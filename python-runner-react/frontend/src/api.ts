import type { ToolNestModuleApiClient } from "@toolnest/react-module-sdk";

const base = "/modules/python-runner";

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

export interface TimelineEvent {
  id: string;
  kind: string;
  status: string;
  title: string;
  subtitle?: string | null;
  event_time: string;
  trigger_type?: string | null;
  execution_id?: string | null;
  duration_ms?: number | null;
  exit_code?: number | null;
  schedule_text?: string | null;
  schedule_id?: string | null;
  error_summary?: string | null;
}

export interface PythonExecution {
  id: string;
  name: string;
  task_mode?: string;
  trigger_type?: string;
  trigger_id?: string | null;
  source_type: "inline" | "archive";
  source_config?: Record<string, unknown>;
  source_snapshot_path?: string | null;
  code_snapshot?: string;
  entry_file: string;
  working_directory?: string | null;
  args: string[];
  timeout_seconds: number;
  status: string;
  stdout: string;
  stderr: string;
  stdout_path?: string | null;
  stderr_path?: string | null;
  workspace_path?: string | null;
  exit_code: number | null;
  logs_truncated?: boolean;
  started_at: string | null;
  finished_at: string | null;
  duration_ms: number | null;
  created_at: string;
  updated_at: string;
}

