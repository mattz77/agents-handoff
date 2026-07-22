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
  project_slug: string;
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

export interface DeployProjectRow {
  slug: string;
  display_name: string;
  local_path: string;
  compose_service: string;
  vercel_deploy_hook_url: string | null;
  branches: string[];
  branches_updated_at: string | null;
  created_at: string;
}

async function ensureTables() {
  await pg.query(`create table if not exists deploy_projects (
    slug text primary key,
    display_name text not null,
    local_path text not null,
    compose_service text not null,
    vercel_deploy_hook_url text,
    created_at timestamptz not null default now()
  )`);
  await pg.query(`alter table deploy_projects add column if not exists branches jsonb not null default '[]'::jsonb`);
  await pg.query(`alter table deploy_projects add column if not exists branches_updated_at timestamptz`);
  // Seed do próprio handoff-daemon — sempre existe, é o repo onde este worker roda.
  await pg.query(`insert into deploy_projects (slug, display_name, local_path, compose_service)
    values ('handoff-daemon', 'Handoff Daemon', '.', 'handoff-daemon')
    on conflict (slug) do nothing`);

  await pg.query(`create table if not exists deploy_requests (
    id uuid primary key default gen_random_uuid(),
    project_slug text not null default 'handoff-daemon',
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
  // Coluna nova em bancos que já tinham a tabela da versão anterior desta feature.
  await pg.query(`alter table deploy_requests add column if not exists project_slug text not null default 'handoff-daemon'`);
  await pg.query(`create index if not exists idx_deploy_requests_status on deploy_requests (status, created_at desc)`);
}

export async function listDeployProjects(): Promise<DeployProjectRow[]> {
  await ensureTables();
  const { rows } = await pg.query(`select * from deploy_projects order by display_name`);
  return rows;
}

export async function upsertDeployProject(opts: { slug: string; displayName: string; localPath: string; composeService: string; vercelDeployHookUrl?: string }): Promise<DeployProjectRow> {
  await ensureTables();
  const { rows } = await pg.query(
    `insert into deploy_projects (slug, display_name, local_path, compose_service, vercel_deploy_hook_url)
     values ($1, $2, $3, $4, $5)
     on conflict (slug) do update set display_name = $2, local_path = $3, compose_service = $4, vercel_deploy_hook_url = $5
     returning *`,
    [opts.slug, opts.displayName, opts.localPath, opts.composeService, opts.vercelDeployHookUrl || null]
  );
  return rows[0];
}

export async function deleteDeployProject(slug: string): Promise<void> {
  if (slug === "handoff-daemon") throw new Error("projeto handoff-daemon não pode ser removido");
  await ensureTables();
  await pg.query(`delete from deploy_projects where slug = $1`, [slug]);
}

export async function createDeployRequest(opts: { projectSlug: string; target: DeployTarget; action: DeployAction; branch: string }): Promise<DeployRequestRow> {
  await ensureTables();
  const { rows } = await pg.query(
    `insert into deploy_requests (project_slug, target, action, branch) values ($1, $2, $3, $4) returning *`,
    [opts.projectSlug, opts.target, opts.action, opts.branch]
  );
  return rows[0];
}

export async function getDeployRequest(id: string): Promise<DeployRequestRow | null> {
  await ensureTables();
  const { rows } = await pg.query(`select * from deploy_requests where id = $1`, [id]);
  return rows[0] || null;
}

export async function getLatestDeployRequest(): Promise<DeployRequestRow | null> {
  await ensureTables();
  const { rows } = await pg.query(`select * from deploy_requests order by created_at desc limit 1`);
  return rows[0] || null;
}

export async function listDeployRequests(limit = 20): Promise<DeployRequestRow[]> {
  await ensureTables();
  const { rows } = await pg.query(`select * from deploy_requests order by created_at desc limit $1`, [limit]);
  return rows;
}

// Chamado só pelo worker de host (scripts/deploy-worker.js), nunca pelo daemon — o daemon
// não roda comandos, só lê o resultado que o worker escreve aqui.
export async function claimNextPendingDeployRequest(): Promise<DeployRequestRow | null> {
  await ensureTables();
  const { rows } = await pg.query(
    `update deploy_requests set status = 'running', started_at = now()
     where id = (select id from deploy_requests where status = 'pending' order by created_at asc limit 1)
     returning *`
  );
  return rows[0] || null;
}

// Chamado só pelo worker de host — reflete o resultado real de `git for-each-ref` no
// local_path do projeto, pra o seletor de branch no painel não depender de digitação manual.
export async function updateDeployProjectBranches(slug: string, branches: string[]): Promise<void> {
  await ensureTables();
  await pg.query(
    `update deploy_projects set branches = $2::jsonb, branches_updated_at = now() where slug = $1`,
    [slug, JSON.stringify(branches)]
  );
}

export async function getDeployProject(slug: string): Promise<DeployProjectRow | null> {
  await ensureTables();
  const { rows } = await pg.query(`select * from deploy_projects where slug = $1`, [slug]);
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
