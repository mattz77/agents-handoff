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
  codereview_schedule TEXT DEFAULT '23:45',       -- HH:MM BRT
  created_at    TIMESTAMPTZ DEFAULT NOW(),
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
