// POST /api/generate-call - Dispatch Engine v1. Seeded skeleton (code),
// Muse Spark fleshing (strict JSON), validator (code), cache on disk.
// Same model and settings as the patient route: muse-spark-1.3 Standard,
// Reasoning Low, Temperature 0.7, Max tokens 2000 (shared chatComplete
// defaults, untouched). Body: { seed?: number, level?: 1 | 2 }.
// Returns { call, skeleton, cached, fallbackNote } and always resolves to a
// playable call: cache hit, fresh generation, cached fallback, or the
// bike_down fallback signal for the client. Never leaves Dispatch stuck.

import { Hono } from "hono";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chatComplete } from "../lib/meta";
import { fillPrompt, loadPrompt } from "../lib/prompts";
import type { ServerConfig } from "../lib/config";
import {
  loadBystanders,
  loadComplaints,
  loadComplications,
  loadEnvironments,
  loadMechanisms
} from "../../src/data/loaders";
import { sampleSkeleton } from "../../src/dispatch/sampler";
import {
  assembleCall,
  parseFlesh,
  validateFleshedCall,
  validateSkeleton
} from "../../src/dispatch/validate";
import type { CallSkeleton, FleshedCall } from "../../src/dispatch/types";

const serverDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.join(serverDir, "..");
const cacheDir = path.join(repoRoot, "data", "calls", "cache");

function cacheFile(seed: number, level: number): string {
  return path.join(cacheDir, `gen_${seed}_L${level}.json`);
}

/** Reads one cache file. Returns null when missing, unparsable or invalid. */
function readCached(file: string): FleshedCall | null {
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
    return validateFleshedCall(raw).ok ? (raw as FleshedCall) : null;
  } catch {
    return null;
  }
}

/** Seeded pick of a valid cached call, skipping invalid files. */
function pickCached(seed: number): { file: string; call: FleshedCall } | null {
  let files: string[] = [];
  try {
    files = fs.readdirSync(cacheDir).filter((f) => f.endsWith(".json")).sort();
  } catch {
    return null;
  }
  if (files.length === 0) return null;
  const start = Math.abs(seed) % files.length;
  for (let i = 0; i < files.length; i++) {
    const file = files[(start + i) % files.length] as string;
    const call = readCached(path.join(cacheDir, file));
    if (call !== null) return { file, call };
  }
  return null;
}

/** Strip em/en dashes without writing one in this file (char codes). */
function stripDashes(text: string): string {
  const em = String.fromCharCode(0x2014);
  const en = String.fromCharCode(0x2013);
  return text.split(em).join("-").split(en).join("-");
}

/** Compact prompt context: the skeleton plus the labels the model needs. */
function skeletonContext(s: CallSkeleton): string {
  const complaint =
    loadComplaints().complaints.find((c) => c.id === s.complaintId)?.label ?? s.complaintId;
  const mechanism = loadMechanisms().mechanisms.find((m) => m.id === s.mechanismId);
  const subtype = mechanism?.subtypes.find((t) => t.id === s.subtypeId);
  const env = loadEnvironments().environments.find((e) => e.id === s.environmentId);
  const arch =
    s.bystanderId === null
      ? null
      : loadBystanders().archetypes.find((a) => a.id === s.bystanderId);
  const complication =
    s.complication === null
      ? null
      : loadComplications().complications.find((c) => c.id === s.complication?.id)?.label ??
        s.complication.id;
  return JSON.stringify(
    {
      skeleton: s,
      context: {
        complaint,
        mechanism: s.mechanismId,
        subtype: s.subtypeId,
        subtypeClues: subtype?.sceneClues ?? [],
        subtypeNote: subtype?.medicNote ?? "",
        environment: env?.label ?? s.environmentId,
        hazards: env?.hazards ?? [],
        bystander: arch === null ? null : { label: arch?.label, behavior: arch?.behavior },
        complication
      }
    },
    null,
    1
  );
}

interface GenerateBody {
  seed?: unknown;
  level?: unknown;
}

