import { redis } from "../infra/redis";
import {
  HandoffEnvelope, HermesAudit, HermesSeverity,
  newTaskId, idempotencyKey,
} from "../domain/handoff";

const STREAM = "handoff:stream";

/**
 * Lint estático (sem LLM) da estrutura do active-context.md — TASK 35 Fase 6.
 * Regra: checkpoint sempre no topo (## Modelo ativo é a 1ª seção "## ") e nunca duplicado.
 */
export interface BrainStructureLint {
  ok: boolean;
  issues: string[];
}

export function lintBrainStructure(activeContextRaw: string): BrainStructureLint {
  const issues: string[] = [];
  const text = activeContextRaw.charCodeAt(0) === 0xfeff ? activeContextRaw.slice(1) : activeContextRaw;
  const headers = [...text.matchAll(/^##\s+(.+)$/gm)].map((m) => m[1].trim());

  if (headers.length === 0) {
    return { ok: true, issues: [] };
  }
  if (headers[0] !== 'Modelo ativo') {
    issues.push(`Checkpoint fora do topo: 1ª seção é "${headers[0]}", esperado "Modelo ativo".`);
  }
  const modeloAtivoCount = headers.filter((h) => h === 'Modelo ativo').length;
  if (modeloAtivoCount > 1) {
    issues.push(`Seção "## Modelo ativo" duplicada (${modeloAtivoCount}x) — deve haver só 1, sempre no topo.`);
  }
  return { ok: issues.length === 0, issues };
}
const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434";
const HERMES_MODEL = process.env.HERMES_MODEL || "hermes3:8b";
const TIMEOUT_MS = Number(process.env.HERMES_TIMEOUT_MS || 45_000);

const SYSTEM = `Você é o Hermes 3, auditor sênior da trinca LLM-Brain.
Analise a atualização de contexto e responda SOMENTE com JSON válido neste formato exato:
{"nota": <int 0-10>, "severidade": "low"|"medium"|"high", "riscos": ["..."], "resumo": "<1 linha>"}
Sem texto fora do JSON. Português do Brasil.`;

/** Normaliza/valida a saída do modelo. Saída malformada → severidade "unknown" (nunca lança). */
function coerceAudit(raw: string): HermesAudit {
  try {
    const o = JSON.parse(raw);
    const sev: HermesSeverity = ["low", "medium", "high"].includes(o.severidade) ? o.severidade : "unknown";
    return {
      nota: Number.isFinite(o.nota) ? Math.max(0, Math.min(10, Math.round(o.nota))) : 0,
      severidade: sev,
      riscos: Array.isArray(o.riscos) ? o.riscos.map(String).slice(0, 12) : [],
      resumo: typeof o.resumo === "string" ? o.resumo.slice(0, 400) : "(sem resumo)",
    };
  } catch {
    return { nota: 0, severidade: "unknown", riscos: [], resumo: "Saída do Hermes malformada" };
  }
}

/** Chama o Ollama com timeout. Falha/offline → audit "unknown" (não lança). */
async function callHermes(context: string): Promise<HermesAudit> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: HERMES_MODEL,
        system: SYSTEM,
        prompt: `CONTEXTO RECENTE:\n${context}`,
        format: "json",
        stream: false,
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`);
    const data = await res.json();
    return coerceAudit(data.response ?? "");
  } catch (e) {
    return {
      nota: 0, severidade: "unknown", riscos: [],
      resumo: `Hermes indisponível: ${(e as Error).message}`,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Audita um handoff de forma assíncrona e fire-and-forget.
 * Publica um envelope event_kind="hermes.audit" no stream → o consumer persiste em hermes_audits.
 * NUNCA lança: é chamada sem await pelo worker; uma falha aqui não pode quebrar a troca de bastão.
 */
export async function runHermesAudit(source: HandoffEnvelope) {
  try {
    const context = `Projeto: ${source.project} | Branch: ${source.current_branch}\n`
      + `Status: ${source.lifecycle_status} | ${source.signatures.sender} → ${source.signatures.receiver}\n`
      + `Ação pendente: ${source.payload?.pending_action_item ?? ""}`;

    const audit = await callHermes(context);

    const envelope: HandoffEnvelope = {
      task_id: newTaskId(),
      // Determinístico: dedupe por (correlation + resumo) — não incha o stream com auditorias iguais.
      idempotency_key: idempotencyKey({
        project: source.project,
        commitSha: source.correlation_id,
        action: audit.resumo,
      }),
      schema_version: "7.0",
      timestamp: new Date().toISOString(),
      correlation_id: source.correlation_id,
      project: source.project,
      current_branch: source.current_branch,
      lifecycle_status: "ACKNOWLEDGED", // status válido p/ não corromper o enum; roteamento é por event_kind
      attempt: 1,
      payload: {
        macro_goal: "Auditoria Hermes 3",
        completed_milestones: [],
        pending_action_item: audit.resumo,
        git_context: { commit_sha: source.payload?.git_context?.commit_sha ?? "HEAD", diff_uri: "", untracked_files: [] },
        environment_state: { active_containers: [], affected_databases: [] },
      },
      signatures: { sender: "Hermes_Linter", receiver: source.signatures.sender },
      event_kind: "hermes.audit",
      hermes_audit: audit,
    };

    await redis.xadd(STREAM, "MAXLEN", "~", "100000", "*", "data", JSON.stringify(envelope));
    console.log(`[Hermes] auditoria publicada corr=${source.correlation_id} sev=${audit.severidade}`);
  } catch (e) {
    console.error("[Hermes] runHermesAudit falhou (ignorado):", (e as Error).message);
  }
}
