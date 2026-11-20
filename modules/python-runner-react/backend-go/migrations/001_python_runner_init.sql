CREATE TABLE IF NOT EXISTS pr_projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ready',
  active_release_id TEXT,
  source_hash TEXT,
  requirements_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS pr_project_releases (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES pr_projects(id) ON DELETE CASCADE,
  root_path TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  requirements_hash TEXT,
  entry_candidates JSONB NOT NULL DEFAULT '[]'::jsonb,
  dependency_files JSONB NOT NULL DEFAULT '[]'::jsonb,
  active BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS pr_project_releases_project_created_idx
  ON pr_project_releases(project_id, created_at DESC);

CREATE TABLE IF NOT EXISTS pr_executions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '未命名脚本',
  project_id TEXT REFERENCES pr_projects(id) ON DELETE SET NULL,
  task_mode TEXT NOT NULL DEFAULT 'once',
  trigger_type TEXT NOT NULL DEFAULT 'manual',
  trigger_id TEXT,
  source_type TEXT NOT NULL,
  source_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  source_snapshot_path TEXT,
  code_snapshot TEXT NOT NULL DEFAULT '',
  entry_file TEXT NOT NULL,
  working_directory TEXT,
  args JSONB NOT NULL DEFAULT '[]'::jsonb,
  timeout_seconds INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  stdout TEXT NOT NULL DEFAULT '',
  stderr TEXT NOT NULL DEFAULT '',
  stdout_path TEXT,
  stderr_path TEXT,
  logs_truncated BOOLEAN NOT NULL DEFAULT FALSE,
  exit_code INTEGER,
  workspace_path TEXT,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  duration_ms INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS pr_executions_created_idx ON pr_executions(created_at DESC);
CREATE INDEX IF NOT EXISTS pr_executions_status_created_idx ON pr_executions(status, created_at DESC);
CREATE INDEX IF NOT EXISTS pr_executions_project_created_idx ON pr_executions(project_id, created_at DESC);

CREATE TABLE IF NOT EXISTS pr_scheduled_tasks (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  source JSONB NOT NULL,
  args JSONB NOT NULL DEFAULT '[]'::jsonb,
  timeout_seconds INTEGER NOT NULL DEFAULT 30,
  schedule_type TEXT NOT NULL,
  cron_expression TEXT,
  run_at TIMESTAMPTZ,
  timezone TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  status TEXT NOT NULL DEFAULT 'enabled',
  next_run_at TIMESTAMPTZ,
  last_execution_id TEXT,
  last_run_at TIMESTAMPTZ,
  last_status TEXT,
  total_runs INTEGER NOT NULL DEFAULT 0,
  success_runs INTEGER NOT NULL DEFAULT 0,
  failed_runs INTEGER NOT NULL DEFAULT 0,
  notification_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS pr_scheduled_tasks_due_idx
  ON pr_scheduled_tasks(enabled, next_run_at);

CREATE TABLE IF NOT EXISTS pr_persistent_tasks (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  source JSONB NOT NULL,
  args JSONB NOT NULL DEFAULT '[]'::jsonb,
  runtime_environment TEXT NOT NULL DEFAULT 'project_venv',
  working_directory TEXT,
  status TEXT NOT NULL DEFAULT 'stopped',
  auto_start BOOLEAN NOT NULL DEFAULT FALSE,
  restart_policy TEXT NOT NULL DEFAULT 'never',
  restart_delay_seconds INTEGER NOT NULL DEFAULT 5,
  max_restart_count INTEGER NOT NULL DEFAULT 3,
  current_execution_id TEXT,
  pid INTEGER,
  started_at TIMESTAMPTZ,
  stopped_at TIMESTAMPTZ,
  last_heartbeat_at TIMESTAMPTZ,
  restart_count INTEGER NOT NULL DEFAULT 0,
  last_exit_code INTEGER,
  last_error TEXT,
  notification_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS pr_persistent_events (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES pr_persistent_tasks(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  status_before TEXT,
  status_after TEXT,
  message TEXT NOT NULL,
  exit_code INTEGER,
  error_summary TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS pr_persistent_events_task_created_idx
  ON pr_persistent_events(task_id, created_at DESC);

CREATE TABLE IF NOT EXISTS pr_security_scans (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES pr_projects(id) ON DELETE CASCADE,
  source_hash TEXT NOT NULL,
  risk_level TEXT NOT NULL,
  summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  message TEXT NOT NULL DEFAULT '',
  scanned_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS pr_security_scans_project_source_idx
  ON pr_security_scans(project_id, source_hash, scanned_at DESC);

CREATE TABLE IF NOT EXISTS pr_security_findings (
  id TEXT PRIMARY KEY,
  scan_id TEXT NOT NULL REFERENCES pr_security_scans(id) ON DELETE CASCADE,
  level TEXT NOT NULL,
  category TEXT NOT NULL,
  file TEXT NOT NULL,
  line INTEGER,
  message TEXT NOT NULL,
  suggestion TEXT NOT NULL,
  token TEXT,
  content TEXT
);

CREATE TABLE IF NOT EXISTS pr_environment_states (
  project_id TEXT PRIMARY KEY REFERENCES pr_projects(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'missing',
  python_executable TEXT,
  venv_path TEXT NOT NULL,
  requirements_path TEXT,
  requirements_hash TEXT,
  last_install_status TEXT,
  last_install_at TIMESTAMPTZ,
  last_install_exit_code INTEGER,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
