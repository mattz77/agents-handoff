// Webhook do GitHub → gatilho automático do Daemon-CIFixAgent.
// POST /webhooks/github com evento workflow_run (action=completed, conclusion=failure)
// dispara runCiFixForSlug pro projeto dono do repo. Auth: HMAC sha256 do próprio GitHub
// (X-Hub-Signature-256 com GITHUB_WEBHOOK_SECRET) — fail-closed se o secret não estiver setado.
import http from "node:http";
import { createHmac, timingSafeEqual } from "node:crypto";
import { pg } from "../infra/postgres";
import { runCiFixForSlug } from "./codereview-cron";

const WEBHOOK_SECRET = process.env.GITHUB_WEBHOOK_SECRET || "";

function json(res: http.ServerResponse, code: number, body: unknown) {
  res.writeHead(code, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

async function readRawBody(req: http.IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks);
}

function validSignature(raw: Buffer, header: string | undefined): boolean {
  if (!WEBHOOK_SECRET || !header?.startsWith("sha256=")) return false;
  const expected = Buffer.from("sha256=" + createHmac("sha256", WEBHOOK_SECRET).update(raw).digest("hex"));
  const provided = Buffer.from(header);
  return expected.length === provided.length && timingSafeEqual(expected, provided);
}

/** Handler do webhook. Retorna true se a rota foi tratada. */
export async function handleGithubWebhook(req: http.IncomingMessage, res: http.ServerResponse): Promise<boolean> {
  const path = (req.url || "").split("?")[0];
  if (path !== "/webhooks/github") return false;
  if (req.method !== "POST") return json(res, 405, { error: "método não suportado" }), true;

  const raw = await readRawBody(req);
  if (!validSignature(raw, req.headers["x-hub-signature-256"] as string | undefined)) {
    return json(res, 401, { error: "assinatura inválida" }), true;
  }

  const event = req.headers["x-github-event"] as string | undefined;
  if (event === "ping") return json(res, 200, { pong: true }), true;
  if (event !== "workflow_run") return json(res, 202, { ignored: `evento ${event}` }), true;

  let payload: any;
  try { payload = JSON.parse(raw.toString("utf8")); } catch { return json(res, 400, { error: "JSON inválido" }), true; }

  const run = payload.workflow_run;
  if (payload.action !== "completed" || run?.conclusion !== "failure") {
    return json(res, 202, { ignored: `action=${payload.action} conclusion=${run?.conclusion}` }), true;
  }
  // Só corrige falha de PR — falha em branch default/push direto é pra humano ver.
  const prNumber: number | undefined = Array.isArray(run.pull_requests) && run.pull_requests.length
    ? run.pull_requests[0].number
    : undefined;
  if (!prNumber) return json(res, 202, { ignored: "run sem PR associado" }), true;

  const owner = payload.repository?.owner?.login;
  const repo = payload.repository?.name;
  const { rows } = await pg.query(
    `select slug from handoff_projects where git_owner = $1 and git_repo = $2 and codereview_enabled = true limit 1`,
    [owner, repo]
  );
  if (!rows.length) return json(res, 202, { ignored: `repo ${owner}/${repo} não registrado` }), true;
  const slug = rows[0].slug;

  // Responde já (GitHub tem timeout de 10s) e roda o fix em background.
  json(res, 202, { accepted: true, slug, prNumber, runId: run.id });
  console.log(`[GithubWebhook] workflow_run failure: ${owner}/${repo} PR #${prNumber} run ${run.id} → CI-fix (${slug})`);
  runCiFixForSlug(slug, { prNumber }).then((r) => {
    if (r.ok) console.log(`[GithubWebhook] CI-fix ok (${slug}): ${(r as any).filesFixed?.join(", ")}`);
    else console.warn(`[GithubWebhook] CI-fix não aplicado (${slug}): ${r.error || (r as any).skipped}`);
  }).catch((e) => console.error(`[GithubWebhook] CI-fix falhou (${slug}):`, e.message));
  return true;
}