export interface ProjectFileNode {
  name: string;
  path: string;
  type: "file" | "directory";
  children?: ProjectFileNode[];
}
export interface ProjectUpload {
  id: string;
  name: string;
  filename: string;
  upload_source: string;
  source_type: "archive";
  file_count: number;
  total_size: number;
  entry_candidates: string[];
  python_files: string[];
  dependency_files: string[];
  file_tree: ProjectFileNode[];
  status: string;
  error_message: string | null;
  created_at: string;
  updated_at: string;
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
export interface SecurityFinding {
  id: string;
  level: string;
  category: string;
  file: string;
  line: number | null;
  message: string;
  suggestion: string;
  token?: string;
  content?: string;
}
export interface SecurityScan {
  runner_mode: string;
  security_mode: string;
  scan_id: string;
  risk_level: string;
  summary: Record<string, number>;
  findings: SecurityFinding[];
  scanned_at: string;
  message: string;
}
export interface ProjectEnvironment {
  upload_id: string;
  status: string;
  python_executable: string | null;
  venv_path: string;
  project_dir: string;
  data_dir: string;
  data_size: number;
  requirements_path: string | null;
  has_requirements: boolean;
  risky_requirements: Array<Record<string, string>>;
  last_install_status: string | null;
  last_install_at: string | null;
  last_install_exit_code: number | null;
  last_error: string | null;
  requirements_changed: boolean;
  created_at: string | null;
  updated_at: string | null;
}
export interface ProjectConfig {
  upload_id: string;
  file_name: string;
  detected: boolean;
  source_exists: boolean;
  override_exists: boolean;
  valid: boolean;
  error: string | null;
  values: Record<string, unknown>;
  sensitive_paths: string[];
  configured_sensitive_paths: string[];
  source_updated_at: string | null;
  updated_at: string | null;
  size: number;
  content: string;
}
export interface ProjectFilePreview {
  path: string;
  filename: string;
  language: string;
  size: number;
  encoding: string;
  truncated: boolean;
  readonly: boolean;
  content: string;
}
export interface ProjectStorage {
  source_size: number;
  venv_size: number;
  data_size: number;
  workspace_size: number;
  logs_size: number;
  backup_size: number;
  backup_count: number;
  latest_backup_at: string | null;
  total_size: number;
  workspace_count: number;
  last_updated_at: string;
}
export interface ProjectUpdateResult {
  id: string;
  name?: string;
  updated?: boolean;
  rolled_back?: boolean;
  backup_id?: string | null;
  source_hash_changed?: boolean;
  requirements_changed?: boolean;
  old_requirements_hash?: string | null;
  new_requirements_hash?: string | null;
  entry_candidates?: string[];
  dependency_files?: string[];
  impacted_tasks: Array<Record<string, unknown>>;
  missing_entry_tasks: Array<Record<string, unknown>>;
  message: string;
}
export interface NotificationConfig {
  notify_on_failure: boolean;
  failure_threshold_enabled: boolean;
  failure_threshold: number;
  notify_on_success: boolean;
  notify_on_recovered: boolean;
  forward_output_on_success: boolean;
  output_mode: "summary" | "stdout" | "stderr" | "both";
  max_lines: number;
  max_chars: number;
  notify_when_empty_output: boolean;
  channels: "default" | "custom";
  custom_channels: string[];
  email_recipients: string[];
}
export interface ScheduledTask {
  id: string;
  name: string;
  description: string;
  code: string;
  source_type: string;
  source_config: Record<string, unknown>;
  source: ExecutionSource;
  args: string[];
  timeout_seconds: number;
  schedule_type: string;
  cron_expression: string | null;
  run_at: string | null;
  timezone: string;
  enabled: boolean;
  status: string;
  last_execution_id: string | null;
  last_run_at: string | null;
  next_run_at: string | null;
  last_status: string | null;
  total_runs: number;
  success_runs: number;
  failed_runs: number;
  notification_config: NotificationConfig;
  created_at: string;
  updated_at: string;
}
export interface PersistentTask {
  id: string;
  name: string;
  description: string;
  code: string;
  source_type: string;
  source_config: Record<string, unknown>;
  source: ExecutionSource;
  args: string[];
  runtime_environment: string;
  working_directory: string | null;
  status: string;
  auto_start: boolean;
  restart_policy: string;
  restart_delay_seconds: number;
  max_restart_count: number;
  notification_config: NotificationConfig;
  current_execution_id: string | null;
  pid: number | null;
  started_at: string | null;
  stopped_at: string | null;
  last_heartbeat_at: string | null;
  restart_count: number;
  last_exit_code: number | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}
export type ExecutionSource =
  | { type: "inline"; code: string }
  | {
      type: "archive";
      project_id?: string;
      upload_id?: string;
      entry_file?: string;
    };
export interface CreateExecutionPayload {
  name: string;
  source: ExecutionSource;
  args: string[];
  timeout_seconds: number;
  runtime_environment: "auto" | "project_venv" | "system";
  security?: { risk_confirmed: boolean; scan_id: string };
}

let client: ToolNestModuleApiClient | null = null;
export function setPythonRunnerApi(next: ToolNestModuleApiClient | null) {
  client = next;
}
export type UploadProgressHandler = (value: number) => void;

function uploadProgressConfig(onProgress?: UploadProgressHandler) {
  if (!onProgress) return undefined;
  return {
    onUploadProgress: (event: { loaded: number; total?: number }) => {
      if (!event.total || event.total <= 0) return;
      onProgress(Math.min(100, Math.round((event.loaded / event.total) * 100)));
    },
  };
}
function api(): ToolNestModuleApiClient {
  if (!client) throw new Error("Python Runner API is not initialized");
  return client;
}

export function getOverview() {
  return api().get<PythonOverview>(`${base}/overview`);
}
export function getTimeline(limit = 30) {
  return api().get<{ items: TimelineEvent[] }>(`${base}/timeline`, {
    params: { limit },
  });
}
export function scanInline(code: string) {
  return api().post<SecurityScan>(`${base}/security/scan-inline`, { code });
}
export function listProjects() {
  return api().get<ProjectSummary[]>(`${base}/projects`);
}
export function listUploads() {
  return api().get<ProjectUpload[]>(`${base}/uploads`);
}
export function getUpload(id: string) {
  return api().get<ProjectUpload>(`${base}/uploads/${encodeURIComponent(id)}`);
}
export function uploadProject(
  file: File,
  name: string,
  uploadSource: "zip" | "folder" = "zip",
  onProgress?: UploadProgressHandler,
) {
  const body = new FormData();
  body.append("file", file);
  body.append("name", name);
  body.append("upload_source", uploadSource);
  return api().post<ProjectUpload>(
    `${base}/uploads/archive`,
    body,
    uploadProgressConfig(onProgress),
  );
}
export function deleteUpload(id: string) {
  return api().delete<null>(`${base}/uploads/${encodeURIComponent(id)}`);
}
export function updateUpload(
  id: string,
  file: File,
  name: string,
  confirmScheduleImpact = false,
  uploadSource: "zip" | "folder" = "zip",
  onProgress?: UploadProgressHandler,
) {
  const body = new FormData();
  body.append("file", file);
  body.append("name", name);
  body.append("upload_source", uploadSource);
  body.append("confirm_schedule_impact", String(confirmScheduleImpact));
  return api().post<ProjectUpdateResult>(
    `${base}/uploads/${encodeURIComponent(id)}/update`,
    body,
    uploadProgressConfig(onProgress),
  );
}
export function rollbackUpload(id: string, confirmScheduleImpact = false) {
  return api().post<ProjectUpdateResult>(
    `${base}/uploads/${encodeURIComponent(id)}/rollback`,
    { confirm_schedule_impact: confirmScheduleImpact },
  );
}
export function getSecurity(id: string) {
  return api().get<SecurityScan>(
    `${base}/uploads/${encodeURIComponent(id)}/security`,
  );
}
export function scanSecurity(id: string) {
  return api().post<SecurityScan>(
    `${base}/uploads/${encodeURIComponent(id)}/security/scan`,
  );
}
export function previewFile(id: string, filePath: string) {
  return api().get<ProjectFilePreview>(
    `${base}/uploads/${encodeURIComponent(id)}/files/preview`,
    { params: { path: filePath, scope: "source" } },
  );
}
export function getProjectStorage(id: string) {
  return api().get<ProjectStorage>(
    `${base}/uploads/${encodeURIComponent(id)}/storage`,
  );
}
export function getProjectConfig(id: string) {
  return api().get<ProjectConfig>(
    `${base}/uploads/${encodeURIComponent(id)}/config`,
  );
}
export function saveProjectConfig(
  id: string,
  payload: { values?: Record<string, unknown>; content?: string },
) {
  return api().put<ProjectConfig>(
    `${base}/uploads/${encodeURIComponent(id)}/config`,
    payload,
  );
}
export function getEnvironment(id: string) {
  return api().get<ProjectEnvironment>(
    `${base}/uploads/${encodeURIComponent(id)}/environment`,
  );
}
export function createEnvironment(id: string) {
  return api().post<ProjectEnvironment>(
    `${base}/uploads/${encodeURIComponent(id)}/environment/create`,
  );
}
export function installRequirements(
  id: string,
  payload: Record<string, unknown>,
) {
  return api().post<ProjectEnvironment>(
    `${base}/uploads/${encodeURIComponent(id)}/environment/install-requirements`,
    payload,
  );
}
export function rebuildEnvironment(id: string) {
  return api().post<ProjectEnvironment>(
    `${base}/uploads/${encodeURIComponent(id)}/environment/rebuild`,
  );
}
export function deleteEnvironment(id: string) {
  return api().delete<ProjectEnvironment>(
    `${base}/uploads/${encodeURIComponent(id)}/environment`,
  );
}
export function getInstallLog(id: string) {
  return api().get<{ content: string; truncated: boolean }>(
    `${base}/uploads/${encodeURIComponent(id)}/environment/install-log`,
  );
}
export function clearProjectData(id: string) {
  return api().delete<ProjectEnvironment>(
    `${base}/uploads/${encodeURIComponent(id)}/data`,
  );
}
export type ProjectCleanupTarget =
  | "workspaces"
  | "execution_snapshots"
  | "install_logs"
  | "project_data"
  | "venv"
  | "backups";
export function cleanupProject(id: string, target: ProjectCleanupTarget) {
  return api().post<{
    target: string;
    deleted_files: number;
    freed_bytes: number;
    message: string;
  }>(`${base}/uploads/${encodeURIComponent(id)}/maintenance/cleanup`, {
    target,
  });
}
export function runProject(
  id: string,
  entryFile: string,
  runtimeEnvironment: CreateExecutionPayload["runtime_environment"],
  options: Omit<Partial<CreateExecutionPayload>, "source"> = {},
) {
  return createExecution({
    name: options.name ?? `项目运行 · ${entryFile || "自动入口"}`,
    source: {
      type: "archive",
      project_id: id,
      upload_id: id,
      entry_file: entryFile,
    },
    args: options.args ?? [],
    timeout_seconds: options.timeout_seconds ?? 30,
    runtime_environment: runtimeEnvironment,
    ...(options.security ? { security: options.security } : {}),
  });
}
export function createExecution(payload: CreateExecutionPayload) {
  return api().post<PythonExecution>(`${base}/executions`, payload);
}
export function listExecutions() {
  return api().get<PythonExecution[]>(`${base}/executions`);
}
export function getExecution(id: string) {
  return api().get<PythonExecution>(`${base}/executions/${id}`);
}
export function getExecutionLogs(id: string, after?: string, limit?: number) {
  return api().get<
    Array<{ type: string; content: string; timestamp: string; cursor?: string }>
  >(`${base}/executions/${id}/logs`, {
    params: { ...(after ? { after } : {}), ...(limit ? { limit } : {}) },
  });
}
export function stopExecution(id: string) {
  return api().post<PythonExecution>(`${base}/executions/${id}/stop`);
}
export function rerunExecution(id: string) {
  return api().post<PythonExecution>(`${base}/executions/${id}/rerun`);
}
export function deleteExecution(id: string) {
  return api().delete<null>(`${base}/executions/${id}`);
}
export interface TaskListParams {
  keyword?: string | undefined;
  status?: string | undefined;
  page?: number;
  page_size?: number;
}
export function listSchedules(params?: TaskListParams) {
  return api().get<{
    items: ScheduledTask[];
    total: number;
    page: number;
    page_size: number;
  }>(`${base}/scheduled-tasks`, { params });
}
export function createSchedule(payload: Record<string, unknown>) {
  return api().post<ScheduledTask>(`${base}/scheduled-tasks`, payload);
}
export function getSchedule(id: string) {
  return api().get<ScheduledTask>(
    `${base}/scheduled-tasks/${encodeURIComponent(id)}`,
  );
}
export function updateSchedule(id: string, payload: Record<string, unknown>) {
  return api().put<ScheduledTask>(
    `${base}/scheduled-tasks/${encodeURIComponent(id)}`,
    payload,
  );
}
export function toggleSchedule(id: string, enabled: boolean) {
  return api().post<ScheduledTask>(
    `${base}/scheduled-tasks/${id}/${enabled ? "enable" : "disable"}`,
  );
}
export function runSchedule(id: string) {
  return api().post<ScheduledTask>(`${base}/scheduled-tasks/${id}/run`);
}
export function deleteSchedule(id: string) {
  return api().delete<null>(`${base}/scheduled-tasks/${id}`);
}
export function listPersistentTasks(params?: TaskListParams) {
  return api().get<{
    items: PersistentTask[];
    total: number;
    page: number;
    page_size: number;
  }>(`${base}/persistent-tasks`, { params });
}
export function getPersistentTask(id: string) {
  return api().get<PersistentTask>(
    `${base}/persistent-tasks/${encodeURIComponent(id)}`,
  );
}
export function createPersistentTask(payload: Record<string, unknown>) {
  return api().post<PersistentTask>(`${base}/persistent-tasks`, payload);
}
export function updatePersistentTask(
  id: string,
  payload: Record<string, unknown>,
) {
  return api().put<PersistentTask>(
    `${base}/persistent-tasks/${encodeURIComponent(id)}`,
    payload,
  );
}
export function startPersistent(id: string) {
  return api().post<PersistentTask>(`${base}/persistent-tasks/${id}/start`);
}
export function stopPersistent(id: string) {
  return api().post<PersistentTask>(`${base}/persistent-tasks/${id}/stop`);
}
export function restartPersistent(id: string) {
  return api().post<PersistentTask>(`${base}/persistent-tasks/${id}/restart`);
}
export function deletePersistent(id: string) {
  return api().delete<null>(`${base}/persistent-tasks/${id}`);
}
export interface PersistentTaskEvent {
  id: string;
  event_type: string;
  status_before: string | null;
  status_after: string | null;
  message: string;
  exit_code: number | null;
  error_summary: string | null;
  created_at: string;
}
export function getPersistentLogs(id: string) {
  return api().get<{ lines: string[]; log_size: number; truncated: boolean }>(
    `${base}/persistent-tasks/${id}/logs`,
  );
}
export function clearPersistentLogs(id: string) {
  return api().post<{ lines: string[]; log_size: number }>(
    `${base}/persistent-tasks/${id}/logs/clear`,
  );
}
export function getPersistentEvents(id: string) {
  return api().get<PersistentTaskEvent[]>(
    `${base}/persistent-tasks/${id}/events`,
  );
}
