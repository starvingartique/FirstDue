// POST /api/radio - the ED charge nurse receiving the text report.
// Body: { report: string, state: string, history?: [{ from, text }] }
// Same model and settings as the patient: muse-spark-1.3 Standard,
// Reasoning Low, Temperature 0.7, Max tokens 2000 (shared chatComplete).
// Returns { text, complete }: the nurse ends with [COMPLETE] when the MIST
// elements are covered, and the marker is stripped server-side.

import { Hono } from "hono";
import { chatComplete, type ChatMessage } from "../lib/meta";
import { fillPrompt, loadPrompt } from "../lib/prompts";
import type { ServerConfig } from "../lib/config";

interface RadioBody {
  report?: unknown;
  state?: unknown;
  history?: unknown;
}

const COMPLETE_MARK = "[COMPLETE]";

/** Strip em/en dashes without writing one in this file (char codes). */
function stripDashes(text: string): string {
  const em = String.fromCharCode(0x2014);
  const en = String.fromCharCode(0x2013);
  return text.split(em).join("-").split(en).join("-");
}

export function radioRoutes(config: ServerConfig): Hono {
  const app = new Hono();

  app.post("/radio", async (c) => {
    if (config.modelApiKey === null) {
      return c.json({ error: "MODEL_API_KEY is missing in server/.env" }, 500);
    }
    let body: RadioBody;
    try {
      body = (await c.req.json()) as RadioBody;
    } catch {
      return c.json({ error: "request body must be JSON" }, 400);
    }
    if (typeof body.report !== "string" || body.report.trim() === "") {
      return c.json({ error: "body.report must be a non-empty string" }, 400);
    }
    if (typeof body.state !== "string" || body.state.trim() === "") {
      return c.json({ error: "body.state must be a non-empty string" }, 400);
    }
    const messages: ChatMessage[] = [];
    if (Array.isArray(body.history)) {
      for (const turn of body.history.slice(-10)) {
        if (typeof turn !== "object" || turn === null) continue;
        const { from, text } = turn as { from?: unknown; text?: unknown };
        if (typeof text !== "string" || text === "") continue;
        if (from === "player") messages.push({ role: "user", content: text.slice(0, 1200) });
        else if (from === "nurse") messages.push({ role: "assistant", content: text.slice(0, 600) });
      }
    }
    messages.push({ role: "user", content: body.report.slice(0, 1200) });

    let system: string;
    try {
      system = fillPrompt(loadPrompt("radio"), body.state.slice(0, 2000), "");
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
      // Never let an em-dash reach a nurse line.
      const clean = stripDashes(raw);
      const complete = clean.includes(COMPLETE_MARK);
      const text = clean.split(COMPLETE_MARK).join("").trim();
      return c.json({ text, complete, model: config.modelId });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "Meta call failed" }, 502);
    }
  });

  return app;
}
