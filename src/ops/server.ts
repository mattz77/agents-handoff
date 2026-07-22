import http from "node:http";
import { redis } from "../infra/redis";
import fs from "node:fs";
import { join, extname } from "node:path";
import { pg, getGithubToken } from "../infra/postgres";
import {
  getOverview,
  getRecentHandoffs,
  getOutbox,
  getDlq,
  getAlerts,
  getBreakers,
  getHandoffDetails,
  getBrainStatus,
  getDataLakeStats,
  getDockerStatus,
  getRedisHA,
  getGitActivity,
  getSystemInfo,
  getHandoffTimeline,
  getOutboxStats,
  getHermesAudits,
  appendBrainTask,
} from "./metrics";
import { getCodeReviewData, getCodeReviewReport } from "./codereview-data";
import { runCodeReviewForSlug, runAttackForSlug, runCiFixForSlug, isAttacking } from "./codereview-cron";
import { getReviewProgress, getAllReviewProgress } from "../hermes/review-progress";
import { listNimModels } from "../hermes/nim-client";
import { listProviderModels, testProvider, invalidateProviderCache, providerStatus, isProviderConfigured, ProviderType } from "../hermes/provider-client";
import { encryptSecret, secretsEnabled } from "../infra/secret-box";
import { RECOMMENDED_MODELS } from "../hermes/skills";
import { replayFromDlq } from "./replay";
import { transitionStatus } from "../outbox";
import { verifyAccess, accessConfigured } from "./cf-access";
import { ragService } from "../infra/datalake-rag";
import { createAgentTask, listAgentTasks, getAgentTask, updateAgentTask, deleteAgentTask } from "./agent-tasks";
import { executeAgentTask } from "../hermes/task-agent";
import { ensurePromotionColumn, ensurePromotionPr } from "./promotion";
import { detectConflicts, resolveConflicts, getConflictAttempt } from "../hermes/conflict-agent";
import { createDeployRequest, getDeployRequest, getLatestDeployRequest, listDeployRequests, DeployTarget, DeployAction } from "./deploy-data";

function json(res: http.ServerResponse, code: number, body: unknown) {
  const s = JSON.stringify(body);
  res.writeHead(code, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(s);
}

async function readBody(req: http.IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return {};
  }
}

/** Liveness + readiness real: confere Redis e Postgres. */
async function handleHealth(res: http.ServerResponse) {
  const checks: Record<string, string> = {};
  let healthy = true;
  try {
    const pong = await redis.ping();
    checks.redis = pong === "PONG" ? "ok" : "degraded";
  } catch {
    checks.redis = "down";
    healthy = false;
  }
  try {
    await pg.query("select 1");
    checks.postgres = "ok";
  } catch {
    checks.postgres = "down";
    healthy = false;
  }
  json(res, healthy ? 200 : 503, {
    status: healthy ? "ok" : "unhealthy",
    service: "handoff-daemon",
    checks,
  });
}

/**
 * Trata as rotas de operação. Retorna true se a requisição foi tratada aqui.
 * Mantém o /health já existente e adiciona /ops e /ops/api/*.
 */
