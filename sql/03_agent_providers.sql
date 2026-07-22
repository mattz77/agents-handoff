-- Provedores de modelos IA configuráveis pelo painel Ops (NVIDIA NIM, OpenAI, Anthropic).
-- Segredos (api_key) NUNCA em texto plano: coluna api_key_enc guarda AES-256-GCM
-- (ver src/infra/secret-box.ts). O painel só recebe status (configured/model), nunca a key.
--
-- provider_type: 'nim' | 'openai' | 'anthropic'
-- Uma linha por (provider_type, project_slug). project_slug NULL = provedor global (default do daemon).
-- is_default: quando true, esse provedor é o preferido para chamadas sem provider explícito.

CREATE TABLE IF NOT EXISTS agent_providers (
  id            bigserial primary key,
  provider_type text not null,                 -- 'nim' | 'openai' | 'anthropic'
  project_slug  text,                            -- NULL = global
  api_key_enc   text,                            -- AES-256-GCM base64 (iv||tag||ct)
  base_url      text,                            -- override opcional (NIM usa custom; OpenAI/Anthropic default)
  model         text,                            -- modelo default deste provedor
  is_default    boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (provider_type, project_slug)
);

CREATE INDEX IF NOT EXISTS idx_agent_providers_slug ON agent_providers (project_slug);
