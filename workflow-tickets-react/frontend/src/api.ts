import type { ToolNestModuleApiClient } from "@toolnest/react-module-sdk";

export type Id = string;
export type Status = string;

export interface FormField { id: string; type: string; label: string; description?: string; placeholder?: string; required?: boolean; readonly?: boolean; hidden?: boolean; default?: unknown; default_template?: string; options?: Array<{ label: string; value: string | number }>; items?: Array<{ id: string; label: string }>; config?: Record<string, unknown>; reference?: { path?: string; mode?: string } }
export interface WorkflowNode { id: Id; name: string; key: string; description: string; node_type: "general" | "summary"; position: { x: number; y: number }; form_schema: { fields: FormField[] }; completion_rule: Record<string, unknown>; predecessor_rule?: Record<string, unknown> | null; actions: Array<Record<string, unknown>>; inputs: Array<Record<string, unknown>>; outputs: Array<Record<string, unknown>> }
export interface WorkflowEdge { id: Id; source_node_id: Id; target_node_id: Id; source_side?: string; target_side?: string; priority?: number; condition?: Record<string, unknown> | null; condition_mode?: string }
export interface WorkflowVersion { id: Id; workflow_id: Id; version: number; status: Status; change_note: string; publish_note: string; source_version_id?: Id | null; created_at: string; published_at?: string | null; nodes: WorkflowNode[]; edges: WorkflowEdge[]; ticket_count: number }
export interface Workflow { id: Id; name: string; description: string; group_name?: string | null; status: Status; created_at: string; updated_at: string; current_version_id: Id; versions: WorkflowVersion[] }
export interface TicketNode { id: Id; node_id: Id; name: string; key: string; status: Status; values: Record<string, unknown>; outputs: Array<Record<string, unknown>>; resources: Record<string, Record<string, unknown>>; blocked_reason: string; assignee_id?: Id | null; assignee_name?: string | null; started_at?: string | null; completed_at?: string | null }
export interface TicketAttachment { id: Id; name: string; filename: string; mime_type: string; size: number; url: string }
export interface Ticket { id: Id; number: string; title: string; note: string; status: Status; priority: Status; tags: string[]; workflow_id: Id; workflow_version_id: Id; workflow_name: string; project_id?: Id | null; project_name?: string; milestone_id?: Id | null; milestone_name?: string; created_by: string; owner_id?: Id | null; owner_name?: string | null; weight?: number; due_at?: string | null; reminder_at?: string | null; reminder_sent_at?: string | null; attachments?: TicketAttachment[]; parent_ticket_id?: Id | null; related_ticket_ids?: Id[]; blocked_by_ticket_ids?: Id[]; created_at: string; updated_at: string; node_instances: TicketNode[] }
export interface Project { id: Id; key: string; name: string; description: string; status: Status; owner_name: string; start_at?: string | null; target_at?: string | null; tags: string[]; note: string; ticket_count?: number; milestone_count?: number; progress?: number; health?: string; created_at: string; updated_at: string }
export interface Milestone { id: Id; project_id: Id; name: string; description: string; status: Status; target_at?: string | null; progress_mode: string; progress: number; review: string; created_at: string; updated_at: string }
export interface InboxItem { id: Id; title: string; note: string; status: Status; owner_name: string; due_at?: string | null; reminder_at?: string | null; ticket_id?: Id | null; created_at: string; updated_at: string }
export interface Schedule { id: Id; workflow_id: Id; name: string; schedule_type: Status; timezone: string; start_at: string; end_at?: string | null; weekday?: number | null; day_of_month?: number | null; cron_expression: string; title_template: string; note_template: string; project_id?: Id | null; milestone_id?: Id | null; enabled: boolean; next_run_at?: string | null; last_run_at?: string | null; last_run_status?: string | null; last_run_error?: string | null; run_count: number; created_at: string; updated_at: string }
export interface ScheduleRun { id: Id; schedule_id: Id; status: Status; planned_at: string; executed_at: string; ticket_id?: Id | null; error?: string | null }
export interface SavedView { id: Id; name: string; filters: Record<string, unknown>; favorite: boolean; is_default: boolean; updated_at: string }
export interface AutomationRule { id: Id; name: string; enabled: boolean; trigger: string; conditions: Record<string, unknown>; actions: Array<Record<string, unknown>>; created_at: string; updated_at: string }
export interface RelatedResource { id: Id; project_id?: Id | null; name: string; type: string; url?: string | null; description: string; attributes: Record<string, unknown>; ticket_ids: Id[]; milestone_ids: Id[]; updated_at: string }
export interface TimelineEvent { id: Id; type: string; title: string; detail?: string; ticket_id?: Id | null; node_id?: Id | null; project_id?: Id | null; milestone_id?: Id | null; created_at: string; actor_name: string }
export interface TimelineActivityDay { date: string; count: number; samples: string[] }
export interface TimelineActivity { total: number; days: TimelineActivityDay[] }
export interface Overview { todo: Ticket[]; in_progress: Ticket[]; today: Ticket[]; timeline: TimelineEvent[]; counts: Record<string, number>; inbox_count: number; project_counts: Record<string, number> }
export interface Settings { max_file_size_mb: number; temporary_resource_days: number; temporary_resource_access_count: number; notification_rules: Record<string, { enabled: boolean; level: string; channels: string[] }> }
export interface DryRunResult { version: number; nodes: Array<{ node_id: Id; name: string; status: string; completion_rule: Record<string, unknown> }>; actions_executed: boolean; explanation: string }

