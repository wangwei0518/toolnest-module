import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import { JsonStore } from "./store.js";
import {
  defaultSettings,
  id,
  nowIso,
  type ActionExecution,
  type AutomationExecutionRead,
  type Attachment,
  type AutomationRule,
  type CompletionRule,
  type FormField,
  type ScheduleItem,
  type Milestone,
  type Page,
  type PredecessorCondition,
  type Project,
  type RelatedResource,
  type RuleGroup,
  type SavedView,
  type Schedule,
  type ScheduleRun,
  type NotificationRule,
  type Settings,
  type Ticket,
  type TicketNode,
  type TimelineActivity,
  type TimelineActivityTicket,
  type TimelineEvent,
  type Workflow,
  type WorkflowEdge,
  type WorkflowNode,
  type WorkflowStore,
  type WorkflowVersion,
} from "./types.js";

export class DomainError extends Error {
  constructor(readonly statusCode: number, message: string) {
    super(message);
    this.name = "DomainError";
  }
}

const ACTIVE_NODE_STATUSES = new Set(["ready", "in_progress", "waiting", "blocked"]);
const TERMINAL_TICKET_STATUSES = new Set(["completed", "cancelled", "archived"]);
const RELATED_RESOURCE_TYPES = new Set(["server", "repository", "document", "custom"]);
const AUTOMATION_TRIGGERS = new Set(["ticket_created", "ticket_completed", "ticket_cancelled", "ticket_reopened", "node_ready", "node_completed", "node_blocked", "ticket_reminder"]);
const AUTOMATION_TRIGGER_ALIASES: Record<string, string> = { ticket_blocked: "node_blocked", ticket_reminder_sent: "ticket_reminder" };
const AUTOMATION_ACTION_TYPES = new Set(["set_priority", "add_tag", "set_project", "set_milestone", "set_due_at", "archive"]);
const AUTOMATION_PRIORITIES = new Set(["none", "low", "medium", "high", "urgent"]);
const AUTOMATION_TICKET_STATUSES = new Set(["draft", "in_progress", "blocked", "completed", "cancelled", "archived"]);

function canonicalResourceType(value: string): string {
  return value === "link" || value === "url" ? "custom" : value;
}

function fail(statusCode: number, message: string): never {
  throw new DomainError(statusCode, message);
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function canonicalAutomationTrigger(value: string): string {
  return AUTOMATION_TRIGGER_ALIASES[value] ?? value;
}

const SETTING_LIMITS = {
  max_file_size_mb: { min: 1, max: 2048, label: "最大附件大小" },
  temporary_resource_days: { min: 1, max: 365, label: "临时资源有效期" },
  temporary_resource_access_count: { min: 1, max: 10000, label: "临时资源最大访问次数" },
} as const;
const SUPPORTED_NOTIFICATION_CHANNELS = new Set(["web_internal", "qqbot", "email", "webhook"]);
const NOTIFICATION_CHANNEL_ALIASES: Record<string, string> = { in_app: "web_internal" };
const SUPPORTED_NOTIFICATION_LEVELS = new Set(["info", "success", "warning", "error"]);
const FALLBACK_NOTIFICATION_RULE: NotificationRule = { enabled: true, level: "info", channels: ["web_internal"] };

function normalizeStoredRule(value: unknown, fallback = FALLBACK_NOTIFICATION_RULE): NotificationRule {
  const raw = asObject(value);
  const rawChannels = Array.isArray(raw.channels) ? raw.channels : fallback.channels;
  const channels = [...new Set(rawChannels.map(text).map((channel) => NOTIFICATION_CHANNEL_ALIASES[channel] ?? channel).filter((channel) => SUPPORTED_NOTIFICATION_CHANNELS.has(channel)))];
  return {
    enabled: typeof raw.enabled === "boolean" ? raw.enabled : fallback.enabled,
    level: SUPPORTED_NOTIFICATION_LEVELS.has(text(raw.level)) ? text(raw.level) : fallback.level,
    channels: channels.length ? channels : [...fallback.channels],
  };
}

function normalizeStoredSettings(value: unknown): Settings {
  const raw = asObject(value);
  const defaults = defaultSettings();
  const settings = { ...defaults };
  for (const key of Object.keys(SETTING_LIMITS) as Array<keyof typeof SETTING_LIMITS>) {
    const number = Number(raw[key]);
    const limit = SETTING_LIMITS[key];
    settings[key] = Number.isInteger(number) && number >= limit.min && number <= limit.max ? number : defaults[key];
  }
  const storedRules = asObject(raw.notification_rules);
  const rules: Record<string, NotificationRule> = { ...defaults.notification_rules };
  for (const [event, value] of Object.entries(storedRules)) rules[event] = normalizeStoredRule(value, rules[event] ?? FALLBACK_NOTIFICATION_RULE);
  if (storedRules.node_blocked && !storedRules.ticket_blocked) rules.ticket_blocked = normalizeStoredRule(storedRules.node_blocked, rules.ticket_blocked ?? FALLBACK_NOTIFICATION_RULE);
  settings.notification_rules = rules;
  return settings;
}

function validatedSettingNumber(value: unknown, key: keyof typeof SETTING_LIMITS, fallback: number): number {
  const number = Number(value);
  const limit = SETTING_LIMITS[key];
  if (!Number.isInteger(number) || number < limit.min || number > limit.max) fail(422, `${limit.label}必须是 ${limit.min}–${limit.max} 之间的整数`);
  return number || fallback;
}

function validateRule(value: unknown, fallback: NotificationRule): NotificationRule {
  const raw = asObject(value);
  if (raw.enabled !== undefined && typeof raw.enabled !== "boolean") fail(422, "通知开关必须是布尔值");
  const level = raw.level === undefined ? fallback.level : text(raw.level);
  if (!SUPPORTED_NOTIFICATION_LEVELS.has(level)) fail(422, "通知级别无效");
  if (raw.channels !== undefined && (!Array.isArray(raw.channels) || raw.channels.some((item) => typeof item !== "string"))) fail(422, "通知渠道必须是字符串数组");
  const channels = [...new Set((Array.isArray(raw.channels) ? raw.channels : fallback.channels).map(text).map((channel) => NOTIFICATION_CHANNEL_ALIASES[channel] ?? channel))];
  if (channels.some((channel) => !SUPPORTED_NOTIFICATION_CHANNELS.has(channel))) fail(422, "通知渠道包含不支持的类型");
  const enabled = raw.enabled === undefined ? fallback.enabled : raw.enabled;
  if (enabled && !channels.length) fail(422, "启用通知时至少选择一个通知渠道");
  return { enabled, level, channels };
}

function normalizeIds(value: unknown): string[] {
  return [...new Set(asArray(value).map(text).filter(Boolean))];
}

function hasValue(value: unknown): boolean {
  if (value === false || value === 0) return true;
  if (Array.isArray(value)) return value.length > 0;
  return value !== null && value !== undefined && String(value).trim() !== "";
}

function sortedUpdated<T extends { updated_at: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => b.updated_at.localeCompare(a.updated_at));
}

function safeDate(value: unknown): Date | null {
  if (!value) return null;
  const date = new Date(String(value));
  return Number.isNaN(date.valueOf()) ? null : date;
}

