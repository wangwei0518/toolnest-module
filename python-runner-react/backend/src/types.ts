export interface PythonExecution {
  id: string;
  name: string;
  task_mode: string;
  trigger_type: string;
  trigger_id: string | null;
  source_type: string;
  source_config: Record<string, unknown>;
  source_snapshot_path: string | null;
  code_snapshot: string;
  entry_file: string;
  working_directory: string | null;
  args: string[];
  timeout_seconds: number;
  status: string;
  stdout: string;
  stderr: string;
  stdout_path: string | null;
  stderr_path: string | null;
  logs_truncated: boolean;
  exit_code: number | null;
  workspace_path: string | null;
  started_at: string | null;
  finished_at: string | null;
  duration_ms: number | null;
  created_at: string;
  updated_at: string;
}

export interface PythonOverview {
  stats: {
    running_count: number;
    today_total: number;
    today_success: number;
    today_failed: number;
    success_rate: number;
    enabled_schedule_count: number;
    next_schedule_time: string | null;
    running_persistent_count: number;
    failed_persistent_count: number;
  };
  recent_executions: PythonExecution[];
  running_executions: PythonExecution[];
  upcoming_schedules: Array<{
    id: string;
    name: string;
    description: string;
    schedule_type: string;
    cron_expression: string | null;
    next_run_at: string | null;
    status: string;
  }>;
  recent_logs: Array<{
    execution_id: string;
    execution_name: string;
    type: string;
    content: string;
    timestamp: string;
    status: string;
    exit_code: number | null;
  }>;
  error_logs: Array<{
    execution_id: string;
    execution_name: string;
    type: string;
    content: string;
    timestamp: string;
    status: string;
    exit_code: number | null;
  }>;
}

export interface ProjectSummary {
  id: string;
  name: string;
  status: string;
  active_release_id: string | null;
  source_hash: string | null;
  requirements_hash: string | null;
  created_at: string;
  updated_at: string;
}
