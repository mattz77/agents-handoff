-- Auditorias do Hermes 3 (linter assíncrono). NÃO são transições de ciclo de vida do handoff:
-- são anexos referenciando o correlation_id do handoff auditado.
CREATE TABLE IF NOT EXISTS hermes_audits (
  id              bigserial primary key,
  correlation_id  uuid not null,
  handoff_task_id uuid,
  project         text,
  nota            int,                          -- 0-10 (null se severidade unknown)
  severidade      text not null,                -- low | medium | high | unknown
  riscos          jsonb not null default '[]',
  resumo          text,
  raw             text,                         -- resposta crua do modelo (debug / saída malformada)
  created_at      timestamptz not null default now()
);

CREATE INDEX IF NOT EXISTS idx_hermes_audits_corr    ON hermes_audits (correlation_id);
CREATE INDEX IF NOT EXISTS idx_hermes_audits_created ON hermes_audits (created_at DESC);
