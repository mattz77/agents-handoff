-- TASK 37/38: registry próprio do handoff-daemon. `projects` já pertence ao
-- sistema commit-briefing (mesmo banco Supabase, schema diferente) — não tocar nela.
CREATE TABLE IF NOT EXISTS handoff_projects (
  id            SERIAL PRIMARY KEY,
  slug          TEXT UNIQUE NOT NULL,
  display_name  TEXT NOT NULL,
  local_path    TEXT,
  git_provider  TEXT NOT NULL DEFAULT 'github',  -- 'github' | 'gitlab' | 'local'
  git_owner     TEXT,
  git_repo      TEXT,
  default_branch TEXT DEFAULT 'main',
  codereview_enabled BOOLEAN DEFAULT TRUE,
  codereview_auto BOOLEAN DEFAULT FALSE,          -- entra no cron diário; false = só review manual
  codereview_schedule TEXT DEFAULT '02:00',       -- HH:MM BRT
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Migration idempotente pra bancos já criados sem a coluna:
ALTER TABLE handoff_projects ADD COLUMN IF NOT EXISTS codereview_auto BOOLEAN DEFAULT FALSE;
ALTER TABLE handoff_projects ALTER COLUMN codereview_schedule SET DEFAULT '02:00';
-- NULL = usa LINTER_MODEL padrão do .env. Preenchido = override por projeto (ex.: fallback quando o padrão está DEGRADED no NIM).
ALTER TABLE handoff_projects ADD COLUMN IF NOT EXISTS codereview_model TEXT;
-- Ciclo autônomo review→fix: agente ataca issues do último report e abre PR de correção.
ALTER TABLE handoff_projects ADD COLUMN IF NOT EXISTS attack_auto BOOLEAN DEFAULT FALSE;
ALTER TABLE handoff_projects ADD COLUMN IF NOT EXISTS attack_schedule TEXT DEFAULT '03:00'; -- HH:MM BRT, roda após o review das 02:00
ALTER TABLE handoff_projects ADD COLUMN IF NOT EXISTS attack_model TEXT;                    -- NULL = mesmo default do review

CREATE TABLE IF NOT EXISTS handoff_settings (
  key           TEXT PRIMARY KEY,
  value         TEXT,
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS codereview_reports (
  id            SERIAL PRIMARY KEY,
  project_slug  TEXT NOT NULL REFERENCES handoff_projects(slug),
  commit_sha    TEXT,
  pr_number     INT,
  pr_url        TEXT,
  score         NUMERIC(4,1),
  issues        JSONB NOT NULL DEFAULT '[]',
  summary       TEXT,
  refactors     JSONB NOT NULL DEFAULT '[]',
  diff_lines    INT,
  model_used    TEXT,
  pr_commented  BOOLEAN DEFAULT FALSE,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS codereview_reports_project_created_idx ON codereview_reports (project_slug, created_at DESC);

-- Execuções do fix-agent ("Atacar PR"): uma linha por ataque, log por issue em jsonb.
CREATE TABLE IF NOT EXISTS codereview_attacks (
  id            SERIAL PRIMARY KEY,
  project_slug  TEXT NOT NULL REFERENCES handoff_projects(slug),
  report_id     INT REFERENCES codereview_reports(id),
  model_used    TEXT,
  status        TEXT NOT NULL DEFAULT 'running',  -- running | done | failed
  branch        TEXT,
  pr_url        TEXT,
  issues_total  INT DEFAULT 0,
  issues_fixed  INT DEFAULT 0,
  log           JSONB NOT NULL DEFAULT '[]',       -- [{file,line,severity,status:'fixed'|'skipped'|'error',detail}]
  error         TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  finished_at   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS codereview_attacks_project_idx ON codereview_attacks (project_slug, created_at DESC);
