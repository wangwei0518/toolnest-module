export type WorkflowStatus = "draft" | "published" | "archived";
export type VersionStatus = "draft" | "published" | "archived";
export type TicketStatus = "draft" | "in_progress" | "blocked" | "completed" | "cancelled" | "archived";
export type TicketPriority = "none" | "low" | "medium" | "high" | "urgent";
export type TicketNodeStatus = "pending" | "ready" | "in_progress" | "waiting" | "blocked" | "completed" | "skipped" | "failed" | "cancelled";
export type ProjectStatus = "planning" | "active" | "paused" | "completed" | "archived";
export type MilestoneStatus = "pending" | "in_progress" | "completed" | "cancelled";
export type FormFieldType = "text" | "textarea" | "number" | "select" | "radio" | "multiselect" | "switch" | "date" | "checklist" | "todo" | "markdown" | "json" | "code" | "file" | "image" | "url" | "script";

export interface FormOption {
  label: string;
  value: string | number;
}

export interface FormField {
  id: string;
  type: FormFieldType;
  label: string;
  description?: string;
  placeholder?: string;
  required?: boolean;
  readonly?: boolean;
  hidden?: boolean;
  default?: unknown;
  default_template?: string;
  options?: FormOption[];
  items?: Array<{ id: string; label: string }>;
  config?: Record<string, unknown>;
  reference?: { path?: string; mode?: string };
}

export interface FormSchema {
  fields: FormField[];
}

export interface RuleGroup {
  type?: "group";
  operator?: "AND" | "OR";
  children?: Array<RuleGroup | CompletionRule>;
  rules?: Array<RuleGroup | CompletionRule>;
  negate?: boolean;
}

export interface CompletionRule {
  type?: "rule";
  kind?: "field_filled" | "value_compare" | "checklist_complete" | "attachment_count" | "manual_confirm" | "node_status";
  field_id?: string;
  node_id?: string;
  operator?: string;
  operator_value?: unknown;
  value?: unknown;
  count?: number;
  status?: string;
  label?: string;
  negate?: boolean;
}

export interface PredecessorCondition {
  node_id: string;
  statuses?: string[];
  status?: string;
  negate?: boolean;
}

export interface PredecessorRule {
  operator: "AND" | "OR";
  conditions: PredecessorCondition[];
  negate?: boolean;
}

export interface WorkflowAction {
  provider_key: string;
  event: string;
  label?: string;
  config?: Record<string, unknown>;
  order?: number;
}

export interface WorkflowNode {
  id: string;
  name: string;
  key: string;
  description: string;
  node_type: "general" | "summary";
  status?: string;
  position: { x: number; y: number };
  form_schema: FormSchema;
  completion_rule: RuleGroup | CompletionRule;
  predecessor_rule?: PredecessorRule | null;
  actions: WorkflowAction[];
  inputs: Array<Record<string, unknown>>;
  outputs: Array<Record<string, unknown>>;
}

export interface WorkflowEdge {
  id: string;
  source_node_id: string;
  target_node_id: string;
  source_side?: string;
  target_side?: string;
  priority?: number;
  condition?: RuleGroup | CompletionRule | null;
  condition_mode?: "unconditional" | "conditional" | "unless";
}

export interface WorkflowVersion {
  id: string;
  workflow_id: string;
  version: number;
  status: VersionStatus;
  change_note: string;
  publish_note: string;
  source_version_id?: string | null;
  created_at: string;
  published_at?: string | null;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  ticket_count: number;
}

export interface Workflow {
  id: string;
  name: string;
  description: string;
  group_name?: string | null;
  status: WorkflowStatus;
  created_at: string;
  updated_at: string;
  current_version_id: string;
  versions: WorkflowVersion[];
}

