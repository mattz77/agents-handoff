import { pg } from "../infra/postgres";
import { decryptSecret, secretsEnabled } from "../infra/secret-box";
import { nimChat, listNimModels, extractJson, NimChatMessage, NimChatOptions } from "./nim-client";

export { extractJson };
export type { NimChatMessage, NimChatOptions };

export type ProviderType = "nim" | "openai" | "anthropic" | "opencode";

const DEFAULT_BASE: Record<ProviderType, string> = {
  nim: process.env.LINTER_BASE_URL || "https://integrate.api.nvidia.com/v1",
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com/v1",
  opencode: process.env.OPENCODE_GO_BASE_URL || "https://opencode.ai/zen/v1",
};

const TIMEOUT_MS = Number(process.env.LINTER_TIMEOUT_MS || 120_000);
const MAX_TOKENS = Number(process.env.LINTER_MAX_TOKENS || 8192);
const MAX_RETRIES = 2;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface ProviderConfig {
  providerType: ProviderType;
  apiKey: string;
  baseUrl: string;
  model: string;
}

// ---------------------------------------------------------------------------
// Roteamento por prefixo no nome do modelo: "openai:gpt-5", "anthropic:claude-...",
// "nim:meta/llama-..." ou bare (sem prefixo) = NIM. Assim o seletor de modelo já
// existente no code review escolhe o provedor sem UX nova.
// ---------------------------------------------------------------------------
export function parseModel(model?: string): { provider: ProviderType; model: string | undefined } {
  if (!model) return { provider: "nim", model: undefined };
  const m = model.match(/^(nim|openai|anthropic|opencode):(.+)$/);
  if (m) return { provider: m[1] as ProviderType, model: m[2] };
  return { provider: "nim", model };
}

// Config do DB (api key criptografada). Cache curto pra não descriptografar a cada chamada.
let cfgCache: { at: number; rows: any[] } | null = null;
const CFG_TTL_MS = 30_000;

async function loadConfigRows(): Promise<any[]> {
  if (cfgCache && Date.now() - cfgCache.at < CFG_TTL_MS) return cfgCache.rows;
  await pg.query(`create table if not exists agent_providers (
    id bigserial primary key, provider_type text not null, project_slug text,
    api_key_enc text, base_url text, model text, is_default boolean not null default false,
    created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
    unique (provider_type, project_slug))`);
  const { rows } = await pg.query(`select provider_type, project_slug, api_key_enc, base_url, model, is_default from agent_providers`);
  cfgCache = { at: Date.now(), rows };
  return rows;
}

/** Invalida o cache de config (chamar após upsert/delete no painel). */
export function invalidateProviderCache() { cfgCache = null; }

/** Resolve a config efetiva de um provider (linha do projeto tem prioridade sobre a global). */
async function resolveConfig(provider: ProviderType, projectSlug?: string): Promise<ProviderConfig | null> {
  const rows = await loadConfigRows();
  const forType = rows.filter((r) => r.provider_type === provider);
  const row = forType.find((r) => r.project_slug === projectSlug) || forType.find((r) => !r.project_slug);
  if (!row) {
    // NIM tem fallback nativo via env (comportamento atual preservado).
    if (provider === "nim" && (process.env.LINTER_API_KEY || "")) {
      return { providerType: "nim", apiKey: process.env.LINTER_API_KEY || "", baseUrl: DEFAULT_BASE.nim, model: process.env.LINTER_MODEL || "minimaxai/minimax-m3" };
    }
    // OpenCode Go: fallback via OPENCODE_GO_API_KEY (mesma key de ~/.local/share/opencode/auth.json).
    if (provider === "opencode" && (process.env.OPENCODE_GO_API_KEY || "")) {
      return {
        providerType: "opencode",
        apiKey: process.env.OPENCODE_GO_API_KEY || "",
        baseUrl: DEFAULT_BASE.opencode,
        model: process.env.OPENCODE_GO_MODEL || "kimi-k2.5",
      };
    }
    return null;
  }
  let apiKey = "";
  if (row.api_key_enc && secretsEnabled()) {
    try { apiKey = decryptSecret(row.api_key_enc); } catch { apiKey = ""; }
  }
  if (!apiKey && provider === "nim") apiKey = process.env.LINTER_API_KEY || "";
  if (!apiKey && provider === "opencode") apiKey = process.env.OPENCODE_GO_API_KEY || "";
  return {
    providerType: provider,
    apiKey,
    baseUrl: row.base_url || DEFAULT_BASE[provider],
    model: row.model || (provider === "nim" ? (process.env.LINTER_MODEL || "minimaxai/minimax-m3") : provider === "opencode" ? (process.env.OPENCODE_GO_MODEL || "kimi-k2.5") : ""),
  };
}

