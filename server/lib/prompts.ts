// Prompt template loader. Templates live in server/prompts/*.txt and receive
// an engine state snapshot at call time (brief section 9). {{STATE}} marks
// where the snapshot goes; {{EXTRA}} marks per-call additions.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type PromptName = "patient" | "bystander" | "dispatch" | "radio" | "fto" | "callgen";

const promptsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "prompts");

export function loadPrompt(name: PromptName): string {
  const file = path.join(promptsDir, `${name}.txt`);
  if (!fs.existsSync(file)) throw new Error(`missing prompt template ${name}.txt`);
  return fs.readFileSync(file, "utf8");
}

export function fillPrompt(template: string, state: string, extra = ""): string {
  return template.replaceAll("{{STATE}}", state).replaceAll("{{EXTRA}}", extra);
}