export function generateCallRoutes(config: ServerConfig): Hono {
  const app = new Hono();

  app.post("/generate-call", async (c) => {
    let body: GenerateBody;
    try {
      body = (await c.req.json()) as GenerateBody;
    } catch {
      return c.json({ error: "request body must be JSON" }, 400);
    }
    const level = body.level === 1 ? 1 : 2;
    const seed =
      typeof body.seed === "number" && Number.isFinite(body.seed)
        ? Math.floor(Math.abs(body.seed)) % 1000000
        : Math.floor(Math.random() * 1000000);

    // Cache hit: instant and deterministic.
    const hit = readCached(cacheFile(seed, level));
    if (hit !== null) {
      return c.json({ call: hit, skeleton: hit.skeleton, cached: true, fallbackNote: null });
    }

    // Skeleton: code, not LLM.
    let skeleton: CallSkeleton;
    try {
      skeleton = sampleSkeleton(seed, level);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "sampler failed" }, 500);
    }
    const skel = validateSkeleton(skeleton);
    if (!skel.ok) {
      const fb = pickCached(seed);
      if (fb !== null) {
        return c.json({
          call: fb.call,
          skeleton: fb.call.skeleton,
          cached: true,
          fallbackNote: `Sampler output invalid; served cached call ${fb.file}.`
        });
      }
      return c.json({ error: `invalid skeleton: ${skel.errors.join("; ")}`, fallback: "bike_down" }, 500);
    }

    if (config.modelApiKey === null) {
      const fb = pickCached(seed);
      if (fb !== null) {
        return c.json({
          call: fb.call,
          skeleton: fb.call.skeleton,
          cached: true,
          fallbackNote: `MODEL_API_KEY is missing in server/.env; served cached call ${fb.file}.`
        });
      }
      return c.json(
        { error: "MODEL_API_KEY is missing in server/.env and the cache is empty", fallback: "bike_down" },
        500
      );
    }

    // Fleshing: Muse Spark, strict JSON. Invalid output retries once, then
    // falls back to a cached call. Never no call.
    const state = skeletonContext(skeleton);
    let system: string;
    try {
      system = fillPrompt(loadPrompt("callgen"), state, "");
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "prompt load failed" }, 500);
    }
    let lastErrors = ["unknown error"];
    let userTurn = "Generate the fleshed call JSON for this skeleton.";
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const raw = await chatComplete({
          baseUrl: config.modelBaseUrl,
          apiKey: config.modelApiKey,
          model: config.modelId,
          messages: [
            { role: "system", content: system },
            { role: "user", content: userTurn.slice(0, 2000) }
          ]
        });
        const call = assembleCall(skeleton, parseFlesh(stripDashes(raw)));
        const checked = validateFleshedCall(call);
        if (checked.ok) {
          try {
            fs.writeFileSync(cacheFile(seed, level), `${JSON.stringify(call, null, 2)}\n`);
          } catch {
            // A cache write failure must not fail an otherwise good call.
          }
          return c.json({ call, skeleton, cached: false, fallbackNote: null, model: config.modelId });
        }
        lastErrors = checked.errors;
      } catch (error) {
        lastErrors = [error instanceof Error ? error.message : "fleshing failed"];
      }
      try {
        system = fillPrompt(
          loadPrompt("callgen"),
          state,
          `The previous output failed validation:\n${lastErrors.join("\n")}\nFix every item and return only valid JSON.`
        );
      } catch {
        break;
      }
      userTurn = "Regenerate the fleshed call JSON with every validation error fixed.";
    }
    const fb = pickCached(seed);
    if (fb !== null) {
      return c.json({
        call: fb.call,
        skeleton: fb.call.skeleton,
        cached: true,
        fallbackNote: `Generation failed (${lastErrors.join("; ").slice(0, 200)}); served cached call ${fb.file}.`
      });
    }
    return c.json(
      { error: `Generation failed: ${lastErrors.join("; ")}`, fallback: "bike_down" },
      502
    );
  });

  return app;
}
