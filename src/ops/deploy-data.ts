import { pg } from "../infra/postgres";

export type DeployTarget = "self-hosted" | "vercel";
export type DeployAction = "rebuild" | "up" | "rebuild+up";
export type DeployStatus = "pending" | "running" | "done" | "failed";

export interface DeployLogLine {
  at: string;
  line: string;
}

export interface DeployRequestRow {
  id: string;
  target: DeployTarget;
  action: DeployAction;
  branch: string;
  status: DeployStatus;
  log: DeployLogLine[];
  error: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

async function ensureTable() {
  await pg.query(`create table if not exists deploy_requests (
    id uuid primary key default gen_random_uuid(),
    target text not null default 'self-hosted',
    action text not null default 'rebuild+up',
    branch text not null default 'main',
    status text not null default 'pending',
    log jsonb not null default '[]'::jsonb,
    error text,
    created_at timestamptz not null default now(),
    started_at timestamptz,
    finished_at timestamptz
  )`);
  await pg.query(`create index if not exists idx_deploy_requests_status on deploy_requests (status, created_at desc)`);
}

export async function createDeployRequest(opts: { target: DeployTarget; action: DeployAction; branch: string }): Promise<DeployRequestRow> {
  await ensureTable();
  const { rows } = await pg.query(
    `insert into deploy_requests (target, action, branch) values ($1, $2, $3) returning *`,
    [opts.target, opts.action, opts.branch]
  );
  return rows[0];
}

export async function getDeployRequest(id: string): Promise<DeployRequestRow | null> {
  await ensureTable();
  const { rows } = await pg.query(`select * from deploy_requests where id = $1`, [id]);
  return rows[0] || null;
}

export async function getLatestDeployRequest(): Promise<DeployRequestRow | null> {
  await ensureTable();
  const { rows } = await pg.query(`select * from deploy_requests order by created_at desc limit 1`);
  return rows[0] || null;
}

export async function listDeployRequests(limit = 20): Promise<DeployRequestRow[]> {
  await ensureTable();
  const { rows } = await pg.query(`select * from deploy_requests order by created_at desc limit $1`, [limit]);
  return rows;
}

// Chamado só pelo worker de host (scripts/deploy-worker.js), nunca pelo daemon — o daemon
// não roda comandos, só lê o resultado que o worker escreve aqui.
export async function claimNextPendingDeployRequest(): Promise<DeployRequestRow | null> {
  await ensureTable();
  const { rows } = await pg.query(
    `update deploy_requests set status = 'running', started_at = now()
     where id = (select id from deploy_requests where status = 'pending' order by created_at asc limit 1)
     returning *`
  );
  return rows[0] || null;
}

export async function appendDeployLog(id: string, line: string): Promise<void> {
  await pg.query(
    `update deploy_requests set log = log || $2::jsonb where id = $1`,
    [id, JSON.stringify([{ at: new Date().toISOString(), line }])]
  );
}

export async function finishDeployRequest(id: string, status: "done" | "failed", error?: string): Promise<void> {
  await pg.query(
    `update deploy_requests set status = $2, error = $3, finished_at = now() where id = $1`,
    [id, status, error || null]
  );
}