function activityDateKey(value: string, timeZone: string): string {
  const date = safeDate(value);
  if (!date) return "";
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
    const values = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

function shiftActivityDate(dateKey: string, offset: number): string {
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  if (Number.isNaN(date.valueOf())) return "";
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

function jsonValue(value: unknown): unknown {
  if (value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  return value;
}

function normalizeTags(value: unknown): string[] {
  return [...new Set(asArray(value).map(text).filter(Boolean))];
}

function workflowRead(workflow: Workflow, tickets: Ticket[]): Workflow {
  const usage = new Map<string, number>();
  for (const ticket of tickets) usage.set(ticket.workflow_version_id, (usage.get(ticket.workflow_version_id) ?? 0) + 1);
  const result = clone(workflow);
  for (const version of result.versions) version.ticket_count = usage.get(version.id) ?? 0;
  result.status = result.versions.some((item) => item.status === "published") ? "published" : result.status;
  return result;
}

function ticketRead(ticket: Ticket, workflows: Workflow[], projects: Project[] = [], milestones: Milestone[] = []): Ticket {
  const result = clone(ticket);
  const workflow = workflows.find((item) => item.id === ticket.workflow_id);
  result.workflow_name = workflow?.name ?? ticket.workflow_name;
  const project = projects.find((item) => item.id === ticket.project_id);
  const milestone = milestones.find((item) => item.id === ticket.milestone_id);
  result.project_name = project?.name ?? ticket.project_name ?? "";
  result.milestone_name = milestone?.name ?? ticket.milestone_name ?? "";
  result.weight = result.weight ?? 1;
  result.related_ticket_ids = result.related_ticket_ids ?? [];
  result.blocked_by_ticket_ids = result.blocked_by_ticket_ids ?? [];
  return result;
}

function defaultWorkflow(name: string, description: string, groupName?: string | null): Workflow {
  const workflowId = id();
  const makeNode = (nodeName: string, key: string, descriptionText: string, field: FormField, rule: CompletionRule, x: number): WorkflowNode => ({
    id: id(), name: nodeName, key, description: descriptionText, node_type: "general", status: "ready", position: { x, y: 140 },
    form_schema: { fields: [field] }, completion_rule: { type: "group", operator: "AND", children: [rule] }, actions: [], inputs: [], outputs: [],
  });
  const first = makeNode("准备资料", "prepare", "准备当前节点需要的输入。", { id: "context", type: "textarea", label: "执行说明", required: true, placeholder: "记录本节点的输入或约束" }, { type: "rule", kind: "field_filled", field_id: "context", label: "执行说明" }, 80);
  const second = makeNode("执行处理", "process", "执行并记录实际处理过程。", { id: "result", type: "textarea", label: "处理结果", required: true }, { type: "rule", kind: "field_filled", field_id: "result", label: "处理结果" }, 360);
  const third = makeNode("结果确认", "confirm", "确认结果并沉淀可复用输出。", { id: "confirmed", type: "switch", label: "已确认", required: true }, { type: "rule", kind: "manual_confirm", field_id: "confirmed", label: "人工确认" }, 640);
  const versionId = id();
  const created = nowIso();
  const version: WorkflowVersion = { id: versionId, workflow_id: workflowId, version: 1, status: "published", change_note: "系统初始化", publish_note: "系统初始化", created_at: created, published_at: created, nodes: [first, second, third], edges: [{ id: id(), source_node_id: first.id, target_node_id: second.id }, { id: id(), source_node_id: second.id, target_node_id: third.id }], ticket_count: 0 };
  return { id: workflowId, name: text(name), description: text(description), group_name: text(groupName) || null, status: "published", created_at: created, updated_at: created, current_version_id: versionId, versions: [version] };
}

export class WorkflowTicketsService {
  constructor(private readonly store: JsonStore, private readonly moduleId: string, private readonly platformApiUrl?: string, private readonly platformToken?: string) {}

  async init(): Promise<void> {
    await this.store.init();
    const data = this.store.get();
    if (!data.workflows.length) {
      data.workflows.push(defaultWorkflow("通用任务流程", "用于记录准备、处理和确认的通用流程。", "通用"));
      await this.store.save();
    }
  }

  get data(): WorkflowStore {
    return this.store.get();
  }

  async overview(): Promise<Record<string, unknown>> {
    const tickets = sortedUpdated(this.data.tickets);
    const todo = tickets.filter((ticket) => ticket.node_instances.some((node) => ACTIVE_NODE_STATUSES.has(node.status))).slice(0, 5);
    const inProgress = tickets.filter((ticket) => ticket.status === "in_progress" || ticket.status === "blocked").slice(0, 5);
    const todayEnd = new Date(); todayEnd.setHours(23, 59, 59, 999);
    const today = tickets.filter((ticket) => ["draft", "in_progress", "blocked"].includes(ticket.status) && [ticket.due_at, ticket.reminder_at].some((value) => { const date = safeDate(value); return date && date <= todayEnd; })).slice(0, 5);
    const counts: Record<string, number> = {};
    for (const ticket of tickets) counts[ticket.status] = (counts[ticket.status] ?? 0) + 1;
    const projectCounts: Record<string, number> = {};
    for (const project of this.data.projects) projectCounts[project.status] = (projectCounts[project.status] ?? 0) + 1;
    const scheduleItemCount = this.data.schedule_items.filter((item) => item.status === "pending").length;
    return { todo: todo.map((ticket) => ticketRead(ticket, this.data.workflows, this.data.projects, this.data.milestones)), in_progress: inProgress.map((ticket) => ticketRead(ticket, this.data.workflows, this.data.projects, this.data.milestones)), today: today.map((ticket) => ticketRead(ticket, this.data.workflows, this.data.projects, this.data.milestones)), timeline: this.timeline(undefined, 8), counts, schedule_item_count: scheduleItemCount, project_counts: projectCounts };
  }

  timeline(ticketId?: string, limit = 30, projectId?: string, milestoneId?: string): TimelineEvent[] {
    let items = [...this.data.timeline];
    if (ticketId) items = items.filter((item) => item.ticket_id === ticketId);
    if (projectId) { this.getProject(projectId); const ticketIds = new Set(this.data.tickets.filter((item) => item.project_id === projectId).map((item) => item.id)); items = items.filter((item) => item.project_id === projectId || (item.ticket_id ? ticketIds.has(item.ticket_id) : false)); }
    if (milestoneId) { this.getMilestone(milestoneId); const ticketIds = new Set(this.data.tickets.filter((item) => item.milestone_id === milestoneId).map((item) => item.id)); items = items.filter((item) => item.milestone_id === milestoneId || (item.ticket_id ? ticketIds.has(item.ticket_id) : false)); }
    return items.slice(0, limit).map(clone);
  }

  timelineActivity(since?: string, until?: string, timeZone = "UTC", projectId?: string): TimelineActivity {
    const sinceDate = since ? safeDate(since) : null;
    const untilDate = until ? safeDate(until) : null;
    if ((since && !sinceDate) || (until && !untilDate)) fail(400, "时间线日期范围无效");
    if (sinceDate && untilDate && untilDate <= sinceDate) fail(400, "时间线日期范围无效");

    const days = new Map<string, { count: number; samples: string[]; tickets: TimelineActivityTicket[] }>();
    const ticketsById = new Map(this.data.tickets.map((ticket) => [ticket.id, ticket]));
    const projectTicketIds = projectId ? new Set(this.data.tickets.filter((ticket) => ticket.project_id === projectId).map((ticket) => ticket.id)) : undefined;
    if (projectId) this.getProject(projectId);
    let total = 0;
    for (const event of this.data.timeline) {
      if (projectTicketIds && event.project_id !== projectId && (!event.ticket_id || !projectTicketIds.has(event.ticket_id))) continue;
      const eventDate = safeDate(event.created_at);
      if (!eventDate || (sinceDate && eventDate < sinceDate) || (untilDate && eventDate >= untilDate)) continue;
      const date = activityDateKey(event.created_at, timeZone);
      if (!date) continue;
      const day = days.get(date) ?? { count: 0, samples: [], tickets: [] };
      day.count += 1;
      if (day.samples.length < 2 && !day.samples.includes(event.title)) day.samples.push(event.title);
      const ticket = event.ticket_id ? ticketsById.get(event.ticket_id) : undefined;
      if (ticket?.status === "in_progress" && !day.tickets.some((item) => item.id === ticket.id)) {
        day.tickets.push({ id: ticket.id, number: ticket.number, title: ticket.title });
      }
      days.set(date, day);
      total += 1;
    }
    const todayKey = activityDateKey(nowIso(), timeZone);
    const todayEndKey = shiftActivityDate(todayKey, 1);
    const activityStartKey = sinceDate ? activityDateKey(sinceDate.toISOString(), timeZone) : "";
    const requestedEndKey = untilDate ? activityDateKey(untilDate.toISOString(), timeZone) : todayEndKey;
    const activityEndKey = requestedEndKey && requestedEndKey < todayEndKey ? requestedEndKey : todayEndKey;
    for (const ticket of this.data.tickets) {
      if (projectTicketIds && !projectTicketIds.has(ticket.id)) continue;
      if (ticket.status !== "in_progress") continue;
      const createdKey = activityDateKey(ticket.created_at, timeZone);
      if (!createdKey) continue;
      const startKey = activityStartKey && activityStartKey > createdKey ? activityStartKey : createdKey;
      if (!activityEndKey || startKey >= activityEndKey) continue;
      const activityTicket = { id: ticket.id, number: ticket.number, title: ticket.title };
      for (let date = startKey; date < activityEndKey;) {
        const day = days.get(date) ?? { count: 0, samples: [], tickets: [] };
        if (!day.tickets.some((item) => item.id === ticket.id)) day.tickets.push(activityTicket);
        days.set(date, day);
        const nextDate = shiftActivityDate(date, 1);
        if (!nextDate || nextDate <= date) break;
        date = nextDate;
      }
    }
    return {
      total,
      days: [...days.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([date, value]) => ({
        date,
        count: value.count,
        samples: value.samples,
        ...(value.tickets.length ? { tickets: value.tickets } : {}),
      })),
    };
  }

  listWorkflows(keyword = ""): Workflow[] {
    const normalized = text(keyword).toLocaleLowerCase();
    return this.data.workflows.filter((workflow) => workflow.status !== "archived" && (!normalized || `${workflow.name} ${workflow.description}`.toLocaleLowerCase().includes(normalized))).map((workflow) => workflowRead(workflow, this.data.tickets));
  }

  getWorkflow(workflowId: string): Workflow {
    return workflowRead(this.findWorkflow(workflowId), this.data.tickets);
  }

  async createWorkflow(body: Record<string, unknown>): Promise<Workflow> {
    const name = text(body.name); if (!name) fail(422, "工作流名称不能为空");
    const created = nowIso(); const workflow = defaultWorkflow(name, text(body.description), text(body.group_name) || null);
    const initialVersion = workflow.versions[0]; if (initialVersion) { workflow.status = "draft"; initialVersion.status = "draft"; initialVersion.published_at = null; initialVersion.publish_note = ""; }
    workflow.updated_at = created; this.data.workflows.unshift(workflow); await this.store.save(); return this.getWorkflow(workflow.id);
  }

  async updateWorkflow(workflowId: string, body: Record<string, unknown>): Promise<Workflow> {
    const workflow = this.findWorkflow(workflowId); const version = this.editableVersion(workflow, text(body.version_id) || undefined);
    if (body.name !== undefined) { const name = text(body.name); if (!name) fail(422, "工作流名称不能为空"); workflow.name = name; }
    if (body.description !== undefined) workflow.description = text(body.description);
    if (body.group_name !== undefined) workflow.group_name = text(body.group_name) || null;
    if (Array.isArray(body.nodes)) version.nodes = body.nodes.map((node) => this.normalizeNode(node as Record<string, unknown>));
    if (Array.isArray(body.edges)) version.edges = body.edges.map((edge) => this.normalizeEdge(edge as Record<string, unknown>));
    this.validateGraph(version.nodes, version.edges);
    workflow.updated_at = nowIso(); await this.store.save(); return this.getWorkflow(workflow.id);
  }

  async archiveWorkflow(workflowId: string): Promise<Workflow> {
    const workflow = this.findWorkflow(workflowId); workflow.status = "archived"; workflow.updated_at = nowIso(); for (const version of workflow.versions) if (version.status === "draft") version.status = "archived"; await this.store.save(); return this.getWorkflow(workflow.id);
  }

  async createVersion(workflowId: string, body: Record<string, unknown>): Promise<WorkflowVersion> {
    const workflow = this.findWorkflow(workflowId); const source = workflow.versions.find((version) => version.id === text(body.source_version_id)) ?? this.publishedVersion(workflow) ?? workflow.versions.at(-1); if (!source) fail(409, "没有可复制的来源版本");
    const version: WorkflowVersion = { ...clone(source), id: id(), version: Math.max(...workflow.versions.map((item) => item.version), 0) + 1, status: "draft", change_note: text(body.change_note), publish_note: "", source_version_id: source.id, created_at: nowIso(), published_at: null, ticket_count: 0, nodes: clone(source.nodes), edges: clone(source.edges) };
    workflow.versions.push(version); workflow.current_version_id = version.id; workflow.status = "draft"; workflow.updated_at = nowIso(); await this.store.save(); return clone(version);
  }

  async publishWorkflow(workflowId: string, body: Record<string, unknown>): Promise<Workflow> {
    const workflow = this.findWorkflow(workflowId); const versionId = text(body.version_id) || workflow.current_version_id; const version = workflow.versions.find((item) => item.id === versionId); if (!version) fail(404, "版本不存在"); if (version.status !== "draft") fail(409, "只有草稿版本可以发布"); this.validateGraph(version.nodes, version.edges);
    for (const item of workflow.versions) if (item.status === "published") item.status = "archived";
    version.status = "published"; version.publish_note = text(body.publish_note); version.published_at = nowIso(); workflow.current_version_id = version.id; workflow.status = "published"; workflow.updated_at = nowIso(); await this.store.save(); return this.getWorkflow(workflowId);
  }

  compareVersions(workflowId: string, baseId: string, targetId: string): Record<string, unknown> {
    const workflow = this.findWorkflow(workflowId); const base = workflow.versions.find((item) => item.id === baseId); const target = workflow.versions.find((item) => item.id === targetId); if (!base || !target) fail(404, "版本不存在");
    const map = (nodes: WorkflowNode[]) => new Map(nodes.map((node) => [node.id, node])); const baseNodes = map(base.nodes); const targetNodes = map(target.nodes);
    return { base_version: base.version, target_version: target.version, added_nodes: target.nodes.filter((node) => !baseNodes.has(node.id)), removed_nodes: base.nodes.filter((node) => !targetNodes.has(node.id)), changed_nodes: target.nodes.filter((node) => { const old = baseNodes.get(node.id); if (!old) return false; const strip = (value: WorkflowNode) => { const { position: _position, ...rest } = clone(value); return rest; }; return JSON.stringify(strip(old)) !== JSON.stringify(strip(node)); }), added_edges: target.edges.filter((edge) => !base.edges.some((old) => JSON.stringify(old) === JSON.stringify(edge))), removed_edges: base.edges.filter((edge) => !target.edges.some((old) => JSON.stringify(old) === JSON.stringify(edge))) };
  }

  dryRun(workflowId: string, body: Record<string, unknown>): Record<string, unknown> {
    const workflow = this.findWorkflow(workflowId); const version = this.publishedVersion(workflow) ?? workflow.versions.find((item) => item.id === workflow.current_version_id) ?? workflow.versions.at(-1); if (!version) fail(409, "工作流没有版本");
    return { workflow_id: workflow.id, version: version.version, nodes: version.nodes.map((node) => ({ node_id: node.id, name: node.name, status: node.predecessor_rule ? "waiting" : "ready", completion_rule: node.completion_rule })), initial_values: asObject(body.initial_values), actions_executed: false, explanation: "预演不会写入工单、动态或动作执行记录。" };
  }

  listTickets(query: Record<string, unknown> = {}): Page<Ticket> {
    const keyword = text(query.keyword).toLocaleLowerCase(); const status = text(query.status); const projectId = text(query.project_id); const milestoneId = text(query.milestone_id); const priority = text(query.priority); const tag = text(query.tag).toLocaleLowerCase(); const view = text(query.view);
    let items = this.data.tickets.filter((ticket) => (!keyword || `${ticket.number} ${ticket.title} ${ticket.note}`.toLocaleLowerCase().includes(keyword)) && (!status || ticket.status === status) && (!projectId || ticket.project_id === projectId) && (!milestoneId || ticket.milestone_id === milestoneId) && (!priority || ticket.priority === priority) && (!tag || ticket.tags.some((item) => item.toLocaleLowerCase().includes(tag))));
    if (view === "mine") items = items.filter((ticket) => ticket.owner_id === text(query.owner_id) || (!ticket.owner_id && ticket.owner_name === text(query.owner_name)));
    if (view === "today") { const now = new Date(); items = items.filter((ticket) => { const due = safeDate(ticket.due_at); return due && due.toDateString() === now.toDateString(); }); }
    const page = Math.max(1, Number(query.page) || 1); const pageSize = Math.min(100, Math.max(1, Number(query.page_size) || 100)); const sorted = sortedUpdated(items); return { items: sorted.slice((page - 1) * pageSize, page * pageSize).map((ticket) => ticketRead(ticket, this.data.workflows, this.data.projects, this.data.milestones)), total: sorted.length, page, page_size: pageSize };
  }

  getTicket(ticketId: string): Ticket {
    const ticket = clone(this.findTicket(ticketId)); for (const node of ticket.node_instances) for (const [fieldId, resource] of Object.entries(node.resources)) { const current = this.data.temporary_resources.find((item) => item.token === (text(resource.url).split("/").filter(Boolean).at(-1) ?? "")); if (current) node.resources[fieldId] = this.resourceRead(current); }
    const result = ticketRead(ticket, this.data.workflows, this.data.projects, this.data.milestones);
    result.attachments = this.data.attachments.filter((item) => item.ticket_id === ticket.id).map((item) => this.attachmentRead(item));
    return result;
  }

  async createTicket(body: Record<string, unknown>, actor = "当前用户"): Promise<Ticket> {
    const workflow = this.findWorkflow(text(body.workflow_id)); const version = this.publishedVersion(workflow); if (!version) fail(409, "只能基于已发布版本创建工单");
    return this.createTicketFromVersion(workflow, version, { title: text(body.title), note: text(body.note), created_by: actor, owner_id: text(body.owner_id) || null, owner_name: text(body.owner_name) || actor, due_at: text(body.due_at) || null, reminder_at: text(body.reminder_at) || null, project_id: text(body.project_id) || null, milestone_id: text(body.milestone_id) || null, priority: text(body.priority) || "none", weight: Math.max(1, Math.min(100, Number(body.weight) || 1)), tags: normalizeTags(body.tags), initial_values: asObject(body.initial_values), parent_ticket_id: text(body.parent_ticket_id) || null, related_ticket_ids: normalizeIds(body.related_ticket_ids), blocked_by_ticket_ids: normalizeIds(body.blocked_by_ticket_ids) }, true);
  }

  async updateTicket(ticketId: string, body: Record<string, unknown>): Promise<Ticket> {
    const ticket = this.findTicket(ticketId); const previousProjectId = ticket.project_id; if (TERMINAL_TICKET_STATUSES.has(ticket.status) && body.status === undefined) fail(409, "当前工单不能修改");
    if (body.title !== undefined) { const value = text(body.title); if (!value) fail(422, "工单标题不能为空"); ticket.title = value; }
    if (body.note !== undefined) ticket.note = text(body.note); if (body.priority !== undefined) ticket.priority = text(body.priority) as Ticket["priority"]; if (body.tags !== undefined) ticket.tags = normalizeTags(body.tags); if (body.owner_id !== undefined) ticket.owner_id = text(body.owner_id) || null; if (body.owner_name !== undefined) ticket.owner_name = text(body.owner_name) || null; if (body.due_at !== undefined) ticket.due_at = text(body.due_at) || null; if (body.reminder_at !== undefined) ticket.reminder_at = text(body.reminder_at) || null; if (body.weight !== undefined) ticket.weight = Math.max(1, Math.min(100, Number(body.weight) || 1));
    this.resolveScope(text(body.project_id) || ticket.project_id, text(body.milestone_id) || ticket.milestone_id); if (body.project_id !== undefined) ticket.project_id = text(body.project_id) || null; if (body.milestone_id !== undefined) ticket.milestone_id = text(body.milestone_id) || null; if (ticket.project_id !== previousProjectId) for (const resource of this.data.resources) resource.ticket_ids = resource.ticket_ids.filter((id) => id !== ticket.id);
    if (body.parent_ticket_id !== undefined) ticket.parent_ticket_id = text(body.parent_ticket_id) || null; if (body.related_ticket_ids !== undefined) ticket.related_ticket_ids = normalizeIds(body.related_ticket_ids); if (body.blocked_by_ticket_ids !== undefined) ticket.blocked_by_ticket_ids = normalizeIds(body.blocked_by_ticket_ids);
    ticket.related_ticket_ids = [...new Set(ticket.related_ticket_ids ?? [])]; ticket.blocked_by_ticket_ids = [...new Set(ticket.blocked_by_ticket_ids ?? [])]; const knownTicketIds = new Set(this.data.tickets.map((item) => item.id)); const relationIds = [...ticket.related_ticket_ids, ...ticket.blocked_by_ticket_ids]; if (relationIds.includes(ticket.id) || ticket.parent_ticket_id === ticket.id) fail(422, "工单不能关联自身"); if (relationIds.some((item) => !knownTicketIds.has(item)) || (ticket.parent_ticket_id && !knownTicketIds.has(ticket.parent_ticket_id))) fail(422, "关联工单不存在"); if (ticket.due_at && ticket.reminder_at && new Date(ticket.reminder_at).getTime() > new Date(ticket.due_at).getTime()) fail(422, "提醒时间不能晚于目标时间");
    ticket.updated_at = nowIso(); this.event("ticket_updated", "工单信息已更新", undefined, ticket.id, ticket.project_id, ticket.milestone_id); await this.store.save(); return this.getTicket(ticket.id);
  }

  async duplicateTicket(ticketId: string, body: Record<string, unknown> = {}, actor = "当前用户"): Promise<Ticket> { const original = this.findTicket(ticketId); const workflow = this.findWorkflow(original.workflow_id); const version = workflow.versions.find((item) => item.id === original.workflow_version_id); if (!version) fail(409, "工单绑定版本不存在"); const copyProject = body.copy_project === undefined ? true : Boolean(body.copy_project); const copyRelations = Boolean(body.copy_relations); const copyValues = body.copy_values === undefined ? true : Boolean(body.copy_values); return this.createTicketFromVersion(workflow, version, { title: text(body.title) || `${original.title}（副本）`, note: body.note === undefined ? original.note : text(body.note), created_by: actor, owner_id: body.owner_id === undefined ? original.owner_id : text(body.owner_id) || null, owner_name: body.owner_name === undefined ? original.owner_name : text(body.owner_name) || actor, due_at: body.due_at === undefined ? original.due_at : text(body.due_at) || null, reminder_at: body.reminder_at === undefined ? original.reminder_at : text(body.reminder_at) || null, project_id: copyProject ? (body.project_id === undefined ? original.project_id : text(body.project_id) || null) : null, milestone_id: copyProject ? (body.milestone_id === undefined ? original.milestone_id : text(body.milestone_id) || null) : null, priority: body.priority === undefined ? original.priority : text(body.priority), tags: body.tags === undefined ? original.tags : normalizeTags(body.tags), weight: body.weight === undefined ? original.weight : Math.max(1, Math.min(100, Number(body.weight) || 1)), initial_values: copyValues ? (original.node_instances[0]?.values ?? {}) : {}, parent_ticket_id: copyRelations ? (original.parent_ticket_id ?? null) : null, related_ticket_ids: copyRelations ? (original.related_ticket_ids ?? []) : [], blocked_by_ticket_ids: copyRelations ? (original.blocked_by_ticket_ids ?? []) : [] }, true); }

  async deleteTicket(ticketId: string): Promise<void> { const ticket = this.findTicket(ticketId); for (const attachment of this.data.attachments.filter((item) => item.ticket_id === ticket.id)) { try { await unlink(attachment.storage_path); } catch { /* already removed */ } } this.data.tickets = this.data.tickets.filter((item) => item.id !== ticket.id); this.data.timeline = this.data.timeline.filter((item) => item.ticket_id !== ticket.id); this.data.attachments = this.data.attachments.filter((item) => item.ticket_id !== ticket.id); this.data.temporary_resources = this.data.temporary_resources.filter((item) => item.ticket_id !== ticket.id); this.data.action_executions = this.data.action_executions.filter((item) => item.ticket_id !== ticket.id); for (const resource of this.data.resources) resource.ticket_ids = resource.ticket_ids.filter((id) => id !== ticket.id); for (const run of this.data.schedule_runs) if (run.ticket_id === ticket.id) run.ticket_id = null; await this.store.save(); }

  async bulkUpdate(body: Record<string, unknown>): Promise<Ticket[]> { const ids = new Set(asArray(body.ticket_ids).map(text)); const projectId = body.project_id === undefined ? undefined : text(body.project_id) || null; const milestoneId = body.milestone_id === undefined ? undefined : text(body.milestone_id) || null; if (projectId !== undefined || milestoneId !== undefined) this.resolveScope(projectId, milestoneId); const selected = this.data.tickets.filter((item) => ids.has(item.id)); const previousProjects = new Map(selected.map((ticket) => [ticket.id, ticket.project_id])); for (const ticket of selected) { if (projectId !== undefined) ticket.project_id = projectId; if (milestoneId !== undefined) ticket.milestone_id = milestoneId; if (body.priority !== undefined) ticket.priority = text(body.priority) as Ticket["priority"]; ticket.tags = [...new Set([...ticket.tags, ...normalizeTags(body.add_tags)])]; ticket.updated_at = nowIso(); if (ticket.project_id !== previousProjects.get(ticket.id)) for (const resource of this.data.resources) resource.ticket_ids = resource.ticket_ids.filter((id) => id !== ticket.id); } await this.store.save(); return this.data.tickets.filter((item) => ids.has(item.id)).map((ticket) => this.getTicket(ticket.id)); }

  async saveNode(ticketId: string, nodeId: string, values: Record<string, unknown>): Promise<Ticket> { const ticket = this.executableTicket(ticketId); const node = this.ticketNode(ticket, nodeId); if (node.status === "pending") fail(409, "节点尚未满足前序条件"); const definition = this.nodeDefinition(ticket, node); const errors = this.validateValues(definition.form_schema.fields.map((field) => ({ ...field, required: false })), values); if (Object.keys(errors).length) fail(422, Object.values(errors).join("；")); node.values = clone(values); this.prepareRuntimeResources(ticket, node, definition); if (["ready", "blocked", "waiting"].includes(node.status)) { node.status = "in_progress"; node.started_at = node.started_at ?? nowIso(); } ticket.status = "in_progress"; ticket.updated_at = nowIso(); this.event("field_submitted", `节点「${node.name}」已保存表单`, node.node_id, ticket.id, ticket.project_id, ticket.milestone_id); await this.store.save(); return this.getTicket(ticket.id); }

  async completeNode(ticketId: string, nodeId: string): Promise<Ticket> { const ticket = this.executableTicket(ticketId); const node = this.ticketNode(ticket, nodeId); const definition = this.nodeDefinition(ticket, node); const errors = this.validateValues(definition.form_schema.fields, node.values); if (Object.keys(errors).length) fail(422, Object.values(errors).join("；")); if (!this.evaluateRule(definition.completion_rule, ticket, node)) fail(422, "完成条件尚未满足"); node.status = "completed"; node.completed_at = nowIso(); node.outputs = [{ key: "result", value: clone(node.values) }]; this.event("node_completed", `节点「${node.name}」已完成`, node.node_id, ticket.id, ticket.project_id, ticket.milestone_id); await this.notify("node_completed", `节点「${node.name}」已完成`, ticket, node.node_id); const activated = this.activateEdges(ticket); if (ticket.node_instances.every((item) => ["completed", "skipped", "cancelled"].includes(item.status))) { ticket.status = "completed"; this.event("ticket_completed", "工单已完成", undefined, ticket.id, ticket.project_id, ticket.milestone_id); await this.notify("ticket_completed", "工单已完成", ticket); } else { ticket.status = "in_progress"; for (const ready of activated) await this.notify("node_ready", `节点「${ready.name}」已进入待处理`, ticket, ready.node_id); } ticket.updated_at = nowIso(); await this.store.save(); return this.getTicket(ticket.id); }

  async blockNode(ticketId: string, nodeId: string, reason: string): Promise<Ticket> { const ticket = this.executableTicket(ticketId); const node = this.ticketNode(ticket, nodeId); if (!text(reason)) fail(422, "请填写阻塞原因"); node.status = "blocked"; node.blocked_reason = text(reason); ticket.status = "blocked"; ticket.updated_at = nowIso(); this.event("node_blocked", `节点「${node.name}」已阻塞`, node.node_id, ticket.id, ticket.project_id, ticket.milestone_id, reason); await this.notify("ticket_blocked", `工单「${ticket.title}」已阻塞`, ticket, node.node_id); await this.store.save(); return this.getTicket(ticket.id); }

  async reopenTicket(ticketId: string): Promise<Ticket> { const ticket = this.findTicket(ticketId); if (ticket.status === "cancelled") { for (const node of ticket.node_instances) if (node.status === "cancelled") { node.status = "pending"; node.started_at = null; node.completed_at = null; node.blocked_reason = ""; } ticket.status = "in_progress"; this.activateEdges(ticket, true); this.event("ticket_restarted", "工单已重新启动", undefined, ticket.id, ticket.project_id, ticket.milestone_id); } else { ticket.status = "in_progress"; for (const node of ticket.node_instances) if (node.status === "blocked") { node.status = "ready"; node.blocked_reason = ""; } this.event("ticket_reopened", "工单已重新打开", undefined, ticket.id, ticket.project_id, ticket.milestone_id); } ticket.updated_at = nowIso(); await this.notify("ticket_reopened", "工单已重新打开", ticket); await this.store.save(); return this.getTicket(ticket.id); }

  async cancelTicket(ticketId: string, reason = ""): Promise<Ticket> { const ticket = this.findTicket(ticketId); if (TERMINAL_TICKET_STATUSES.has(ticket.status)) fail(409, "当前工单无法终止"); for (const node of ticket.node_instances) if (!['completed', 'skipped'].includes(node.status)) { node.status = "cancelled"; node.blocked_reason = text(reason); } for (const resource of this.data.temporary_resources) if (resource.ticket_id === ticket.id) resource.revoked = true; ticket.status = "cancelled"; ticket.updated_at = nowIso(); this.event("ticket_cancelled", "工单已终止", undefined, ticket.id, ticket.project_id, ticket.milestone_id, reason); await this.store.save(); await this.notify("ticket_cancelled", `工单「${ticket.title}」已终止`, ticket); return this.getTicket(ticket.id); }

  async rollbackNode(ticketId: string, currentNodeId: string, targetNodeId: string, reason: string): Promise<Ticket> { const ticket = this.executableTicket(ticketId); const workflow = this.findWorkflow(ticket.workflow_id); const version = workflow.versions.find((item) => item.id === ticket.workflow_version_id); if (!version) fail(409, "工单绑定版本不存在"); const direct = version.edges.filter((edge) => edge.target_node_id === currentNodeId && ticket.node_instances.find((item) => item.node_id === edge.source_node_id)?.status === "completed").map((edge) => edge.source_node_id); if (!targetNodeId) { if (direct.length !== 1) fail(422, "多个前序节点已完成，请指定回退节点"); targetNodeId = direct[0] ?? ""; } if (!direct.includes(targetNodeId)) fail(422, "只能回退到当前节点的直接完成前序节点"); const reachable = new Set<string>(); const pending = [currentNodeId]; while (pending.length) { const next = pending.pop()!; if (reachable.has(next)) continue; reachable.add(next); for (const edge of version.edges.filter((item) => item.source_node_id === next)) pending.push(edge.target_node_id); } for (const node of ticket.node_instances) if (reachable.has(node.node_id) || node.node_id === targetNodeId) { if (node.node_id !== targetNodeId) { node.status = "pending"; node.values = {}; node.outputs = []; node.completed_at = null; } else { node.status = "ready"; node.completed_at = null; } node.blocked_reason = ""; } ticket.status = "in_progress"; ticket.updated_at = nowIso(); this.event("node_rolled_back", `工单已回退到节点「${ticket.node_instances.find((item) => item.node_id === targetNodeId)?.name ?? targetNodeId}」`, targetNodeId, ticket.id, ticket.project_id, ticket.milestone_id, reason); await this.store.save(); return this.getTicket(ticket.id); }

  async uploadAttachment(ticketId: string, nodeId: string, body: Record<string, unknown>): Promise<Record<string, unknown>> { const ticket = this.executableTicket(ticketId); const node = this.ticketNode(ticket, nodeId); const definition = this.nodeDefinition(ticket, node); const field = definition.form_schema.fields.find((item) => item.id === text(body.field_id)); if (!field || !["file", "image"].includes(field.type)) fail(422, "附件字段不存在"); const content = Buffer.from(text(body.content_base64), "base64"); const max = Number(asObject(field.config).max_size_mb) || this.settings().max_file_size_mb; if (content.length > max * 1024 * 1024) fail(413, `附件不能超过 ${max} MB`); const attachmentDir = path.join(this.store.dataDir, "attachments"); await mkdir(attachmentDir, { recursive: true }); const attachmentId = id(); const filename = path.basename(text(body.filename)) || "attachment"; const filePath = path.join(attachmentDir, `${attachmentId}${path.extname(filename).slice(0, 20)}`); await writeFile(filePath, content); const attachment: Attachment = { id: attachmentId, ticket_id: ticket.id, ticket_node_id: node.id, field_id: field.id, filename, stored_name: path.basename(filePath), mime_type: text(body.mime_type) || "application/octet-stream", extension: path.extname(filename), size: content.length, storage_path: filePath, created_at: nowIso() }; this.data.attachments.push(attachment); await this.store.save(); return this.attachmentRead(attachment); }

  async deleteAttachment(attachmentId: string): Promise<void> { const attachment = this.data.attachments.find((item) => item.id === attachmentId); if (!attachment) fail(404, "附件不存在"); try { await unlink(attachment.storage_path); } catch { /* already removed */ } this.data.attachments = this.data.attachments.filter((item) => item.id !== attachmentId); await this.store.save(); }

  getAttachment(attachmentId: string): { attachment: Attachment; path: string } { const attachment = this.data.attachments.find((item) => item.id === attachmentId); if (!attachment) fail(404, "附件不存在"); return { attachment, path: attachment.storage_path }; }

  diagnostics(ticketId: string): Record<string, unknown> { const ticket = this.findTicket(ticketId); const workflow = this.findWorkflow(ticket.workflow_id); const version = workflow.versions.find((item) => item.id === ticket.workflow_version_id); if (!version) fail(409, "工单绑定版本不存在"); const nodeById = new Map(ticket.node_instances.map((item) => [item.node_id, item])); const active = new Set(ticket.node_instances.filter((item) => item.status !== "pending").map((item) => item.node_id)); return { version: version.version, nodes: ticket.node_instances.map((node) => ({ id: node.node_id, name: node.name, status: node.status, assignee: node.assignee_name, blocked_reason: node.blocked_reason, values: this.mask(node.values), outputs: this.mask(node.outputs) })), edges: version.edges.map((edge) => ({ id: edge.id, source: nodeById.get(edge.source_node_id)?.name ?? edge.source_node_id, target: nodeById.get(edge.target_node_id)?.name ?? edge.target_node_id, condition: this.mask(edge.condition), selected: active.has(edge.source_node_id) && active.has(edge.target_node_id), explanation: active.has(edge.target_node_id) ? "目标节点已进入流程" : "目标节点尚未激活，可能未满足条件或仍在等待前序节点" })), actions: this.data.action_executions.filter((item) => item.ticket_id === ticket.id).map((item) => ({ ...item, input: this.mask(item.input), output: this.mask(item.output) })) }; }

  listScheduleItems(includeArchived = false): ScheduleItem[] { return sortedUpdated(this.data.schedule_items.filter((item) => includeArchived || ["pending", "completed"].includes(item.status))); }
  async createScheduleItem(body: Record<string, unknown>, actor = "当前用户"): Promise<ScheduleItem> { const created = nowIso(); const item: ScheduleItem = { id: id(), title: text(body.title), note: text(body.note), status: "pending", owner_id: text(body.owner_id) || null, owner_name: text(body.owner_name) || actor, due_at: text(body.due_at) || null, reminder_at: text(body.reminder_at) || null, ticket_id: null, created_at: created, updated_at: created }; if (!item.title) fail(422, "事项标题不能为空"); this.data.schedule_items.unshift(item); await this.store.save(); return clone(item); }
  async updateScheduleItem(itemId: string, body: Record<string, unknown>): Promise<ScheduleItem> { const item = this.findScheduleItem(itemId); if (body.completed !== undefined) item.status = Boolean(body.completed) ? "completed" : "pending"; if (body.title !== undefined) item.title = text(body.title); item.updated_at = nowIso(); await this.store.save(); return clone(item); }
  async archiveScheduleItem(itemId: string): Promise<ScheduleItem> { const item = this.findScheduleItem(itemId); if (item.status === "converted") fail(409, "已转换事项不能归档"); item.status = "archived"; item.updated_at = nowIso(); await this.store.save(); return clone(item); }
  async convertScheduleItem(itemId: string, body: Record<string, unknown>, actor = "当前用户"): Promise<Ticket> { const item = this.findScheduleItem(itemId); if (item.status !== "pending") fail(409, "当前日程事项无法转换"); const workflow = this.findWorkflow(text(body.workflow_id)); const version = this.publishedVersion(workflow); if (!version) fail(409, "只能基于已发布版本创建工单"); const ticket = await this.createTicketFromVersion(workflow, version, { title: item.title, note: item.note, created_by: actor, owner_id: item.owner_id, owner_name: item.owner_name, due_at: item.due_at, reminder_at: item.reminder_at, project_id: text(body.project_id) || null, milestone_id: text(body.milestone_id) || null, priority: text(body.priority) || "none", tags: [] }, true); item.status = "converted"; item.ticket_id = ticket.id; item.updated_at = nowIso(); await this.store.save(); return ticket; }

  listProjects(): Project[] { return sortedUpdated(this.data.projects.filter((item) => item.status !== "archived")).map((project) => this.getProject(project.id)); }
  getProject(projectId: string): Project & { ticket_count: number; completed_ticket_count: number; milestone_count: number; progress: number; health: string; current_milestone_id: string | null; current_milestone_name: string | null; current_milestone_goal: string | null; current_milestone_target_at: string | null } {
    const project = this.findProject(projectId);
    const tickets = this.data.tickets.filter((item) => item.project_id === project.id);
    const milestones = this.data.milestones.filter((item) => item.project_id === project.id);
    const completedTicketCount = tickets.filter((item) => item.status === "completed").length;
    const progress = tickets.length ? Math.round(completedTicketCount / tickets.length * 100) : 0;
    const current = [...milestones].filter((item) => !["completed", "cancelled"].includes(item.status)).sort((a, b) => {
      const activeRank = (value: string) => value === "in_progress" ? 0 : 1;
      return activeRank(a.status) - activeRank(b.status) || (a.target_at ?? "9999").localeCompare(b.target_at ?? "9999") || b.updated_at.localeCompare(a.updated_at);
    })[0];
    const overdue = milestones.some((item) => item.target_at && new Date(item.target_at) < new Date() && !["completed", "cancelled"].includes(item.status));
    const blocked = tickets.some((item) => item.status === "blocked");
    return {
      ...clone(project),
      goal: project.goal ?? project.description,
      planned_start_at: project.planned_start_at ?? project.start_at ?? null,
      review_markdown: project.review_markdown ?? project.note,
      default_workflow_id: project.default_workflow_id ?? null,
      color: project.color ?? "primary",
      icon: project.icon ?? "flag",
      favorite: project.favorite ?? false,
      ticket_count: tickets.length,
      completed_ticket_count: completedTicketCount,
      milestone_count: milestones.length,
      progress,
      health: overdue ? "overdue" : blocked ? "risk" : "normal",
      current_milestone_id: current?.id ?? null,
      current_milestone_name: current?.name ?? null,
      current_milestone_goal: current?.goal ?? current?.description ?? null,
      current_milestone_target_at: current?.target_at ?? null,
    };
  }
  async createProject(body: Record<string, unknown>, actor = "当前用户"): Promise<Project> {
    const name = text(body.name); if (!name) fail(422, "项目名称不能为空");
    const now = new Date(); const prefix = `PRJ-${now.toISOString().slice(0, 10).replaceAll("-", "")}`;
    const key = `${prefix}-${String(this.data.projects.filter((item) => item.key.startsWith(prefix)).length + 1).padStart(3, "0")}`;
    const goal = text(body.goal || body.description); const startAt = text(body.start_at || body.planned_start_at) || null;
    const project: Project = { id: id(), key, name, description: goal, goal, status: (text(body.status) || "planning") as Project["status"], owner_name: text(body.owner_name) || actor, start_at: startAt, planned_start_at: startAt, target_at: text(body.target_at) || null, tags: normalizeTags(body.tags), note: text(body.note), review_markdown: text(body.review_markdown || body.note), default_workflow_id: text(body.default_workflow_id) || null, color: text(body.color) || "primary", icon: text(body.icon) || "flag", favorite: Boolean(body.favorite), created_at: nowIso(), updated_at: nowIso() };
    this.data.projects.unshift(project); await this.store.save(); return this.getProject(project.id);
  }
  async updateProject(projectId: string, body: Record<string, unknown>): Promise<Project> {
    const project = this.findProject(projectId);
    if (body.name !== undefined) project.name = text(body.name);
    if (body.description !== undefined || body.goal !== undefined) { const goal = text(body.goal === undefined ? body.description : body.goal); project.description = goal; project.goal = goal; }
    if (body.owner_name !== undefined) project.owner_name = text(body.owner_name);
    if (body.note !== undefined) project.note = text(body.note);
    if (body.review_markdown !== undefined) project.review_markdown = text(body.review_markdown);
    if (body.status !== undefined) project.status = text(body.status) as Project["status"];
    if (body.tags !== undefined) project.tags = normalizeTags(body.tags);
    if (body.start_at !== undefined || body.planned_start_at !== undefined) { const startAt = text(body.start_at === undefined ? body.planned_start_at : body.start_at) || null; project.start_at = startAt; project.planned_start_at = startAt; }
    if (body.target_at !== undefined) project.target_at = text(body.target_at) || null;
    if (body.default_workflow_id !== undefined) project.default_workflow_id = text(body.default_workflow_id) || null;
    if (body.color !== undefined) project.color = text(body.color) || "primary";
    if (body.icon !== undefined) project.icon = text(body.icon) || "flag";
    if (body.favorite !== undefined) project.favorite = Boolean(body.favorite);
    project.updated_at = nowIso(); await this.store.save(); return this.getProject(project.id);
  }
  async archiveProject(projectId: string): Promise<Project> { const project = this.findProject(projectId); project.status = "archived"; project.updated_at = nowIso(); await this.store.save(); return this.getProject(project.id); }
  projectAnalytics(projectId: string): Record<string, unknown> {
    const project = this.getProject(projectId); const tickets = this.data.tickets.filter((item) => item.project_id === projectId);
    const days = Array.from({ length: 14 }, (_, index) => { const date = new Date(); date.setHours(0, 0, 0, 0); date.setDate(date.getDate() - (13 - index)); const key = date.toISOString().slice(0, 10); const dayTickets = tickets.filter((ticket) => ticket.created_at.slice(0, 10) === key); return { date: key, created: dayTickets.length, completed: dayTickets.filter((ticket) => ticket.status === "completed").length }; });
    const durations = tickets.filter((item) => item.status === "completed").map((item) => Math.max(0, (Date.parse(item.updated_at) - Date.parse(item.created_at)) / 3_600_000)).sort((a, b) => a - b);
    const percentile = (ratio: number) => durations.length ? durations[Math.min(durations.length - 1, Math.floor((durations.length - 1) * ratio))] ?? 0 : 0;
    return { project, status_counts: Object.fromEntries([...new Set(tickets.map((item) => item.status))].map((status) => [status, tickets.filter((item) => item.status === status).length])), priority_counts: Object.fromEntries([...new Set(tickets.map((item) => item.priority))].map((priority) => [priority, tickets.filter((item) => item.priority === priority).length])), trend: days, velocity: tickets.filter((item) => item.status === "completed").length, daily_velocity: days.reduce((sum, item) => sum + item.completed, 0) / 14, blocked_count: tickets.filter((item) => item.status === "blocked").length, overdue_count: tickets.filter((item) => item.due_at && new Date(item.due_at) < new Date() && !["completed", "cancelled", "archived"].includes(item.status)).length, duration_hours: { average: durations.length ? durations.reduce((sum, value) => sum + value, 0) / durations.length : 0, median: percentile(0.5), p75: percentile(0.75) }, node_durations: [], path_distribution: [] };
  }

  listMilestones(projectId: string): Milestone[] { this.findProject(projectId); return sortedUpdated(this.data.milestones.filter((item) => item.project_id === projectId)).map((item) => this.getMilestone(item.id, projectId)); }
  getMilestone(milestoneId: string, projectId?: string): Milestone {
    const milestone = this.data.milestones.find((item) => item.id === milestoneId); if (!milestone) fail(404, "里程碑不存在"); if (projectId && milestone.project_id !== projectId) fail(404, "里程碑不属于当前项目");
    const tickets = this.data.tickets.filter((item) => item.milestone_id === milestone.id); const completed = tickets.filter((item) => item.status === "completed").length;
    const progress = milestone.progress_mode === "manual" ? milestone.progress : tickets.length ? Math.round(completed / tickets.length * 100) : milestone.progress;
    return { ...clone(milestone), goal: milestone.goal ?? milestone.description, review_markdown: milestone.review_markdown ?? milestone.review, completion_criteria: milestone.completion_criteria ?? "", risk_note: milestone.risk_note ?? "", owner_name: milestone.owner_name ?? null, manual_progress: milestone.manual_progress ?? milestone.progress, ticket_count: tickets.length, completed_ticket_count: completed, progress };
  }
  async createMilestone(projectId: string, body: Record<string, unknown>): Promise<Milestone> {
    this.findProject(projectId); const name = text(body.name); if (!name) fail(422, "里程碑名称不能为空");
    const goal = text(body.goal || body.description); const rawMode = text(body.progress_mode) || "ticket_count"; const progressMode: Milestone["progress_mode"] = rawMode === "manual" ? "manual" : "ticket";
    const rawStatus = text(body.status); const status = rawStatus === "planned" ? "pending" : rawStatus === "active" ? "in_progress" : (rawStatus || "pending");
    const manualProgress = Math.max(0, Math.min(100, Number(body.manual_progress ?? body.progress) || 0));
    const milestone: Milestone = { id: id(), project_id: projectId, name, description: goal, goal, status: status as Milestone["status"], owner_name: text(body.owner_name) || null, target_at: text(body.target_at) || null, progress_mode: progressMode, progress: progressMode === "manual" ? manualProgress : 0, manual_progress: manualProgress, completion_criteria: text(body.completion_criteria), risk_note: text(body.risk_note), review: text(body.review_markdown || body.review), review_markdown: text(body.review_markdown || body.review), notification_sent_at: null, created_at: nowIso(), updated_at: nowIso() };
    this.data.milestones.unshift(milestone); await this.store.save(); return this.getMilestone(milestone.id, projectId);
  }
  async updateMilestone(milestoneId: string, body: Record<string, unknown>, projectId?: string): Promise<Milestone> {
    const milestone = this.getMilestone(milestoneId, projectId);
    if (body.name !== undefined) milestone.name = text(body.name);
    if (body.description !== undefined || body.goal !== undefined) { const goal = text(body.goal === undefined ? body.description : body.goal); milestone.description = goal; milestone.goal = goal; }
    if (body.owner_name !== undefined) milestone.owner_name = text(body.owner_name) || null;
    if (body.completion_criteria !== undefined) milestone.completion_criteria = text(body.completion_criteria);
    if (body.risk_note !== undefined) milestone.risk_note = text(body.risk_note);
    if (body.review !== undefined || body.review_markdown !== undefined) { const review = text(body.review_markdown === undefined ? body.review : body.review_markdown); milestone.review = review; milestone.review_markdown = review; }
    if (body.status !== undefined) { const rawStatus = text(body.status); milestone.status = (rawStatus === "planned" ? "pending" : rawStatus === "active" ? "in_progress" : rawStatus) as Milestone["status"]; }
    if (body.target_at !== undefined) milestone.target_at = text(body.target_at) || null;
    if (body.progress_mode !== undefined) milestone.progress_mode = text(body.progress_mode) === "manual" ? "manual" : "ticket";
    if (body.manual_progress !== undefined || body.progress !== undefined) { const progress = Math.max(0, Math.min(100, Number(body.manual_progress ?? body.progress) || 0)); milestone.manual_progress = progress; if (milestone.progress_mode === "manual") milestone.progress = progress; }
    milestone.updated_at = nowIso(); const index = this.data.milestones.findIndex((item) => item.id === milestoneId); this.data.milestones[index] = milestone; await this.store.save(); return this.getMilestone(milestone.id, projectId);
  }
  async deleteMilestone(milestoneId: string, projectId?: string): Promise<void> { this.getMilestone(milestoneId, projectId); this.data.milestones = this.data.milestones.filter((item) => item.id !== milestoneId); for (const ticket of this.data.tickets) if (ticket.milestone_id === milestoneId) ticket.milestone_id = null; for (const resource of this.data.resources) resource.milestone_ids = resource.milestone_ids.filter((id) => id !== milestoneId); await this.store.save(); }

  listSavedViews(): SavedView[] { return sortedUpdated(this.data.saved_views); }
  async createSavedView(body: Record<string, unknown>): Promise<SavedView> { const item: SavedView = { id: id(), name: text(body.name), filters: asObject(body.filters), favorite: Boolean(body.favorite), is_default: Boolean(body.is_default), created_at: nowIso(), updated_at: nowIso() }; if (!item.name) fail(422, "视图名称不能为空"); if (item.is_default) for (const view of this.data.saved_views) view.is_default = false; this.data.saved_views.unshift(item); await this.store.save(); return clone(item); }
  async updateSavedView(viewId: string, body: Record<string, unknown>): Promise<SavedView> { const view = this.data.saved_views.find((item) => item.id === viewId); if (!view) fail(404, "保存的视图不存在"); if (body.name !== undefined) view.name = text(body.name); if (body.filters !== undefined) view.filters = asObject(body.filters); if (body.favorite !== undefined) view.favorite = Boolean(body.favorite); if (body.is_default !== undefined) { view.is_default = Boolean(body.is_default); if (view.is_default) for (const item of this.data.saved_views) if (item.id !== view.id) item.is_default = false; } view.updated_at = nowIso(); await this.store.save(); return clone(view); }
  async deleteSavedView(viewId: string): Promise<void> { if (!this.data.saved_views.some((item) => item.id === viewId)) fail(404, "保存的视图不存在"); this.data.saved_views = this.data.saved_views.filter((item) => item.id !== viewId); await this.store.save(); }

  private normalizeAutomation(input: { name: unknown; enabled: unknown; trigger: unknown; conditions: unknown; actions: unknown }): Pick<AutomationRule, "name" | "enabled" | "trigger" | "conditions" | "actions"> {
    const name = text(input.name);
    if (!name) fail(422, "规则名称不能为空");
    const trigger = canonicalAutomationTrigger(text(input.trigger) || "ticket_created");
    if (!AUTOMATION_TRIGGERS.has(trigger)) fail(422, "自动化触发事件无效");
    const rawConditions = asObject(input.conditions);
    const conditions: Record<string, unknown> = { ...clone(rawConditions) };
    const workflowId = text(rawConditions.workflow_id);
    const projectId = text(rawConditions.project_id);
    const priority = text(rawConditions.priority);
    const status = text(rawConditions.status);
    if (workflowId) this.findWorkflow(workflowId);
    if (projectId) this.findProject(projectId);
    if (priority && !AUTOMATION_PRIORITIES.has(priority)) fail(422, "自动化优先级无效");
    if (status && !AUTOMATION_TICKET_STATUSES.has(status)) fail(422, "自动化工单状态无效");
    if (workflowId) conditions.workflow_id = workflowId; else delete conditions.workflow_id;
    if (projectId) conditions.project_id = projectId; else delete conditions.project_id;
    if (priority) conditions.priority = priority; else delete conditions.priority;
    if (status) conditions.status = status; else delete conditions.status;

    const rawActions = asArray(input.actions);
    if (!rawActions.length) fail(422, "至少配置一个自动化动作");
    if (rawActions.length > 20) fail(422, "单条规则最多配置 20 个动作");
    let actionProjectId: string | undefined;
    let actionMilestoneProjectId: string | undefined;
    const actions = rawActions.map((value, index) => {
      const raw = asObject(value);
      const type = text(raw.type);
      if (!AUTOMATION_ACTION_TYPES.has(type)) fail(422, `第 ${index + 1} 个自动化动作无效`);
      const action = { ...clone(raw), type } as Record<string, unknown>;
      const actionValue = text(raw.value ?? raw.project_id ?? raw.milestone_id);
      if (type === "set_priority") {
        if (!AUTOMATION_PRIORITIES.has(actionValue)) fail(422, `第 ${index + 1} 个动作的优先级无效`);
        action.value = actionValue;
      } else if (type === "add_tag") {
        if (!actionValue || actionValue.length > 50) fail(422, `第 ${index + 1} 个动作的标签不能为空且不能超过 50 个字符`);
        action.value = actionValue;
      } else if (type === "set_project") {
        if (!actionValue) fail(422, `第 ${index + 1} 个动作必须选择项目`);
        this.findProject(actionValue);
        actionProjectId = actionValue;
        action.value = actionValue;
      } else if (type === "set_milestone") {
        if (!actionValue) fail(422, `第 ${index + 1} 个动作必须选择里程碑`);
        const milestone = this.getMilestone(actionValue);
        if (projectId && milestone.project_id !== projectId) fail(422, `第 ${index + 1} 个里程碑不属于限定项目`);
        actionMilestoneProjectId = milestone.project_id;
        action.value = actionValue;
      } else if (type === "set_due_at") {
        if (!actionValue || !safeDate(actionValue)) fail(422, `第 ${index + 1} 个动作的目标时间无效`);
        action.value = actionValue;
      } else {
        delete action.value;
      }
      return action;
    });
    if (actionProjectId && actionMilestoneProjectId && actionProjectId !== actionMilestoneProjectId) fail(422, "关联项目与里程碑不属于同一项目");
    return { name, enabled: input.enabled === true, trigger, conditions, actions };
  }

  listAutomations(): AutomationRule[] { return sortedUpdated(this.data.automations).map((rule) => clone({ ...rule, trigger: canonicalAutomationTrigger(rule.trigger) })); }
  async createAutomation(body: Record<string, unknown>): Promise<AutomationRule> {
    const normalized = this.normalizeAutomation({ name: body.name, enabled: body.enabled === true, trigger: body.trigger, conditions: body.conditions, actions: body.actions });
    const timestamp = nowIso();
    const item: AutomationRule = { id: id(), ...normalized, created_at: timestamp, updated_at: timestamp };
    this.data.automations.unshift(item);
    await this.store.save();
    return clone(item);
  }
  async updateAutomation(ruleId: string, body: Record<string, unknown>): Promise<AutomationRule> {
    const item = this.data.automations.find((value) => value.id === ruleId);
    if (!item) fail(404, "自动化规则不存在");
    const normalized = this.normalizeAutomation({ name: body.name === undefined ? item.name : body.name, enabled: body.enabled === undefined ? item.enabled : body.enabled === true, trigger: body.trigger === undefined ? item.trigger : body.trigger, conditions: body.conditions === undefined ? item.conditions : body.conditions, actions: body.actions === undefined ? item.actions : body.actions });
    Object.assign(item, normalized, { updated_at: nowIso() });
    await this.store.save();
    return clone(item);
  }
  listAutomationExecutions(ruleId: string, limit = 30): AutomationExecutionRead[] {
    if (!this.data.automations.some((rule) => rule.id === ruleId)) fail(404, "自动化规则不存在");
    const safeLimit = Math.max(1, Math.min(100, Number.isFinite(limit) ? Math.floor(limit) : 30));
    return this.data.action_executions
      .filter((execution) => execution.provider_key === `automation:${ruleId}`)
      .sort((left, right) => right.created_at.localeCompare(left.created_at))
      .slice(0, safeLimit)
      .map((execution) => {
        const ticket = this.data.tickets.find((item) => item.id === execution.ticket_id);
        return { ...clone(execution), ticket_title: ticket?.title ?? "工单已删除", ticket_number: ticket?.number ?? "未知工单" };
      });
  }
  async deleteAutomation(ruleId: string): Promise<void> { if (!this.data.automations.some((item) => item.id === ruleId)) fail(404, "自动化规则不存在"); this.data.automations = this.data.automations.filter((item) => item.id !== ruleId); await this.store.save(); }

  listResources(projectId?: string, ticketId?: string, milestoneId?: string): RelatedResource[] { return this.data.resources.filter((resource) => { const projectIds = resource.project_ids?.length ? resource.project_ids : resource.project_id ? [resource.project_id] : []; return (!projectId || projectIds.includes(projectId)) && (!ticketId || resource.ticket_ids.includes(ticketId)) && (!milestoneId || resource.milestone_ids.includes(milestoneId)); }).map((resource) => { const type = canonicalResourceType(resource.resource_type ?? resource.type); return clone({ ...resource, type, project_id: resource.project_id ?? resource.project_ids?.[0] ?? null, project_ids: resource.project_ids ?? (resource.project_id ? [resource.project_id] : []), resource_type: type, external_url: resource.external_url ?? resource.url, identifier: resource.identifier ?? "" }); }); }
  async createResource(body: Record<string, unknown>): Promise<RelatedResource> { const resource = this.normalizeResource(body); this.data.resources.unshift(resource); this.event("resource_created", `资源「${resource.name}」已创建`, undefined, undefined, resource.project_id); await this.store.save(); return clone(resource); }
  async updateResource(resourceId: string, body: Record<string, unknown>): Promise<RelatedResource> { const resource = this.data.resources.find((item) => item.id === resourceId); if (!resource) fail(404, "关联资源不存在"); Object.assign(resource, this.normalizeResource(body, resource)); resource.updated_at = nowIso(); await this.store.save(); return clone(resource); }
  async deleteResource(resourceId: string): Promise<void> { if (!this.data.resources.some((item) => item.id === resourceId)) fail(404, "关联资源不存在"); this.data.resources = this.data.resources.filter((item) => item.id !== resourceId); await this.store.save(); }

  listSchedules(workflowId: string): Schedule[] { this.findWorkflow(workflowId); return this.data.schedules.filter((item) => item.workflow_id === workflowId).sort((a, b) => Number(b.enabled) - Number(a.enabled) || (a.next_run_at ?? "").localeCompare(b.next_run_at ?? "")); }
  async createSchedule(workflowId: string, body: Record<string, unknown>): Promise<Schedule> { this.findWorkflow(workflowId); const schedule = this.normalizeSchedule(workflowId, body); this.data.schedules.unshift(schedule); await this.store.save(); return clone(schedule); }
  async updateSchedule(scheduleId: string, body: Record<string, unknown>): Promise<Schedule> { const current = this.data.schedules.find((item) => item.id === scheduleId); if (!current) fail(404, "定时任务不存在"); const next = this.normalizeSchedule(current.workflow_id, body, current); Object.assign(current, next, { updated_at: nowIso() }); await this.store.save(); return clone(current); }
  async deleteSchedule(scheduleId: string): Promise<void> { if (!this.data.schedules.some((item) => item.id === scheduleId)) fail(404, "定时任务不存在"); this.data.schedules = this.data.schedules.filter((item) => item.id !== scheduleId); this.data.schedule_runs = this.data.schedule_runs.filter((item) => item.schedule_id !== scheduleId); await this.store.save(); }
  listScheduleRuns(scheduleId: string, limit = 30): ScheduleRun[] { if (!this.data.schedules.some((item) => item.id === scheduleId)) fail(404, "定时任务不存在"); return this.data.schedule_runs.filter((item) => item.schedule_id === scheduleId).sort((a, b) => b.executed_at.localeCompare(a.executed_at)).slice(0, limit).map(clone); }
  async runScheduleNow(scheduleId: string): Promise<{ schedule: Schedule; run: ScheduleRun }> { const schedule = this.data.schedules.find((item) => item.id === scheduleId); if (!schedule) fail(404, "定时任务不存在"); const run = await this.executeSchedule(schedule, new Date()); await this.store.save(); return { schedule: clone(schedule), run: clone(run) }; }
  async runDueSchedules(): Promise<number> { let count = 0; const now = new Date(); for (const schedule of this.data.schedules) while (schedule.enabled && schedule.next_run_at && new Date(schedule.next_run_at) <= now) { await this.executeSchedule(schedule, new Date(schedule.next_run_at)); schedule.next_run_at = this.nextScheduleAt(schedule, new Date(schedule.next_run_at)); if (!schedule.next_run_at) schedule.enabled = false; count++; } if (count) await this.store.save(); return count; }
 async runDueReminders(): Promise<number> { let count = 0; const now = Date.now(); for (const ticket of this.data.tickets) if (["draft", "in_progress", "blocked"].includes(ticket.status) && ticket.reminder_at && !ticket.reminder_sent_at && new Date(ticket.reminder_at).valueOf() <= now) { ticket.reminder_sent_at = nowIso(); this.event("ticket_reminder_sent", "已发送工单提醒", undefined, ticket.id, ticket.project_id, ticket.milestone_id); await this.notify("ticket_reminder", `工单「${ticket.title}」提醒`, ticket); count++; } if (count) await this.store.save(); return count; }
  async runDueProjectNotifications(): Promise<number> {
    let count = 0;
    const now = Date.now();
    for (const milestone of this.data.milestones) {
      if (!milestone.target_at || milestone.notification_sent_at || milestone.status === "completed" || new Date(milestone.target_at).valueOf() > now) continue;
      milestone.notification_sent_at = nowIso();
      this.event("milestone_due", "里程碑已到期：" + milestone.name, undefined, undefined, milestone.project_id, milestone.id);
      await this.notifyContext("milestone_due", "里程碑已到期：" + milestone.name, "milestone", milestone.id, milestone.project_id, "/modules/" + this.moduleId + "/projects/" + milestone.project_id);
      count++;
    }
    for (const project of this.data.projects) {
      const hasRisk = this.data.tickets.some((ticket) => ticket.project_id === project.id && ticket.status === "blocked") || this.data.milestones.some((milestone) => milestone.project_id === project.id && milestone.target_at && new Date(milestone.target_at).valueOf() <= now && milestone.status !== "completed");
      if (!hasRisk || this.data.timeline.some((item) => item.type === "project_risk" && item.project_id === project.id)) continue;
      this.event("project_risk", "项目存在风险：" + project.name, undefined, undefined, project.id);
      await this.notifyContext("project_risk", "项目存在风险：" + project.name, "project", project.id, project.id, "/modules/" + this.moduleId + "/projects/" + project.id);
      count++;
    }
    if (count) await this.store.save();
    return count;
  }


  settings(): Settings { return clone(normalizeStoredSettings(this.data.settings)); }
  async updateSettings(body: Record<string, unknown>): Promise<Settings> {
    const values = asObject(body.values ?? body);
    const current = this.settings();
    const next = clone(current);
    for (const key of Object.keys(SETTING_LIMITS) as Array<keyof typeof SETTING_LIMITS>) if (values[key] !== undefined) next[key] = validatedSettingNumber(values[key], key, current[key]);
    if (values.notification_rules !== undefined) {
      if (!values.notification_rules || typeof values.notification_rules !== "object" || Array.isArray(values.notification_rules)) fail(422, "通知规则必须是对象");
      for (const [event, value] of Object.entries(values.notification_rules as Record<string, unknown>)) next.notification_rules[event] = validateRule(value, next.notification_rules[event] ?? FALLBACK_NOTIFICATION_RULE);
    }
    this.data.settings = next;
    await this.store.save();
    return this.settings();
  }
  actionProviders(): Array<Record<string, unknown>> { return [{ key: "notification", label: "平台通知", description: "向 ToolNest 通知中心发送通知", events: ["on_enter", "on_complete", "on_fail", "on_block"] }]; }

  async consumeTemporaryResource(token: string): Promise<{ resource: Record<string, unknown>; content: string }> {
    const resource = this.data.temporary_resources.find((item) => item.token === token);
    if (!resource || resource.revoked || new Date(resource.expires_at) <= new Date() || (resource.max_access_count !== null && resource.max_access_count !== undefined && resource.access_count >= resource.max_access_count)) fail(404, "临时资源不存在或已失效");
    resource.access_count += 1; await this.store.save(); return { resource: this.resourceRead(resource), content: resource.content };
  }

  exportCsv(): string {
    const escape = (value: unknown) => '"' + String(value ?? "").replaceAll('"', '""') + '"';
    const rows = this.data.tickets.map((ticket) => [ticket.number, ticket.title, ticket.status, ticket.priority, ticket.workflow_name, ticket.project_id ?? "", ticket.milestone_id ?? "", ticket.created_at]);
    return [["编号", "标题", "状态", "优先级", "工作流", "项目", "里程碑", "创建时间"], ...rows].map((row) => row.map(escape).join(",")).join("\n");
  }
  async exportData(): Promise<Record<string, unknown>> { const data = clone(this.data) as unknown as Record<string, unknown>; const attachments = this.data.attachments.map((attachment) => ({ id: attachment.id, ticket_id: attachment.ticket_id, ticket_node_id: attachment.ticket_node_id, field_id: attachment.field_id, name: attachment.filename, filename: attachment.filename, mime_type: attachment.mime_type, size: attachment.size, content_base64: "" })); for (const item of attachments) { try { item.content_base64 = (await readFile(this.getAttachment(item.id).path)).toString("base64"); } catch { /* omit missing contents */ } } data.attachments = attachments; return { schema_version: 3, exported_at: nowIso(), data }; }
  async importData(body: Record<string, unknown>): Promise<Record<string, unknown>> {
    const incoming = asObject(body.data ?? body);
    const mode = text(body.mode) || "merge";
    if (mode === "replace" && body.confirm !== true) fail(422, "替换导入需要 confirm=true");
    const current = this.data;
    for (const key of ["workflows", "tickets", "timeline", "projects", "milestones", "schedules", "schedule_runs", "saved_views", "automations", "resources", "action_executions"] as const) {
      const values = incoming[key];
      if (!Array.isArray(values)) continue;
      if (mode === "replace") (current as unknown as Record<string, unknown>)[key] = clone(values);
      else (current[key] as unknown[]).push(...(clone(values) as unknown[]));
    }
    const scheduleItems = incoming.schedule_items;
    if (Array.isArray(scheduleItems)) {
      if (mode === "replace") current.schedule_items = clone(scheduleItems) as ScheduleItem[];
      else current.schedule_items.push(...(clone(scheduleItems) as ScheduleItem[]));
    }
    const incomingAttachments = asArray(incoming.attachments);
    if (incomingAttachments.length) {
      if (mode === "replace") current.attachments = [];
      const attachmentDir = path.join(this.store.dataDir, "attachments");
      await mkdir(attachmentDir, { recursive: true });
      for (const raw of incomingAttachments) {
        const source = asObject(raw);
        const attachmentId = text(source.id) && !current.attachments.some((item) => item.id === text(source.id)) ? text(source.id) : id();
        const filename = path.basename(text(source.filename) || text(source.name) || "attachment");
        const storagePath = path.join(attachmentDir, attachmentId + path.extname(filename).slice(0, 20));
        const content = text(source.content_base64);
        await writeFile(storagePath, content ? Buffer.from(content, "base64") : Buffer.alloc(0));
        current.attachments.push({
          id: attachmentId,
          ticket_id: text(source.ticket_id),
          ticket_node_id: text(source.ticket_node_id),
          field_id: text(source.field_id),
          filename,
          stored_name: path.basename(storagePath),
          mime_type: text(source.mime_type) || "application/octet-stream",
          extension: path.extname(filename),
          size: Number(source.size) || 0,
          storage_path: storagePath,
          created_at: text(source.created_at) || nowIso(),
        });
      }
    }
    if (incoming.settings && typeof incoming.settings === "object") current.settings = clone(incoming.settings) as Settings;
    await this.store.save();
    return { imported: true, schema_version: current.schema_version, counts: Object.fromEntries(Object.entries(current).filter(([, value]) => Array.isArray(value)).map(([key, value]) => [key, (value as unknown[]).length])) };
  }

  private findWorkflow(workflowId: string): Workflow { const workflow = this.data.workflows.find((item) => item.id === workflowId); if (!workflow) fail(404, "工作流不存在"); return workflow; }
  private findTicket(ticketId: string): Ticket { const ticket = this.data.tickets.find((item) => item.id === ticketId); if (!ticket) fail(404, "工单不存在"); return ticket; }
  private findProject(projectId: string): Project { const project = this.data.projects.find((item) => item.id === projectId); if (!project) fail(404, "项目不存在"); return project; }
  private findScheduleItem(itemId: string): ScheduleItem { const item = this.data.schedule_items.find((value) => value.id === itemId); if (!item) fail(404, "日程事项不存在"); return item; }
  private publishedVersion(workflow: Workflow): WorkflowVersion | undefined { return workflow.versions.filter((item) => item.status === "published").sort((a, b) => b.version - a.version)[0]; }
  private editableVersion(workflow: Workflow, versionId?: string): WorkflowVersion { const version = versionId ? workflow.versions.find((item) => item.id === versionId) : workflow.versions.find((item) => item.id === workflow.current_version_id); if (versionId && !version) fail(404, "版本不存在"); if (version?.status === "draft") return version; const source = workflow.versions.at(-1); if (!source) fail(409, "版本不存在"); const next: WorkflowVersion = { ...clone(source), id: id(), version: Math.max(...workflow.versions.map((item) => item.version)) + 1, status: "draft", source_version_id: source.id, change_note: "", publish_note: "", created_at: nowIso(), published_at: null, nodes: clone(source.nodes), edges: clone(source.edges), ticket_count: 0 }; workflow.versions.push(next); workflow.current_version_id = next.id; return next; }
  private normalizeNode(raw: Record<string, unknown>): WorkflowNode { const formSchema = asObject(raw.form_schema); const fields = asArray(formSchema.fields).map((item) => { const field = asObject(item); return { id: text(field.id) || id(), type: (text(field.type) || "text") as FormField["type"], label: text(field.label) || "未命名字段", description: text(field.description), placeholder: text(field.placeholder), required: Boolean(field.required), readonly: Boolean(field.readonly), hidden: Boolean(field.hidden), default: field.default, default_template: text(field.default_template) || undefined, options: asArray(field.options).map((option) => { const value = asObject(option); return { label: text(value.label), value: jsonValue(value.value) as string | number }; }), items: asArray(field.items).map((item) => { const value = asObject(item); return { id: text(value.id), label: text(value.label) }; }).filter((item) => item.id || item.label), config: asObject(field.config), reference: asObject(field.reference) as FormField["reference"] } satisfies FormField; }); return { id: text(raw.id) || id(), name: text(raw.name) || "未命名节点", key: text(raw.key) || `node-${id().slice(0, 8)}`, description: text(raw.description), node_type: text(raw.node_type) === "summary" ? "summary" : "general", status: text(raw.status), position: { x: Number(asObject(raw.position).x) || 0, y: Number(asObject(raw.position).y) || 0 }, form_schema: { fields }, completion_rule: (asObject(raw.completion_rule) as RuleGroup | CompletionRule) ?? { type: "group", operator: "AND", children: [] }, predecessor_rule: raw.predecessor_rule && typeof raw.predecessor_rule === "object" ? (asObject(raw.predecessor_rule) as unknown as WorkflowNode["predecessor_rule"]) : null, actions: asArray(raw.actions).map((item) => asObject(item) as unknown as WorkflowNode["actions"][number]), inputs: asArray(raw.inputs).map(asObject), outputs: asArray(raw.outputs).map(asObject) }; }
  private normalizeEdge(raw: Record<string, unknown>): WorkflowEdge { return { id: text(raw.id) || id(), source_node_id: text(raw.source_node_id), target_node_id: text(raw.target_node_id), source_side: text(raw.source_side), target_side: text(raw.target_side), priority: Number(raw.priority) || 0, condition: (asObject(raw.condition) as WorkflowEdge["condition"]) || null, condition_mode: (text(raw.condition_mode) || "unconditional") as WorkflowEdge["condition_mode"] }; }
  private validateGraph(nodes: WorkflowNode[], edges: WorkflowEdge[]): void { const ids = new Set<string>(); for (const node of nodes) { if (ids.has(node.id)) fail(422, "工作流包含重复的节点标识"); ids.add(node.id); } if (nodes.filter((node) => node.node_type === "summary").length > 1) fail(422, "一个工作流只能配置一个总结节点"); const pairs = new Set<string>(); const outgoing = new Map<string, string[]>(); const incoming = new Map<string, string[]>(); const indegree = new Map<string, number>(nodes.map((node) => [node.id, 0])); for (const edge of edges) { if (!ids.has(edge.source_node_id) || !ids.has(edge.target_node_id)) fail(422, "连线引用了不存在的节点"); if (edge.source_node_id === edge.target_node_id) fail(422, "节点不能连接到自身"); const pair = `${edge.source_node_id}:${edge.target_node_id}`; if (pairs.has(pair)) fail(422, "相同节点之间不能重复连线"); pairs.add(pair); outgoing.set(edge.source_node_id, [...(outgoing.get(edge.source_node_id) ?? []), edge.target_node_id]); incoming.set(edge.target_node_id, [...(incoming.get(edge.target_node_id) ?? []), edge.source_node_id]); indegree.set(edge.target_node_id, (indegree.get(edge.target_node_id) ?? 0) + 1); } const queue = [...indegree.entries()].filter(([, value]) => value === 0).map(([key]) => key); let visited = 0; while (queue.length) { const nodeId = queue.pop()!; visited++; for (const target of outgoing.get(nodeId) ?? []) { const next = (indegree.get(target) ?? 0) - 1; indegree.set(target, next); if (next === 0) queue.push(target); } } if (visited !== nodes.length) fail(422, "工作流不能形成循环连线"); for (const node of nodes) if (node.predecessor_rule) { const rule = node.predecessor_rule; if (!(rule.operator === "AND" || rule.operator === "OR") || !rule.conditions.length) fail(422, `节点「${node.name}」的前序配置无效`); for (const condition of rule.conditions) if (!(incoming.get(node.id) ?? []).includes(condition.node_id)) fail(422, `节点「${node.name}」的前序配置引用了未连接的节点`); } }

  private createTicketFromVersion(workflow: Workflow, version: WorkflowVersion, input: { title: string; note: string; created_by: string; owner_id?: string | null; owner_name?: string | null; due_at?: string | null; reminder_at?: string | null; project_id?: string | null; milestone_id?: string | null; priority: string; tags: string[]; weight?: number; initial_values?: Record<string, unknown>; parent_ticket_id?: string | null; related_ticket_ids?: string[]; blocked_by_ticket_ids?: string[] }, save: boolean): Promise<Ticket> { if (!input.title) fail(422, "工单标题不能为空"); this.resolveScope(input.project_id, input.milestone_id); const prefix = input.project_id ? this.findProject(input.project_id).key : "TK"; const sequence = this.data.tickets.filter((item) => item.number.startsWith(`${prefix}-`)).length + 1; const created = nowIso(); const ticket: Ticket = { id: id(), number: `${prefix}-${String(sequence).padStart(3, "0")}`, title: input.title, note: input.note, status: "in_progress", priority: (input.priority || "none") as Ticket["priority"], tags: input.tags, workflow_id: workflow.id, workflow_version_id: version.id, workflow_name: workflow.name, project_id: input.project_id, project_name: this.data.projects.find((item) => item.id === input.project_id)?.name ?? "", milestone_id: input.milestone_id, milestone_name: this.data.milestones.find((item) => item.id === input.milestone_id)?.name ?? "", created_by: input.created_by, owner_id: input.owner_id, owner_name: input.owner_name, weight: input.weight ?? 1, parent_ticket_id: input.parent_ticket_id ?? null, related_ticket_ids: input.related_ticket_ids ?? [], blocked_by_ticket_ids: input.blocked_by_ticket_ids ?? [], due_at: input.due_at, reminder_at: input.reminder_at, reminder_sent_at: null, created_at: created, updated_at: created, node_instances: version.nodes.map((definition) => ({ id: id(), node_id: definition.id, name: definition.name, key: definition.key, status: "pending", values: {}, outputs: [], resources: {}, blocked_reason: "", started_at: null, completed_at: null, assignee_id: null, assignee_name: null })) }; const roots = new Set(version.nodes.map((node) => node.id)); for (const edge of version.edges) roots.delete(edge.target_node_id); for (const node of ticket.node_instances) if (roots.has(node.node_id)) node.status = "ready"; const first = ticket.node_instances.find((node) => roots.has(node.node_id)); if (first) { const definition = version.nodes.find((node) => node.id === first.node_id); if (definition) { first.values = clone(input.initial_values ?? {}); this.hydrateDefaults(ticket, version, first, definition); this.prepareRuntimeResources(ticket, first, definition); } } this.data.tickets.unshift(ticket); this.event("ticket_created", "工单已创建", undefined, ticket.id, ticket.project_id, ticket.milestone_id); if (save) return this.store.save().then(async () => { await this.notify("ticket_created", `工单「${ticket.title}」已创建`, ticket); return this.getTicket(ticket.id); }); return Promise.resolve(this.getTicket(ticket.id)); }
  private prepareRuntimeResources(ticket: Ticket, node: TicketNode, definition: WorkflowNode): void {
    for (const field of definition.form_schema.fields) {
      if (field.type !== "script") continue;
      const config = asObject(field.config);
      const template = text(config.execution_template);
      if (!template) continue;
      for (const resource of this.data.temporary_resources) if (resource.ticket_id === ticket.id && resource.ticket_node_id === node.id && resource.field_id === field.id) resource.revoked = true;
      const language = text(config.language) || "shell";
      const filenames: Record<string, string> = { shell: "run.sh", bash: "run.sh", cmd: "run.cmd", powershell: "run.ps1", python: "run.py" };
      const mimeTypes: Record<string, string> = { shell: "text/x-shellscript", bash: "text/x-shellscript", cmd: "text/x-msdos-batch", powershell: "text/x-powershell", python: "text/x-python" };
      const filename = text(config.filename) || filenames[language] || "run.txt";
      const generated = {
        id: id(),
        token: id(),
        ticket_id: ticket.id,
        ticket_node_id: node.id,
        field_id: field.id,
        filename,
        mime_type: mimeTypes[language] || "text/plain",
        content: this.renderTemplate(template, ticket, node),
        expires_at: new Date(Date.now() + this.settings().temporary_resource_days * 86_400_000).toISOString(),
        max_access_count: config.max_access_count === undefined ? this.settings().temporary_resource_access_count : Math.max(1, Number(config.max_access_count) || 1),
        access_count: 0,
        revoked: false,
      };
      this.data.temporary_resources.push(generated);
      node.resources[field.id] = this.resourceRead(generated);
    }
  }

  private renderTemplate(template: string, ticket: Ticket, node: TicketNode): string {
    return template.replace(new RegExp("\\{\\{\\s*([^}]+?)\\s*\\}\\}", "g"), (_match, expression: string) => {
      const expressionPath = expression.trim();
      if (expressionPath === "ticket.title") return ticket.title;
      if (expressionPath === "ticket.number") return ticket.number;
      if (expressionPath.startsWith("current.values.")) return text(node.values[expressionPath.slice("current.values.".length)]);
      const match = /^nodes\\.([^\\.]+)\\.(values|outputs|resources)\\.(.+)$/.exec(expressionPath);
      if (!match) return "";
      const source = ticket.node_instances.find((item) => item.key === match[1]);
      if (!source) return "";
      const collection = match[2] === "values" ? source.values : match[2] === "outputs" ? source.outputs : source.resources;
      return text((collection as Record<string, unknown>)[match[3] ?? ""]);
    });
  }

  private resolveScope(projectId?: string | null, milestoneId?: string | null): void { if (projectId) this.findProject(projectId); if (milestoneId) { const milestone = this.getMilestone(milestoneId); if (projectId && milestone.project_id !== projectId) fail(422, "里程碑不属于当前项目"); } }
  private executableTicket(ticketId: string): Ticket { const ticket = this.findTicket(ticketId); if (TERMINAL_TICKET_STATUSES.has(ticket.status)) fail(409, "当前工单无法继续执行"); return ticket; }
  private ticketNode(ticket: Ticket, nodeId: string): TicketNode { const node = ticket.node_instances.find((item) => item.id === nodeId || item.node_id === nodeId); if (!node) fail(404, "工单节点不存在"); return node; }
  private nodeDefinition(ticket: Ticket, node: TicketNode): WorkflowNode { const workflow = this.findWorkflow(ticket.workflow_id); const version = workflow.versions.find((item) => item.id === ticket.workflow_version_id); const definition = version?.nodes.find((item) => item.id === node.node_id); if (!definition) fail(409, "工单节点定义不存在"); return definition; }
  private hydrateDefaults(ticket: Ticket, version: WorkflowVersion, node: TicketNode, definition: WorkflowNode): void { for (const field of definition.form_schema.fields) { if (node.values[field.id] !== undefined) continue; const reference = text(field.reference?.path); if (reference) { const value = this.resolveReference(ticket, version, reference); if (value !== undefined) node.values[field.id] = clone(value); } else if (field.default !== undefined) node.values[field.id] = clone(field.default); else if (field.default_template) node.values[field.id] = this.renderTemplate(field.default_template, ticket, node); else if (field.type === "switch") node.values[field.id] = false; else if (["multiselect", "checklist", "todo"].includes(field.type)) node.values[field.id] = []; } }
  private resolveReference(ticket: Ticket, _version: WorkflowVersion, reference: string): unknown { if (reference === "ticket.title") return ticket.title; if (reference === "ticket.number") return ticket.number; const match = /^nodes\.([^\.]+)\.(values|outputs|resources)\.([^\.]+)$/.exec(reference); if (!match) return undefined; const source = ticket.node_instances.find((node) => node.key === match[1]); if (!source) return undefined; const sourceKind = match[2]!; const sourceName = match[3]!; const collection = sourceKind === "values" ? source.values : sourceKind === "resources" ? source.resources : source.outputs; return (collection as Record<string, unknown>)[sourceName]; }
  private validateValues(fields: FormField[], values: Record<string, unknown>): Record<string, string> { const errors: Record<string, string> = {}; for (const field of fields) { const value = values[field.id]; if (field.required && !hasValue(value)) errors[field.id] = `「${field.label}」为必填项`; if (field.type === "number" && hasValue(value) && !Number.isFinite(Number(value))) errors[field.id] = `「${field.label}」必须是数字`; if (field.type === "json" && hasValue(value)) try { if (typeof value === "string") JSON.parse(value); } catch { errors[field.id] = `「${field.label}」不是有效 JSON`; } if (field.type === "url" && hasValue(value) && !/^https?:\/\//i.test(String(value))) errors[field.id] = `「${field.label}」必须是有效 URL`; const config = asObject(field.config); if (field.type === "number" && hasValue(value) && config.min !== undefined && Number(value) < Number(config.min)) errors[field.id] = `「${field.label}」不能小于 ${config.min}`; if (field.type === "number" && hasValue(value) && config.max !== undefined && Number(value) > Number(config.max)) errors[field.id] = `「${field.label}」不能大于 ${config.max}`; } return errors; }
  private evaluateRule(rule: RuleGroup | CompletionRule | undefined, ticket: Ticket, node: TicketNode): boolean { if (!rule) return true; const raw = rule as Record<string, unknown>; const children = Array.isArray(raw.children) ? raw.children : Array.isArray(raw.rules) ? raw.rules : null; let result: boolean; if (children) { const values = children.map((child) => this.evaluateRule(child as RuleGroup | CompletionRule, ticket, node)); result = text(raw.operator).toUpperCase() === "OR" ? values.some(Boolean) : values.every(Boolean); } else { const kind = text(raw.kind); const value = raw.field_id ? node.values[text(raw.field_id)] : undefined; switch (kind) { case "field_filled": result = hasValue(value); break; case "manual_confirm": result = value === true || value === "true"; break; case "checklist_complete": result = asArray(value).length > 0 && asArray(value).every((item) => typeof item === "object" ? Boolean(asObject(item).completed ?? asObject(item).checked) : true); break; case "attachment_count": result = this.data.attachments.filter((item) => item.ticket_node_id === node.id && (!raw.field_id || item.field_id === raw.field_id)).length >= Number(raw.count ?? 1); break; case "node_status": { const other = ticket.node_instances.find((item) => item.node_id === text(raw.node_id)); result = other?.status === text(raw.status) || (Array.isArray(raw.statuses) && (raw.statuses as unknown[]).map(text).includes(other?.status ?? "")); break; } case "value_compare": { const expected = raw.operator_value ?? raw.value; const operator = text(raw.operator); const left = value; result = operator === "=" || operator === "==" ? String(left) === String(expected) : operator === "!=" ? String(left) !== String(expected) : operator === ">" ? Number(left) > Number(expected) : operator === "<" ? Number(left) < Number(expected) : operator === ">=" ? Number(left) >= Number(expected) : operator === "<=" ? Number(left) <= Number(expected) : operator === "contains" ? String(left).includes(String(expected)) : hasValue(left); break; } default: result = true; } } return raw.negate === true ? !result : result; }
  private activateEdges(ticket: Ticket, force = false): TicketNode[] { const workflow = this.findWorkflow(ticket.workflow_id); const version = workflow.versions.find((item) => item.id === ticket.workflow_version_id); if (!version) return []; const ready: TicketNode[] = []; for (const node of ticket.node_instances) { if (node.status !== "pending") continue; const incoming = version.edges.filter((edge) => edge.target_node_id === node.node_id); if (!incoming.length) continue; const eligible = incoming.filter((edge) => ticket.node_instances.find((item) => item.node_id === edge.source_node_id)?.status === "completed").sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0)); const definition = version.nodes.find((item) => item.id === node.node_id); if (!definition) continue; const predecessor = definition.predecessor_rule; const predecessorValues = predecessor?.conditions.map((condition: PredecessorCondition) => { const source = ticket.node_instances.find((item) => item.node_id === condition.node_id); const states = condition.statuses ?? (condition.status ? [condition.status] : ["completed"]); const value = Boolean(source && states.includes(source.status)); return condition.negate ? !value : value; }); const predecessorSatisfied = !predecessor || (predecessor.operator === "OR" ? predecessorValues?.some(Boolean) : predecessorValues?.every(Boolean)); for (const edge of eligible) { const conditionSatisfied = edge.condition_mode === "unconditional" || !edge.condition || this.evaluateRule(edge.condition, ticket, ticket.node_instances.find((item) => item.node_id === edge.source_node_id)!); const final = edge.condition_mode === "unless" ? !conditionSatisfied : conditionSatisfied; if (final && (predecessorSatisfied || force)) { node.status = "ready"; this.hydrateDefaults(ticket, version, node, definition); this.prepareRuntimeResources(ticket, node, definition); ready.push(node); break; } } } for (const node of ready) this.event("node_ready", `节点「${node.name}」已进入待处理`, node.node_id, ticket.id, ticket.project_id, ticket.milestone_id); return ready; }
  private runAutomations(trigger: string, ticket: Ticket): void {
    const normalizedTrigger = canonicalAutomationTrigger(trigger);
    for (const rule of this.data.automations) {
      if (!rule.enabled || canonicalAutomationTrigger(rule.trigger) !== normalizedTrigger) continue;
      const conditions = rule.conditions;
      if (conditions.workflow_id && conditions.workflow_id !== ticket.workflow_id) continue;
      if (conditions.project_id && conditions.project_id !== ticket.project_id) continue;
      if (conditions.priority && conditions.priority !== ticket.priority) continue;
      if (conditions.status && conditions.status !== ticket.status) continue;
      const providerKey = "automation:" + rule.id;
      if (this.data.action_executions.some((item) => item.ticket_id === ticket.id && item.provider_key === providerKey && canonicalAutomationTrigger(item.event) === normalizedTrigger)) continue;
      const execution: ActionExecution = { id: id(), ticket_id: ticket.id, node_id: null, provider_key: providerKey, event: normalizedTrigger, status: "succeeded", input: clone(conditions), output: {}, error: null, created_at: nowIso(), completed_at: null };
      let applied = 0;
      try {
        for (const action of rule.actions) {
          const type = text(action.type);
          const value = action.value;
          if (type === "set_priority") ticket.priority = text(value) as Ticket["priority"];
          else if (type === "add_tag") ticket.tags = [...new Set([...ticket.tags, ...normalizeTags([value])])];
          else if (type === "set_project") { const projectId = text(value || action.project_id) || null; this.resolveScope(projectId, ticket.milestone_id); ticket.project_id = projectId; }
          else if (type === "set_milestone") { const milestoneId = text(value || action.milestone_id) || null; this.resolveScope(ticket.project_id, milestoneId); ticket.milestone_id = milestoneId; }
          else if (type === "set_due_at") ticket.due_at = text(value) || null;
          else if (type === "archive") ticket.status = "archived";
          applied++;
        }
        ticket.updated_at = nowIso();
        execution.output = { applied, total: rule.actions.length };
      } catch (error) {
        execution.status = "failed";
        execution.output = { applied, total: rule.actions.length };
        execution.error = error instanceof Error ? error.message : String(error);
      }
      execution.completed_at = nowIso();
      this.data.action_executions.push(execution);
    }
  }

  private event(type: string, title: string, nodeId?: string, ticketId?: string, projectId?: string | null, milestoneId?: string | null, detail?: string): TimelineEvent { const event: TimelineEvent = { id: id(), type, title, detail, node_id: nodeId ?? null, ticket_id: ticketId ?? null, project_id: projectId ?? null, milestone_id: milestoneId ?? null, created_at: nowIso(), actor_name: "当前用户" }; this.data.timeline.unshift(event); if (ticketId) { const ticket = this.data.tickets.find((item) => item.id === ticketId); if (ticket) this.runAutomations(type, ticket); } return event; }
 private async notify(eventType: string, title: string, ticket: Ticket, nodeId?: string): Promise<void> { const rule = this.settings().notification_rules[eventType]; if (rule && !rule.enabled) return; if (!this.platformApiUrl || !this.platformToken) return; try { await fetch(`${this.platformApiUrl}/internal/modules/${encodeURIComponent(this.moduleId)}/notifications`, { method: "POST", headers: { "content-type": "application/json", "x-toolnest-internal-token": this.platformToken }, body: JSON.stringify({ title, summary: ticket.number, content: ticket.note || title, level: rule?.level ?? "info", event_type: `workflow_tickets.${eventType}`, source_type: "ticket", source_id: ticket.id, related_url: `/modules/${this.moduleId}/tickets/${ticket.id}`, channels: rule?.channels }) }); } catch { /* notifications must not break ticket execution */ } }
  private async notifyContext(eventType: string, title: string, sourceType: "project" | "milestone", sourceId: string, projectId: string, relatedUrl: string): Promise<void> {
    const rule = this.settings().notification_rules[eventType];
    if (rule && !rule.enabled) return;
    if (!this.platformApiUrl || !this.platformToken) return;
    try {
      await fetch(this.platformApiUrl + "/internal/modules/" + encodeURIComponent(this.moduleId) + "/notifications", {
        method: "POST",
        headers: { "content-type": "application/json", "x-toolnest-internal-token": this.platformToken },
        body: JSON.stringify({ title, summary: projectId, content: title, level: rule?.level ?? "info", event_type: "workflow_tickets." + eventType, source_type: sourceType, source_id: sourceId, related_url: relatedUrl, channels: rule?.channels }),
      });
    } catch { /* notifications must not break background processing */ }
  }

  private attachmentRead(attachment: Attachment): Record<string, unknown> { return { id: attachment.id, name: attachment.filename, filename: attachment.filename, mime_type: attachment.mime_type, size: attachment.size, url: `/api/v1/modules/${this.moduleId}/attachments/${attachment.id}` }; }
  private resourceRead(resource: { id: string; token: string; filename: string; mime_type: string; content: string; expires_at: string; max_access_count?: number | null; access_count: number }): Record<string, unknown> { return { id: resource.id, url: `/api/v1/modules/${this.moduleId}/temp/${resource.token}`, filename: resource.filename, mime_type: resource.mime_type, content: resource.content, expires_at: resource.expires_at, max_access_count: resource.max_access_count ?? null, access_count: resource.access_count }; }
  private mask(value: unknown, key = ""): unknown { if (/password|passwd|secret|token|api[_-]?key|credential/i.test(key)) return "******"; if (Array.isArray(value)) return value.map((item) => this.mask(item, key)); if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, this.mask(item, name)])); return value; }
  private normalizeResource(body: Record<string, unknown>, existing?: RelatedResource): RelatedResource {
    const now = nowIso();
    const projectId = body.project_id === undefined ? (existing?.project_id ?? (text(asArray(body.project_ids)[0]) || null)) : text(body.project_id) || null;
    if (projectId) this.findProject(projectId);
    const type = canonicalResourceType(text(body.type || body.resource_type) || existing?.type || "custom");
    if (!RELATED_RESOURCE_TYPES.has(type)) fail(422, "资源类型无效");
    const name = text(body.name) || existing?.name || "";
    if (!name) fail(422, "资源名称不能为空");
    const identifier = body.identifier === undefined ? existing?.identifier ?? "" : text(body.identifier);
    const url = body.url === undefined && body.external_url === undefined ? existing?.url ?? existing?.external_url ?? null : text(body.url || body.external_url) || null;
    if (url && !/^https?:\/\//i.test(url)) fail(422, "外部链接必须以 http:// 或 https:// 开头");
    const attributes = { ...(existing?.attributes ?? {}), ...(body.attributes === undefined ? {} : asObject(body.attributes)) };
    if (attributes.port !== undefined && text(attributes.port) && (!/^\d+$/.test(text(attributes.port)) || Number(attributes.port) < 1 || Number(attributes.port) > 65535)) fail(422, "端口必须是 1 到 65535 之间的数字");
    const ticketIds = body.ticket_ids === undefined ? [...new Set(existing?.ticket_ids ?? [])] : normalizeIds(body.ticket_ids);
    const milestoneIds = body.milestone_ids === undefined ? [...new Set(existing?.milestone_ids ?? [])] : normalizeIds(body.milestone_ids);
    if (ticketIds.length || milestoneIds.length) {
      if (!projectId) fail(422, "资源必须先关联项目，才能关联工单或里程碑");
      for (const ticketId of ticketIds) if (this.findTicket(ticketId).project_id !== projectId) fail(422, "关联工单必须属于当前项目");
      for (const milestoneId of milestoneIds) if (this.getMilestone(milestoneId).project_id !== projectId) fail(422, "关联里程碑必须属于当前项目");
    }
    return { id: existing?.id ?? id(), project_id: projectId, project_ids: projectId ? [projectId] : [], name, type, resource_type: type, identifier, url, external_url: url, description: body.description === undefined ? existing?.description || "" : text(body.description), attributes, ticket_ids: ticketIds, milestone_ids: milestoneIds, created_at: existing?.created_at ?? now, updated_at: now };
  }
  private normalizeSchedule(workflowId: string, body: Record<string, unknown>, existing?: Schedule): Schedule {
    const type = (text(body.schedule_type) || existing?.schedule_type || "once") as Schedule["schedule_type"];
    if (!["once", "daily", "weekly", "monthly", "cron"].includes(type)) fail(422, "计划类型无效");
    const start = text(body.start_at) || existing?.start_at || nowIso();
    const parsed = safeDate(start);
    if (!parsed) fail(422, "开始时间无效");
    const cron = text(body.cron_expression) || existing?.cron_expression || "";
    if (type === "cron" && !/^\S+(?:\s+\S+){4}$/.test(cron)) fail(422, "Cron 表达式必须包含 5 个字段");
    const enabled = body.enabled === undefined ? existing?.enabled ?? true : Boolean(body.enabled);
    const result: Schedule = {
      id: existing?.id ?? id(),
      workflow_id: workflowId,
      name: text(body.name) || existing?.name || "未命名定时任务",
      schedule_type: type,
      timezone: text(body.timezone) || existing?.timezone || "Asia/Shanghai",
      start_at: parsed.toISOString(),
      end_at: text(body.end_at) || existing?.end_at || null,
      weekday: body.weekday === undefined ? existing?.weekday ?? null : Number(body.weekday),
      day_of_month: body.day_of_month === undefined ? existing?.day_of_month ?? null : Number(body.day_of_month),
      cron_expression: cron,
      cron_day_mode: (text(body.cron_day_mode) || existing?.cron_day_mode || "calendar") as Schedule["cron_day_mode"],
      title_template: text(body.title_template) || existing?.title_template || "{workflow} · {date}",
      note_template: text(body.note_template) || existing?.note_template || "",
      project_id: body.project_id === undefined ? existing?.project_id ?? null : text(body.project_id) || null,
      milestone_id: body.milestone_id === undefined ? existing?.milestone_id ?? null : text(body.milestone_id) || null,
      enabled,
      next_run_at: null,
      last_run_at: existing?.last_run_at ?? null,
      last_run_status: existing?.last_run_status ?? null,
      last_run_error: existing?.last_run_error ?? null,
      run_count: existing?.run_count ?? 0,
      created_at: existing?.created_at ?? nowIso(),
      updated_at: nowIso(),
    };
    if (enabled) {
      if (existing?.next_run_at && existing.schedule_type === type) result.next_run_at = existing.next_run_at;
      else if (type === "once" || parsed > new Date()) result.next_run_at = parsed.toISOString();
      else {
        let candidate = this.nextScheduleAt(result, parsed);
        while (candidate && new Date(candidate) <= new Date()) candidate = this.nextScheduleAt(result, new Date(candidate));
        result.next_run_at = candidate;
      }
    }
    return result;
  }
  private nextScheduleAt(schedule: Schedule, plannedAt: Date): string | null {
    const next = new Date(plannedAt);
    if (schedule.schedule_type === "once") return null;
    if (schedule.schedule_type === "daily") next.setUTCDate(next.getUTCDate() + 1);
    else if (schedule.schedule_type === "weekly") {
      const days = schedule.weekday == null ? 7 : ((schedule.weekday - next.getUTCDay() + 7) % 7 || 7);
      next.setUTCDate(next.getUTCDate() + days);
    } else if (schedule.schedule_type === "monthly") {
      next.setUTCMonth(next.getUTCMonth() + 1);
      if (schedule.day_of_month) next.setUTCDate(Math.min(schedule.day_of_month, 28));
    } else {
      const minuteField = schedule.cron_expression.trim().split(/\s+/)[0] || "*";
      const stepMatch = /^\*\/(\d+)$/.exec(minuteField);
      if (stepMatch) {
        const step = Math.max(1, Number(stepMatch[1]));
        const nextMinute = Math.floor(next.getUTCMinutes() / step) * step + step;
        next.setUTCMinutes(nextMinute, 0, 0);
      } else {
        next.setUTCMinutes(next.getUTCMinutes() + 60, 0, 0);
      }
    }
    if (schedule.end_at && next > new Date(schedule.end_at)) return null;
    return next.toISOString();
  }
  private async executeSchedule(schedule: Schedule, plannedAt: Date): Promise<ScheduleRun> { const run: ScheduleRun = { id: id(), schedule_id: schedule.id, workflow_id: schedule.workflow_id, planned_at: plannedAt.toISOString(), executed_at: nowIso(), status: "failed", ticket_id: null, error: null }; const workflow = this.findWorkflow(schedule.workflow_id); const version = this.publishedVersion(workflow); if (!version) { run.status = "skipped"; run.error = "没有可用的已发布版本，未创建工单。"; } else { try { const sequence = this.data.tickets.length + 1; const title = (schedule.title_template || "{workflow} · {date}").replaceAll("{workflow}", workflow.name).replaceAll("{date}", plannedAt.toISOString().slice(0, 10)).replaceAll("{year}", String(plannedAt.getUTCFullYear())).replaceAll("{month}", String(plannedAt.getUTCMonth() + 1).padStart(2, "0")).replaceAll("{day}", String(plannedAt.getUTCDate()).padStart(2, "0")).replaceAll("{time}", plannedAt.toISOString().slice(11, 16)).replaceAll("{sequence}", String(sequence).padStart(3, "0")); const ticket = await this.createTicketFromVersion(workflow, version, { title, note: (schedule.note_template || "").replaceAll("{workflow}", workflow.name).replaceAll("{date}", plannedAt.toISOString().slice(0, 10)).replaceAll("{year}", String(plannedAt.getUTCFullYear())).replaceAll("{month}", String(plannedAt.getUTCMonth() + 1).padStart(2, "0")).replaceAll("{day}", String(plannedAt.getUTCDate()).padStart(2, "0")).replaceAll("{time}", plannedAt.toISOString().slice(11, 16)).replaceAll("{sequence}", String(sequence).padStart(3, "0")) || `由定时任务「${schedule.name}」自动创建。`, created_by: "系统 · 定时任务", owner_id: null, owner_name: "系统 · 定时任务", due_at: null, reminder_at: null, project_id: schedule.project_id, milestone_id: schedule.milestone_id, priority: "none", tags: [] }, false); run.status = "succeeded"; run.ticket_id = ticket.id; } catch (error) { run.error = error instanceof Error ? error.message : String(error); } } schedule.last_run_at = run.executed_at; schedule.last_run_status = run.status; schedule.last_run_error = run.error; schedule.run_count++; schedule.updated_at = nowIso(); this.data.schedule_runs.unshift(run); return run; }
}
