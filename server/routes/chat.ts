// POST /api/chat - patient and character dialogue through Muse Spark.
// Body: { messages: [{ role, content }], system?: string, maxTokens?: number }

import { Hono } from "hono";
import { chatComplete, type ChatMessage } from "../lib/meta";
import type { ServerConfig } from "../lib/config";

interface ChatBody {
  messages?: unknown;
  system?: unknown;
  maxTokens?: unknown;
}

function toMessages(body: ChatBody): ChatMessage[] {
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    throw new Error('body.messages must be a non-empty array');
  }
  return body.messages.map((entry) => {
    if (typeof entry !== "object" || entry === null) throw new Error("each message must be an object");
    const { role, content } = entry as { role?: unknown; content?: unknown };
    if (role !== "system" && role !== "user" && role !== "assistant") {
      throw new Error("message.role must be system, user or assistant");
    }
    if (typeof content !== "string" || content === "") {
      throw new Error("message.content must be a non-empty string");
    }
    return { role, content };
  });
}

export function chatRoutes(config: ServerConfig): Hono {
  const app = new Hono();

  app.post("/chat", async (c) => {
    if (config.modelApiKey === null) {
      return c.json({ error: "MODEL_API_KEY is missing in server/.env" }, 500);
    }
    let body: ChatBody;
    try {
      body = (await c.req.json()) as ChatBody;
    } catch {
      return c.json({ error: "request body must be JSON" }, 400);
    }
    let messages: ChatMessage[];
    try {
      messages = toMessages(body);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "bad messages" }, 400);
    }
    if (typeof body.system === "string" && body.system !== "") {
      messages = [{ role: "system", content: body.system }, ...messages];
    }
    const maxTokens =
      typeof body.maxTokens === "number" && Number.isFinite(body.maxTokens)
        ? Math.min(Math.max(Math.floor(body.maxTokens), 1), 4000)
        : undefined;
    try {
      const text = await chatComplete({
        baseUrl: config.modelBaseUrl,
        apiKey: config.modelApiKey,
        model: config.modelId,
        messages,
        maxTokens
      });
      return c.json({ text, model: config.modelId });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "Meta call failed" }, 502);
    }
  });

  return app;
}
