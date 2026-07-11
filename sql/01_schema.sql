-- Schema da Auditoria (Handoffs) e Outbox para garantir idempotência e consistência

-- lifecycle_status (text, sem CHECK): valores aceitos pelo domínio LifecycleStatus
--   INIT | IN_PROGRESS | AWAITING_HANDOFF_OPS | AWAITING_HANDOFF_DEV
--   FALLBACK_TRIGGERED | DONE | FAILED | ACKNOWLEDGED | COMPLETED
CREATE TABLE handoffs (
  task_id          uuid primary key,
  idempotency_key  text not null unique,
  correlation_id   uuid not null,
  project          text not null,
  branch           text,
  lifecycle_status text not null,
  payload          jsonb not null,
  sender           text not null,
  receiver         text not null,
  attempt          int  not null default 1,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

CREATE INDEX idx_handoffs_status  ON handoffs (lifecycle_status);
CREATE INDEX idx_handoffs_corr    ON handoffs (correlation_id);
CREATE INDEX idx_handoffs_payload ON handoffs USING GIN (payload);

CREATE TABLE outbox (
  id             bigserial primary key,
  aggregate_id   uuid not null,              -- task_id
  event_type     text not null,              -- 'whatsapp.notify' | 'n8n.relay' ...
  payload        jsonb not null,
  status         text not null default 'PENDING', -- PENDING | SENT | FAILED
  attempts       int  not null default 0,
  created_at     timestamptz not null default now(),
  sent_at        timestamptz
);

CREATE INDEX idx_outbox_pending ON outbox (status) WHERE status = 'PENDING';