/** Status de configuração de cada provider (pro painel e pra montar o seletor de modelos). */
export async function providerStatus(projectSlug?: string): Promise<Array<{ provider: ProviderType; configured: boolean; model: string; base_url: string; is_default: boolean }>> {
  const rows = await loadConfigRows();
  const out: Array<{ provider: ProviderType; configured: boolean; model: string; base_url: string; is_default: boolean }> = [];
  for (const provider of ["nim", "openai", "anthropic", "opencode"] as ProviderType[]) {
    const forType = rows.filter((r) => r.provider_type === provider);
    const row = forType.find((r) => r.project_slug === projectSlug) || forType.find((r) => !r.project_slug);
    const cfg = await resolveConfig(provider, projectSlug);
    out.push({
      provider,
      configured: !!(cfg && cfg.apiKey),
      model: cfg?.model || row?.model || "",
      base_url: cfg?.baseUrl || row?.base_url || DEFAULT_BASE[provider],
      is_default: !!row?.is_default,
    });
  }
  return out;
}

/** true se o provider tem API key resolvível (DB ou env NIM). */
export async function isProviderConfigured(provider: ProviderType, projectSlug?: string): Promise<boolean> {
  const cfg = await resolveConfig(provider, projectSlug);
  return !!(cfg && cfg.apiKey);
}

/** Provider marcado is_default (linha do projeto > global). Usado quando o model não traz prefixo nem existe env NIM. */
async function defaultProvider(projectSlug?: string): Promise<ProviderType | null> {
  const rows = await loadConfigRows();
  const defaults = rows.filter((r) => r.is_default);
  const row = defaults.find((r) => r.project_slug === projectSlug) || defaults.find((r) => !r.project_slug);
  return row ? (row.provider_type as ProviderType) : null;
}

// ---------------------------------------------------------------------------
// Implementações HTTP
// ---------------------------------------------------------------------------
async function withTimeout<T>(fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try { return await fn(ctrl.signal); } finally { clearTimeout(timer); }
}

/** Chat OpenAI-compatible (serve OpenAI e NIM configurado via DB — mesmo schema /chat/completions). */
async function openaiCompatChat(cfg: ProviderConfig, messages: NimChatMessage[], opts: NimChatOptions): Promise<string> {
  return withTimeout(async (signal) => {
    const body: Record<string, unknown> = {
      model: opts.model || cfg.model,
      messages,
      temperature: opts.temperature ?? 0.2,
      max_tokens: MAX_TOKENS,
    };
    if (opts.jsonMode) body.response_format = { type: "json_object" };
    const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify(body),
      signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      const err = new Error(`${cfg.providerType} HTTP ${res.status}: ${text.slice(0, 500)}`) as Error & { status?: number };
      err.status = res.status;
      throw err;
    }
    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== "string") throw new Error(`${cfg.providerType} resposta sem content`);
    return content;
  });
}

