import http from "node:http";
import { createHash, timingSafeEqual } from "node:crypto";
import { pg } from "../infra/postgres";
import { getBrainStatus } from "./metrics";
import { getCodeReviewData } from "./codereview-data";
import { runCodeReviewForSlug } from "./codereview-cron";

// API de agente — consumida por bots externos (Telegram via n8n, AnythingLLM agent skill).
// Fica fora de /ops/api/* de propósito: aquele prefixo é gated pelo Cloudflare Access (JWT de
// browser), que bots não têm. Aqui a auth é Bearer token fixo (AGENT_API_TOKEN no .env).
let AGENT_TOKEN = process.env.AGENT_API_TOKEN || "";
let AGENT_TOKEN_HASH = AGENT_TOKEN ? createHash("sha256").update(AGENT_TOKEN).digest() : null;

/** @internal Reatribui o token em runtime (ex.: reload de config) e recomputa o hash. */
function setAgentToken(token: string) {
  const next = token || "";
  if (next === AGENT_TOKEN) return; // idempotente: hash já é derivado do token atual
  AGENT_TOKEN = next;
  AGENT_TOKEN_HASH = next ? createHash("sha256").update(next).digest() : null;
}

function json(res: http.ServerResponse, code: number, body: unknown) {
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

function authorized(req: http.IncomingMessage): boolean {
  if (!AGENT_TOKEN_HASH) return false; // sem hash => sem token => API desligada (fail-closed)
  const PREFIX = "Bearer ";
  const header = req.headers.authorization || "";
  if (!header.startsWith(PREFIX)) return false;
  const provided = header.slice(PREFIX.length);
  if (!provided) return false;
  const a = createHash("sha256").update(provided).digest();
  return timingSafeEqual(a, AGENT_TOKEN_HASH);
}

async function readBody(req: http.IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { return {}; }
}

/** Resumo textual de um report de code review — formato pronto pra mensagem de chat. */
function formatReviewSummary(r: any): string {
  const issues = Array.isArray(r.issues) ? r.issues : [];
  const critical = issues.filter((i: any) => i.severity === "critical").length;
  const warnings = issues.filter((i: any) => i.severity === "warning").length;
  const lines = [
    `📋 Code Review — ${r.display_name || r.project_slug}`,
    `Score: ${r.score != null ? Number(r.score).toFixed(1) : "N/A"}/10 | Commit: ${(r.commit_sha || "").slice(0, 7)}`,
    `Issues: ${critical} críticas, ${warnings} avisos (${issues.length} total)`,
    ``,
    r.summary || "(sem resumo)",
  ];
  if (r.pr_url) lines.push("", `PR: ${r.pr_url}${r.pr_commented ? " (comentado ✓)" : ""}`);
  if (critical > 0) {
    lines.push("", "Críticas:");
    for (const i of issues.filter((x: any) => x.severity === "critical").slice(0, 5)) {
      lines.push(`• ${i.file}${i.line != null ? ":" + i.line : ""} — ${i.message}`);
    }
  }
  lines.push("", `Gerado: ${r.created_at ? new Date(r.created_at).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "?"}`);
  return lines.join("\n");
}

/** Status resumido de um projeto: último review + handoffs recentes + tasks do Brain. */
async function projectStatus(slug: string): Promise<string> {
  const [reviewData, brain, handoffs] = await Promise.all([
    getCodeReviewData(slug),
    Promise.resolve(getBrainStatus()),
    pg.query(
      `select lifecycle_status, payload->>'pending_action_item' as action, updated_at
       from handoffs where project = $1 order by updated_at desc limit 5`,
      [slug]
    ),
  ]);

  const lines = [`📊 Status do projeto: ${slug}`, ""];

  const latest = reviewData.reports?.[0];
  if (latest) {
    const issues = Array.isArray(latest.issues) ? latest.issues : [];
    lines.push(`Último code review: score ${latest.score != null ? Number(latest.score).toFixed(1) : "N/A"}/10, ${issues.length} issues (${new Date(latest.created_at).toLocaleDateString("pt-BR")})`);
  } else {
    lines.push("Nenhum code review registrado ainda.");
  }

  // Match por campo **Projeto:** (novo padrão) com fallback pro slug no título (tasks antigas).
  const projTasks = (brain.taskList || []).filter((t: any) =>
    t.project ? t.project.toLowerCase() === slug.toLowerCase()
              : t.title.toLowerCase().includes(slug.toLowerCase())
  );
  const pending = projTasks.filter((t) => t.status === "pending" || t.status === "in_progress");
  lines.push("", `Tasks (LLM-Brain): ${pending.length} pendentes/em progresso de ${projTasks.length} visíveis`);
  for (const t of pending.slice(0, 8)) {
    lines.push(`• [${t.status}] ${t.title} (${t.assigned})`);
  }

  if (handoffs.rows.length) {
    lines.push("", "Handoffs recentes:");
    for (const h of handoffs.rows) {
      lines.push(`• [${h.lifecycle_status}] ${(h.action || "").slice(0, 80)} — ${new Date(h.updated_at).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}`);
    }
  }

  lines.push("", `Modelo ativo no Brain: ${brain.activeModel}`);
  return lines.join("\n");
}

/** Contexto completo das tasks do LLM-Brain — pro agente responder "como estão as tasks?". */
function tasksContext(): string {
  const brain = getBrainStatus();
  const lines = [
    `🧠 LLM-Brain — visão geral das tasks`,
    `Pendentes: ${brain.pendingTasks} | Concluídas: ${brain.completedTasks} | Bloqueadas: ${brain.blockedTasks}`,
    `Modelo ativo: ${brain.activeModel}`,
    `Tarefa atual: ${brain.currentTask}`,
    "",
    "Lista (mais recentes primeiro):",
  ];
  for (const t of brain.taskList || []) {
    lines.push(`• [${t.status}] ${t.title} — assigned: ${t.assigned}, prioridade: ${t.priority}`);
  }
  if (brain.recentDecisions?.length) {
    lines.push("", "Decisões recentes:");
    for (const d of brain.recentDecisions) lines.push(`• [${d.date}] ${d.title} (${d.model})`);
  }
  return lines.join("\n");
}

/**
 * Rotas: GET /agent/summary?project=slug | GET /agent/tasks | GET /agent/codereview?project=slug
 *        POST /agent/codereview/run {slug}
 * Todas exigem Authorization: Bearer <AGENT_API_TOKEN>. Retornam { text } pronto pra chat.
 */
export async function handleAgentRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<boolean> {
  const url = new URL(req.url || "/", "http://localhost");
  const path = url.pathname;
  if (!path.startsWith("/agent/")) return false;

  if (!authorized(req)) {
    json(res, 401, { error: AGENT_TOKEN ? "Token inválido" : "AGENT_API_TOKEN não configurado no daemon" });
    return true;
  }

  const method = req.method || "GET";
  try {
    if (method === "GET" && path === "/agent/tasks") {
      json(res, 200, { text: tasksContext() });
      return true;
    }
    if (method === "GET" && path === "/agent/summary") {
      const project = url.searchParams.get("project");
      if (!project) { json(res, 400, { error: "?project=slug obrigatório" }); return true; }
      json(res, 200, { text: await projectStatus(project) });
      return true;
    }
    if (method === "GET" && path === "/agent/codereview") {
      const project = url.searchParams.get("project") || undefined;
      const data = await getCodeReviewData(project);
      const latest = data.reports?.[0];
      if (!latest) { json(res, 200, { text: `Nenhum code review encontrado${project ? ` para "${project}"` : ""}.` }); return true; }
      json(res, 200, { text: formatReviewSummary(latest) });
      return true;
    }
    if (method === "POST" && path === "/agent/codereview/run") {
      const body = await readBody(req);
      if (!body.slug) { json(res, 400, { error: "Campo 'slug' obrigatório" }); return true; }
      const result = await runCodeReviewForSlug(String(body.slug));
      if (!result.ok) { json(res, 200, { text: `Code review de "${body.slug}" não rodou: ${result.error}` }); return true; }
      const data = await getCodeReviewData(String(body.slug));
      const latest = data.reports?.[0];
      json(res, 200, { text: latest ? formatReviewSummary(latest) : `Review #${result.reportId} gerado.` });
      return true;
    }

    json(res, 404, { error: "Rota /agent não encontrada" });
    return true;
  } catch (e) {
    json(res, 500, { error: (e as Error).message });
    return true;
  }
}