type Envelope<T> = { data: T };
type Query = Record<string, string | number | boolean | null | undefined>;

export function createWorkflowApi(client: ToolNestModuleApiClient, moduleId = "workflow-tickets-react") {
  const base = `/modules/${moduleId}`;
  const call = async <T>(request: Promise<Envelope<T> | T>): Promise<T> => { const value = await request; return value && typeof value === "object" && "data" in value ? (value as Envelope<T>).data : value as T; };
  return {
    getOverview: () => call(client.get<Envelope<Overview>>(`${base}/overview`)),
    getTimeline: (query: Query = {}) => call(client.get<Envelope<TimelineEvent[]>>(`${base}/timeline`, { params: query })),
    getTimelineActivity: (query: Query = {}) => call(client.get<Envelope<TimelineActivity>>(`${base}/timeline`, { params: { ...query, aggregate: "day" } })),
    listWorkflows: (keyword = "") => call(client.get<Envelope<Workflow[]>>(`${base}/workflows`, { params: keyword ? { keyword } : undefined })),
    getWorkflow: (id: string) => call(client.get<Envelope<Workflow>>(`${base}/workflows/${id}`)),
    createWorkflow: (payload: Record<string, unknown>) => call(client.post<Envelope<Workflow>>(`${base}/workflows`, payload)),
    updateWorkflow: (id: string, payload: Record<string, unknown>) => call(client.put<Envelope<Workflow>>(`${base}/workflows/${id}`, payload)),
    archiveWorkflow: (id: string) => call(client.post<Envelope<Workflow>>(`${base}/workflows/${id}/archive`)),
    createVersion: (id: string, payload: Record<string, unknown>) => call(client.post<Envelope<WorkflowVersion>>(`${base}/workflows/${id}/versions`, payload)),
    publishWorkflow: (id: string, payload: Record<string, unknown>) => call(client.post<Envelope<Workflow>>(`${base}/workflows/${id}/publish`, payload)),
    compareVersions: (id: string, baseVersionId: string, targetVersionId: string) => call(client.get<Envelope<Record<string, unknown>>>(`${base}/workflows/${id}/versions/compare`, { params: { base_version_id: baseVersionId, target_version_id: targetVersionId } })),
    dryRunWorkflow: (id: string, initialValues: Record<string, unknown>) => call(client.post<Envelope<DryRunResult>>(`${base}/workflows/${id}/dry-run`, { initial_values: initialValues })),
    listSchedules: (workflowId: string) => call(client.get<Envelope<Schedule[]>>(`${base}/workflows/${workflowId}/schedules`)),
    createSchedule: (workflowId: string, payload: Record<string, unknown>) => call(client.post<Envelope<Schedule>>(`${base}/workflows/${workflowId}/schedules`, payload)),
    updateSchedule: (workflowId: string, scheduleId: string, payload: Record<string, unknown>) => call(client.put<Envelope<Schedule>>(`${base}/workflows/${workflowId}/schedules/${scheduleId}`, payload)),
    deleteSchedule: (workflowId: string, scheduleId: string) => call(client.delete<Envelope<null>>(`${base}/workflows/${workflowId}/schedules/${scheduleId}`)),
    listScheduleRuns: (workflowId: string, scheduleId: string) => call(client.get<Envelope<ScheduleRun[]>>(`${base}/workflows/${workflowId}/schedules/${scheduleId}/runs`)),
    runScheduleNow: (workflowId: string, scheduleId: string) => call(client.post<Envelope<{ schedule: Schedule; run: ScheduleRun }>>(`${base}/workflows/${workflowId}/schedules/${scheduleId}/run`)),
    listTickets: (query: Query = {}) => call(client.get<Envelope<{ items: Ticket[]; total: number }>>(`${base}/tickets`, { params: query })),
    getTicket: (id: string) => call(client.get<Envelope<Ticket>>(`${base}/tickets/${id}`)),
    createTicket: (payload: Record<string, unknown>) => call(client.post<Envelope<Ticket>>(`${base}/tickets`, payload)),
    updateTicket: (id: string, payload: Record<string, unknown>) => call(client.put<Envelope<Ticket>>(`${base}/tickets/${id}`, payload)),
    deleteTicket: (id: string) => call(client.delete<Envelope<null>>(`${base}/tickets/${id}`)),
    duplicateTicket: (id: string, payload: Record<string, unknown> = {}) => call(client.post<Envelope<Ticket>>(`${base}/tickets/${id}/duplicate`, payload)),
    bulkUpdateTickets: (payload: Record<string, unknown>) => call(client.post<Envelope<Ticket[]>>(`${base}/tickets/bulk-update`, payload)),
    saveNode: (ticketId: string, nodeId: string, values: Record<string, unknown>) => call(client.post<Envelope<Ticket>>(`${base}/tickets/${ticketId}/nodes/${nodeId}/save`, { values })),
    completeNode: (ticketId: string, nodeId: string) => call(client.post<Envelope<Ticket>>(`${base}/tickets/${ticketId}/nodes/${nodeId}/complete`)),
    blockNode: (ticketId: string, nodeId: string, reason: string) => call(client.post<Envelope<Ticket>>(`${base}/tickets/${ticketId}/nodes/${nodeId}/block`, { reason })),
    rollbackNode: (ticketId: string, nodeId: string, targetNodeId: string, reason: string) => call(client.post<Envelope<Ticket>>(`${base}/tickets/${ticketId}/nodes/${nodeId}/rollback`, { target_node_id: targetNodeId, reason })),
    cancelTicket: (id: string, reason: string) => call(client.post<Envelope<Ticket>>(`${base}/tickets/${id}/cancel`, { reason })),
    reopenTicket: (id: string) => call(client.post<Envelope<Ticket>>(`${base}/tickets/${id}/reopen`)),
   getTicketDiagnostics: (id: string) => call(client.get<Envelope<Record<string, unknown>>>(`${base}/tickets/${id}/diagnostics`)),
    uploadAttachment: (ticketId: string, nodeId: string, payload: Record<string, unknown>) => call(client.post<Envelope<TicketAttachment>>(`${base}/tickets/${ticketId}/nodes/${nodeId}/attachments`, payload)),
    deleteAttachment: (attachmentId: string) => call(client.delete<Envelope<null>>(`${base}/attachments/${attachmentId}`)),
    listInboxItems: () => call(client.get<Envelope<InboxItem[]>>(`${base}/inbox`)),
    createInboxItem: (payload: Record<string, unknown>) => call(client.post<Envelope<InboxItem>>(`${base}/inbox`, payload)),
    convertInboxItem: (id: string, payload: Record<string, unknown>) => call(client.post<Envelope<Ticket>>(`${base}/inbox/${id}/convert`, payload)),
    archiveInboxItem: (id: string) => call(client.post<Envelope<InboxItem>>(`${base}/inbox/${id}/archive`)),
    setInboxItemCompleted: (id: string, completed: boolean) => call(client.post<Envelope<InboxItem>>(`${base}/inbox/${id}/complete`, { completed })),
    deleteInboxItem: (id: string) => call(client.delete<Envelope<null>>(`${base}/inbox/${id}`)),
    listProjects: () => call(client.get<Envelope<Project[]>>(`${base}/projects`)),
    getProject: (id: string) => call(client.get<Envelope<Project>>(`${base}/projects/${id}`)),
    createProject: (payload: Record<string, unknown>) => call(client.post<Envelope<Project>>(`${base}/projects`, payload)),
    updateProject: (id: string, payload: Record<string, unknown>) => call(client.put<Envelope<Project>>(`${base}/projects/${id}`, payload)),
    archiveProject: (id: string) => call(client.post<Envelope<Project>>(`${base}/projects/${id}/archive`)),
    getProjectAnalytics: (id: string) => call(client.get<Envelope<Record<string, unknown>>>(`${base}/projects/${id}/analytics`)),
    listMilestones: (projectId: string) => call(client.get<Envelope<Milestone[]>>(`${base}/projects/${projectId}/milestones`)),
    getMilestone: (projectId: string, milestoneId: string) => call(client.get<Envelope<Milestone>>(`${base}/projects/${projectId}/milestones/${milestoneId}`)),
    createMilestone: (projectId: string, payload: Record<string, unknown>) => call(client.post<Envelope<Milestone>>(`${base}/projects/${projectId}/milestones`, payload)),
    updateMilestone: (projectId: string, milestoneId: string, payload: Record<string, unknown>) => call(client.put<Envelope<Milestone>>(`${base}/projects/${projectId}/milestones/${milestoneId}`, payload)),
    deleteMilestone: (projectId: string, milestoneId: string) => call(client.delete<Envelope<null>>(`${base}/projects/${projectId}/milestones/${milestoneId}`)),
    listSavedViews: () => call(client.get<Envelope<SavedView[]>>(`${base}/saved-views`)),
    createSavedView: (payload: Record<string, unknown>) => call(client.post<Envelope<SavedView>>(`${base}/saved-views`, payload)),
    updateSavedView: (id: string, payload: Record<string, unknown>) => call(client.put<Envelope<SavedView>>(`${base}/saved-views/${id}`, payload)),
    deleteSavedView: (id: string) => call(client.delete<Envelope<null>>(`${base}/saved-views/${id}`)),
    listAutomations: () => call(client.get<Envelope<AutomationRule[]>>(`${base}/automations`)),
    createAutomation: (payload: Record<string, unknown>) => call(client.post<Envelope<AutomationRule>>(`${base}/automations`, payload)),
    updateAutomation: (id: string, payload: Record<string, unknown>) => call(client.put<Envelope<AutomationRule>>(`${base}/automations/${id}`, payload)),
    deleteAutomation: (id: string) => call(client.delete<Envelope<null>>(`${base}/automations/${id}`)),
    listResources: (query: Query = {}) => call(client.get<Envelope<RelatedResource[]>>(`${base}/resources`, { params: query })),
    createResource: (payload: Record<string, unknown>) => call(client.post<Envelope<RelatedResource>>(`${base}/resources`, payload)),
    updateResource: (id: string, payload: Record<string, unknown>) => call(client.put<Envelope<RelatedResource>>(`${base}/resources/${id}`, payload)),
    deleteResource: (id: string) => call(client.delete<Envelope<null>>(`${base}/resources/${id}`)),
    // `/settings` is reserved by the platform module-management API.
    getSettings: () => call(client.get<Envelope<Settings>>(`${base}/module-settings`)),
    updateSettings: (payload: Settings) => call(client.put<Envelope<Settings>>(`${base}/module-settings`, payload)),
    listActionProviders: () => call(client.get<Envelope<Array<Record<string, unknown>>>>(`${base}/action-providers`)),
    exportData: () => call(client.get<Envelope<Record<string, unknown>>>(`${base}/data/export`)),
    importData: (payload: Record<string, unknown>) => call(client.post<Envelope<Record<string, unknown>>>(`${base}/data/import`, payload)),
  };
}

export type WorkflowApi = ReturnType<typeof createWorkflowApi>;