/** Chat Anthropic — schema diferente: system separado, /v1/messages, header x-api-key. */
async function anthropicChat(cfg: ProviderConfig, messages: NimChatMessage[], opts: NimChatOptions): Promise<string> {
  return withTimeout(async (signal) => {
    const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
    const convo = messages.filter((m) => m.role !== "system").map((m) => ({ role: m.role, content: m.content }));
    const body: Record<string, unknown> = {
      model: opts.model || cfg.model,
      max_tokens: MAX_TOKENS,
      temperature: opts.temperature ?? 0.2,
      messages: convo,
    };
    if (system) body.system = opts.jsonMode ? `${system}\n\nResponda APENAS com JSON válido, sem texto fora do objeto.` : system;
    const res = await fetch(`${cfg.baseUrl}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": cfg.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
      signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      const err = new Error(`anthropic HTTP ${res.status}: ${text.slice(0, 500)}`) as Error & { status?: number };
      err.status = res.status;
      throw err;
    }
    const data = await res.json();
    const content = Array.isArray(data?.content) ? data.content.filter((c: any) => c.type === "text").map((c: any) => c.text).join("") : "";
    if (!content) throw new Error("anthropic resposta sem content");
    return content;
  });
}

async function chatOnce(cfg: ProviderConfig, messages: NimChatMessage[], opts: NimChatOptions): Promise<string> {
  return cfg.providerType === "anthropic" ? anthropicChat(cfg, messages, opts) : openaiCompatChat(cfg, messages, opts);
}

// ---------------------------------------------------------------------------
// API pública
// ---------------------------------------------------------------------------
/**
 * Chat unificado — substitui nimChat nos agentes. O provedor sai do prefixo do modelo
 * ("openai:gpt-5", "anthropic:claude-...", bare/"nim:..." = NIM) ou do provider is_default.
 * Retry em 429/5xx e blips de rede. Mantém a assinatura de nimChat.
 */
export async function providerChat(messages: NimChatMessage[], opts: NimChatOptions & { projectSlug?: string } = {}): Promise<string> {
  let { provider, model } = parseModel(opts.model);
  // Sem prefixo e sem env NIM: tenta o provider default configurado.
  if ((!opts.model || provider === "nim") && !(process.env.LINTER_API_KEY || "")) {
    const dflt = await defaultProvider(opts.projectSlug);
    if (dflt) provider = dflt;
  }

  // Caminho nativo NIM via env (comportamento legado intacto) quando não há config de DB.
  const cfg = await resolveConfig(provider, opts.projectSlug);
  if (provider === "nim" && !cfg) {
    return nimChat(messages, { ...opts, model });
  }
  if (!cfg || !cfg.apiKey) {
    throw new Error(`Provider "${provider}" não configurado (sem API key). Configure em /ops → Modelos IA.`);
  }

  let lastErr: Error | undefined;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await chatOnce(cfg, messages, { ...opts, model });
    } catch (e) {
      lastErr = e as Error;
      const status = (e as Error & { status?: number }).status;
      const isNetworkGlitch = e instanceof Error && (e.name === "AbortError" || /aborted|fetch failed|ECONNRESET|ETIMEDOUT/i.test(e.message));
      const retryable = status === 429 || (status !== undefined && status >= 500) || isNetworkGlitch;
      if (!retryable || attempt === MAX_RETRIES) throw lastErr;
      await sleep(1000 * 2 ** attempt);
    }
  }
  throw lastErr;
}

const STATIC_MODELS: Record<Exclude<ProviderType, "nim">, string[]> = {
  openai: ["gpt-5", "gpt-5-mini", "gpt-4.1", "o4-mini"],
  anthropic: ["claude-opus-4-8", "claude-sonnet-5", "claude-haiku-4-5-20251001"],
  // Catálogo OpenCode Go (zen) — GET /models real quando key presente; fallback estático.
  opencode: [
    "kimi-k2.5", "kimi-k2.6", "kimi-k2.7-code",
    "glm-5", "glm-5.1", "glm-5.2",
    "qwen3.5-plus", "qwen3.6-plus",
    "minimax-m2.5", "minimax-m2.7", "minimax-m3",
    "grok-4.5", "deepseek-v4-pro", "deepseek-v4-flash",
    "claude-sonnet-4-6", "claude-opus-4-6", "gpt-5.4",
  ],
};

/** Lista modelos de um provider. NIM = catálogo real; OpenAI/Anthropic = GET /models com fallback estático. */
export async function listProviderModels(provider: ProviderType, projectSlug?: string): Promise<string[]> {
  if (provider === "nim") return listNimModels();
  const cfg = await resolveConfig(provider, projectSlug);
  if (!cfg || !cfg.apiKey) return STATIC_MODELS[provider];
  try {
    const res = await fetch(`${cfg.baseUrl}/models`, {
      headers: provider === "anthropic"
        ? { "x-api-key": cfg.apiKey, "anthropic-version": "2023-06-01" }
        : { Authorization: `Bearer ${cfg.apiKey}` },
    });
    if (!res.ok) return STATIC_MODELS[provider];
    const data = await res.json();
    const ids: string[] = Array.isArray(data?.data) ? data.data.map((m: any) => m.id).filter(Boolean).sort() : [];
    return ids.length ? ids : STATIC_MODELS[provider];
  } catch {
    return STATIC_MODELS[provider];
  }
}

/** Testa conectividade de um provider (chamada mínima). Retorna latência. */
export async function testProvider(provider: ProviderType, projectSlug?: string): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  const started = Date.now();
  try {
    if (provider === "nim") {
      await listNimModels();
    } else {
      const cfg = await resolveConfig(provider, projectSlug);
      if (!cfg || !cfg.apiKey) throw new Error("não configurado");
      await chatOnce(cfg, [{ role: "user", content: "ping" }], { model: cfg.model, temperature: 0 });
    }
    return { ok: true, latencyMs: Date.now() - started };
  } catch (e) {
    return { ok: false, latencyMs: Date.now() - started, error: (e as Error).message };
  }
}
