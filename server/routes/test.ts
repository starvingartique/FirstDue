// GET /api/test - one fixed Muse Spark call. Used by `npm run server:test`
// for the Oct 27 acceptance check. Returns live model text or a clear error.

import { Hono } from "hono";
import { chatComplete } from "../lib/meta";
import type { ServerConfig } from "../lib/config";

export function testRoutes(config: ServerConfig): Hono {
  const app = new Hono();

  app.get("/test", async (c) => {
    if (config.modelApiKey === null) {
      return c.json({ error: "MODEL_API_KEY is missing in server/.env" }, 500);
    }
    try {
      const text = await chatComplete({
        baseUrl: config.modelBaseUrl,
        apiKey: config.modelApiKey,
        model: config.modelId,
        messages: [
          {
            role: "user",
            content: "Reply with exactly: First Due server link OK."
          }
        ]
      });
      return c.json({ text, model: config.modelId });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "Meta call failed" }, 502);
    }
  });

  return app;
}
