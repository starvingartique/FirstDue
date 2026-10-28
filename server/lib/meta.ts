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
