// POST /api/debrief - the FTO debrief after handoff.
// Body: { facts: string } - the client-built run facts (log lines, final
// state, expected pathway, destination and radio as logged).
// Same model and settings as the patient: muse-spark-1.3 Standard,
// Reasoning Low, Temperature 0.7, Max tokens 2000 (shared chatComplete).
// Returns { text, model }. If this route fails, the client renders a
// code-built debrief from the same facts, never a blank screen.

import { Hono } from "hono";
import { chatComplete } from "../lib/meta";
import { fillPrompt, loadPrompt } from "../lib/prompts";
import type { ServerConfig } from "../lib/config";

interface DebriefBody {
  facts?: unknown;
}

/** Strip em/en dashes without writing one in this file (char codes). */
function stripDashes(text: string): string {
  const em = String.fromCharCode(0x2014);
  const en = String.fromCharCode(0x2013);
  return text.split(em).join("-").split(en).join("-");
}

export function debriefRoutes(config: ServerConfig): Hono {
  const app = new Hono();

  app.post("/debrief", async (c) => {
    if (config.modelApiKey === null) {
      return c.json({ error: "MODEL_API_KEY is missing in server/.env" }, 500);
    }
    let body: DebriefBody;
    try {
      body = (await c.req.json()) as DebriefBody;
    } catch {
      return c.json({ error: "request body must be JSON" }, 400);
    }
    if (typeof body.facts !== "string" || body.facts.trim() === "") {
      return c.json({ error: "body.facts must be a non-empty string" }, 400);
    }

    let system: string;
    try {
      system = fillPrompt(loadPrompt("fto"), body.facts.slice(0, 6000), "");
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "prompt load failed" }, 500);
    }
    try {
      const raw = await chatComplete({
        baseUrl: config.modelBaseUrl,
        apiKey: config.modelApiKey,
        model: config.modelId,
        messages: [
          { role: "system", content: system },
          { role: "user", content: "Debrief this run." }
        ]
      });
      // Never let an em-dash reach a debrief line.
      return c.json({ text: stripDashes(raw), model: config.modelId });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "Meta call failed" }, 502);
    }
  });

  return app;
}
