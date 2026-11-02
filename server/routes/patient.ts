// POST /api/patient - the talking patient through Muse Spark.
// Body: { message: string, state: string, history?: [{ from, text }], persona?: string }
// Bike down plays Josh: the locked character block comes from bike_down.json
// patientPrompt (read server-side, never trusted from the client). A
// generated call sends its own persona and history instead, and the route
// plays that patient with generic rules, never Josh. Model settings are
// untouched: muse-spark-1.3 Standard, Reasoning Low, Temperature 0.7,
// Max tokens 2000.

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
  persona?: unknown;
}

/**
 * Generated-call voice. The persona and history come from the fleshed call;
 * the rules below are the generic version of the Josh prompt: same shape,
 * no Josh identity, no fixed pain number, secrets only on the right
 * questions. Model and settings are untouched (shared chatComplete call).
 */
function generatedSystem(persona: string, state: string): string {
  return [
    "You play the injured or ill patient in a paramedic training sim. Stay in character as that patient.",
    "",
    "Rules:",
    "- Speak only as this patient would speak, given the persona, history and state below. One or two short sentences per reply, unless the player asks an open question.",
    "- Your words never change the patient's body, vitals, or scene. The sim engine owns all of that.",
    "- Answer only what you were asked. Reveal history details and secrets only when the right questions are asked.",
    "- Plain words only. Reflect the pain level, whether a tourniquet is on and tight, whether the patient can breathe comfortably, and confusion or lethargy as the state worsens.",
    "- Never state exact vitals numbers the patient could not know (no heart rate, no blood pressure, no oxygen numbers). Pain out of 10 is fine when asked.",
    "- Never claim an injury, exposure, or event that is not in the persona, history, or engine state below. Never borrow another patient's story.",
    "- Never use em-dashes. Use single hyphens - like this - if you need a pause.",
    "- Never break character, never mention you are an AI, never give medical advice to the player.",
    "",
    "Current engine state (stay consistent with every line):",
    state.slice(0, 2000),
    "",
    "Persona and history (this patient only):",
    persona.slice(0, 4000)
  ].join("\n");
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
        else if (from === "patient" || from === "josh") messages.push({ role: "assistant", content: text.slice(0, 600) });
      }
    }
    messages.push({ role: "user", content: body.message.slice(0, 300) });

    const persona =
      typeof body.persona === "string" && body.persona.trim() !== "" ? body.persona : null;
    let system: string;
    try {
      system =
        persona === null
          ? fillPrompt(loadPrompt("patient"), body.state.slice(0, 2000), lockedBlock())
          : generatedSystem(persona, body.state);
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
