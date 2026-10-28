// Server config. The Meta key lives only in server/.env (gitignored) and is
// read here, on the server. Client code must never import this module.

import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

// This file lives in server/lib, the env file lives in server/.
const serverDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: path.join(serverDir, ".env") });

export interface ServerConfig {
  hostname: string;
  port: number;
  modelApiKey: string | null;
  modelBaseUrl: string;
  modelId: string;
}

function readEnv(name: string): string | null {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") return null;
  return value.trim();
}

export function loadConfig(): ServerConfig {
  const portRaw = readEnv("PORT");
  return {
    // Localhost only: this server holds the key, it must not face the LAN.
    hostname: readEnv("HOST") ?? "127.0.0.1",
    port: portRaw === null ? 8787 : Number(portRaw),
    // Only read from the server env. Never log this value.
    modelApiKey: readEnv("MODEL_API_KEY"),
    modelBaseUrl: readEnv("MODEL_BASE_URL") ?? "https://api.meta.ai/v1",
    // Task spec: muse-spark-1.3 Standard, never the contributor model.
    // Confirm the exact id against dev.meta.ai docs on first run (brief 2).
    modelId: readEnv("MODEL_ID") ?? "muse-spark-1.3"
  };
}
