// POST /api/patient - the talking patient through Muse Spark.
// Body: { message: string, state: string, history?: [{ from, text }] }
// The locked character block comes from bike_down.json patientPrompt (read
// server-side, never trusted from the client). Model settings are untouched:
// muse-spark-1.3 Standard, Reasoning Low, Temperature 0.7, Max tokens 2000.

import { Hono } from "hono";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chatComplete, type ChatMessage } from "../lib/meta";
import { fillPrompt, loadPrompt } from "../lib/prompts";
import type { ServerConfig } from "../lib/config";

const serverDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.join(serverDir, "..");

interface PatientBody {
  message?: unknown;
  state?: unknown;
  history?: unknown;
}

function lockedBlock(): string {
  const file = path.join(repoRoot, "data", "calls", "fixed", "bike_down.json");
  const raw = JSON.parse(fs.readFileSync(file, "utf8")) as {
    backstory?: unknown;
    patientPrompt?: {
      name?: unknown;
      ageSex?: unknown;
      backstoryLocked?: unknown;
      personality?: unknown;
      painAtSceneStart?: unknown;
      weightLine?: unknown;
      weightLineTrigger?: unknown;
      tourniquetPainLine?: unknown;
      speechRules?: unknown;
    };
  };
  const p = raw.patientPrompt ?? {};
  const rules = Array.isArray(p.speechRules) ? p.speechRules.map((r) => `- ${String(r)}`).join("\n") : "";
  return [
    `Locked identity: ${String(p.name ?? "Josh")}, ${String(p.ageSex ?? "28M")}.`,
    `Locked backstory: ${String(p.backstoryLocked ?? raw.backstory ?? "")}`,
    `Personality: ${String(p.personality ?? "")}`,
    `Pain: ${String(p.painAtSceneStart ?? "")}`,
    `Weight answer: "${String(p.weightLine ?? "")}" (${String(p.weightLineTrigger ?? "")})`,
    `Tourniquet: ${String(p.tourniquetPainLine ?? "")}`,
    rules
  ].join("\n");
}

export function patientRoutes(config: ServerConfig): Hono {
  const app = new Hono();

  app.post("/patient", async (c) => {
    if (config.modelApiKey === null) {
      return c.json({ error: "MODEL_API_KEY is missing in server/.env" }, 500);
    }
    let body: PatientBody;
    try {
      body = (await c.req.json()) as PatientBody;
    } catch {
      return c.json({ error: "request body must be JSON" }, 400);
    }
    if (typeof body.message !== "string" || body.message.trim() === "") {
      return c.json({ error: "body.message must be a non-empty string" }, 400);
    }
    if (typeof body.state !== "string" || body.state.trim() === "") {
      return c.json({ error: "body.state must be a non-empty string" }, 400);
    }
    const messages: ChatMessage[] = [];
    if (Array.isArray(body.history)) {
      for (const turn of body.history.slice(-8)) {
        if (typeof turn !== "object" || turn === null) continue;
        const { from, text } = turn as { from?: unknown; text?: unknown };
        if (typeof text !== "string" || text === "") continue;
        if (from === "player") messages.push({ role: "user", content: text.slice(0, 300) });
        else if (from === "josh") messages.push({ role: "assistant", content: text.slice(0, 600) });
      }
    }
    messages.push({ role: "user", content: body.message.slice(0, 300) });

    let system: string;
    try {
      system = fillPrompt(loadPrompt("patient"), body.state.slice(0, 2000), lockedBlock());
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "prompt load failed" }, 500);
    }
    try {
      const raw = await chatComplete({
        baseUrl: config.modelBaseUrl,
        apiKey: config.modelApiKey,
        model: config.modelId,
        messages: [{ role: "system", content: system }, ...messages]
      });
      // Never let an em-dash reach a patient line.
      const text = raw.replaceAll("\u2014", "-").replaceAll("\u2013", "-");
      return c.json({ text, model: config.modelId });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "Meta call failed" }, 502);
    }
  });

  return app;
}
