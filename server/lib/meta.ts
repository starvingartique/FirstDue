// Minimal Meta Model API client. One chat call shape for every server route.
// Patient-call params per task spec: Reasoning Low, Temperature 0.7,
// Max tokens 2000 (reasoning shares the budget, so 400 fails).

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  messages: ChatMessage[];
  maxTokens?: number;
}

export const TRANSCRIBE_MODEL = "muse-voice-transcribe-1.0";

export const PATIENT_MAX_TOKENS = 2000;
export const PATIENT_TEMPERATURE = 0.7;

interface ChatCompletionWire {
  choices?: Array<{ message?: { content?: unknown } }>;
}

function contentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) =>
        typeof part === "object" && part !== null && "text" in part
          ? String((part as { text: unknown }).text)
          : ""
      )
      .join("");
  }
  return "";
}

export async function chatComplete(options: ChatOptions): Promise<string> {
  const url = `${options.baseUrl.replace(/\/$/, "")}/chat/completions`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${options.apiKey}`
    },
    body: JSON.stringify({
      model: options.model,
      messages: options.messages,
      temperature: PATIENT_TEMPERATURE,
      max_tokens: options.maxTokens ?? PATIENT_MAX_TOKENS,
      reasoning_effort: "low"
    })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Meta API ${response.status}: ${body.slice(0, 300)}`);
  }

  const data = (await response.json()) as ChatCompletionWire;
  const text = contentToText(data.choices?.[0]?.message?.content);
  if (text === "") throw new Error("Meta API returned no text in choices[0].message.content");
  return text;
}

export interface TranscribeOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  audio: Blob;
  filename: string;
}

interface TranscribeWire {
  text?: unknown;
  transcript?: unknown;
  transcription?: unknown;
  results?: unknown;
}

/**
 * File-upload transcription through POST /asr/transcribe: a "request" JSON
 * part (model, audioEncoding, mode PUSH_TO_TALK) plus the "audio" bytes.
 * Realtime streaming is left for later.
 */
export async function transcribeAudio(options: TranscribeOptions): Promise<string> {
  const url = `${options.baseUrl.replace(/\/$/, "")}/asr/transcribe`;
  const head = new Uint8Array(await options.audio.slice(0, 4).arrayBuffer());
  const isWav = head[0] === 0x52 && head[1] === 0x49 && head[2] === 0x46 && head[3] === 0x46;
  const form = new FormData();
  form.append(
    "request",
    JSON.stringify({
      model: options.model,
      audioEncoding: isWav ? "WAV" : "WEBM",
      mode: "PUSH_TO_TALK"
    })
  );
  form.append("audio", options.audio, options.filename);
  const response = await fetch(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${options.apiKey}`
    },
    body: form
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Meta API ${response.status}: ${body.slice(0, 300)}`);
  }

  const data = (await response.json()) as TranscribeWire;
  const firstResult =
    Array.isArray(data.results) && data.results.length > 0
      ? (data.results[0] as { transcript?: unknown })
      : null;
  const text =
    typeof data.text === "string"
      ? data.text
      : typeof data.transcript === "string"
        ? data.transcript
        : typeof data.transcription === "string"
          ? data.transcription
          : firstResult !== null && typeof firstResult.transcript === "string"
            ? firstResult.transcript
            : "";
  if (text.trim() === "") throw new Error("Meta API returned no transcript text");
  return text;
}
