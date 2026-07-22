-- Fila de deploy — daemon roda DENTRO do container que seria rebuildado, então não pode
-- disparar docker compose no host diretamente. Esta tabela é o canal: o painel /ops insere
-- um pedido aqui, um worker rodando solto no host (scripts/deploy-worker.js, via Task
-- Scheduler) poll e executa git+docker, escrevendo o log de volta na mesma linha. O daemon
-- só lê (SSE por polling) — nunca executa comandos de host.
create table if not exists deploy_requests (
  id uuid primary key default gen_random_uuid(),
  target text not null default 'self-hosted',   -- 'self-hosted' | 'vercel'
  action text not null default 'rebuild+up',     -- 'rebuild' | 'up' | 'rebuild+up'
  branch text not null default 'main',
  status text not null default 'pending',        -- pending | running | done | failed
  log jsonb not null default '[]'::jsonb,
  error text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);

create index if not exists idx_deploy_requests_status on deploy_requests (status, created_at desc);
