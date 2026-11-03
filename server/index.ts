// Hono proxy. All Meta API calls go through here so the key never touches
// the client. Routes: /api/health, /api/chat, /api/test, /api/patient,
// /api/radio, /api/generate-call, /api/debrief, /api/transcribe.
// Transcribe, TTS, generate-call and debrief routes land with their milestones.

import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
import { loadConfig } from "./lib/config";
import { chatRoutes } from "./routes/chat";
import { patientRoutes } from "./routes/patient";
import { radioRoutes } from "./routes/radio";
import { generateCallRoutes } from "./routes/generate-call";
import { debriefRoutes } from "./routes/debrief";
import { transcribeRoutes } from "./routes/transcribe";
import { testRoutes } from "./routes/test";

const config = loadConfig();
const app = new Hono();

app.use("/api/*", cors());

app.get("/api/health", (c) =>
  c.json({
    ok: true,
    model: config.modelId,
    keyConfigured: config.modelApiKey !== null,
    time: new Date().toISOString()
  })
);

app.route("/api", chatRoutes(config));
app.route("/api", patientRoutes(config));
app.route("/api", radioRoutes(config));
app.route("/api", generateCallRoutes(config));
app.route("/api", debriefRoutes(config));
app.route("/api", transcribeRoutes(config));
app.route("/api", testRoutes(config));

app.notFound((c) => c.json({ error: "not found" }, 404));
app.onError((error, c) => {
  console.error("server error:", error);
  return c.json({ error: "internal server error" }, 500);
});

console.log(`First Due server on http://${config.hostname}:${config.port} (model ${config.modelId})`);
serve({ fetch: app.fetch, port: config.port, hostname: config.hostname });