export interface TicketNode {
  id: string;
  node_id: string;
  name: string;
  key: string;
  status: TicketNodeStatus;
  values: Record<string, unknown>;
  outputs: Array<Record<string, unknown>>;
  resources: Record<string, Record<string, unknown>>;
  blocked_reason: string;
  started_at?: string | null;
  completed_at?: string | null;
  assignee_id?: string | null;
  assignee_name?: string | null;
}

export interface Ticket {
  id: string;
  number: string;
  title: string;
  note: string;
  status: TicketStatus;
  priority: TicketPriority;
  tags: string[];
  workflow_id: string;
  workflow_version_id: string;
  workflow_name: string;
  project_id?: string | null;
  project_name?: string;
  milestone_id?: string | null;
  milestone_name?: string;
  created_by: string;
  owner_id?: string | null;
  owner_name?: string | null;
  weight?: number;
  due_at?: string | null;
  reminder_at?: string | null;
  reminder_sent_at?: string | null;
  attachments?: Array<Record<string, unknown>>;
  parent_ticket_id?: string | null;
  related_ticket_ids?: string[];
  blocked_by_ticket_ids?: string[];
  created_at: string;
  updated_at: string;
  node_instances: TicketNode[];
}

export interface TimelineEvent {
  id: string;
  type: string;
  title: string;
  detail?: string;
  ticket_id?: string | null;
  node_id?: string | null;
  project_id?: string | null;
  milestone_id?: string | null;
  created_at: string;
  actor_name: string;
}

export interface TimelineActivityTicket {
  id: string;
  number: string;
  title: string;
}

export interface TimelineActivityDay {
  date: string;
  count: number;
  samples: string[];
  tickets?: TimelineActivityTicket[];
}

export interface TimelineActivity {
  total: number;
  days: TimelineActivityDay[];
}

export interface Project {
  id: string;
  key: string;
  name: string;
  description: string;
  goal?: string;
  status: ProjectStatus;
  owner_name: string;
  start_at?: string | null;
  planned_start_at?: string | null;
  target_at?: string | null;
  tags: string[];
  note: string;
  review_markdown?: string;
  default_workflow_id?: string | null;
  color?: string;
  icon?: string;
  favorite?: boolean;
  created_at: string;
  updated_at: string;
}

