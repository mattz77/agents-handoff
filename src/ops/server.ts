import http from "node:http";
import { redis } from "../infra/redis";
import fs from "node:fs";
import { join, extname } from "node:path";
import { pg } from "../infra/postgres";
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
import { runCodeReviewForSlug } from "./codereview-cron";
import { replayFromDlq } from "./replay";
import { transitionStatus } from "../outbox";
import { verifyAccess, accessConfigured } from "./cf-access";
import { DataLakeRAGService } from "../infra/datalake-rag";

const ragService = new DataLakeRAGService();

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
  const isLocalhost = req.headers.host?.startsWith("localhost:");
  const access = await verifyAccess(req);
  if (!isLocalhost && !access.ok) {
    json(res, 401, { error: `Acesso negado: ${access.error}` });
    return true;
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
    if (method === "GET" && path.match(/^\/ops\/api\/codereview\/[^/]+$/)) {
      const slug = path.substring("/ops/api/codereview/".length);
      return json(res, 200, await getCodeReviewData(slug)), true;
    }
    if (method === "POST" && path === "/ops/api/codereview/run") {
      const body = await readBody(req);
      if (body.slug) {
        const result = await runCodeReviewForSlug(String(body.slug));
        return json(res, result.ok ? 200 : 422, result), true;
      }
      const { rows } = await pg.query(`select slug from handoff_projects where codereview_enabled = true`);
      const results = await Promise.allSettled(rows.map((r: any) => runCodeReviewForSlug(r.slug)));
      return json(res, 200, { triggered: rows.map((r: any) => r.slug), results }), true;
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
      const fields = ["display_name", "local_path", "git_provider", "git_owner", "git_repo", "default_branch", "codereview_schedule", "codereview_enabled", "codereview_auto"];
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

    json(res, 404, { error: "Rota não encontrada" });
    return true;
  } catch (e) {
    console.error("HTTP 500 Error:", e);
    json(res, 500, { error: (e as Error)?.message ?? String(e) });
    return true;
  }
}
