// POST /api/transcribe - push-to-talk voice through Muse Voice Transcribe.
// Multipart body: { audio: File }. The key never touches the client: the
// server forwards the bytes to model muse-voice-transcribe-1.0 and returns
// { text }. File upload first; realtime streaming is left for later. Text
// chat stays the always-on fallback.

import { Hono } from "hono";
import { TRANSCRIBE_MODEL, transcribeAudio } from "../lib/meta";
import type { ServerConfig } from "../lib/config";

const MAX_BYTES = 5 * 1024 * 1024;

export function transcribeRoutes(config: ServerConfig): Hono {
  const app = new Hono();

  app.post("/transcribe", async (c) => {
    if (config.modelApiKey === null) {
      return c.json({ error: "MODEL_API_KEY is missing in server/.env" }, 500);
    }
    let audio: unknown;
    try {
      const body = await c.req.parseBody();
      audio = body["audio"];
    } catch {
      return c.json({ error: "request body must be multipart form data" }, 400);
    }
    if (!(audio instanceof File)) {
      return c.json({ error: "multipart field audio must be a file" }, 400);
    }
    if (audio.size === 0 || audio.size > MAX_BYTES) {
      return c.json({ error: "audio must be 1 byte to 5 MB" }, 400);
    }
    try {
      const text = await transcribeAudio({
        baseUrl: config.modelBaseUrl,
        apiKey: config.modelApiKey,
        model: TRANSCRIBE_MODEL,
        audio,
        filename: audio.name !== "" ? audio.name : "talk.webm"
      });
      return c.json({ text, model: TRANSCRIBE_MODEL });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "Meta call failed" }, 502);
    }
  });

  return app;
}