export interface Milestone {
  id: string;
  project_id: string;
  name: string;
  description: string;
  goal?: string;
  status: MilestoneStatus;
  owner_name?: string | null;
  target_at?: string | null;
  progress_mode: "ticket" | "manual";
  progress: number;
  manual_progress?: number;
  completion_criteria?: string;
  risk_note?: string;
  review: string;
  review_markdown?: string;
  ticket_count?: number;
  completed_ticket_count?: number;
  notification_sent_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface ScheduleItem {
  id: string;
  title: string;
  note: string;
  status: "pending" | "completed" | "converted" | "archived";
  owner_id?: string | null;
  owner_name: string;
  due_at?: string | null;
  reminder_at?: string | null;
  ticket_id?: string | null;
  created_at: string;
  updated_at: string;
}

export type ScheduleType = "once" | "daily" | "weekly" | "monthly" | "cron";

export interface Schedule {
  id: string;
  workflow_id: string;
  name: string;
  schedule_type: ScheduleType;
  timezone: string;
  start_at: string;
  end_at?: string | null;
  weekday?: number | null;
  day_of_month?: number | null;
  cron_expression: string;
  cron_day_mode: "calendar" | "weekday";
  title_template: string;
  note_template: string;
  project_id?: string | null;
  milestone_id?: string | null;
  enabled: boolean;
  next_run_at?: string | null;
  last_run_at?: string | null;
  last_run_status?: string | null;
  last_run_error?: string | null;
  run_count: number;
  created_at: string;
  updated_at: string;
}

export interface ScheduleRun {
  id: string;
  schedule_id: string;
  workflow_id: string;
  planned_at: string;
  executed_at: string;
  status: "succeeded" | "failed" | "skipped";
  ticket_id?: string | null;
  error?: string | null;
}

export interface SavedView {
  id: string;
  name: string;
  filters: Record<string, unknown>;
  favorite: boolean;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

export interface AutomationRule {
  id: string;
  name: string;
  enabled: boolean;
  trigger: string;
  conditions: Record<string, unknown>;
  actions: Array<Record<string, unknown>>;
  created_at: string;
  updated_at: string;
}

export interface RelatedResource {
  id: string;
  project_id?: string | null;
  project_ids?: string[];
  name: string;
  type: string;
  resource_type?: string;
  url?: string | null;
  external_url?: string | null;
  identifier?: string;
  description: string;
  attributes: Record<string, unknown>;
  ticket_ids: string[];
  milestone_ids: string[];
  created_at: string;
  updated_at: string;
}

export interface Attachment {
  id: string;
  ticket_id: string;
  ticket_node_id: string;
  field_id: string;
  filename: string;
  stored_name: string;
  mime_type: string;
  extension: string;
  size: number;
  storage_path: string;
  created_at: string;
}

export interface TemporaryResource {
  id: string;
  token: string;
  ticket_id: string;
  ticket_node_id: string;
  field_id: string;
  filename: string;
  mime_type: string;
  content: string;
  expires_at: string;
  max_access_count?: number | null;
  access_count: number;
  revoked: boolean;
}

export interface ActionExecution {
  id: string;
  ticket_id: string;
  node_id?: string | null;
  provider_key: string;
  event: string;
  status: string;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  error?: string | null;
  created_at: string;
  completed_at?: string | null;
}

export interface Settings {
  max_file_size_mb: number;
  temporary_resource_days: number;
  temporary_resource_access_count: number;
  notification_rules: Record<string, { enabled: boolean; level: string; channels: string[] }>;
}

export interface WorkflowStore {
  schema_version: number;
  workflows: Workflow[];
  tickets: Ticket[];
  timeline: TimelineEvent[];
  projects: Project[];
  milestones: Milestone[];
  schedule_items: ScheduleItem[];
  schedules: Schedule[];
  schedule_runs: ScheduleRun[];
  saved_views: SavedView[];
  automations: AutomationRule[];
  resources: RelatedResource[];
  attachments: Attachment[];
  temporary_resources: TemporaryResource[];
  action_executions: ActionExecution[];
  settings: Settings;
}

export interface Page<T> {
  items: T[];
  total: number;
  page?: number;
  page_size?: number;
}

export interface ApiError extends Error {
  statusCode?: number;
}

export function nowIso(): string {
  return new Date().toISOString();
}

import { randomUUID } from "node:crypto";

export function id(): string {
  return randomUUID().replaceAll("-", "");
}

export function defaultSettings(): Settings {
  return {
    max_file_size_mb: 20,
    temporary_resource_days: 7,
    temporary_resource_access_count: 3,
    notification_rules: {
      ticket_created: { enabled: true, level: "info", channels: ["in_app"] },
      node_ready: { enabled: true, level: "info", channels: ["in_app"] },
      node_completed: { enabled: false, level: "success", channels: ["in_app"] },
      ticket_completed: { enabled: true, level: "success", channels: ["in_app"] },
      ticket_blocked: { enabled: true, level: "warning", channels: ["in_app"] },
      ticket_reopened: { enabled: true, level: "info", channels: ["in_app"] },
      ticket_reminder: { enabled: true, level: "warning", channels: ["in_app"] },
      milestone_due: { enabled: true, level: "warning", channels: ["in_app"] },
      project_risk: { enabled: true, level: "warning", channels: ["in_app"] },
    },
  };
}

export function emptyStore(): WorkflowStore {
  return {
    schema_version: 3,
    workflows: [],
    tickets: [],
    timeline: [],
    projects: [],
    milestones: [],
    schedule_items: [],
    schedules: [],
    schedule_runs: [],
    saved_views: [],
    automations: [],
    resources: [],
    attachments: [],
    temporary_resources: [],
    action_executions: [],
    settings: defaultSettings(),
  };
}
