const BASE_URL = process.env.LINTER_BASE_URL || "https://integrate.api.nvidia.com/v1";
const API_KEY = process.env.LINTER_API_KEY || "";
const MODEL = process.env.LINTER_MODEL || "minimaxai/minimax-m3";
const TIMEOUT_MS = Number(process.env.LINTER_TIMEOUT_MS || 120_000);
const MAX_TOKENS = Number(process.env.LINTER_MAX_TOKENS || 8192);
const MAX_RETRIES = 2;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface NimChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface NimChatOptions {
  jsonMode?: boolean;
  temperature?: number;
}

async function chatOnce(messages: NimChatMessage[], opts: NimChatOptions): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const body: Record<string, unknown> = {
      model: MODEL,
      messages,
      temperature: opts.temperature ?? 0.2,
      max_tokens: MAX_TOKENS,
    };
    if (opts.jsonMode) body.response_format = { type: "json_object" };

    const res = await fetch(`${BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      const err = new Error(`NIM HTTP ${res.status}: ${text.slice(0, 500)}`) as Error & { status?: number };
      err.status = res.status;
      throw err;
    }
    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== "string") throw new Error("NIM resposta sem content");
    return content;
  } finally {
    clearTimeout(timer);
  }
}

/** Cliente OpenAI-compatible para o endpoint do Minimax M3 (NVIDIA NIM). Retry em 429/5xx. */
export async function nimChat(messages: NimChatMessage[], opts: NimChatOptions = {}): Promise<string> {
  if (!API_KEY) throw new Error("LINTER_API_KEY não configurado no .env");

  let lastErr: Error | undefined;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await chatOnce(messages, opts);
    } catch (e) {
      lastErr = e as Error;
      const status = (e as Error & { status?: number }).status;
      const retryable = status === 429 || (status !== undefined && status >= 500);
      if (!retryable || attempt === MAX_RETRIES) throw lastErr;
      await sleep(1000 * 2 ** attempt);
    }
  }
  throw lastErr;
}

/** Extrai o JSON de uma resposta de modelo de reasoning (strip <think>, cercas markdown, texto solto). */
export function extractJson(raw: string): string {
  let text = raw.replace(/<think>[\s\S]*?<\/think>/gi, "");
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1];
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    throw new Error("Nenhum JSON encontrado na resposta do modelo");
  }
  return text.slice(start, end + 1);
}