export async function handleOpsRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<boolean> {
  const url = new URL(req.url || "/", "http://localhost");
  const path = url.pathname;
  const method = req.method || "GET";

  if (path === "/health") {
    await handleHealth(res);
    return true;
  }

  // Página do dashboard. O Cloudflare Access (OTP por email) já autenticou no edge
  // antes de a request chegar aqui; os dados (APIs) revalidam o JWT do Access.
  if (path === "/" || path === "/ops" || path === "/ops/") {
    try {
      const htmlPath = join(process.cwd(), 'frontend', 'dist', 'index.html');
      const html = fs.readFileSync(htmlPath, 'utf8');
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html);
    } catch {
      json(res, 404, { error: "Dashboard not found" });
    }
    return true;
  }

  // Serve arquivos estáticos do design system / app JSX
  if (path.startsWith('/ops/static/')) {
    const rel = path.substring('/ops/static/'.length);
    if (rel.includes('..')) { json(res, 400, { error: 'invalid path' }); return true; }
    const ext = extname(rel);
    const mimes: Record<string, string> = {
      '.css': 'text/css; charset=utf-8',
      '.js': 'application/javascript; charset=utf-8',
      '.jsx': 'application/javascript; charset=utf-8',
      '.json': 'application/json',
      '.woff2': 'font/woff2',
      '.woff': 'font/woff',
      '.png': 'image/png',
      '.svg': 'image/svg+xml',
    };
    try {
      const isDist = rel.startsWith('dist/');
      const filePath = isDist 
        ? join(process.cwd(), 'frontend', rel)
        : join(process.cwd(), 'public', rel);
      const content = fs.readFileSync(filePath);
      res.writeHead(200, {
        'Content-Type': mimes[ext] || 'application/octet-stream',
        'Cache-Control': 'public, max-age=3600',
      });
      res.end(content);
    } catch {
      json(res, 404, { error: 'not found' });
    }
    return true;
  }

  if (!path.startsWith("/ops/api/")) return false;

  // Fail-closed: sem CF Access configurado, as APIs não respondem (evita origin exposto).
  if (!accessConfigured()) {
    json(res, 503, { error: "Cloudflare Access não configurado no daemon (CF_ACCESS_TEAM_DOMAIN/CF_ACCESS_AUD)." });
    return true;
  }
  // Revalida o JWT do Cloudflare Access (defesa caso alguém atinja o origin direto).
  // Localhost (host:3000, docker exec, tests) pula a verificação — sem isso o fetch ao JWKS
  // do CF pode travar o request inteiro se o DNS do container estiver instável.
  const isLocalhost = req.headers.host?.startsWith("localhost:") || req.headers.host === "localhost"
    || req.headers.host?.startsWith("127.0.0.1:");
  if (!isLocalhost) {
    const access = await verifyAccess(req);
    if (!access.ok) {
      json(res, 401, { error: `Acesso negado: ${access.error}` });
      return true;
    }
  }

  try {
    const n = (key: string, def: number) => Number(url.searchParams.get(key)) || def;
    const status = url.searchParams.get("status") || undefined;

    if (method === "GET" && path === "/ops/api/overview") {
      return json(res, 200, await getOverview()), true;
    }
    if (method === "GET" && path === "/ops/api/handoffs") {
      return json(res, 200, await getRecentHandoffs(n("limit", 50), status)), true;
    }
    if (method === "POST" && path.match(/^\/ops\/api\/handoffs\/[^/]+\/status$/)) {
      const taskId = path.split("/").slice(-2)[0];
      const body = await readBody(req);
      if (!body.status) {
        return json(res, 400, { error: "Campo 'status' é obrigatório" }), true;
      }
      const result = await transitionStatus(taskId, String(body.status));
      return json(res, result.ok ? 200 : 422, result), true;
    }
    if (method === "GET" && path.startsWith("/ops/api/handoffs/")) {
      const id = path.substring("/ops/api/handoffs/".length);
      const details = await getHandoffDetails(id);
      return json(res, details ? 200 : 404, details || { error: "Not found" }), true;
    }
    if (method === "GET" && path === "/ops/api/outbox") {
      return json(res, 200, await getOutbox(n("limit", 50), status)), true;
    }
    if (method === "GET" && path === "/ops/api/dlq") {
      return json(res, 200, await getDlq(n("limit", 50))), true;
    }
    if (method === "GET" && path === "/ops/api/alerts") {
      return json(res, 200, await getAlerts(n("limit", 30))), true;
    }
    if (method === "GET" && path === "/ops/api/breakers") {
      return json(res, 200, await getBreakers()), true;
    }
    if (method === "POST" && path === "/ops/api/dlq/replay") {
      const body = await readBody(req);
      if (!body.id) {
        return json(res, 400, { error: "Campo 'id' (stream id da DLQ) é obrigatório" }), true;
      }
      const result = await replayFromDlq(String(body.id));
      return json(res, result.ok ? 200 : 422, result), true;
    }

    // New intelligence endpoints
    if (method === "GET" && path === "/ops/api/brain") {
      return json(res, 200, getBrainStatus()), true;
    }
    if (method === "POST" && path === "/ops/api/brain/tasks") {
      const body = await readBody(req);
      if (!body.title) return json(res, 400, { error: "Campo 'title' é obrigatório" }), true;
      const result = appendBrainTask(body);
      return json(res, result.ok ? 200 : 500, result), true;
    }
    if (method === "GET" && path === "/ops/api/brain/search") {
      const q = url.searchParams.get("q") || "";
      const k = n("k", 5);
      if (!q) return json(res, 400, { error: "missing ?q=" }), true;
      const result = await ragService.retrieveContextForTask(q, k);
      return json(res, 200, {
        query: q,
        results: result.relevantDocs.map((d) => ({
          heading: d.title,
          filePath: d.filePath,
          snippet: d.content,
          score: d.score,
        })),
      }), true;
    }
    if (method === "GET" && path === "/ops/api/datalake") {
      return json(res, 200, getDataLakeStats()), true;
    }
    if (method === "GET" && path === "/ops/api/docker") {
      return json(res, 200, await getDockerStatus()), true;
    }
    if (method === "GET" && path === "/ops/api/redis-ha") {
      return json(res, 200, await getRedisHA()), true;
    }
    if (method === "GET" && path === "/ops/api/git") {
      return json(res, 200, getGitActivity()), true;
    }
    if (method === "GET" && path === "/ops/api/system") {
      return json(res, 200, getSystemInfo()), true;
    }
    if (method === "GET" && path === "/ops/api/timeline") {
      return json(res, 200, await getHandoffTimeline()), true;
    }
    if (method === "GET" && path === "/ops/api/outbox-stats") {
      return json(res, 200, await getOutboxStats()), true;
    }
    if (method === "GET" && path === "/ops/api/hermes") {
      const corr = url.searchParams.get("correlation_id") || undefined;
      return json(res, 200, await getHermesAudits(n("limit", 50), corr)), true;
    }
    if (method === "GET" && path === "/ops/api/codereview") {
      return json(res, 200, await getCodeReviewData()), true;
    }
    if (method === "GET" && path.match(/^\/ops\/api\/codereview\/report\/\d+$/)) {
      const id = Number(path.split("/").pop());
      const report = await getCodeReviewReport(id);
      return json(res, report ? 200 : 404, report || { error: "Not found" }), true;
    }
    if (method === "GET" && path === "/ops/api/codereview/models") {
      try {
        const ids = await listNimModels();
        // Anexa modelos de provedores externos configurados, prefixados (openai:/anthropic:)
        // pra o mesmo seletor rotear via providerChat. Falha de um provider não derruba a lista.
        const extra: string[] = [];
        for (const p of ["openai", "anthropic", "opencode"] as ProviderType[]) {
          try {
            if (!(await isProviderConfigured(p))) continue; // só provider com key entra no seletor
            const ms = await listProviderModels(p);
            for (const m of ms) extra.push(`${p}:${m}`);
          } catch { /* provider sem key/off — ignora */ }
        }
        return json(res, 200, { models: [...ids, ...extra], recommended: RECOMMENDED_MODELS }), true;
      } catch (e) {
        return json(res, 502, { error: (e as Error).message }), true;
      }
    }
    if (method === "GET" && path === "/ops/api/codereview/run-status") {
      const slug = url.searchParams.get("slug");
      if (slug) return json(res, 200, getReviewProgress(slug) || { status: null }), true;
      return json(res, 200, getAllReviewProgress()), true;
    }
    if (method === "GET" && path === "/ops/api/codereview/attacks") {
      const slug = url.searchParams.get("slug");
      const { rows } = await pg.query(
        `select id, project_slug, report_id, model_used, status, branch, pr_url, pr_number,
                issues_total, issues_fixed, log, current_step, round, cycle_id,
                verify_status, verify_model, verify_notes, error, created_at, finished_at
         from codereview_attacks ${slug ? "where project_slug = $1" : ""} order by created_at desc limit 30`,
        slug ? [slug] : []
      );
      return json(res, 200, { attacks: rows }), true;
    }
    if (method === "GET" && path.match(/^\/ops\/api\/codereview\/cycle\/\d+$/)) {
      const cycleId = Number(path.split("/").pop());
      const { rows } = await pg.query(
        `select id, round, status, model_used, verify_status, verify_model, verify_notes, current_step,
                issues_total, issues_fixed, pr_url, pr_number, created_at, finished_at
         from codereview_attacks where cycle_id = $1 order by round asc`,
        [cycleId]
      );
      return json(res, 200, { rounds: rows }), true;
    }
    if (method === "POST" && path === "/ops/api/codereview/attack") {
      const body = await readBody(req);
      if (!body.slug) return json(res, 400, { error: "Campo 'slug' é obrigatório" }), true;
      if (isAttacking(String(body.slug))) {
        return json(res, 409, { error: `Já existe um ataque em curso para "${body.slug}" — aguarde terminar.` }), true;
      }
      const { rows: alreadyRunning } = await pg.query(
        `select id from codereview_attacks where project_slug = $1 and status = 'running' limit 1`,
        [body.slug]
      );
      if (alreadyRunning.length) {
        return json(res, 409, { error: `Ataque #${alreadyRunning[0].id} já em curso para "${body.slug}" (outra réplica/restart) — aguarde terminar.` }), true;
      }
      // Ciclo completo (ataque + verificação + possíveis rodadas seguintes) é longo — roda em
      // background, frontend acompanha via GET /ops/api/codereview/attacks?slug=.
      runAttackForSlug(String(body.slug), {
        reportId: body.reportId ? Number(body.reportId) : undefined,
        model: body.model ? String(body.model) : undefined,
        verifyModel: body.verifyModel ? String(body.verifyModel) : undefined,
      }).then((r) => console.log(`[FixAgent] ciclo ${body.slug}:`, JSON.stringify(r).slice(0, 200)))
        .catch((e) => console.error(`[FixAgent] ciclo ${body.slug} rejeitado:`, e.message));
      return json(res, 202, { started: true, slug: body.slug }), true;
    }
    if (method === "POST" && path === "/ops/api/codereview/merge") {
      const body = await readBody(req);
      if (!body.slug || !body.prNumber) return json(res, 400, { error: "Campos 'slug' e 'prNumber' são obrigatórios" }), true;
      await ensurePromotionColumn();
      const { rows: projRows } = await pg.query(
        `select display_name, git_owner, git_repo, default_branch, promote_to_branch from handoff_projects where slug = $1`,
        [body.slug]
      );
      if (!projRows.length || !projRows[0].git_owner || !projRows[0].git_repo) {
        return json(res, 404, { error: `Projeto "${body.slug}" não encontrado ou sem git_owner/git_repo` }), true;
      }
      const project = projRows[0];
      const { git_owner: owner, git_repo: repo } = project;
      const token = await getGithubToken();
      if (!token) return json(res, 500, { error: "GITHUB_TOKEN não configurado" }), true;
      // Já mergeado (ex.: humano mergeou direto no GitHub) — PUT merge de novo dá 405 do GitHub.
      // Idempotente: trata como sucesso e só sincroniza o estado local.
      const prCheck = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls/${body.prNumber}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
      }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
      let mergeData: any = {};
      if (prCheck?.merged) {
        mergeData = { sha: prCheck.merge_commit_sha, alreadyMerged: true };
      } else {
        const mergeRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls/${body.prNumber}/merge`, {
          method: "PUT",
          headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "Content-Type": "application/json" },
          body: JSON.stringify({ merge_method: body.mergeMethod || "squash" }),
        });
        mergeData = await mergeRes.json().catch(() => ({}));
        if (!mergeRes.ok) return json(res, 422, { error: mergeData.message || `GitHub HTTP ${mergeRes.status}` }), true;
      }
      // Só promove quando o PR mergeado tinha como base o branch de trabalho do projeto — PRs
      // satélite de rodadas de fix já commitam direto nele (fix-agent.ts), então isso cobre o
      // caso comum sem abrir PR de promoção pra todo merge de sub-branch avulso.
      let promotion: Awaited<ReturnType<typeof ensurePromotionPr>> | undefined;
      if (prCheck?.base?.ref === project.default_branch) {
        promotion = await ensurePromotionPr(project);
      }
      await pg.query(
        `update codereview_attacks set current_step = 'PR mergeado manualmente' where pr_number = $2 and project_slug = $1`,
        [body.slug, body.prNumber]
      ).catch(() => {});
      return json(res, 200, { merged: true, sha: mergeData.sha, alreadyMerged: !!mergeData.alreadyMerged, promotion }), true;
    }
    if (method === "GET" && path === "/ops/api/codereview/prs") {
      // PRs abertos + últimos mergeados do projeto — alimenta o card "Pull Requests" do painel.
      const slug = url.searchParams.get("slug");
      if (!slug) return json(res, 400, { error: "Param 'slug' é obrigatório" }), true;
      const { rows: projRows } = await pg.query(`select git_owner, git_repo from handoff_projects where slug = $1`, [slug]);
      if (!projRows.length || !projRows[0].git_owner || !projRows[0].git_repo) {
        return json(res, 404, { error: `Projeto "${slug}" não encontrado ou sem git_owner/git_repo` }), true;
      }
      const token = await getGithubToken();
      if (!token) return json(res, 500, { error: "GITHUB_TOKEN não configurado" }), true;
      const ghList = (q: string) =>
        fetch(`https://api.github.com/repos/${projRows[0].git_owner}/${projRows[0].git_repo}/pulls?${q}`, {
          headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
        }).then((r) => (r.ok ? r.json() : [])).catch(() => []);
      const [open, closed] = await Promise.all([
        ghList("state=open&sort=updated&direction=desc&per_page=10"),
        ghList("state=closed&sort=updated&direction=desc&per_page=20"),
      ]);
      const pick = (p: any) => ({
        number: p.number, title: p.title, url: p.html_url, head: p.head?.ref, base: p.base?.ref,
        draft: !!p.draft, mergedAt: p.merged_at, createdAt: p.created_at, author: p.user?.login,
      });
      // mergeable_state só vem no GET de PR individual, não na listagem — busca 1x por PR aberto
      // (lista é pequena, até 10) pra mostrar badge de conflito sem precisar abrir o GitHub.
      const openWithConflict = await Promise.all((open as any[]).map(async (p) => {
        const detail = await fetch(`https://api.github.com/repos/${projRows[0].git_owner}/${projRows[0].git_repo}/pulls/${p.number}`, {
          headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
        }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
        return { ...pick(p), conflicted: detail?.mergeable_state === "dirty", mergeableState: detail?.mergeable_state ?? null };
      }));
      return json(res, 200, {
        open: openWithConflict,
        merged: (closed as any[]).filter((p) => p.merged_at).slice(0, 5).map(pick),
      }), true;
    }
    if (method === "GET" && path === "/ops/api/codereview/conflicts") {
      const slug = url.searchParams.get("slug");
      const prNumber = Number(url.searchParams.get("prNumber"));
      if (!slug || !prNumber) return json(res, 400, { error: "Params 'slug' e 'prNumber' são obrigatórios" }), true;
      const { rows: projRows } = await pg.query(
        `select slug, display_name, local_path, git_provider, git_owner, git_repo, default_branch, codereview_model
         from handoff_projects where slug = $1`,
        [slug]
      );
      if (!projRows.length) return json(res, 404, { error: `Projeto "${slug}" não encontrado` }), true;
      const result = await detectConflicts(projRows[0], prNumber);
      return json(res, result.ok ? 200 : 502, result), true;
    }
    if (method === "GET" && path === "/ops/api/codereview/conflicts/status") {
      const slug = url.searchParams.get("slug");
      const prNumber = Number(url.searchParams.get("prNumber"));
      if (!slug || !prNumber) return json(res, 400, { error: "Params 'slug' e 'prNumber' são obrigatórios" }), true;
      const attempt = await getConflictAttempt(slug, prNumber);
      return json(res, 200, { attempt }), true;
    }
    if (method === "POST" && path === "/ops/api/codereview/conflicts/resolve") {
      const body = await readBody(req);
      if (!body.slug || !body.prNumber) return json(res, 400, { error: "Campos 'slug' e 'prNumber' são obrigatórios" }), true;
      const { rows: projRows } = await pg.query(
        `select slug, display_name, local_path, git_provider, git_owner, git_repo, default_branch, codereview_model
         from handoff_projects where slug = $1`,
        [String(body.slug)]
      );
      if (!projRows.length) return json(res, 404, { error: `Projeto "${body.slug}" não encontrado` }), true;
      // Resolução real (clone + merge + push) é longa — roda em background, painel acompanha
      // via GET /ops/api/codereview/conflicts/status.
      resolveConflicts({ project: projRows[0], prNumber: Number(body.prNumber), model: body.model ? String(body.model) : undefined })
        .then((r) => console.log(`[ConflictResolver] PR #${body.prNumber} (${body.slug}):`, JSON.stringify(r).slice(0, 200)))
        .catch((e) => console.error(`[ConflictResolver] PR #${body.prNumber} (${body.slug}) rejeitado:`, e.message));
      return json(res, 202, { started: true, slug: body.slug, prNumber: Number(body.prNumber) }), true;
    }
    if (method === "GET" && path.match(/^\/ops\/api\/codereview\/[^/]+$/)) {
      const slug = path.substring("/ops/api/codereview/".length);
      return json(res, 200, await getCodeReviewData(slug)), true;
    }
    if (method === "POST" && path === "/ops/api/codereview/run") {
      const body = await readBody(req);
      if (body.slug) {
        const result = await runCodeReviewForSlug(String(body.slug), body.model ? String(body.model) : undefined, !!body.force);
        return json(res, result.ok ? 200 : 422, result), true;
      }
      const { rows } = await pg.query(`select slug from handoff_projects where codereview_enabled = true`);
      const results = await Promise.allSettled(rows.map((r: any) => runCodeReviewForSlug(r.slug)));
      return json(res, 200, { triggered: rows.map((r: any) => r.slug), results }), true;
    }
    if (method === "GET" && path === "/ops/api/agent-tasks") {
      return json(res, 200, { tasks: await listAgentTasks() }), true;
    }
    if (method === "POST" && path === "/ops/api/agent-tasks") {
      const body = await readBody(req);
      if (!body.title || !body.description || !body.project_slug) {
        return json(res, 400, { error: "Campos 'title', 'description' e 'project_slug' são obrigatórios" }), true;
      }
      // Motor "claude-cli" existe no backend mas fica desligado no seletor por ora — só NIM em produção.
      const engine = body.engine === "claude-cli" ? "claude-cli" : "nim";
      const { rows } = await pg.query(
        `select slug, display_name, local_path, git_provider, git_owner, git_repo, default_branch, codereview_model
         from handoff_projects where slug = $1`,
        [String(body.project_slug)]
      );
      if (!rows.length) return json(res, 404, { error: `Projeto "${body.project_slug}" não encontrado` }), true;
      const task = await createAgentTask({
        title: String(body.title).slice(0, 200),
        description: String(body.description).slice(0, 8000),
        project_slug: String(body.project_slug),
        engine,
        model: body.model ? String(body.model) : null,
      });
      executeAgentTask(task, rows[0]).catch((e) => console.error(`[TaskAgent] task ${task.id} rejeitada:`, e.message));
      return json(res, 202, { task }), true;
    }
    if (method === "GET" && path.match(/^\/ops\/api\/agent-tasks\/[^/]+$/)) {
      const id = path.substring("/ops/api/agent-tasks/".length);
      const task = await getAgentTask(id);
      return json(res, task ? 200 : 404, task || { error: "Task não encontrada" }), true;
    }
    if (method === "POST" && path.match(/^\/ops\/api\/agent-tasks\/[^/]+\/retry$/)) {
      const id = path.split("/")[4];
      const original = await getAgentTask(id);
      if (!original) return json(res, 404, { error: "Task não encontrada" }), true;
      if (original.status !== "failed" && original.status !== "rejected") {
        return json(res, 400, { error: "Só é possível reexecutar tasks 'failed' ou 'rejected'" }), true;
      }
      const { rows } = await pg.query(
        `select slug, display_name, local_path, git_provider, git_owner, git_repo, default_branch, codereview_model
         from handoff_projects where slug = $1`,
        [original.project_slug]
      );
      if (!rows.length) return json(res, 404, { error: `Projeto "${original.project_slug}" não encontrado` }), true;
      // Clona como task nova em vez de reciclar o id — preserva o log/erro da tentativa
      // original no kanban (histórico) em vez de sobrescrever.
      const retryTask = await createAgentTask({
        title: original.title,
        description: original.description,
        project_slug: original.project_slug,
        engine: original.engine,
        model: original.model,
      });
      executeAgentTask(retryTask, rows[0]).catch((e) => console.error(`[TaskAgent] retry ${retryTask.id} rejeitada:`, e.message));
      return json(res, 202, { task: retryTask }), true;
    }
    if (method === "POST" && path.match(/^\/ops\/api\/agent-tasks\/[^/]+\/approve$/)) {
      const id = path.split("/")[4];
      const task = await getAgentTask(id);
      if (!task) return json(res, 404, { error: "Task não encontrada" }), true;
      if (!task.pr_number) return json(res, 400, { error: "Task sem PR aberto" }), true;
      await ensurePromotionColumn();
      const { rows: projRows } = await pg.query(
        `select display_name, git_owner, git_repo, default_branch, promote_to_branch from handoff_projects where slug = $1`,
        [task.project_slug]
      );
      if (!projRows.length || !projRows[0].git_owner || !projRows[0].git_repo) {
        return json(res, 404, { error: "Projeto sem git_owner/git_repo" }), true;
      }
      const taskProject = projRows[0];
      const { git_owner: owner, git_repo: repo } = taskProject;
      const token = await getGithubToken();
      if (!token) return json(res, 500, { error: "GITHUB_TOKEN não configurado" }), true;
      const taskPrCheck = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls/${task.pr_number}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
      }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
      if (taskPrCheck?.merged) {
        await updateAgentTask(id, { status: "merged" });
        const promotion = await ensurePromotionPr(taskProject);
        return json(res, 200, { merged: true, sha: taskPrCheck.merge_commit_sha, alreadyMerged: true, promotion }), true;
      }
      const mergeRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls/${task.pr_number}/merge`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "Content-Type": "application/json" },
        body: JSON.stringify({ merge_method: "squash" }),
      });
      const mergeData = await mergeRes.json().catch(() => ({}));
      if (!mergeRes.ok) return json(res, 422, { error: mergeData.message || `GitHub HTTP ${mergeRes.status}` }), true;
      await updateAgentTask(id, { status: "merged" });
      const promotion = await ensurePromotionPr(taskProject);
      return json(res, 200, { merged: true, sha: mergeData.sha, promotion }), true;
    }
    if (method === "POST" && path.match(/^\/ops\/api\/agent-tasks\/[^/]+\/reject$/)) {
      const id = path.split("/")[4];
      const task = await getAgentTask(id);
      if (!task) return json(res, 404, { error: "Task não encontrada" }), true;
      if (task.pr_number) {
        const { rows: projRows } = await pg.query(`select git_owner, git_repo from handoff_projects where slug = $1`, [task.project_slug]);
        if (projRows.length && projRows[0].git_owner && projRows[0].git_repo) {
          const token = await getGithubToken();
          if (token) {
            await fetch(`https://api.github.com/repos/${projRows[0].git_owner}/${projRows[0].git_repo}/pulls/${task.pr_number}`, {
              method: "PATCH",
              headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "Content-Type": "application/json" },
              body: JSON.stringify({ state: "closed" }),
            }).catch(() => {});
          }
        }
      }
      await updateAgentTask(id, { status: "rejected" });
      return json(res, 200, { rejected: true }), true;
    }
    if (method === "DELETE" && path.match(/^\/ops\/api\/agent-tasks\/[^/]+$/)) {
      const id = path.substring("/ops/api/agent-tasks/".length);
      await deleteAgentTask(id);
      return json(res, 200, { deleted: true }), true;
    }
    if (method === "POST" && path === "/ops/api/cifix/run") {
      const body = await readBody(req);
      if (!body.slug) return json(res, 400, { error: "slug obrigatório" }), true;
      const result = await runCiFixForSlug(String(body.slug), {
        prNumber: body.prNumber ? Number(body.prNumber) : undefined,
        model: body.model ? String(body.model) : undefined,
      });
      return json(res, result.ok ? 200 : 422, result), true;
    }
    if (method === "GET" && path === "/ops/api/cifix/attempts") {
      const url = new URL(req.url || "", "http://x");
      const slug = url.searchParams.get("slug");
      const { rows } = await pg.query(
        `select * from ci_fix_attempts ${slug ? "where project_slug = $1" : ""} order by created_at desc limit 20`,
        slug ? [slug] : []
      ).catch(() => ({ rows: [] as any[] }));
      return json(res, 200, rows), true;
    }
    if (method === "POST" && path.match(/^\/ops\/api\/projects\/[^/]+\/model$/)) {
      const slug = path.split("/")[4];
      const body = await readBody(req);
      const { rows } = await pg.query(
        `update handoff_projects set codereview_model = $2, updated_at = now() where slug = $1 returning slug, codereview_model`,
        [slug, body.model || null]
      );
      if (!rows.length) return json(res, 404, { error: `Projeto "${slug}" não encontrado` }), true;
      return json(res, 200, rows[0]), true;
    }

    if (method === "GET" && path === "/ops/api/projects") {
      const { rows } = await pg.query(`select * from handoff_projects order by created_at desc`);
      return json(res, 200, { projects: rows }), true;
    }
    if (method === "POST" && path === "/ops/api/projects") {
      const b = await readBody(req);
      if (!b.slug || !b.display_name) {
        return json(res, 400, { error: "Campos 'slug' e 'display_name' são obrigatórios" }), true;
      }
      // Normaliza URL colada por engano (ex: "https://github.com/owner/repo") pra owner/repo separados —
      // git-collector.ts monta a URL da API GitHub concatenando esses dois campos.
      let gitOwner = b.git_owner ?? null;
      let gitRepo = b.git_repo ?? null;
      const urlMatch = typeof gitRepo === "string" && gitRepo.match(/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/i);
      if (urlMatch) {
        gitOwner = gitOwner || urlMatch[1];
        gitRepo = urlMatch[2];
      }
      const { rows } = await pg.query(
        `insert into handoff_projects (slug, display_name, local_path, git_provider, git_owner, git_repo, default_branch, codereview_schedule, codereview_auto)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         on conflict (slug) do update set
           display_name = excluded.display_name, local_path = excluded.local_path,
           git_provider = excluded.git_provider, git_owner = excluded.git_owner,
           git_repo = excluded.git_repo, default_branch = excluded.default_branch,
           codereview_schedule = excluded.codereview_schedule,
           codereview_auto = excluded.codereview_auto, updated_at = now()
         returning *`,
        [b.slug, b.display_name, b.local_path ?? null, b.git_provider ?? "github",
         gitOwner, gitRepo, b.default_branch ?? "main",
         b.codereview_schedule ?? "02:00", b.codereview_auto ?? false]
      );
      return json(res, 200, rows[0]), true;
    }
    if (method === "PATCH" && path.match(/^\/ops\/api\/projects\/[^/]+$/)) {
      const slug = path.substring("/ops/api/projects/".length);
      const b = await readBody(req);
      const fields = ["display_name", "local_path", "git_provider", "git_owner", "git_repo", "default_branch", "codereview_schedule", "codereview_enabled", "codereview_auto", "promote_to_branch"];
      const sets: string[] = [];
      const vals: unknown[] = [];
      for (const f of fields) {
        if (b[f] !== undefined) { vals.push(b[f]); sets.push(`${f} = $${vals.length}`); }
      }
      if (!sets.length) return json(res, 400, { error: "Nenhum campo para atualizar" }), true;
      vals.push(slug);
      const { rows } = await pg.query(
        `update handoff_projects set ${sets.join(", ")}, updated_at = now() where slug = $${vals.length} returning *`,
        vals
      );
      return json(res, rows.length ? 200 : 404, rows[0] || { error: "Not found" }), true;
    }
    if (method === "DELETE" && path.match(/^\/ops\/api\/projects\/[^/]+$/)) {
      const slug = path.substring("/ops/api/projects/".length);
      const { rowCount } = await pg.query(`update handoff_projects set codereview_enabled = false, updated_at = now() where slug = $1`, [slug]);
      return json(res, rowCount ? 200 : 404, { ok: !!rowCount }), true;
    }

    if (method === "GET" && path === "/ops/api/settings/github-token") {
      await pg.query(`create table if not exists handoff_settings (key text primary key, value text, updated_at timestamptz default now())`);
      const { rows } = await pg.query(`select value from handoff_settings where key = 'github_token'`);
      const stored = rows[0]?.value || "";
      return json(res, 200, { configured: !!(stored || process.env.GITHUB_TOKEN), source: stored ? "db" : (process.env.GITHUB_TOKEN ? "env" : "none") }), true;
    }
    if (method === "PUT" && path === "/ops/api/settings/github-token") {
      const b = await readBody(req);
      await pg.query(`create table if not exists handoff_settings (key text primary key, value text, updated_at timestamptz default now())`);
      await pg.query(
        `insert into handoff_settings (key, value, updated_at) values ('github_token', $1, now())
         on conflict (key) do update set value = excluded.value, updated_at = now()`,
        [String(b.token || "")]
      );
      return json(res, 200, { ok: true }), true;
    }

    // ---- Provedores de modelos IA (NVIDIA NIM / OpenAI / Anthropic) ----
    if (path === "/ops/api/settings/providers" && (method === "GET" || method === "PUT" || method === "DELETE")) {
      const slug = url.searchParams.get("project") || undefined;
      if (method === "GET") {
        return json(res, 200, { secretsEnabled: secretsEnabled(), providers: await providerStatus(slug) }), true;
      }
      // Escrita exige master key (fail-closed) — sem ela não dá pra criptografar a api key.
      if (!secretsEnabled()) {
        return json(res, 503, { error: "AGENT_PROVIDER_MASTER_KEY não configurado no daemon — configuração de provedores desabilitada." }), true;
      }
      if (method === "DELETE") {
        const pt = url.searchParams.get("providerType");
        if (!pt) return json(res, 400, { error: "providerType obrigatório" }), true;
        await pg.query(`delete from agent_providers where provider_type = $1 and project_slug is not distinct from $2`, [pt, slug || null]);
        invalidateProviderCache();
        return json(res, 200, { ok: true }), true;
      }
      // PUT — upsert
      const b = await readBody(req);
      const pt = String(b.providerType || "");
      if (!["nim", "openai", "anthropic", "opencode"].includes(pt)) return json(res, 400, { error: "providerType inválido (nim|openai|anthropic|opencode)" }), true;
      await pg.query(`create table if not exists agent_providers (
        id bigserial primary key, provider_type text not null, project_slug text,
        api_key_enc text, base_url text, model text, is_default boolean not null default false,
        created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
        unique (provider_type, project_slug))`);
      const apiKeyEnc = b.apiKey ? encryptSecret(String(b.apiKey)) : null;
      // COALESCE preserva a key existente quando o painel salva sem reenviar o segredo (edição).
      await pg.query(
        `insert into agent_providers (provider_type, project_slug, api_key_enc, base_url, model, is_default, updated_at)
         values ($1, $2, $3, $4, $5, $6, now())
         on conflict (provider_type, project_slug) do update set
           api_key_enc = coalesce($3, agent_providers.api_key_enc),
           base_url = $4, model = $5, is_default = $6, updated_at = now()`,
        [pt, slug || null, apiKeyEnc, b.baseUrl || null, b.model || null, !!b.isDefault]
      );
      // is_default é exclusivo por escopo (projeto ou global): zera os demais do mesmo escopo.
      if (b.isDefault) {
        await pg.query(
          `update agent_providers set is_default = false where project_slug is not distinct from $1 and provider_type <> $2`,
          [slug || null, pt]
        );
      }
      invalidateProviderCache();
      return json(res, 200, { ok: true }), true;
    }
    if (method === "POST" && path === "/ops/api/settings/providers/test") {
      const b = await readBody(req);
      const pt = String(b.providerType || "");
      if (!["nim", "openai", "anthropic", "opencode"].includes(pt)) return json(res, 400, { error: "providerType inválido" }), true;
      return json(res, 200, await testProvider(pt as ProviderType, b.project || undefined)), true;
    }

    // Deploy — o daemon (dentro do próprio container que seria rebuildado) NUNCA executa
    // docker/git aqui. Só grava o pedido; scripts/deploy-worker.js (solto no host, via Task
    // Scheduler) faz o trabalho real e escreve o log de volta na mesma linha.
    if (method === "POST" && path === "/ops/api/deploy/run") {
      const b = await readBody(req);
      const target: DeployTarget = b.target === "vercel" ? "vercel" : "self-hosted";
      const action: DeployAction = ["rebuild", "up", "rebuild+up"].includes(b.action) ? b.action : "rebuild+up";
      const branch = String(b.branch || "main").trim();
      if (!/^[A-Za-z0-9._\/-]{1,100}$/.test(branch)) return json(res, 400, { error: "nome de branch inválido" }), true;
      const row = await createDeployRequest({ target, action, branch });
      return json(res, 200, { ok: true, id: row.id }), true;
    }
    if (method === "GET" && path === "/ops/api/deploy/history") {
      return json(res, 200, { requests: await listDeployRequests(20) }), true;
    }
    if (method === "GET" && path === "/ops/api/deploy/latest") {
      return json(res, 200, { request: await getLatestDeployRequest() }), true;
    }
    if (method === "GET" && path === "/ops/api/deploy/stream") {
      const id = url.searchParams.get("id") || "";
      const row0 = id ? await getDeployRequest(id) : await getLatestDeployRequest();
      if (!row0) return json(res, 404, { error: "deploy request não encontrado" }), true;
      res.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-store",
        Connection: "keep-alive",
      });
      let lastLogCount = 0;
      let lastStatus = "";
      const send = (event: string, data: unknown) => {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      };
      const tick = async () => {
        const row = await getDeployRequest(row0.id);
        if (!row) return;
        if (row.log.length > lastLogCount) {
          for (const l of row.log.slice(lastLogCount)) send("log", l);
          lastLogCount = row.log.length;
        }
        if (row.status !== lastStatus) {
          lastStatus = row.status;
          send("status", { status: row.status, error: row.error });
        }
        if (row.status === "done" || row.status === "failed") {
          clearInterval(interval);
          clearTimeout(cap);
          res.end();
        }
      };
      const interval = setInterval(() => { tick().catch(() => {}); }, 800);
      // Cap de segurança — nunca deixa a conexão SSE aberta indefinidamente se o worker travar.
      const cap = setTimeout(() => { clearInterval(interval); res.end(); }, 15 * 60 * 1000);
      req.on("close", () => { clearInterval(interval); clearTimeout(cap); });
      tick().catch(() => {});
      return true;
    }

    json(res, 404, { error: "Rota não encontrada" });
    return true;
  } catch (e) {
    console.error("HTTP 500 Error:", e);
    json(res, 500, { error: (e as Error)?.message ?? String(e) });
    return true;
  }
}
