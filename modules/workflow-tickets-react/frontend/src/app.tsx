import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent, type ReactNode } from "react";
import type { ToolNestModuleRouteRenderProps } from "@toolnest/react-module-sdk";
import { RiAddLine, RiAlertLine, RiArrowDownLine, RiArrowLeftLine, RiArrowRightLine, RiArrowUpLine, RiCheckLine, RiCloseLine, RiDeleteBinLine, RiEditLine, RiFileCopyLine, RiFilterLine, RiGitBranchLine, RiHistoryLine, RiInformationLine, RiMore2Line, RiPlayLine, RiRefreshLine, RiSaveLine, RiSettings3Line } from "@remixicon/react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldDescription, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";

import { createWorkflowApi, type AutomationActionType, type AutomationExecution, type AutomationRule, type AutomationTrigger, type FormField, type Milestone, type NotificationChannel, type NotificationEvent, type NotificationLevel, type NotificationRule, type Overview, type Project, type RelatedResource, type SavedView, type Schedule, type Settings, type Ticket, type TimelineEvent, type Workflow, type WorkflowNode, type WorkflowVersion } from "./api";
import { getModuleApiClient } from "./api/client";
import { OverviewPage as RedesignedOverviewPage } from "./components/overview-page";
import { ScheduleCalendarContent } from "./components/schedule-calendar-page";
import { TicketDetailParityPage, TicketListParityPage } from "./components/ticket-pages";
import { WorkflowDesignerPage as WorkflowDesignerCanvasPage } from "./components/workflow-designer-page";
import { WorkflowVersionsParityPage } from "./components/workflow-versions-page";
import { MilestoneDetailPage, ProjectCreatePage, ProjectDetailPage, ProjectsPage } from "./components/project-pages";
import { TicketCreatePage as TicketCreateWorkbench } from "./components/ticket-create-page";
import { WorkflowListPage as WorkflowTemplatesPage } from "./components/workflow-list-page";
import { useModulePageMeta } from "./components/module-layout";

type Router = ToolNestModuleRouteRenderProps["router"];
type PageProps = ToolNestModuleRouteRenderProps & { api: ReturnType<typeof createWorkflowApi> };
const statusLabels: Record<string, string> = { draft: "草稿", published: "已发布", archived: "已归档", in_progress: "进行中", blocked: "阻塞", completed: "已完成", cancelled: "已终止", pending: "待安排", ready: "待执行", planning: "规划中", active: "进行中", enabled: "已启用", paused: "已暂停", converted: "已转换", success: "成功", succeeded: "成功", failed: "失败", skipped: "已跳过", normal: "正常", risk: "注意", overdue: "已逾期", disabled: "已停用" };

const eventLabels: Record<string, string> = { ticket_created: "工单创建", ticket_completed: "工单完成", ticket_cancelled: "工单终止", ticket_reopened: "工单重新打开", node_ready: "节点就绪", node_completed: "节点完成", ticket_blocked: "工单阻塞", ticket_reminder: "工单提醒", milestone_due: "里程碑到期", project_risk: "项目风险" };
const automationTriggerLabels: Record<AutomationTrigger, string> = { ticket_created: "工单创建", ticket_completed: "工单完成", ticket_cancelled: "工单终止", ticket_reopened: "工单重新打开", node_ready: "节点就绪", node_completed: "节点完成", node_blocked: "节点阻塞", ticket_reminder: "工单提醒" };
const automationActionLabels: Record<AutomationActionType, string> = { set_priority: "设置优先级", add_tag: "追加标签", set_project: "关联项目", set_milestone: "关联里程碑", set_due_at: "设置目标时间", archive: "归档工单" };
const automationActionGroups: Array<{ label: string; types: AutomationActionType[] }> = [{ label: "字段更新", types: ["set_priority", "add_tag"] }, { label: "关联管理", types: ["set_project", "set_milestone"] }, { label: "时间管理", types: ["set_due_at"] }, { label: "生命周期", types: ["archive"] }];
const notificationEvents: Array<{ value: NotificationEvent; label: string; description: string }> = [
  { value: "ticket_created", label: "工单创建", description: "创建新工单后发送通知。" },
  { value: "node_ready", label: "节点就绪", description: "节点满足前置条件并进入待处理状态。" },
  { value: "node_completed", label: "节点完成", description: "工单中的节点完成后发送通知。" },
  { value: "ticket_completed", label: "工单完成", description: "所有节点完成后发送通知。" },
  { value: "ticket_blocked", label: "工单阻塞", description: "节点被标记为阻塞后发送通知。" },
  { value: "ticket_reopened", label: "工单重新打开", description: "已终止或阻塞的工单恢复执行后发送通知。" },
  { value: "ticket_cancelled", label: "工单终止", description: "工单被终止后发送通知。" },
  { value: "ticket_reminder", label: "工单提醒", description: "到达工单提醒时间后发送通知。" },
  { value: "milestone_due", label: "里程碑到期", description: "里程碑到达目标时间后发送通知。" },
  { value: "project_risk", label: "项目风险", description: "项目出现阻塞工单或逾期里程碑后发送通知。" },
];
const notificationLevels: Array<{ value: NotificationLevel; label: string }> = [{ value: "info", label: "普通" }, { value: "success", label: "成功" }, { value: "warning", label: "提醒" }, { value: "error", label: "错误" }];
const notificationChannels: Array<{ value: NotificationChannel; label: string }> = [{ value: "web_internal", label: "站内通知" }, { value: "qqbot", label: "QQ Bot" }, { value: "email", label: "邮件" }, { value: "webhook", label: "Webhook" }];
const defaultNotificationRule: NotificationRule = { enabled: true, level: "info", channels: ["web_internal"] };
const priorityLabels: Record<string, string> = { none: "无优先级", low: "低", medium: "中", high: "高", urgent: "紧急" };
const fieldTypeLabels: Record<string, string> = { text: "单行文本", textarea: "多行文本", number: "数字", select: "下拉选择", radio: "单选", multiselect: "多选", switch: "开关", date: "日期", checklist: "清单", todo: "待办", markdown: "Markdown", json: "JSON", code: "代码", file: "文件", image: "图片", url: "链接", script: "脚本" };
function statusVariant(value: string): "default" | "secondary" | "outline" | "destructive" { return ["completed", "published", "success", "succeeded", "active", "enabled", "ready", "normal"].includes(value) ? "default" : ["blocked", "cancelled", "failed", "overdue", "urgent", "risk"].includes(value) ? "destructive" : ["draft", "pending", "planning", "in_progress"].includes(value) ? "outline" : "secondary"; }
function StatusBadge({ value }: { value: string }) { return <Badge variant={statusVariant(value)}>{(statusLabels[value] ?? value) || "未知"}</Badge>; }
function requiredParam(value: string | undefined, label: string): string { if (!value) throw new Error(`${label}参数缺失。`); return value; }
function decodePathPart(value: string): string { try { return decodeURIComponent(value); } catch { return value; } }
function formatDate(value?: string | null): string { return value ? new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "未设置"; }
function errorMessage(error: unknown, fallback: string): string { return error instanceof Error ? error.message : fallback; }
function countEntries(value: unknown): Array<[string, number]> { return value && typeof value === "object" ? Object.entries(value as Record<string, unknown>).map(([key, count]) => [key, Number(count) || 0]) : []; }
function PageFrame({ title, description, extra, children }: { title?: string; description?: string; extra?: ReactNode; children: ReactNode }) { const { setPageMeta } = useModulePageMeta(); useEffect(() => { if (!title) return; setPageMeta(description ? { title, description } : { title }); }, [description, setPageMeta, title]); return <section className="grid gap-5">{extra ? <div className="flex flex-wrap items-center justify-end gap-2">{extra}</div> : null}{children}</section>; }
function LoadingState() { return <div className="grid gap-3 rounded-lg border border-dashed p-6" aria-label="正在加载"><Skeleton className="h-5 w-2/5" /><Skeleton className="h-20 w-full" /><Skeleton className="h-20 w-full" /></div>; }
function EmptyState({ description, action }: { description: string; action?: ReactNode }) { return <Empty><EmptyHeader><EmptyTitle>暂无数据</EmptyTitle><EmptyDescription>{description}</EmptyDescription></EmptyHeader>{action ? <div className="flex justify-center">{action}</div> : null}</Empty>; }
function ErrorState({ message, retry }: { message: string; retry?: () => void }) { return <Alert variant="destructive"><AlertTitle>加载失败</AlertTitle><AlertDescription className="flex flex-wrap items-center gap-3">{message}{retry ? <Button size="sm" variant="outline" onClick={retry}>重试</Button> : null}</AlertDescription></Alert>; }
function TableContainer({ children }: { children: ReactNode }) { return <div className="w-full overflow-x-auto">{children}</div>; }
function ProgressLabel({ ticket }: { ticket: Ticket }) { const completed = ticket.node_instances.filter((node) => node.status === "completed").length; const value = ticket.node_instances.length ? Math.round(completed / ticket.node_instances.length * 100) : 0; return <div className="grid min-w-28 gap-1"><div className="flex justify-between gap-2 text-xs text-muted-foreground"><span>{completed}/{ticket.node_instances.length} 节点</span><span>{value}%</span></div><Progress value={value} aria-label={`工单进度 ${value}%`} /></div>; }
function TicketLink({ ticket, router }: { ticket: Ticket; router: Router }) { return <Button variant="link" className="h-auto min-w-0 justify-start p-0 text-left" onClick={() => void router.push(`/modules/workflow-tickets-react/tickets/${ticket.id}`)}>{ticket.title}</Button>; }
function ConfirmAction({ title, description, onConfirm, children, variant = "ghost", size = "icon-sm", ariaLabel }: { title: string; description: string; onConfirm: () => Promise<void>; children: ReactNode; variant?: "ghost" | "outline" | "destructive"; size?: "sm" | "icon-sm"; ariaLabel: string }) { const [open, setOpen] = useState(false); return <><Button size={size} variant={variant} aria-label={ariaLabel} onClick={() => setOpen(true)}>{children}</Button><AlertDialog open={open} onOpenChange={setOpen}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{title}</AlertDialogTitle><AlertDialogDescription>{description}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>取消</AlertDialogCancel><AlertDialogAction variant={variant === "destructive" ? "destructive" : "default"} onClick={() => void onConfirm().then(() => setOpen(false))}>确认</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog></>; }

function OverviewPage({ api, router }: PageProps) {
  const [data, setData] = useState<Overview>(); const [workflows, setWorkflows] = useState<Workflow[]>([]); const [keyword, setKeyword] = useState(""); const [loading, setLoading] = useState(true); const [error, setError] = useState("");
  const load = async () => { setLoading(true); setError(""); try { const [overview, nextWorkflows] = await Promise.all([api.getOverview(), api.listWorkflows()]); setData(overview); setWorkflows(nextWorkflows); } catch (err) { setError(errorMessage(err, "总览加载失败")); } finally { setLoading(false); } };
  useEffect(() => { void load(); }, []);
  const search = async (event: FormEvent) => { event.preventDefault(); if (!keyword.trim()) return; try { const result = await api.listTickets({ keyword: keyword.trim() }); if (result.items[0]) await router.push(`/modules/workflow-tickets-react/tickets/${result.items[0].id}`); else { const workflow = (await api.listWorkflows(keyword.trim()))[0]; if (workflow) await router.push(`/modules/workflow-tickets-react/workflows/${workflow.id}/designer`); } } catch (err) { setError(errorMessage(err, "搜索失败")); } };
  if (loading && !data) return <PageFrame title="总览"><LoadingState /></PageFrame>; if (error && !data) return <PageFrame title="总览"><ErrorState message={error} retry={() => void load()} /></PageFrame>; if (!data) return null;
  const metrics = [["待处理", data.todo.length, "tickets"], ["进行中", data.in_progress.length, "tickets"], ["今日关注", data.today.length, "tickets"], ["日程", data.schedule_item_count, "schedule"]] as const;
  return <PageFrame title="总览" description="从待办、项目和动态开始推进工作。" extra={<><form className="flex gap-2" onSubmit={search}><Input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="搜索工单或模板" aria-label="搜索工单或模板" /><Button variant="outline" type="submit">搜索</Button></form><Button variant="outline" onClick={() => void load()}><RiRefreshLine data-icon="inline-start" />刷新</Button></>}><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{metrics.map(([label, value]) => <Card key={label}><CardHeader><CardDescription>{label}</CardDescription><CardTitle className="text-3xl">{value}</CardTitle></CardHeader></Card>)}</div><div className="grid gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(22rem,0.85fr)]"><Card><CardHeader><CardTitle>进行中的工单</CardTitle><CardDescription>优先处理当前仍有活动节点的任务。</CardDescription></CardHeader><CardContent>{data.in_progress.length ? <div className="grid gap-3">{data.in_progress.map((ticket) => <div key={ticket.id} className="grid gap-2 rounded-md border p-3"><div className="flex flex-wrap items-center justify-between gap-2"><div className="flex min-w-0 items-center gap-2"><span className="font-mono text-xs text-muted-foreground">{ticket.number}</span><TicketLink ticket={ticket} router={router} /></div><StatusBadge value={ticket.status} /></div><ProgressLabel ticket={ticket} /></div>)}</div> : <EmptyState description="暂无进行中的工单。" action={<Button onClick={() => void router.push("/modules/workflow-tickets-react/tickets/new")}>新建工单</Button>} />}</CardContent></Card><Card><CardHeader><CardTitle>最近动态</CardTitle><CardDescription>记录工单和项目的重要变化。</CardDescription></CardHeader><CardContent>{data.timeline.length ? <div className="grid gap-3">{data.timeline.map((event) => <div key={event.id} className="grid gap-1 border-l-2 border-primary pl-3"><p className="text-sm font-medium">{event.title}</p><p className="text-xs text-muted-foreground">{event.detail || event.actor_name} · {formatDate(event.created_at)}</p></div>)}</div> : <EmptyState description="暂无动态。" />}</CardContent></Card></div><Card><CardHeader><CardTitle>工单模板</CardTitle><CardDescription>已发布模板可以直接创建工单，草稿模板可继续配置。</CardDescription></CardHeader><CardContent>{workflows.length ? <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{workflows.slice(0, 6).map((workflow) => <Button key={workflow.id} variant="outline" className="h-auto justify-between gap-3 px-3 py-3 text-left" onClick={() => void router.push(`/modules/workflow-tickets-react/workflows/${workflow.id}/designer`)}><span className="min-w-0"><span className="block truncate font-medium">{workflow.name}</span><span className="mt-1 block truncate text-xs text-muted-foreground">{workflow.description || "暂无描述"}</span></span><StatusBadge value={workflow.status} /></Button>)}</div> : <EmptyState description="暂无模板。" />}</CardContent></Card></PageFrame>;
}
function ScheduleCalendarPage({ api, router, query }: PageProps) {
  return <PageFrame title="日程" description="按日期查看和安排事项，并在需要时转换为工单。"><ScheduleCalendarContent api={api} router={router} quick={query.quick === "1"} /></PageFrame>;
}


function TicketTable({ tickets, router, selectable = false, selected = [], setSelected }: { tickets: Ticket[]; router: Router; selectable?: boolean; selected?: string[]; setSelected?: (ids: string[]) => void }) { return tickets.length ? <TableContainer><Table><TableHeader><TableRow>{selectable ? <TableHead className="w-10" /> : null}<TableHead className="w-80">工单</TableHead><TableHead className="w-28">状态</TableHead><TableHead className="w-28">优先级</TableHead><TableHead className="w-44">进度</TableHead><TableHead className="w-40">更新时间</TableHead></TableRow></TableHeader><TableBody>{tickets.map((ticket) => <TableRow key={ticket.id}>{selectable ? <TableCell><Checkbox checked={selected.includes(ticket.id)} onCheckedChange={(checked) => setSelected?.(checked ? [...selected, ticket.id] : selected.filter((id) => id !== ticket.id))} aria-label={`选择${ticket.title}`} /></TableCell> : null}<TableCell><div className="grid gap-1"><TicketLink ticket={ticket} router={router} /><span className="font-mono text-xs text-muted-foreground">{ticket.number}</span></div></TableCell><TableCell><StatusBadge value={ticket.status} /></TableCell><TableCell>{priorityLabels[ticket.priority] ?? ticket.priority}</TableCell><TableCell><ProgressLabel ticket={ticket} /></TableCell><TableCell className="text-xs text-muted-foreground">{formatDate(ticket.updated_at)}</TableCell></TableRow>)}</TableBody></Table></TableContainer> : <EmptyState description="暂无符合条件的工单。" />; }
function TicketListPage({ api, router }: PageProps) { const [tickets, setTickets] = useState<Ticket[]>([]); const [projects, setProjects] = useState<Project[]>([]); const [keyword, setKeyword] = useState(""); const [status, setStatus] = useState(""); const [projectId, setProjectId] = useState(""); const [selected, setSelected] = useState<string[]>([]); const [loading, setLoading] = useState(true); const [error, setError] = useState(""); const load = async () => { try { setLoading(true); const [result, nextProjects] = await Promise.all([api.listTickets({ keyword, status, project_id: projectId }), api.listProjects()]); setTickets(result.items); setProjects(nextProjects); setSelected([]); } catch (err) { setError(errorMessage(err, "工单加载失败")); } finally { setLoading(false); } }; useEffect(() => { void load(); }, [status, projectId]); const submit = (event: FormEvent) => { event.preventDefault(); void load(); }; const bulkTag = async () => { if (selected.length) { await api.bulkUpdateTickets({ ticket_ids: selected, add_tags: ["批量处理"] }); await load(); } }; return <PageFrame title="工单" description="查询、筛选并推进所有运行中的工单。" extra={<Button onClick={() => void router.push("/modules/workflow-tickets-react/tickets/new")}><RiAddLine data-icon="inline-start" />新建工单</Button>}><Card><CardContent className="pt-5"><form className="flex flex-col gap-3 md:flex-row" onSubmit={submit}><Input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="搜索编号、标题或备注" aria-label="搜索工单" /><Select value={status} onValueChange={(value) => setStatus(value ?? "")}><SelectTrigger className="w-full md:w-40"><SelectValue placeholder="全部状态" /></SelectTrigger><SelectContent><SelectGroup><SelectLabel>工单状态</SelectLabel>{["in_progress", "blocked", "completed", "cancelled"].map((value) => <SelectItem key={value} value={value}>{statusLabels[value]}</SelectItem>)}</SelectGroup></SelectContent></Select><Select value={projectId} onValueChange={(value) => setProjectId(value ?? "")}><SelectTrigger className="w-full md:w-48"><SelectValue placeholder="全部项目" /></SelectTrigger><SelectContent><SelectGroup><SelectLabel>项目</SelectLabel>{projects.map((project) => <SelectItem key={project.id} value={project.id}>{project.name}</SelectItem>)}</SelectGroup></SelectContent></Select><Button variant="outline" type="submit"><RiFilterLine data-icon="inline-start" />应用筛选</Button></form></CardContent></Card>{selected.length ? <Alert><AlertDescription className="flex flex-wrap items-center gap-3">已选择 {selected.length} 条工单。<Button size="sm" onClick={() => void bulkTag()}>批量添加标签</Button></AlertDescription></Alert> : null}{error ? <ErrorState message={error} retry={() => void load()} /> : null}<Card><CardHeader><CardTitle>工单列表</CardTitle><CardDescription>点击工单进入节点运行面板。</CardDescription></CardHeader><CardContent>{loading ? <LoadingState /> : <TicketTable tickets={tickets} router={router} selectable selected={selected} setSelected={setSelected} />}</CardContent></Card></PageFrame>; }

function TicketListPageEnhanced({ api, router, query }: PageProps) {
  type Filters = { keyword: string; status: string; view: string; project_id: string; priority: string; tag: string };
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [savedViews, setSavedViews] = useState<SavedView[]>([]);
  const [keyword, setKeyword] = useState(query.keyword || "");
  const [status, setStatus] = useState(query.status || "");
  const [view, setView] = useState(query.view || "");
  const [projectId, setProjectId] = useState(query.project_id || "");
  const [priority, setPriority] = useState(query.priority || "");
  const [tag, setTag] = useState(query.tag || "");
  const [savedViewId, setSavedViewId] = useState("");
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkProject, setBulkProject] = useState("__unchanged__");
  const [bulkPriority, setBulkPriority] = useState("__unchanged__");
  const [bulkTags, setBulkTags] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const filters = (): Filters => ({ keyword, status, view, project_id: projectId, priority, tag });
  const load = async (overrides: Partial<Filters> = {}) => {
    const next = { ...filters(), ...overrides };
    try { setLoading(true); setError(""); const result = await api.listTickets(next); setTickets(result.items); setSelected([]); } catch (err) { setError(errorMessage(err, "工单加载失败")); } finally { setLoading(false); }
  };
  useEffect(() => { void Promise.all([api.listProjects(), api.listSavedViews()]).then(async ([nextProjects, nextViews]) => { setProjects(nextProjects); setSavedViews(nextViews); const defaultView = nextViews.find((item) => item.is_default); if (!Object.keys(query).length && defaultView) { const saved = defaultView.filters as Partial<Filters>; setKeyword(String(saved.keyword || "")); setStatus(String(saved.status || "")); setView(String(saved.view || "")); setProjectId(String(saved.project_id || "")); setPriority(String(saved.priority || "")); setTag(String(saved.tag || "")); await load(saved); } else await load(); }).catch((err) => setError(errorMessage(err, "工单列表加载失败"))); }, []);
  const selectTab = (nextView: string, nextStatus = "") => { setView(nextView); setStatus(nextStatus); void load({ view: nextView, status: nextStatus }); };
  const applySaved = (id: string) => { const saved = savedViews.find((item) => item.id === id); if (!saved) return; const next = saved.filters as Partial<Filters>; setSavedViewId(id); setKeyword(String(next.keyword || "")); setStatus(String(next.status || "")); setView(String(next.view || "")); setProjectId(String(next.project_id || "")); setPriority(String(next.priority || "")); setTag(String(next.tag || "")); void load(next); };
  const saveCurrentView = async () => { if (!saveName.trim()) return; try { const saved = await api.createSavedView({ name: saveName.trim(), filters: filters(), favorite: false, is_default: false }); setSavedViews((current) => [saved, ...current]); setSaveName(""); setSaveOpen(false); setSavedViewId(saved.id); } catch (err) { setError(errorMessage(err, "保存视图失败")); } };
  const bulkUpdate = async () => { if (!selected.length) return; try { await api.bulkUpdateTickets({ ticket_ids: selected, ...(bulkProject !== "__unchanged__" ? { project_id: bulkProject || null } : {}), ...(bulkPriority !== "__unchanged__" ? { priority: bulkPriority || null } : {}), add_tags: bulkTags.split(",").map((item) => item.trim()).filter(Boolean) }); setBulkOpen(false); setBulkTags(""); await load(); } catch (err) { setError(errorMessage(err, "批量更新失败")); } };
  return <PageFrame title="工单" description="查询、筛选并推进所有运行中的工单。" extra={<Button onClick={() => void router.push("/modules/workflow-tickets-react/tickets/new")}><RiAddLine data-icon="inline-start" />新建工单</Button>}><Card><CardContent className="grid gap-4 pt-5"><div className="flex flex-wrap gap-2" role="tablist" aria-label="工单视图"><Button size="sm" variant={!status && !view ? "default" : "outline"} onClick={() => selectTab("")}>全部</Button><Button size="sm" variant={view === "today" ? "default" : "outline"} onClick={() => selectTab("today")}>今日</Button><Button size="sm" variant={view === "mine" ? "default" : "outline"} onClick={() => selectTab("mine")}>待我处理</Button><Button size="sm" variant={status === "completed" ? "default" : "outline"} onClick={() => selectTab("", "completed")}>已完成</Button><Button size="sm" variant={status === "cancelled" ? "default" : "outline"} onClick={() => selectTab("", "cancelled")}>已终止</Button></div><form className="grid gap-3 lg:grid-cols-[minmax(16rem,1fr)_12rem_12rem_10rem_auto]" onSubmit={(event) => { event.preventDefault(); void load(); }}><Input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="搜索编号、标题或备注" aria-label="搜索工单" /><Select value={status} onValueChange={(value) => { const next = value ?? ""; setStatus(next); void load({ status: next }); }}><SelectTrigger><SelectValue placeholder="全部状态" /></SelectTrigger><SelectContent><SelectGroup><SelectLabel>工单状态</SelectLabel>{["in_progress", "blocked", "completed", "cancelled"].map((value) => <SelectItem key={value} value={value}>{statusLabels[value]}</SelectItem>)}</SelectGroup></SelectContent></Select><Select value={projectId} onValueChange={(value) => { const next = value ?? ""; setProjectId(next); void load({ project_id: next }); }}><SelectTrigger><SelectValue placeholder="全部项目" /></SelectTrigger><SelectContent><SelectGroup><SelectLabel>项目</SelectLabel>{projects.map((project) => <SelectItem key={project.id} value={project.id}>{project.name}</SelectItem>)}</SelectGroup></SelectContent></Select><Select value={priority} onValueChange={(value) => { const next = value ?? ""; setPriority(next); void load({ priority: next }); }}><SelectTrigger><SelectValue placeholder="全部优先级" /></SelectTrigger><SelectContent><SelectGroup><SelectLabel>优先级</SelectLabel>{Object.entries(priorityLabels).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectGroup></SelectContent></Select><Button variant="outline" type="submit"><RiFilterLine data-icon="inline-start" />应用筛选</Button></form><div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(14rem,0.5fr)_auto]"><Input value={tag} onChange={(event) => setTag(event.target.value)} placeholder="按标签筛选" aria-label="按标签筛选" /><Select value={savedViewId} onValueChange={(value) => applySaved(value ?? "")}><SelectTrigger><SelectValue placeholder="选择保存的视图" /></SelectTrigger><SelectContent><SelectGroup><SelectLabel>保存的视图</SelectLabel>{savedViews.map((saved) => <SelectItem key={saved.id} value={saved.id}>{saved.name}</SelectItem>)}</SelectGroup></SelectContent></Select><Button variant="outline" onClick={() => setSaveOpen(true)}>保存当前视图</Button></div></CardContent></Card>{selected.length ? <Alert><AlertDescription className="flex flex-wrap items-center gap-3">已选择 {selected.length} 条工单。<Button size="sm" onClick={() => setBulkOpen(true)}>批量修改</Button><Button size="sm" variant="ghost" onClick={() => setSelected([])}>取消选择</Button></AlertDescription></Alert> : null}{error ? <ErrorState message={error} retry={() => void load()} /> : null}<Card><CardHeader><CardTitle>工单列表</CardTitle><CardDescription>点击工单进入节点运行面板。</CardDescription></CardHeader><CardContent>{loading ? <LoadingState /> : <TicketTable tickets={tickets} router={router} selectable selected={selected} setSelected={setSelected} />}</CardContent></Card><Dialog open={saveOpen} onOpenChange={setSaveOpen}><DialogContent><DialogHeader><DialogTitle>保存当前视图</DialogTitle><DialogDescription>保存搜索、状态、项目、优先级和标签条件。</DialogDescription></DialogHeader><Field><FieldLabel>视图名称</FieldLabel><Input value={saveName} onChange={(event) => setSaveName(event.target.value)} placeholder="例如：高优先级发布工单" /></Field><DialogFooter><Button variant="outline" onClick={() => setSaveOpen(false)}>取消</Button><Button onClick={() => void saveCurrentView()}>保存</Button></DialogFooter></DialogContent></Dialog><Dialog open={bulkOpen} onOpenChange={setBulkOpen}><DialogContent><DialogHeader><DialogTitle>批量修改工单</DialogTitle><DialogDescription>未选择的字段保持原值。</DialogDescription></DialogHeader><FieldGroup><Field><FieldLabel>项目</FieldLabel><Select value={bulkProject} onValueChange={(value) => setBulkProject(value ?? "__unchanged__")}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectGroup><SelectLabel>项目</SelectLabel><SelectItem value="__unchanged__">保持不变</SelectItem><SelectItem value="">取消项目</SelectItem>{projects.map((project) => <SelectItem key={project.id} value={project.id}>{project.name}</SelectItem>)}</SelectGroup></SelectContent></Select></Field><Field><FieldLabel>优先级</FieldLabel><Select value={bulkPriority} onValueChange={(value) => setBulkPriority(value ?? "__unchanged__")}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectGroup><SelectLabel>优先级</SelectLabel><SelectItem value="__unchanged__">保持不变</SelectItem><SelectItem value="none">无优先级</SelectItem>{Object.entries(priorityLabels).filter(([value]) => value !== "none").map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectGroup></SelectContent></Select></Field><Field><FieldLabel>追加标签</FieldLabel><Input value={bulkTags} onChange={(event) => setBulkTags(event.target.value)} placeholder="多个标签用逗号分隔" /></Field></FieldGroup><DialogFooter><Button variant="outline" onClick={() => setBulkOpen(false)}>取消</Button><Button onClick={() => void bulkUpdate()}>更新 {selected.length} 条</Button></DialogFooter></DialogContent></Dialog></PageFrame>;
}

function TicketCreatePage({ api, router, query }: PageProps) { const [workflows, setWorkflows] = useState<Workflow[]>([]); const [projects, setProjects] = useState<Project[]>([]); const [title, setTitle] = useState(""); const [note, setNote] = useState(""); const [workflowId, setWorkflowId] = useState(""); const [projectId, setProjectId] = useState(query.project_id || ""); const [priority, setPriority] = useState(""); const [saving, setSaving] = useState(false); const [error, setError] = useState(""); useEffect(() => { void Promise.all([api.listWorkflows(), api.listProjects()]).then(([nextWorkflows, nextProjects]) => { setWorkflows(nextWorkflows.filter((workflow) => workflow.status === "published")); setProjects(nextProjects); }).catch((err) => setError(errorMessage(err, "创建表单加载失败"))); }, []); const save = async (event: FormEvent) => { event.preventDefault(); if (!title.trim() || !workflowId) { setError("请填写标题并选择已发布模板。"); return; } try { setSaving(true); const ticket = await api.createTicket({ title, note, workflow_id: workflowId, project_id: projectId || null, priority: priority || "none" }); await router.push(`/modules/workflow-tickets-react/tickets/${ticket.id}`); } catch (err) { setError(errorMessage(err, "创建工单失败")); } finally { setSaving(false); } }; return <PageFrame title="新建工单" description="基于已发布模板创建一个新的运行实例。"><Card><CardContent className="pt-5"><form className="grid gap-5" onSubmit={save}><FieldGroup><Field><FieldLabel htmlFor="ticket-title">标题</FieldLabel><Input id="ticket-title" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="例如：准备本周发布" required /></Field><Field><FieldLabel htmlFor="ticket-note">备注</FieldLabel><Textarea id="ticket-note" value={note} onChange={(event) => setNote(event.target.value)} placeholder="记录背景、约束或交付要求" /></Field><Field><FieldLabel>工作流模板</FieldLabel><Select value={workflowId} onValueChange={(value) => setWorkflowId(value ?? "")}><SelectTrigger><SelectValue placeholder="选择已发布模板" /></SelectTrigger><SelectContent><SelectGroup><SelectLabel>已发布模板</SelectLabel>{workflows.map((workflow) => <SelectItem key={workflow.id} value={workflow.id}>{workflow.name}</SelectItem>)}</SelectGroup></SelectContent></Select></Field><Field><FieldLabel>项目</FieldLabel><Select value={projectId} onValueChange={(value) => setProjectId(value ?? "")}><SelectTrigger><SelectValue placeholder="不关联项目" /></SelectTrigger><SelectContent><SelectGroup><SelectLabel>项目</SelectLabel>{projects.map((project) => <SelectItem key={project.id} value={project.id}>{project.name}</SelectItem>)}</SelectGroup></SelectContent></Select></Field><Field><FieldLabel>优先级</FieldLabel><Select value={priority} onValueChange={(value) => setPriority(value ?? "")}><SelectTrigger><SelectValue placeholder="无优先级" /></SelectTrigger><SelectContent><SelectGroup><SelectLabel>优先级</SelectLabel>{Object.entries(priorityLabels).filter(([value]) => value !== "none").map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectGroup></SelectContent></Select></Field></FieldGroup>{error ? <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert> : null}<div className="flex flex-wrap justify-end gap-2"><Button type="button" variant="outline" onClick={() => void router.back?.()}>取消</Button><Button type="submit" disabled={saving}>{saving ? "创建中…" : "创建工单"}</Button></div></form></CardContent></Card></PageFrame>; }

function NodeForm({ definition, values, setValues, readOnly }: { definition: WorkflowNode; values: Record<string, unknown>; setValues: (values: Record<string, unknown>) => void; readOnly: boolean }) { return <FieldGroup>{definition.form_schema.fields.map((field) => { const value = values[field.id]; const set = (next: unknown) => setValues({ ...values, [field.id]: next }); if (["textarea", "markdown", "code", "json"].includes(field.type)) return <Field key={field.id}><FieldLabel htmlFor={`field-${field.id}`}>{field.label}{field.required ? " *" : ""}</FieldLabel><Textarea id={`field-${field.id}`} value={typeof value === "string" ? value : value == null ? "" : JSON.stringify(value)} onChange={(event) => set(event.target.value)} placeholder={field.placeholder} disabled={readOnly} /><FieldDescription>{field.description}</FieldDescription></Field>; if (field.type === "switch") return <Field key={field.id} orientation="horizontal"><FieldLabel htmlFor={`field-${field.id}`}>{field.label}</FieldLabel><Switch id={`field-${field.id}`} checked={value === true} onCheckedChange={set} disabled={readOnly} /></Field>; if (["select", "radio"].includes(field.type)) return <Field key={field.id}><FieldLabel>{field.label}{field.required ? " *" : ""}</FieldLabel><Select value={value == null ? "" : String(value)} onValueChange={(next) => set(next)} disabled={readOnly}><SelectTrigger><SelectValue placeholder={field.placeholder || "请选择"} /></SelectTrigger><SelectContent><SelectGroup><SelectLabel>{field.label}</SelectLabel>{(field.options ?? []).map((option) => <SelectItem key={String(option.value)} value={String(option.value)}>{option.label}</SelectItem>)}</SelectGroup></SelectContent></Select></Field>; return <Field key={field.id}><FieldLabel htmlFor={`field-${field.id}`}>{field.label}{field.required ? " *" : ""}</FieldLabel><Input id={`field-${field.id}`} type={field.type === "number" ? "number" : field.type === "date" ? "date" : field.type === "url" ? "url" : "text"} value={typeof value === "string" || typeof value === "number" ? value : ""} onChange={(event) => set(field.type === "number" ? Number(event.target.value) : event.target.value)} placeholder={field.placeholder} disabled={readOnly} /><FieldDescription>{field.description}</FieldDescription></Field>; })}</FieldGroup>; }

function TicketDetailPage({ api, router, params }: PageProps) { const [ticket, setTicket] = useState<Ticket>(); const [workflow, setWorkflow] = useState<Workflow>(); const [timeline, setTimeline] = useState<TimelineEvent[]>([]); const [values, setValues] = useState<Record<string, unknown>>({}); const [selectedNodeId, setSelectedNodeId] = useState(""); const [blockOpen, setBlockOpen] = useState(false); const [blockReason, setBlockReason] = useState(""); const [cancelOpen, setCancelOpen] = useState(false); const [rollbackOpen, setRollbackOpen] = useState(false); const [deleteOpen, setDeleteOpen] = useState(false); const [diagnostics, setDiagnostics] = useState<Record<string, unknown>>(); const [error, setError] = useState(""); const ticketId = requiredParam(params.id || params.ticketId, "工单"); const load = async () => { try { const next = await api.getTicket(ticketId); const [nextWorkflow, nextTimeline] = await Promise.all([api.getWorkflow(next.workflow_id), api.getTimeline({ ticket_id: next.id })]); setTicket(next); setWorkflow(nextWorkflow); setTimeline(nextTimeline); const active = next.node_instances.find((node) => ["ready", "in_progress", "blocked"].includes(node.status)); const chosen = next.node_instances.find((node) => node.id === selectedNodeId) ?? active ?? next.node_instances[0]; setSelectedNodeId(chosen?.id ?? ""); setValues(chosen?.values ?? {}); } catch (err) { setError(errorMessage(err, "工单详情加载失败")); } }; useEffect(() => { void load(); }, [ticketId]); const node = ticket?.node_instances.find((item) => item.id === selectedNodeId); const definition = workflow?.versions.flatMap((version) => version.nodes).find((item) => item.id === node?.node_id); const save = async () => { if (!ticket || !node) return; try { const next = await api.saveNode(ticket.id, node.id, values); setTicket(next); await load(); } catch (err) { setError(errorMessage(err, "保存节点失败")); } }; const complete = async () => { if (!ticket || !node) return; try { await api.saveNode(ticket.id, node.id, values); await api.completeNode(ticket.id, node.id); await load(); } catch (err) { setError(errorMessage(err, "完成条件尚未满足")); } }; const cancel = async () => { if (!ticket) return; await api.cancelTicket(ticket.id, "用户终止工单"); setCancelOpen(false); await load(); }; const rollback = async () => { if (!ticket || !node) return; const target = ticket.node_instances.find((item) => item.status === "completed" && item.id !== node.id); if (!target) { setError("没有可回退的已完成前序节点。"); return; } await api.rollbackNode(ticket.id, node.id, target.node_id, "需要重新执行"); setRollbackOpen(false); await load(); }; const remove = async () => { if (!ticket) return; await api.deleteTicket(ticket.id); setDeleteOpen(false); await router.push("/modules/workflow-tickets-react/tickets"); }; if (error && !ticket) return <PageFrame title="工单详情"><ErrorState message={error} retry={() => void load()} /></PageFrame>; if (!ticket || !workflow) return <PageFrame title="工单详情"><LoadingState /></PageFrame>; return <PageFrame title={ticket.title} description={`${ticket.number} · ${ticket.workflow_name}`} extra={<><StatusBadge value={ticket.status} /><Button variant="outline" onClick={async () => { const copy = await api.duplicateTicket(ticket.id); await router.push(`/modules/workflow-tickets-react/tickets/${copy.id}`); }}><RiFileCopyLine data-icon="inline-start" />复制</Button><Button variant="destructive" onClick={() => setCancelOpen(true)} disabled={["completed", "cancelled"].includes(ticket.status)}>终止</Button>{ticket.status === "cancelled" ? <Button variant="outline" onClick={async () => { await api.reopenTicket(ticket.id); await load(); }}>重新打开</Button> : null}<Button variant="outline" onClick={() => setRollbackOpen(true)} disabled={!node || !ticket.node_instances.some((item) => item.status === "completed" && item.id !== node.id)}>回退</Button><Button variant="ghost" onClick={() => setDeleteOpen(true)}>删除</Button></>}><div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(18rem,0.4fr)]"><div className="grid gap-5"><Card><CardHeader><CardTitle>流程节点</CardTitle><CardDescription>选择当前节点或查看已经完成的节点。</CardDescription></CardHeader><CardContent className="grid gap-2">{ticket.node_instances.map((item) => <Button key={item.id} variant={item.id === selectedNodeId ? "default" : "outline"} className="h-auto justify-between gap-3 px-3 py-3 text-left" onClick={() => { setSelectedNodeId(item.id); setValues(item.values); }}><span className="flex min-w-0 items-center gap-2"><RiGitBranchLine className="shrink-0" /><span className="truncate">{item.name}</span></span><StatusBadge value={item.status} /></Button>)}</CardContent></Card>{node && definition && <Card><CardHeader><CardTitle>{node.name}</CardTitle><CardDescription>{definition.description || "填写节点表单并满足完成条件。"}</CardDescription></CardHeader><CardContent><NodeForm definition={definition} values={values} setValues={setValues} readOnly={node.status === "completed" || node.status === "cancelled"} /></CardContent><CardFooter className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => void save()} disabled={node.status === "completed" || node.status === "cancelled"}><RiSaveLine data-icon="inline-start" />保存草稿</Button><Button onClick={() => void complete()} disabled={node.status === "completed" || node.status === "cancelled"}><RiCheckLine data-icon="inline-start" />完成节点</Button><Button variant="outline" onClick={() => setBlockOpen(true)} disabled={node.status === "completed" || node.status === "cancelled"}>标记阻塞</Button></CardFooter></Card>}</div><div className="grid content-start gap-5"><Card><CardHeader><CardTitle>工单信息</CardTitle></CardHeader><CardContent className="grid gap-3 text-sm"><div className="flex justify-between gap-3"><span className="text-muted-foreground">优先级</span><span>{priorityLabels[ticket.priority] ?? ticket.priority}</span></div><div className="flex justify-between gap-3"><span className="text-muted-foreground">负责人</span><span>{ticket.owner_name || "未分配"}</span></div><div className="flex justify-between gap-3"><span className="text-muted-foreground">截止时间</span><span>{formatDate(ticket.due_at)}</span></div><Separator /><ProgressLabel ticket={ticket} /></CardContent></Card><Card><CardHeader><CardTitle>时间线</CardTitle></CardHeader><CardContent className="grid gap-3">{timeline.length ? timeline.slice(0, 10).map((event) => <div key={event.id} className="border-l-2 border-primary pl-3"><p className="text-sm font-medium">{event.title}</p><p className="text-xs text-muted-foreground">{formatDate(event.created_at)}</p></div>) : <EmptyState description="暂无动态。" />}</CardContent></Card>{node && definition && definition.form_schema.fields.find((field) => ["file", "image"].includes(field.type))?.id ? <AttachmentList api={api} ticket={ticket} nodeId={node.id} fieldId={definition.form_schema.fields.find((field) => ["file", "image"].includes(field.type))?.id ?? ""} reload={load} readOnly={node.status === "completed" || node.status === "cancelled"} /> : null}<Button variant="outline" onClick={async () => setDiagnostics(await api.getTicketDiagnostics(ticket.id))}><RiInformationLine data-icon="inline-start" />查看运行诊断</Button>{diagnostics ? <Card><CardHeader><CardTitle>运行诊断</CardTitle></CardHeader><CardContent><pre className="max-h-80 overflow-auto text-xs leading-5">{JSON.stringify(diagnostics, null, 2)}</pre></CardContent></Card> : null}</div></div><Dialog open={blockOpen} onOpenChange={setBlockOpen}><DialogContent><DialogHeader><DialogTitle>标记节点阻塞</DialogTitle><DialogDescription>记录阻塞原因，工单会进入阻塞状态。</DialogDescription></DialogHeader><Field><FieldLabel>阻塞原因</FieldLabel><Textarea value={blockReason} onChange={(event) => setBlockReason(event.target.value)} /></Field><DialogFooter><Button variant="outline" onClick={() => setBlockOpen(false)}>取消</Button><Button onClick={async () => { if (node) { await api.blockNode(ticket.id, node.id, blockReason); setBlockOpen(false); await load(); } }}>确认阻塞</Button></DialogFooter></DialogContent></Dialog><AlertDialog open={rollbackOpen} onOpenChange={setRollbackOpen}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>回退当前节点？</AlertDialogTitle><AlertDialogDescription>当前节点及其下游会重置，目标节点的已保存值会保留。</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>取消</AlertDialogCancel><AlertDialogAction onClick={() => void rollback()}>确认回退</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog><AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>删除这张工单？</AlertDialogTitle><AlertDialogDescription>工单、时间线、附件和临时执行资源都会被删除。</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>取消</AlertDialogCancel><AlertDialogAction variant="destructive" onClick={() => void remove()}>确认删除</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog><AlertDialog open={cancelOpen} onOpenChange={setCancelOpen}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>终止这张工单？</AlertDialogTitle><AlertDialogDescription>未完成节点会被取消，临时执行资源会被撤销。</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>保留工单</AlertDialogCancel><AlertDialogAction variant="destructive" onClick={() => void cancel()}>确认终止</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog></PageFrame>; }

function WorkflowListPage({ api, router }: PageProps) { return <WorkflowTemplatesPage api={api} router={router} />; }
function WorkflowFormPage({ api, router }: PageProps) { const [name, setName] = useState(""); const [description, setDescription] = useState(""); const [groupName, setGroupName] = useState(""); const [error, setError] = useState(""); const save = async (event: FormEvent) => { event.preventDefault(); try { const workflow = await api.createWorkflow({ name, description, group_name: groupName || null }); await router.push(`/modules/workflow-tickets-react/workflows/${workflow.id}/designer`); } catch (err) { setError(errorMessage(err, "创建模板失败")); } }; return <PageFrame title="新建工单模板" description="先定义基本信息，再配置节点和连接关系。"><Card><CardContent className="pt-5"><form className="grid gap-5" onSubmit={save}><FieldGroup><Field><FieldLabel>模板名称</FieldLabel><Input value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：发布流程" required /></Field><Field><FieldLabel>描述</FieldLabel><Textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="说明模板适合解决什么问题" /></Field><Field><FieldLabel>模板分组</FieldLabel><Input value={groupName} onChange={(event) => setGroupName(event.target.value)} placeholder="例如：研发" /></Field></FieldGroup>{error ? <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert> : null}<div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={() => void router.back?.()}>取消</Button><Button type="submit">创建并配置</Button></div></form></CardContent></Card></PageFrame>; }

function WorkflowDesignerPage({ api, router, params, query }: PageProps) { const workflowId = requiredParam(params.id || params.workflowId, "工作流"); const [workflow, setWorkflow] = useState<Workflow>(); const [versionId, setVersionId] = useState(query.versionId || ""); const [selectedId, setSelectedId] = useState(""); const [saving, setSaving] = useState(false); const [metaOpen, setMetaOpen] = useState(false); const [nodeName, setNodeName] = useState(""); const [error, setError] = useState(""); const load = async () => { try { const next = await api.getWorkflow(workflowId); setWorkflow(next); const version = next.versions.find((item) => item.id === (versionId || next.current_version_id)) ?? next.versions.at(-1); setVersionId(version?.id ?? ""); setSelectedId((current) => current || version?.nodes[0]?.id || ""); } catch (err) { setError(errorMessage(err, "设计器加载失败")); } }; useEffect(() => { void load(); }, [workflowId]); const version = workflow?.versions.find((item) => item.id === versionId); const selected = version?.nodes.find((node) => node.id === selectedId); const updateSelected = async (next: WorkflowNode) => { if (!workflow || !version || version.status !== "draft") return; const nodes = version.nodes.map((node) => node.id === next.id ? next : node); try { setSaving(true); const updated = await api.updateWorkflow(workflow.id, { version_id: version.id, nodes, edges: version.edges }); setWorkflow(updated); } catch (err) { setError(errorMessage(err, "保存节点失败")); } finally { setSaving(false); } }; const addNode = async () => { if (!workflow || !version || version.status !== "draft") return; const next: WorkflowNode = { id: crypto.randomUUID(), name: `新节点 ${version.nodes.length + 1}`, key: `node-${version.nodes.length + 1}`, description: "", node_type: "general", position: { x: version.nodes.length * 220, y: 100 }, form_schema: { fields: [] }, completion_rule: { type: "group", operator: "AND", children: [] }, actions: [], inputs: [], outputs: [] }; const updated = await api.updateWorkflow(workflow.id, { version_id: version.id, nodes: [...version.nodes, next], edges: version.edges }); setWorkflow(updated); setSelectedId(next.id); }; const publish = async () => { if (!workflow || !version) return; try { await api.publishWorkflow(workflow.id, { version_id: version.id, publish_note: "通过 React 设计器发布" }); await load(); } catch (err) { setError(errorMessage(err, "发布失败")); } }; if (error && !workflow) return <PageFrame title="工作流设计器"><ErrorState message={error} retry={() => void load()} /></PageFrame>; if (!workflow || !version) return <PageFrame title="工作流设计器"><LoadingState /></PageFrame>; const readOnly = version.status !== "draft"; return <PageFrame title={workflow.name} description={`v${version.version} · ${statusLabels[version.status]}`} extra={<><Button variant="outline" onClick={() => void router.push(`/modules/workflow-tickets-react/workflows/${workflow.id}/versions`)}>版本记录</Button><Button variant="outline" onClick={() => void load()}><RiRefreshLine data-icon="inline-start" />刷新</Button>{!readOnly ? <><Button variant="outline" onClick={() => void addNode()}><RiAddLine data-icon="inline-start" />新增节点</Button><Button onClick={() => void publish()} disabled={saving}><RiPlayLine data-icon="inline-start" />发布</Button></> : <Button onClick={async () => { const draft = await api.createVersion(workflow.id, { source_version_id: version.id, change_note: "基于已发布版本继续编辑" }); await router.push(`/modules/workflow-tickets-react/workflows/${workflow.id}/designer?versionId=${draft.id}`); }}>基于此版本编辑</Button>}</>}><div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]"><Card><CardHeader><CardTitle>流程画布</CardTitle><CardDescription>节点按流程顺序展示；连线和分支保存后由后端校验。</CardDescription></CardHeader><CardContent><div className="grid gap-3">{version.nodes.map((node, index) => <div key={node.id} className="flex items-center gap-3"><Button variant={node.id === selectedId ? "default" : "outline"} className="h-auto min-w-48 flex-1 justify-start gap-3 px-3 py-3 text-left" onClick={() => setSelectedId(node.id)}><span className="grid size-7 place-items-center rounded-full bg-muted text-xs">{index + 1}</span><span className="min-w-0"><span className="block truncate font-medium">{node.name}</span><span className="block truncate text-xs text-muted-foreground">{node.form_schema.fields.length} 个字段 · {node.node_type === "summary" ? "总结节点" : "普通节点"}</span></span></Button>{index < version.nodes.length - 1 ? <RiArrowRightLine className="text-muted-foreground" /> : null}</div>)}</div></CardContent></Card><Card><CardHeader><CardTitle>节点设置</CardTitle><CardDescription>草稿可编辑，已发布版本只读。</CardDescription></CardHeader><CardContent>{selected ? <FieldGroup><Field><FieldLabel>节点名称</FieldLabel><Input value={selected.name} onChange={(event) => setNodeName(event.target.value)} onBlur={() => { if (nodeName.trim() && nodeName !== selected.name) void updateSelected({ ...selected, name: nodeName.trim() }); }} onFocus={() => setNodeName(selected.name)} disabled={readOnly} /></Field><Field><FieldLabel>节点说明</FieldLabel><Textarea value={selected.description} onChange={(event) => void updateSelected({ ...selected, description: event.target.value })} disabled={readOnly} /></Field><Field><FieldLabel>节点表单字段</FieldLabel><div className="grid gap-2">{selected.form_schema.fields.length ? selected.form_schema.fields.map((field) => <div key={field.id} className="rounded-md border px-3 py-2 text-sm"><div className="flex justify-between gap-2"><span>{field.label}</span><Badge variant="secondary">{fieldTypeLabels[field.type] ?? "字段"}</Badge></div></div>) : <p className="text-sm text-muted-foreground">暂无字段。可在节点表单编辑器中继续添加。</p>}</div><div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => void router.push("/modules/workflow-tickets-react/workflows/" + workflow.id + "/designer/form/" + selected.id + "?versionId=" + version.id)} disabled={readOnly}>编辑表单</Button><Button size="sm" variant="outline" onClick={() => void router.push("/modules/workflow-tickets-react/workflows/" + workflow.id + "/designer/rules/" + selected.id + "?versionId=" + version.id)} disabled={readOnly}>编辑规则</Button></div></Field>{error ? <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert> : null}</FieldGroup> : <EmptyState description="选择一个节点。" />}</CardContent><CardFooter><Button className="w-full" variant="outline" onClick={() => setMetaOpen(true)}><RiSettings3Line data-icon="inline-start" />模板信息</Button></CardFooter></Card></div><Dialog open={metaOpen} onOpenChange={setMetaOpen}><DialogContent><DialogHeader><DialogTitle>模板信息</DialogTitle><DialogDescription>修改模板名称、描述和分组。</DialogDescription></DialogHeader><p className="text-sm text-muted-foreground">当前模板：{workflow.name}</p><DialogFooter><Button variant="outline" onClick={() => setMetaOpen(false)}>关闭</Button></DialogFooter></DialogContent></Dialog></PageFrame>; }

function WorkflowVersionsPage({ api, router, params }: PageProps) { const workflowId = requiredParam(params.id || params.workflowId, "工作流"); const [workflow, setWorkflow] = useState<Workflow>(); const [error, setError] = useState(""); const load = async () => { try { setWorkflow(await api.getWorkflow(workflowId)); } catch (err) { setError(errorMessage(err, "版本加载失败")); } }; useEffect(() => { void load(); }, [workflowId]); if (error) return <PageFrame title="版本记录"><ErrorState message={error} retry={() => void load()} /></PageFrame>; if (!workflow) return <PageFrame title="版本记录"><LoadingState /></PageFrame>; const versions = [...workflow.versions].sort((a, b) => b.version - a.version); return <PageFrame title={`${workflow.name} · 版本`} description="每个工单绑定创建时的不可变版本快照。" extra={<Button variant="outline" onClick={() => void router.push(`/modules/workflow-tickets-react/workflows/${workflow.id}/designer`)}><RiArrowLeftLine data-icon="inline-start" />返回设计器</Button>}><Card><CardContent className="grid gap-3 pt-5">{versions.map((version) => <div key={version.id} className="flex flex-col gap-3 rounded-md border p-4 sm:flex-row sm:items-center sm:justify-between"><div><div className="flex flex-wrap items-center gap-2"><span className="text-lg font-semibold">v{version.version}</span><StatusBadge value={version.status} /></div><p className="mt-1 text-sm text-muted-foreground">{version.change_note || "未填写版本说明"} · {formatDate(version.created_at)}</p><p className="mt-1 text-xs text-muted-foreground">{version.nodes.length} 个节点 · {version.ticket_count} 个工单绑定</p></div><div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => void router.push(`/modules/workflow-tickets-react/workflows/${workflow.id}/designer?versionId=${version.id}`)}>查看设计</Button>{version.status === "published" ? <Button size="sm" onClick={async () => { const draft = await api.createVersion(workflow.id, { source_version_id: version.id, change_note: "基于已发布版本继续编辑" }); await router.push(`/modules/workflow-tickets-react/workflows/${workflow.id}/designer?versionId=${draft.id}`); }}>创建草稿</Button> : <Button size="sm" onClick={async () => { await api.publishWorkflow(workflow.id, { version_id: version.id, publish_note: "从版本记录发布" }); await load(); }}>发布</Button>}</div></div>)}</CardContent></Card></PageFrame>; }

function ScheduleRunsAction({ api, schedule }: { api: PageProps["api"]; schedule: Schedule & { workflow_name?: string } }) { const [open, setOpen] = useState(false); const [runs, setRuns] = useState<Awaited<ReturnType<typeof api.listScheduleRuns>>>([]); const [error, setError] = useState(""); const load = async () => { try { setError(""); setRuns(await api.listScheduleRuns(schedule.workflow_id, schedule.id)); } catch (err) { setError(errorMessage(err, "执行记录加载失败")); } }; return <><DropdownMenuItem onSelect={(event) => { event.preventDefault(); setOpen(true); void load(); }}>查看执行记录</DropdownMenuItem><Dialog open={open} onOpenChange={setOpen}><DialogContent><DialogHeader><DialogTitle>{schedule.name} · 执行记录</DialogTitle><DialogDescription>{schedule.workflow_name || "定时任务"} 的最近执行结果。</DialogDescription></DialogHeader>{error ? <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert> : runs.length ? <TableContainer><Table><TableHeader><TableRow><TableHead className="w-28">状态</TableHead><TableHead className="w-44">计划时间</TableHead><TableHead className="w-44">执行时间</TableHead><TableHead>结果</TableHead></TableRow></TableHeader><TableBody>{runs.map((run) => <TableRow key={run.id}><TableCell><StatusBadge value={run.status} /></TableCell><TableCell className="text-xs text-muted-foreground">{formatDate(run.planned_at)}</TableCell><TableCell className="text-xs text-muted-foreground">{formatDate(run.executed_at)}</TableCell><TableCell className="max-w-56 truncate text-xs">{run.error || (run.ticket_id ? "已创建工单" : "未创建工单")}</TableCell></TableRow>)}</TableBody></Table></TableContainer> : <EmptyState description="暂无执行记录。" />}</DialogContent></Dialog></>; }
function ScheduleDeleteAction({ api, schedule, reload }: { api: PageProps["api"]; schedule: Schedule; reload: () => Promise<void> }) { const [open, setOpen] = useState(false); return <><DropdownMenuItem variant="destructive" onSelect={(event) => { event.preventDefault(); setOpen(true); }}>删除定时任务</DropdownMenuItem><AlertDialog open={open} onOpenChange={setOpen}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>删除这个定时任务？</AlertDialogTitle><AlertDialogDescription>定时任务和执行记录都会被删除。</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>取消</AlertDialogCancel><AlertDialogAction variant="destructive" onClick={() => void api.deleteSchedule(schedule.workflow_id, schedule.id).then(reload).then(() => setOpen(false))}>确认删除</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog></>; }
function SchedulePage({ api, router }: PageProps) { const [workflows, setWorkflows] = useState<Workflow[]>([]); const [schedules, setSchedules] = useState<Array<Schedule & { workflow_name?: string }>>([]); const [loading, setLoading] = useState(true); const [error, setError] = useState(""); const load = async () => { try { setLoading(true); const nextWorkflows = await api.listWorkflows(); setWorkflows(nextWorkflows); const groups = await Promise.all(nextWorkflows.map(async (workflow) => (await api.listSchedules(workflow.id)).map((schedule) => ({ ...schedule, workflow_name: workflow.name })))); setSchedules(groups.flat()); } catch (err) { setError(errorMessage(err, "定时任务加载失败")); } finally { setLoading(false); } }; useEffect(() => { void load(); }, []); return <PageFrame title="定时任务" description="按计划从已发布模板自动创建工单。" extra={<Button onClick={() => void router.push("/modules/workflow-tickets-react/schedules/new")}><RiAddLine data-icon="inline-start" />新建定时任务</Button>}>{error ? <ErrorState message={error} retry={() => void load()} /> : null}<Card><CardContent>{loading ? <LoadingState /> : schedules.length ? <TableContainer><Table><TableHeader><TableRow><TableHead className="w-64">任务</TableHead><TableHead className="w-32">计划</TableHead><TableHead className="w-28">状态</TableHead><TableHead className="w-44">下次执行</TableHead><TableHead className="w-48 text-right">操作</TableHead></TableRow></TableHeader><TableBody>{schedules.map((schedule) => <TableRow key={schedule.id}><TableCell><div className="grid gap-1"><span className="font-medium">{schedule.name}</span><span className="text-xs text-muted-foreground">{schedule.workflow_name}</span></div></TableCell><TableCell>{({ once: "一次", daily: "每天", weekly: "每周", monthly: "每月", cron: "Cron" } as Record<string, string>)[schedule.schedule_type] ?? schedule.schedule_type}</TableCell><TableCell><StatusBadge value={schedule.enabled ? "active" : "disabled"} /></TableCell><TableCell className="text-xs text-muted-foreground">{formatDate(schedule.next_run_at)}</TableCell><TableCell className="text-right"><div className="flex justify-end gap-2"><Button size="sm" onClick={async () => { await api.runScheduleNow(schedule.workflow_id, schedule.id); await load(); }}><RiPlayLine data-icon="inline-start" />立即执行</Button><DropdownMenu><DropdownMenuTrigger render={<Button size="sm" variant="outline">更多</Button>} /><DropdownMenuContent align="end"><DropdownMenuItem onClick={() => void router.push("/modules/workflow-tickets-react/schedules/" + schedule.id + "?workflow_id=" + schedule.workflow_id)}>编辑</DropdownMenuItem><ScheduleRunsAction api={api} schedule={schedule} /><ScheduleDeleteAction api={api} schedule={schedule} reload={load} /></DropdownMenuContent></DropdownMenu></div></TableCell></TableRow>)}</TableBody></Table></TableContainer> : <EmptyState description="暂无定时任务。" action={<Button onClick={() => void router.push("/modules/workflow-tickets-react/schedules/new")}>创建定时任务</Button>} />} </CardContent></Card></PageFrame>; }
function ScheduleFormPage({ api, router, query, params }: PageProps) {
  const scheduleId = params.id;
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [workflowId, setWorkflowId] = useState(query.workflow_id || "");
  const [name, setName] = useState("");
  const [type, setType] = useState("daily");
  const [startAt, setStartAt] = useState(new Date(Date.now() + 3_600_000).toISOString().slice(0, 16));
  const [endAt, setEndAt] = useState("");
  const [weekday, setWeekday] = useState("1");
  const [dayOfMonth, setDayOfMonth] = useState("1");
  const [cron, setCron] = useState("0 * * * *");
  const [titleTemplate, setTitleTemplate] = useState("{workflow} · {date}");
  const [noteTemplate, setNoteTemplate] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    void (async () => {
      try {
        const nextWorkflows = await api.listWorkflows();
        setWorkflows(nextWorkflows);
        if (!scheduleId) return;
        const groups = await Promise.all(nextWorkflows.map(async (workflow) => (await api.listSchedules(workflow.id)).map((schedule) => ({ schedule, workflowId: workflow.id }))));
        const match = groups.flat().find((item) => item.schedule.id === scheduleId);
        if (!match) throw new Error("定时任务不存在。");
        const schedule = match.schedule;
        setWorkflowId(match.workflowId);
        setName(schedule.name);
        setType(schedule.schedule_type);
        setStartAt(new Date(schedule.start_at).toISOString().slice(0, 16));
        setEndAt(schedule.end_at ? new Date(schedule.end_at).toISOString().slice(0, 16) : "");
        setWeekday(String(schedule.weekday ?? 1));
        setDayOfMonth(String(schedule.day_of_month ?? 1));
        setCron(schedule.cron_expression || "0 * * * *");
        setTitleTemplate(schedule.title_template);
        setNoteTemplate(schedule.note_template);
      } catch (err) {
        setError(errorMessage(err, "定时任务加载失败"));
      }
    })();
  }, [scheduleId]);
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!workflowId || !name.trim()) {
      setError("请选择模板并填写任务名称。");
      return;
    }
    try {
      const payload = { name, schedule_type: type, start_at: new Date(startAt).toISOString(), end_at: endAt ? new Date(endAt).toISOString() : null, weekday: Number(weekday), day_of_month: Number(dayOfMonth), cron_expression: cron, timezone: "Asia/Shanghai", title_template: titleTemplate, note_template: noteTemplate, enabled: true };
      if (scheduleId) await api.updateSchedule(workflowId, scheduleId, payload);
      else await api.createSchedule(workflowId, payload);
      await router.push("/modules/workflow-tickets-react/schedules");
    } catch (err) {
      setError(errorMessage(err, scheduleId ? "更新定时任务失败" : "创建定时任务失败"));
    }
  };
  return <PageFrame title={scheduleId ? "编辑定时任务" : "新建定时任务"} description="计划必须基于已发布模板执行。"><Card><CardContent className="pt-5"><form className="grid gap-5" onSubmit={save}><FieldGroup><Field><FieldLabel>工作流模板</FieldLabel><Select value={workflowId} onValueChange={(value) => setWorkflowId(value ?? "")} disabled={Boolean(scheduleId)}><SelectTrigger><SelectValue placeholder="选择已发布模板" /></SelectTrigger><SelectContent><SelectGroup><SelectLabel>模板</SelectLabel>{workflows.filter((workflow) => workflow.status === "published").map((workflow) => <SelectItem key={workflow.id} value={workflow.id}>{workflow.name}</SelectItem>)}</SelectGroup></SelectContent></Select></Field><Field><FieldLabel>任务名称</FieldLabel><Input value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：每天生成巡检工单" /></Field><Field><FieldLabel>计划类型</FieldLabel><Select value={type} onValueChange={(value) => setType(value ?? "daily")}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectGroup><SelectLabel>计划类型</SelectLabel>{[["once", "一次"], ["daily", "每天"], ["weekly", "每周"], ["monthly", "每月"], ["cron", "Cron"]].map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectGroup></SelectContent></Select></Field><div className="grid gap-4 md:grid-cols-2"><Field><FieldLabel>开始时间</FieldLabel><Input type="datetime-local" value={startAt} onChange={(event) => setStartAt(event.target.value)} /></Field><Field><FieldLabel>结束时间（可选）</FieldLabel><Input type="datetime-local" value={endAt} onChange={(event) => setEndAt(event.target.value)} /></Field></div>{type === "weekly" ? <Field><FieldLabel>每周星期</FieldLabel><Input type="number" min="0" max="6" value={weekday} onChange={(event) => setWeekday(event.target.value)} /></Field> : null}{type === "monthly" ? <Field><FieldLabel>每月日期</FieldLabel><Input type="number" min="1" max="28" value={dayOfMonth} onChange={(event) => setDayOfMonth(event.target.value)} /></Field> : null}{type === "cron" ? <Field><FieldLabel>Cron 表达式</FieldLabel><Input value={cron} onChange={(event) => setCron(event.target.value)} placeholder="*/5 * * * *" /></Field> : null}<Field><FieldLabel>工单标题模板</FieldLabel><Input value={titleTemplate} onChange={(event) => setTitleTemplate(event.target.value)} /><FieldDescription>支持 workflow、date、year、month、day、time、sequence 占位符。</FieldDescription></Field><Field><FieldLabel>备注模板</FieldLabel><Textarea value={noteTemplate} onChange={(event) => setNoteTemplate(event.target.value)} /></Field></FieldGroup>{error ? <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert> : null}<div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={() => void router.back?.()}>取消</Button><Button type="submit">{scheduleId ? "保存计划" : "创建计划"}</Button></div></form></CardContent></Card></PageFrame>;
}
function SettingsPage({ api, router }: PageProps) {
  const [settings, setSettings] = useState<Settings>();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      setSettings(await api.getSettings());
    } catch (err) {
      setError(errorMessage(err, "设置加载失败"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const updateNumber = (key: "max_file_size_mb" | "temporary_resource_days" | "temporary_resource_access_count", value: string) => {
    setSaved(false);
    setSettings((current) => current ? { ...current, [key]: value === "" ? 0 : Number(value) } : current);
  };

  const saveSettings = async () => {
    if (!settings) return;
    setSaving(true);
    setSaved(false);
    setError("");
    try {
      const payload: Settings = {
        ...settings,
        notification_rules: Object.fromEntries(
          Object.entries(settings.notification_rules).map(([event, rule]) => [
            event,
            { ...rule, channels: [...new Set((Array.isArray(rule.channels) ? rule.channels : ["web_internal"]).map((channel) => channel === "in_app" ? "web_internal" : channel))] },
          ]),
        ),
      };
      await api.updateSettings(payload);
      setSettings(await api.getSettings());
      setSaved(true);
    } catch (err) {
      setError(errorMessage(err, "设置保存失败"));
    } finally {
      setSaving(false);
    }
  };

  if (loading && !settings) return <PageFrame title="设置"><LoadingState /></PageFrame>;
  if (!settings) return <PageFrame title="设置"><ErrorState message={error || "设置加载失败"} retry={() => void load()} /></PageFrame>;

  return (
    <PageFrame title="设置" description="管理工单模块的资源、通知和自动化行为。">
      <div className="grid min-w-0 gap-4">
        {error ? <ErrorState message={error} /> : null}
        <Tabs defaultValue="resources" className="min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <TabsList className="max-w-full overflow-x-auto overflow-y-hidden">
              <TabsTrigger value="resources">资源与安全</TabsTrigger>
              <TabsTrigger value="notifications">通知规则</TabsTrigger>
              <TabsTrigger value="automation">自动化</TabsTrigger>
              <TabsTrigger value="data">数据管理</TabsTrigger>
            </TabsList>
            <div className="flex items-center gap-3">
              <Button onClick={() => void saveSettings()} disabled={saving}>{saving ? "保存中…" : "保存设置"}</Button>
              {saved ? <span className="text-sm text-muted-foreground">已保存并验证</span> : null}
            </div>
          </div>
          <TabsContent value="resources" className="grid gap-4 pt-2">
            <Card>
              <CardHeader><CardTitle>资源策略</CardTitle><CardDescription>控制附件和临时执行资源的生命周期。</CardDescription></CardHeader>
              <CardContent><FieldGroup><div className="grid gap-4 md:grid-cols-3"><Field><FieldLabel htmlFor="max-file-size">最大附件大小（MB）</FieldLabel><Input id="max-file-size" type="number" min="1" max="2048" step="1" value={settings.max_file_size_mb} onChange={(event) => updateNumber("max_file_size_mb", event.target.value)} /><FieldDescription>范围：1–2048 MB。</FieldDescription></Field><Field><FieldLabel htmlFor="temporary-resource-days">临时资源有效期（天）</FieldLabel><Input id="temporary-resource-days" type="number" min="1" max="365" step="1" value={settings.temporary_resource_days} onChange={(event) => updateNumber("temporary_resource_days", event.target.value)} /><FieldDescription>超过期限后资源自动失效。</FieldDescription></Field><Field><FieldLabel htmlFor="temporary-resource-access-count">临时资源最大访问次数</FieldLabel><Input id="temporary-resource-access-count" type="number" min="1" max="10000" step="1" value={settings.temporary_resource_access_count} onChange={(event) => updateNumber("temporary_resource_access_count", event.target.value)} /><FieldDescription>范围：1–10000 次。</FieldDescription></Field></div></FieldGroup></CardContent>
            </Card>
            <Alert><RiInformationLine /><AlertDescription>这些策略只作用于工单模块自己的数据，不会修改平台级文件或通知配置。</AlertDescription></Alert>
          </TabsContent>
          <TabsContent value="notifications" className="grid gap-4 pt-2"><NotificationRules settings={settings} setSettings={(next) => { setSaved(false); setSettings(next); }} /></TabsContent>
          <TabsContent value="automation" className="grid gap-4 pt-2"><AutomationRules api={api} router={router} /></TabsContent>
          <TabsContent value="data" className="grid gap-4 pt-2"><SettingsDataActions api={api} /></TabsContent>
        </Tabs>
      </div>
    </PageFrame>
  );
}

export function ModuleApp(props: ToolNestModuleRouteRenderProps) {
  const api = useMemo(() => createWorkflowApi(getModuleApiClient()), []);
  const path = props.path.replace(/^\/modules\/workflow-tickets-react\/?/, "").replace(/^\/+|\/+$/g, "");
  const parts = path.split("/").filter(Boolean);
  const workflowId = parts[0] === "workflows" ? parts[1] : undefined;
  const designerPage = parts[2] === "designer" ? parts[3] : undefined;
  const nodeId = designerPage === "form" || designerPage === "rules" ? parts[4] : undefined;
  const parsedParams = {
    ...props.params,
    ...(parts[0] === "projects" && parts[1] ? { id: parts[1], projectId: parts[1], ...(parts[2] === "milestones" && parts[3] ? { milestoneId: parts[3] } : {}) } : {}),
    ...(parts[0] === "tickets" && parts[1] ? { id: parts[1], ticketId: parts[1] } : {}),
    ...(workflowId ? { id: workflowId, workflowId, ...(nodeId ? { nodeId: decodePathPart(nodeId) } : {}) } : {}),
  };
  const pageProps = { ...props, api, params: parsedParams };
  if (path === "" || path === "overview") return <RedesignedOverviewPage {...pageProps} />;
  if (path === "schedule") return <ScheduleCalendarPage {...pageProps} />;
  if (path === "projects") return <ProjectsPage {...pageProps} />;
  if (path === "projects/new") return <ProjectCreatePage {...pageProps} />;
  if (path.startsWith("projects/") && parts.length === 4 && parts[2] === "milestones") return <MilestoneDetailPage {...pageProps} />;
  if (path.startsWith("projects/") && parts.length === 2) return <ProjectDetailPage {...pageProps} />;
  if (path === "create" || path === "tickets/new") return <TicketCreateWorkbench {...pageProps} />;
  if (path === "tickets") return <TicketListParityPage {...pageProps} />;
  if (path.startsWith("tickets/")) return <TicketDetailParityPage {...pageProps} />;
  if (path === "workflows/new") return <WorkflowFormPage {...pageProps} />;
  if (path === "workflows") return <WorkflowTemplatesPage {...pageProps} />;
  if (path.endsWith("/versions")) return <WorkflowVersionsParityPage {...pageProps} />;
  if (path.includes("/designer/form/")) return <FormDesignerPage {...pageProps} />;
  if (path.includes("/designer/rules/")) return <RuleDesignerPage {...pageProps} />;
  if (path.includes("/designer")) return <WorkflowDesignerCanvasPage api={api} router={props.router} params={parsedParams} query={props.query} />;
  if (path === "schedules/new" || (path.startsWith("schedules/") && parts.length === 2)) return <ScheduleFormPage {...pageProps} />;
  if (path === "schedules") return <SchedulePage {...pageProps} />;
  if (path === "settings") return <SettingsPage {...pageProps} />;
  return <PageFrame title="未找到页面"><EmptyState description="这个模块页面不存在。" /></PageFrame>;
}

function AttachmentList({ api, ticket, nodeId, fieldId, reload, readOnly }: { api: PageProps["api"]; ticket: Ticket; nodeId: string; fieldId: string; reload: () => Promise<void>; readOnly: boolean }) {
  const [deleteId, setDeleteId] = useState("");
  const [error, setError] = useState("");
  const upload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !fieldId) return;
    try {
      const content = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
        reader.onerror = () => reject(reader.error ?? new Error("文件读取失败"));
        reader.readAsDataURL(file);
      });
      await api.uploadAttachment(ticket.id, nodeId, { field_id: fieldId, filename: file.name, mime_type: file.type, content_base64: content });
      event.target.value = "";
      await reload();
    } catch (err) {
      setError(errorMessage(err, "上传附件失败"));
    }
  };
  return (
    <Card>
      <CardHeader><CardTitle>附件</CardTitle><CardDescription>文件受模块附件大小策略限制。</CardDescription></CardHeader>
      <CardContent className="grid gap-3">
        {!readOnly && fieldId ? <Input type="file" onChange={upload} aria-label="上传附件" /> : null}
        {error ? <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert> : null}
        {ticket.attachments?.length ? <div className="grid gap-2">{ticket.attachments.map((attachment) => <div key={attachment.id} className="flex items-center justify-between gap-3 rounded-md border p-3"><a className="min-w-0 truncate text-sm text-primary underline-offset-4 hover:underline" href={attachment.url} target="_blank" rel="noreferrer">{attachment.filename}</a>{!readOnly ? <Button size="icon-sm" variant="ghost" aria-label={"删除附件 " + attachment.filename} onClick={() => setDeleteId(attachment.id)}><RiDeleteBinLine /></Button> : null}</div>)}</div> : <p className="text-sm text-muted-foreground">暂无附件。</p>}
      </CardContent>
      <AlertDialog open={Boolean(deleteId)} onOpenChange={(open) => { if (!open) setDeleteId(""); }}>
        <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>删除这个附件？</AlertDialogTitle><AlertDialogDescription>删除后文件内容不可恢复。</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>取消</AlertDialogCancel><AlertDialogAction variant="destructive" onClick={async () => { if (deleteId) { await api.deleteAttachment(deleteId); setDeleteId(""); await reload(); } }}>确认删除</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

function FormDesignerPage({ api, router, params, query }: PageProps) {
  const workflowId = requiredParam(params.id || params.workflowId, "工作流");
  const nodeId = requiredParam(params.nodeId, "节点");
  const [workflow, setWorkflow] = useState<Workflow>();
  const [versionId, setVersionId] = useState(query.versionId || "");
  const [fields, setFields] = useState<FormField[]>([]);
  const [error, setError] = useState("");
  const load = async () => {
    try {
      const next = await api.getWorkflow(workflowId);
      const version = next.versions.find((item) => item.id === (versionId || next.current_version_id)) ?? next.versions.at(-1);
      const node = version?.nodes.find((item) => item.id === nodeId);
      if (!version || !node) throw new Error("节点或版本不存在。");
      setWorkflow(next);
      setVersionId(version.id);
      setFields(node.form_schema.fields);
    } catch (err) {
      setError(errorMessage(err, "表单设计器加载失败"));
    }
  };
  useEffect(() => { void load(); }, [workflowId, nodeId]);
  const version = workflow?.versions.find((item) => item.id === versionId);
  const node = version?.nodes.find((item) => item.id === nodeId);
  const readOnly = version?.status !== "draft";
  const save = async () => {
    if (!workflow || !version || !node || readOnly) return;
    try {
      const nodes = version.nodes.map((item) => item.id === node.id ? { ...item, form_schema: { fields } } : item);
      const next = await api.updateWorkflow(workflow.id, { version_id: version.id, nodes, edges: version.edges });
      setWorkflow(next);
      setError("");
    } catch (err) {
      setError(errorMessage(err, "保存表单失败"));
    }
  };
  const addField = () => setFields((current) => [...current, { id: crypto.randomUUID(), type: "text", label: "新字段", description: "", placeholder: "", required: false }]);
  const updateField = (fieldId: string, patch: Partial<FormField>) => setFields((current) => current.map((field) => field.id === fieldId ? { ...field, ...patch } : field));
  if (error && !workflow) return <PageFrame title="表单设计器"><ErrorState message={error} retry={() => void load()} /></PageFrame>;
  if (!workflow || !version || !node) return <PageFrame title="表单设计器"><LoadingState /></PageFrame>;
  return <PageFrame title={node.name + " · 表单"} description="配置字段类型、默认值和前序引用；发布版本只读。" extra={<><Button variant="outline" onClick={() => void router.push("/modules/workflow-tickets-react/workflows/" + workflow.id + "/designer")}><RiArrowLeftLine data-icon="inline-start" />返回设计器</Button><Button variant="outline" onClick={() => void router.push("/modules/workflow-tickets-react/workflows/" + workflow.id + "/designer/rules/" + node.id + "?versionId=" + version.id)}>完成规则</Button>{!readOnly ? <Button onClick={() => void save()}><RiSaveLine data-icon="inline-start" />保存表单</Button> : <Button onClick={async () => { const draft = await api.createVersion(workflow.id, { source_version_id: version.id, change_note: "基于已发布版本编辑表单" }); await router.push("/modules/workflow-tickets-react/workflows/" + workflow.id + "/designer/form/" + node.id + "?versionId=" + draft.id); }}>基于版本编辑</Button>}</>}><Card><CardHeader><CardTitle>字段列表</CardTitle><CardDescription>字段删除后，完成规则中的失效引用由后端校验。</CardDescription></CardHeader><CardContent className="grid gap-4">{fields.length ? fields.map((field, index) => <div key={field.id} className="grid gap-3 rounded-md border p-4"><div className="flex items-center justify-between gap-3"><span className="text-sm font-medium">字段 {index + 1}</span>{!readOnly ? <Button size="icon-sm" variant="ghost" aria-label={"删除字段 " + field.label} onClick={() => setFields((current) => current.filter((item) => item.id !== field.id))}><RiDeleteBinLine /></Button> : null}</div><div className="grid gap-3 md:grid-cols-2"><Field><FieldLabel>字段名称</FieldLabel><Input value={field.label} onChange={(event) => updateField(field.id, { label: event.target.value })} disabled={readOnly} /></Field><Field><FieldLabel>字段类型</FieldLabel><Select value={field.type} onValueChange={(value) => updateField(field.id, { type: value ?? "text" })} disabled={readOnly}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectGroup><SelectLabel>类型</SelectLabel>{Object.entries(fieldTypeLabels).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectGroup></SelectContent></Select></Field><Field><FieldLabel>占位提示</FieldLabel><Input value={field.placeholder ?? ""} onChange={(event) => updateField(field.id, { placeholder: event.target.value })} disabled={readOnly} /></Field><Field><FieldLabel>默认值</FieldLabel><Input value={field.default == null ? "" : String(field.default)} onChange={(event) => updateField(field.id, { default: event.target.value })} disabled={readOnly} /></Field></div><Field orientation="horizontal"><Checkbox checked={field.required} onCheckedChange={(checked) => updateField(field.id, { required: checked === true })} disabled={readOnly} /><FieldLabel>完成前必须填写</FieldLabel></Field>{["select", "radio", "multiselect"].includes(field.type) ? <Field><FieldLabel>选项（逗号分隔）</FieldLabel><Input value={(field.options ?? []).map((option) => option.label).join(",")} onChange={(event) => updateField(field.id, { options: event.target.value.split(",").map((label) => ({ label: label.trim(), value: label.trim() })).filter((option) => option.label) })} disabled={readOnly} /></Field> : null}</div>) : <EmptyState description="暂无字段，添加第一个字段开始设计。" />}{error ? <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert> : null}</CardContent><CardFooter>{!readOnly ? <Button variant="outline" onClick={addField}><RiAddLine data-icon="inline-start" />添加字段</Button> : null}</CardFooter></Card></PageFrame>;
}

function RuleDesignerPage({ api, router, params, query }: PageProps) {
  const workflowId = requiredParam(params.id || params.workflowId, "工作流");
  const nodeId = requiredParam(params.nodeId, "节点");
  const [workflow, setWorkflow] = useState<Workflow>();
  const [versionId, setVersionId] = useState(query.versionId || "");
  const [operator, setOperator] = useState("AND");
  const [rules, setRules] = useState<Array<Record<string, unknown>>>([]);
  const [error, setError] = useState("");
  const load = async () => {
    try {
      const next = await api.getWorkflow(workflowId);
      const version = next.versions.find((item) => item.id === (versionId || next.current_version_id)) ?? next.versions.at(-1);
      const node = version?.nodes.find((item) => item.id === nodeId);
      if (!version || !node) throw new Error("节点或版本不存在。");
      const raw = node.completion_rule as Record<string, unknown>;
      const children = Array.isArray(raw.children) ? raw.children.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object") : [];
      setWorkflow(next);
      setVersionId(version.id);
      setOperator(String(raw.operator || "AND"));
      setRules(children);
    } catch (err) {
      setError(errorMessage(err, "规则设计器加载失败"));
    }
  };
  useEffect(() => { void load(); }, [workflowId, nodeId]);
  const version = workflow?.versions.find((item) => item.id === versionId);
  const node = version?.nodes.find((item) => item.id === nodeId);
  const fields = node?.form_schema.fields ?? [];
  const readOnly = version?.status !== "draft";
  const save = async () => {
    if (!workflow || !version || !node || readOnly) return;
    try {
      const completionRule = { type: "group", operator, children: rules };
      const nodes = version.nodes.map((item) => item.id === node.id ? { ...item, completion_rule: completionRule } : item);
      setWorkflow(await api.updateWorkflow(workflow.id, { version_id: version.id, nodes, edges: version.edges }));
    } catch (err) {
      setError(errorMessage(err, "保存完成规则失败"));
    }
  };
  const addRule = () => setRules((current) => [...current, { type: "rule", kind: "field_filled", field_id: fields[0]?.id ?? "", label: "字段已填写" }]);
  if (error && !workflow) return <PageFrame title="完成规则"><ErrorState message={error} retry={() => void load()} /></PageFrame>;
  if (!workflow || !version || !node) return <PageFrame title="完成规则"><LoadingState /></PageFrame>;
  return <PageFrame title={node.name + " · 完成规则"} description="使用 AND/OR 组合规则；最终判定由后端运行时执行。" extra={<><Button variant="outline" onClick={() => void router.push("/modules/workflow-tickets-react/workflows/" + workflow.id + "/designer")}><RiArrowLeftLine data-icon="inline-start" />返回设计器</Button>{!readOnly ? <Button onClick={() => void save()}><RiSaveLine data-icon="inline-start" />保存规则</Button> : null}</>}><Card><CardHeader><CardTitle>规则组</CardTitle><CardDescription>支持字段已填写、值比较、清单完成、附件数量和人工确认。</CardDescription></CardHeader><CardContent className="grid gap-4"><Field><FieldLabel>组合方式</FieldLabel><Select value={operator} onValueChange={(value) => setOperator(value ?? "AND")} disabled={readOnly}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectGroup><SelectLabel>组合方式</SelectLabel><SelectItem value="AND">全部满足</SelectItem><SelectItem value="OR">任一满足</SelectItem></SelectGroup></SelectContent></Select></Field>{rules.length ? rules.map((rule, index) => <div key={index} className="grid gap-3 rounded-md border p-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]"><Field><FieldLabel>规则类型</FieldLabel><Select value={String(rule.kind ?? "field_filled")} onValueChange={(value) => setRules((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, kind: value } : item))} disabled={readOnly}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectGroup><SelectLabel>规则类型</SelectLabel><SelectItem value="field_filled">字段已填写</SelectItem><SelectItem value="value_compare">值比较</SelectItem><SelectItem value="checklist_complete">清单完成</SelectItem><SelectItem value="attachment_count">附件数量</SelectItem><SelectItem value="manual_confirm">人工确认</SelectItem></SelectGroup></SelectContent></Select></Field><Field><FieldLabel>字段</FieldLabel><Select value={String(rule.field_id ?? "")} onValueChange={(value) => setRules((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, field_id: value } : item))} disabled={readOnly}><SelectTrigger><SelectValue placeholder="选择字段" /></SelectTrigger><SelectContent><SelectGroup><SelectLabel>字段</SelectLabel>{fields.map((field) => <SelectItem key={field.id} value={field.id}>{field.label}</SelectItem>)}</SelectGroup></SelectContent></Select></Field>{rule.kind === "value_compare" ? <Field><FieldLabel>比较值</FieldLabel><Input value={String(rule.value ?? "")} onChange={(event) => setRules((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, operator: "==", value: event.target.value } : item))} disabled={readOnly} /></Field> : null}{!readOnly ? <Button size="icon-sm" variant="ghost" aria-label="删除规则" onClick={() => setRules((current) => current.filter((_item, itemIndex) => itemIndex !== index))}><RiDeleteBinLine /></Button> : null}</div>) : <EmptyState description="暂无完成规则，未配置规则时节点可直接完成。" />}{error ? <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert> : null}</CardContent><CardFooter>{!readOnly ? <Button variant="outline" onClick={addRule}><RiAddLine data-icon="inline-start" />添加规则</Button> : null}</CardFooter></Card></PageFrame>;
}

function NotificationRules({ settings, setSettings }: { settings: Settings; setSettings: (settings: Settings) => void }) {
  const updateRule = (event: NotificationEvent, patch: Partial<NotificationRule>) => {
    const current = settings.notification_rules[event] ?? defaultNotificationRule;
    setSettings({ ...settings, notification_rules: { ...settings.notification_rules, [event]: { ...current, ...patch } } });
  };

  return <Card><CardHeader><CardTitle>通知规则</CardTitle><CardDescription>按事件选择是否通知、通知级别和发送渠道。外部渠道仍需在平台设置中完成配置。</CardDescription></CardHeader><CardContent className="grid gap-3">{notificationEvents.map((event) => { const rule = settings.notification_rules[event.value] ?? defaultNotificationRule; const channels = Array.isArray(rule.channels) ? [...new Set(rule.channels.map((value) => value === "in_app" ? "web_internal" : value))] : []; const level = notificationLevels.some((item) => item.value === rule.level) ? rule.level as NotificationLevel : "info"; return <div key={event.value} className="grid gap-4 rounded-md border p-4 lg:grid-cols-[minmax(0,1fr)_minmax(12rem,0.8fr)]"><div><p className="text-sm font-medium">{event.label}</p><p className="text-xs text-muted-foreground">{event.description}</p></div><Field orientation="horizontal"><Switch checked={rule.enabled} onCheckedChange={(enabled) => updateRule(event.value, { enabled, ...(enabled && channels.length === 0 ? { channels: ["web_internal"] } : {}) })} aria-label={`启用${event.label}通知`} /><div><FieldLabel>启用通知</FieldLabel><FieldDescription>{rule.enabled ? "当前事件会进入通知中心。" : "当前事件不会发送通知。"}</FieldDescription></div></Field><div className="grid gap-4 sm:grid-cols-2 lg:col-span-2"><Field><FieldLabel>通知级别</FieldLabel><Select value={level} onValueChange={(value) => updateRule(event.value, { level: (value ?? "info") as NotificationLevel })} disabled={!rule.enabled}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectGroup><SelectLabel>级别</SelectLabel>{notificationLevels.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectGroup></SelectContent></Select></Field><FieldSet><FieldLegend variant="label">通知渠道</FieldLegend><div className="grid gap-2 sm:grid-cols-2">{notificationChannels.map((channel) => <Field key={channel.value} orientation="horizontal"><Checkbox id={`notification-${event.value}-${channel.value}`} checked={channels.includes(channel.value)} onCheckedChange={(checked) => updateRule(event.value, { channels: checked === true ? [...new Set([...channels, channel.value])] : channels.filter((value) => value !== channel.value) })} disabled={!rule.enabled || (channels.length === 1 && channels.includes(channel.value))} /><FieldLabel htmlFor={`notification-${event.value}-${channel.value}`}>{channel.label}</FieldLabel></Field>)}</div><FieldDescription>启用通知时至少保留一个渠道。</FieldDescription></FieldSet></div></div>; })}</CardContent></Card>;
}

type AutomationActionDraft = { type: AutomationActionType; value: string };
type AutomationStep = "trigger" | "actions" | "preview";

function isAutomationTrigger(value: string): value is AutomationTrigger { return Object.prototype.hasOwnProperty.call(automationTriggerLabels, value); }
function isAutomationActionType(value: string): value is AutomationActionType { return Object.prototype.hasOwnProperty.call(automationActionLabels, value); }
function automationActionValue(action: Record<string, unknown>): string { return String(action.value ?? action.project_id ?? action.milestone_id ?? ""); }
function automationActionDraft(action: Record<string, unknown>): AutomationActionDraft | null { const type = String(action.type ?? ""); return isAutomationActionType(type) ? { type, value: automationActionValue(action) } : null; }
function newAutomationAction(type: AutomationActionType = "set_priority"): AutomationActionDraft { return { type, value: type === "set_priority" ? "medium" : "" }; }
function localDateTimeValue(value: string): string { const date = new Date(value); return Number.isNaN(date.getTime()) ? "" : new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16); }
function automationActionSummary(action: AutomationActionDraft, projects: Project[], milestones: Milestone[]): string {
  if (action.type === "set_priority") return `设置优先级为${priorityLabels[action.value] ?? (action.value || "指定值")}`;
  if (action.type === "add_tag") return `追加标签“${action.value || "未填写"}”`;
  if (action.type === "set_project") return `关联项目“${projects.find((item) => item.id === action.value)?.name ?? (action.value ? "指定项目" : "未选择")}”`;
  if (action.type === "set_milestone") return `关联里程碑“${milestones.find((item) => item.id === action.value)?.name ?? (action.value ? "指定里程碑" : "未选择")}”`;
  if (action.type === "set_due_at") return `设置目标时间为${action.value ? formatDate(action.value) : "指定时间"}`;
  return "归档工单";
}
function automationRuleSummary(trigger: string, conditions: Record<string, unknown>, actions: AutomationActionDraft[], workflows: Workflow[], projects: Project[], milestones: Milestone[]): string {
  const conditionParts: string[] = [];
  if (conditions.workflow_id) conditionParts.push(`工作流为“${workflows.find((item) => item.id === String(conditions.workflow_id))?.name ?? "指定工作流"}”`);
  if (conditions.project_id) conditionParts.push(`项目为“${projects.find((item) => item.id === String(conditions.project_id))?.name ?? "指定项目"}”`);
  if (conditions.priority) conditionParts.push(`优先级为“${priorityLabels[String(conditions.priority)] ?? String(conditions.priority)}”`);
  if (conditions.status) conditionParts.push(`状态为“${statusLabels[String(conditions.status)] ?? String(conditions.status)}”`);
  const actionText = actions.length ? actions.map((action) => automationActionSummary(action, projects, milestones)).join("，") : "未配置动作";
  return `当${automationTriggerLabels[trigger as AutomationTrigger] ?? "事件"}时${conditionParts.length ? `，且${conditionParts.join("、")}` : "，适用于全部匹配工单"}，自动${actionText}。`;
}

function AutomationActionValueField({ action, index, projectId, projects, milestones, onChange }: { action: AutomationActionDraft; index: number; projectId: string; projects: Project[]; milestones: Milestone[]; onChange: (index: number, value: string) => void }) {
  if (action.type === "archive") return <Alert variant="destructive"><RiAlertLine /><AlertDescription>归档动作会让匹配工单退出默认工作流，请确认规则范围。</AlertDescription></Alert>;
  const label = action.type === "set_priority" ? "优先级" : action.type === "add_tag" ? "标签" : action.type === "set_project" ? "项目" : action.type === "set_milestone" ? "里程碑" : "目标时间";
  if (action.type === "set_priority") return <Field><FieldLabel>{label}</FieldLabel><Select value={action.value || "medium"} onValueChange={(value) => onChange(index, value ?? "medium")}><SelectTrigger aria-label="动作优先级"><SelectValue /></SelectTrigger><SelectContent><SelectGroup><SelectLabel>优先级</SelectLabel>{Object.entries(priorityLabels).map(([value, textValue]) => <SelectItem key={value} value={value}>{textValue}</SelectItem>)}</SelectGroup></SelectContent></Select></Field>;
  if (action.type === "set_project") return <Field><FieldLabel>{label}</FieldLabel><Select value={action.value} onValueChange={(value) => onChange(index, value ?? "")}><SelectTrigger aria-label="动作项目"><SelectValue placeholder="选择项目" /></SelectTrigger><SelectContent><SelectGroup><SelectLabel>项目</SelectLabel>{projects.map((project) => <SelectItem key={project.id} value={project.id}>{project.name}</SelectItem>)}</SelectGroup></SelectContent></Select></Field>;
  if (action.type === "set_milestone") { const availableMilestones = milestones.filter((milestone) => !projectId || milestone.project_id === projectId); return <Field><FieldLabel>{label}</FieldLabel><Select value={action.value} onValueChange={(value) => onChange(index, value ?? "")}><SelectTrigger aria-label="动作里程碑"><SelectValue placeholder={availableMilestones.length ? "选择里程碑" : "暂无可用里程碑"} /></SelectTrigger><SelectContent><SelectGroup><SelectLabel>里程碑</SelectLabel>{availableMilestones.map((milestone) => <SelectItem key={milestone.id} value={milestone.id}>{milestone.name}</SelectItem>)}</SelectGroup></SelectContent></Select><FieldDescription>{projectId ? "已按项目筛选里程碑。" : "可选择任意项目的里程碑；与关联项目动作需属于同一项目。"}</FieldDescription></Field>; }
  if (action.type === "set_due_at") return <Field><FieldLabel htmlFor={`automation-due-${index}`}>{label}</FieldLabel><Input id={`automation-due-${index}`} type="datetime-local" value={localDateTimeValue(action.value)} onChange={(event) => onChange(index, event.target.value ? new Date(event.target.value).toISOString() : "")} /><FieldDescription>选择匹配工单的目标时间。</FieldDescription></Field>;
  return <Field><FieldLabel htmlFor={`automation-tag-${index}`}>{label}</FieldLabel><Input id={`automation-tag-${index}`} value={action.value} onChange={(event) => onChange(index, event.target.value)} placeholder="例如：自动处理" /></Field>;
}

function AutomationRules({ api, router }: { api: PageProps["api"]; router: Router }) {
  const [rules, setRules] = useState<AutomationRule[]>([]);
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [latestExecutions, setLatestExecutions] = useState<Record<string, AutomationExecution | undefined>>({});
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<string>();
  const [editingEnabled, setEditingEnabled] = useState(false);
  const [step, setStep] = useState<AutomationStep>("trigger");
  const [name, setName] = useState("");
  const [trigger, setTrigger] = useState<AutomationTrigger>("ticket_created");
  const [workflowId, setWorkflowId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [priority, setPriority] = useState("");
  const [ticketStatus, setTicketStatus] = useState("");
  const [actions, setActions] = useState<AutomationActionDraft[]>([newAutomationAction()]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<AutomationRule>();
  const [executionRule, setExecutionRule] = useState<AutomationRule>();
  const [executions, setExecutions] = useState<AutomationExecution[]>([]);
  const [executionLoading, setExecutionLoading] = useState(false);
  const [executionError, setExecutionError] = useState("");

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const [nextRules, nextWorkflows, nextProjects] = await Promise.all([api.listAutomations(), api.listWorkflows(), api.listProjects()]);
      const milestoneLists = await Promise.all(nextProjects.map(async (project) => { try { return await api.listMilestones(project.id); } catch { return []; } }));
      const latest = await Promise.all(nextRules.map(async (rule) => {
        try { return [rule.id, (await api.listAutomationExecutions(rule.id, 1))[0]] as const; } catch { return [rule.id, undefined] as const; }
      }));
      setRules(nextRules);
      setWorkflows(nextWorkflows);
      setProjects(nextProjects);
      setMilestones(milestoneLists.flat());
      setLatestExecutions(Object.fromEntries(latest));
    } catch (err) {
      setError(errorMessage(err, "自动化规则加载失败"));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void load(); }, []);
  const reset = () => {
    setEditing(undefined); setEditingEnabled(false); setStep("trigger"); setName(""); setTrigger("ticket_created"); setWorkflowId(""); setProjectId(""); setPriority(""); setTicketStatus(""); setActions([newAutomationAction()]); setError("");
  };
  const edit = (rule: AutomationRule) => {
    const nextActions = rule.actions.map(automationActionDraft).filter((action): action is AutomationActionDraft => Boolean(action));
    setEditing(rule.id); setEditingEnabled(rule.enabled); setStep("trigger"); setName(rule.name); setTrigger(isAutomationTrigger(rule.trigger) ? rule.trigger : "ticket_created"); setWorkflowId(String(rule.conditions.workflow_id ?? "")); setProjectId(String(rule.conditions.project_id ?? "")); setPriority(String(rule.conditions.priority ?? "")); setTicketStatus(String(rule.conditions.status ?? "")); setActions(nextActions.length ? nextActions : [newAutomationAction()]); setError(automationTriggerLabels[rule.trigger as AutomationTrigger] ? "" : "该规则使用了历史触发事件，保存时会转换为当前支持的工单事件。"); setOpen(true);
  };
  const updateAction = (index: number, value: string) => setActions((current) => current.map((action, actionIndex) => actionIndex === index ? { ...action, value } : action));
  const updateActionType = (index: number, value: string) => { if (!isAutomationActionType(value)) return; setActions((current) => current.map((action, actionIndex) => actionIndex === index ? newAutomationAction(value) : action)); };
  const moveAction = (index: number, offset: number) => setActions((current) => { const nextIndex = index + offset; if (nextIndex < 0 || nextIndex >= current.length) return current; const next = [...current]; const [moved] = next.splice(index, 1); if (moved) next.splice(nextIndex, 0, moved); return next; });
  const clearProject = (value: string) => { setProjectId(value); setActions((current) => current.map((action) => action.type === "set_milestone" ? { ...action, value: "" } : action)); };
  const conditions = { ...(workflowId ? { workflow_id: workflowId } : {}), ...(projectId ? { project_id: projectId } : {}), ...(priority ? { priority } : {}), ...(ticketStatus ? { status: ticketStatus } : {}) };
  const summary = automationRuleSummary(trigger, conditions, actions, workflows, projects, milestones);
  const nextStep = () => { if (step === "trigger") setStep("actions"); else if (step === "actions") { if (!actions.length) { setError("至少添加一个自动动作。"); return; } setStep("preview"); } };
  const previousStep = () => setStep(step === "preview" ? "actions" : "trigger");
  const save = async () => {
    if (!name.trim()) { setError("请填写规则名称。"); setStep("trigger"); return; }
    if (!actions.length) { setError("至少添加一个自动动作。"); setStep("actions"); return; }
    setSaving(true); setError("");
    try {
      const payload = { name: name.trim(), enabled: editing ? editingEnabled : false, trigger, conditions, actions: actions.map((action) => ({ type: action.type, ...(action.type === "archive" ? {} : { value: action.value }) })) };
      if (editing) await api.updateAutomation(editing, payload); else await api.createAutomation(payload);
      setOpen(false); reset(); await load();
    } catch (err) { setError(errorMessage(err, "保存自动化规则失败")); } finally { setSaving(false); }
  };
  const toggle = async (rule: AutomationRule, enabled: boolean) => { try { await api.updateAutomation(rule.id, { enabled }); await load(); } catch (err) { setError(errorMessage(err, "更新自动化规则失败")); } };
  const openExecutions = async (rule: AutomationRule) => { setExecutionRule(rule); setExecutionLoading(true); setExecutionError(""); setExecutions([]); try { setExecutions(await api.listAutomationExecutions(rule.id)); } catch (err) { setExecutionError(errorMessage(err, "执行记录加载失败")); } finally { setExecutionLoading(false); } };
  const deleteRule = async () => { if (!deleteTarget) return; try { await api.deleteAutomation(deleteTarget.id); setDeleteTarget(undefined); await load(); } catch (err) { setError(errorMessage(err, "删除自动化规则失败")); } };

  return <Card><CardHeader><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><CardTitle>自动化规则</CardTitle><CardDescription>用“触发条件 → 执行动作”减少重复处理，并保留每次执行结果。</CardDescription></div><Button onClick={() => { reset(); setOpen(true); }}><RiAddLine data-icon="inline-start" />新建规则</Button></div></CardHeader><CardContent className="grid gap-4">{error && !open && !executionRule ? <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert> : null}{loading && !rules.length ? <LoadingState /> : rules.length ? <div className="grid items-start gap-4 md:grid-cols-2 xl:grid-cols-3">{rules.map((rule) => { const latest = latestExecutions[rule.id]; const actionDrafts = rule.actions.map(automationActionDraft).filter((action): action is AutomationActionDraft => Boolean(action)); return <Card key={rule.id} size="sm" className="min-w-0"><CardHeader className="gap-3"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="flex min-w-0 flex-wrap items-center gap-2"><CardTitle className="truncate text-base">{rule.name}</CardTitle><StatusBadge value={rule.enabled ? "enabled" : "disabled"} /></div><CardDescription className="mt-1">{automationTriggerLabels[rule.trigger as AutomationTrigger] ?? "历史事件"} · {rule.actions.length} 个动作</CardDescription></div><Field orientation="horizontal" className="shrink-0"><Switch checked={rule.enabled} onCheckedChange={(enabled) => void toggle(rule, enabled)} aria-label={`${rule.enabled ? "停用" : "启用"}${rule.name}`} /><FieldLabel className="text-xs">{rule.enabled ? "已启用" : "已停用"}</FieldLabel></Field></div></CardHeader><CardContent className="grid gap-3"><p className="text-sm leading-6 text-muted-foreground">{automationRuleSummary(rule.trigger, rule.conditions, actionDrafts, workflows, projects, [])}</p><div className="flex flex-wrap gap-2"><Badge variant="outline">{rule.actions.length} 个动作</Badge>{rule.conditions.workflow_id ? <Badge variant="outline">限定工作流</Badge> : null}{rule.conditions.project_id ? <Badge variant="outline">限定项目</Badge> : null}</div><div className="flex items-start gap-2 text-xs text-muted-foreground"><span className={latest?.status === "failed" ? "text-destructive" : "text-primary"}>{latest ? (latest.status === "failed" ? "最近执行失败" : "最近执行成功") : "尚未执行"}</span>{latest ? <span>· {formatDate(latest.created_at)}</span> : null}</div></CardContent><CardFooter className="flex justify-end gap-2 border-t"><Button size="sm" variant="outline" onClick={() => void openExecutions(rule)}><RiHistoryLine data-icon="inline-start" />执行记录</Button><DropdownMenu><DropdownMenuTrigger render={<Button type="button" size="icon-sm" variant="ghost" aria-label={`更多操作 ${rule.name}`} />}><RiMore2Line /></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem onClick={() => edit(rule)}><RiEditLine data-icon="inline-start" />编辑规则</DropdownMenuItem><DropdownMenuItem onClick={() => void openExecutions(rule)}><RiHistoryLine data-icon="inline-start" />查看执行记录</DropdownMenuItem><DropdownMenuItem variant="destructive" onClick={() => setDeleteTarget(rule)}><RiDeleteBinLine data-icon="inline-start" />删除规则</DropdownMenuItem></DropdownMenuContent></DropdownMenu></CardFooter></Card>; })}</div> : <EmptyState description="暂无自动化规则。新建规则后，符合条件的工单会按顺序执行动作。" action={<Button onClick={() => { reset(); setOpen(true); }}><RiAddLine data-icon="inline-start" />新建规则</Button>} />}</CardContent><Dialog open={open} onOpenChange={setOpen}><DialogContent className="max-h-[min(46rem,calc(100dvh-2rem))] max-w-3xl overflow-y-auto"><DialogHeader><DialogTitle>{editing ? "编辑自动化规则" : "新建自动化规则"}</DialogTitle><DialogDescription>规则默认停用，保存后可在规则卡片上明确启用。</DialogDescription></DialogHeader><FieldGroup><Field><FieldLabel htmlFor="automation-name">规则名称</FieldLabel><Input id="automation-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：高优先级工单自动归档" /></Field></FieldGroup><Tabs value={step} onValueChange={(value) => { if (value) setStep(value as AutomationStep); }}><TabsList className="w-full justify-start overflow-x-auto overflow-y-hidden"><TabsTrigger value="trigger">触发条件</TabsTrigger><TabsTrigger value="actions">执行动作</TabsTrigger><TabsTrigger value="preview">预览与保存</TabsTrigger></TabsList><TabsContent value="trigger" className="grid gap-4 pt-4"><Card size="sm"><CardHeader><CardTitle>什么时候触发</CardTitle><CardDescription>选择一个工单或节点事件，并可限定适用范围。</CardDescription></CardHeader><CardContent><FieldGroup><Field><FieldLabel>触发事件</FieldLabel><Select value={trigger} onValueChange={(value) => { if (value && isAutomationTrigger(value)) setTrigger(value); }}><SelectTrigger aria-label="触发事件"><SelectValue /></SelectTrigger><SelectContent><SelectGroup><SelectLabel>工单与节点事件</SelectLabel>{Object.entries(automationTriggerLabels).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectGroup></SelectContent></Select></Field><div className="grid gap-4 sm:grid-cols-2"><Field><FieldLabel>限定工作流</FieldLabel><Select value={workflowId || "__all__"} onValueChange={(value) => setWorkflowId(value === "__all__" ? "" : value ?? "")}><SelectTrigger aria-label="限定工作流"><SelectValue placeholder="全部工作流" /></SelectTrigger><SelectContent><SelectGroup><SelectLabel>工作流</SelectLabel><SelectItem value="__all__">全部工作流</SelectItem>{workflows.map((workflow) => <SelectItem key={workflow.id} value={workflow.id}>{workflow.name}</SelectItem>)}</SelectGroup></SelectContent></Select><FieldDescription>不选择时匹配全部工作流。</FieldDescription></Field><Field><FieldLabel>限定项目</FieldLabel><Select value={projectId || "__all__"} onValueChange={(value) => clearProject(value === "__all__" ? "" : value ?? "")}><SelectTrigger aria-label="限定项目"><SelectValue placeholder="全部项目" /></SelectTrigger><SelectContent><SelectGroup><SelectLabel>项目</SelectLabel><SelectItem value="__all__">全部项目</SelectItem>{projects.map((project) => <SelectItem key={project.id} value={project.id}>{project.name}</SelectItem>)}</SelectGroup></SelectContent></Select><FieldDescription>不选择时匹配全部项目；里程碑动作需要限定项目。</FieldDescription></Field><Field><FieldLabel>限定优先级</FieldLabel><Select value={priority || "__all__"} onValueChange={(value) => setPriority(value === "__all__" ? "" : value ?? "")}><SelectTrigger aria-label="限定优先级"><SelectValue placeholder="全部优先级" /></SelectTrigger><SelectContent><SelectGroup><SelectLabel>优先级</SelectLabel><SelectItem value="__all__">全部优先级</SelectItem>{Object.entries(priorityLabels).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectGroup></SelectContent></Select></Field><Field><FieldLabel>限定工单状态</FieldLabel><Select value={ticketStatus || "__all__"} onValueChange={(value) => setTicketStatus(value === "__all__" ? "" : value ?? "")}><SelectTrigger aria-label="限定工单状态"><SelectValue placeholder="全部状态" /></SelectTrigger><SelectContent><SelectGroup><SelectLabel>工单状态</SelectLabel><SelectItem value="__all__">全部状态</SelectItem>{["draft", "in_progress", "blocked", "completed", "cancelled", "archived"].map((value) => <SelectItem key={value} value={value}>{statusLabels[value]}</SelectItem>)}</SelectGroup></SelectContent></Select></Field></div></FieldGroup></CardContent></Card></TabsContent><TabsContent value="actions" className="grid gap-4 pt-4"><Card size="sm"><CardHeader><CardTitle>自动做什么</CardTitle><CardDescription>动作会按列表顺序执行，最多配置 20 个动作。</CardDescription></CardHeader><CardContent className="grid gap-3">{actions.map((action, index) => <Card key={`${index}-${action.type}`} size="sm" className="min-w-0"><CardHeader className="flex flex-row items-start justify-between gap-3 pb-3"><div><CardTitle className="text-sm">动作 {index + 1}</CardTitle><CardDescription>{automationActionSummary(action, projects, milestones)}</CardDescription></div><div className="flex shrink-0"><Button type="button" size="icon-sm" variant="ghost" aria-label={`上移动作 ${index + 1}`} disabled={index === 0} onClick={() => moveAction(index, -1)}><RiArrowUpLine /></Button><Button type="button" size="icon-sm" variant="ghost" aria-label={`下移动作 ${index + 1}`} disabled={index === actions.length - 1} onClick={() => moveAction(index, 1)}><RiArrowDownLine /></Button><Button type="button" size="icon-sm" variant="ghost" aria-label={`删除动作 ${index + 1}`} disabled={actions.length === 1} onClick={() => setActions((current) => current.filter((_, actionIndex) => actionIndex !== index))}><RiDeleteBinLine /></Button></div></CardHeader><CardContent className="grid gap-3 pt-0"><Field><FieldLabel>动作类型</FieldLabel><Select value={action.type} onValueChange={(value) => updateActionType(index, value ?? "set_priority")}><SelectTrigger aria-label={`动作 ${index + 1} 类型`}><SelectValue /></SelectTrigger><SelectContent>{automationActionGroups.map((group) => <SelectGroup key={group.label}><SelectLabel>{group.label}</SelectLabel>{group.types.map((type) => <SelectItem key={type} value={type}>{automationActionLabels[type]}</SelectItem>)}</SelectGroup>)}</SelectContent></Select></Field><AutomationActionValueField action={action} index={index} projectId={projectId} projects={projects} milestones={milestones} onChange={updateAction} /></CardContent></Card>)}<Button type="button" variant="outline" className="justify-start" onClick={() => setActions((current) => [...current, newAutomationAction()])} disabled={actions.length >= 20}><RiAddLine data-icon="inline-start" />添加动作</Button></CardContent></Card></TabsContent><TabsContent value="preview" className="grid gap-4 pt-4"><Card size="sm"><CardHeader><CardTitle>规则预览</CardTitle><CardDescription>保存前确认触发范围和动作顺序。</CardDescription></CardHeader><CardContent className="grid gap-4"><p className="rounded-md border bg-muted/30 p-4 text-sm leading-6">{summary}</p>{actions.some((action) => action.type === "archive") ? <Alert variant="destructive"><RiAlertLine /><AlertDescription>此规则包含归档工单动作，启用前请确认不会误归档仍需处理的工单。</AlertDescription></Alert> : null}{error ? <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert> : null}</CardContent></Card></TabsContent></Tabs><DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>取消</Button>{step !== "trigger" ? <Button type="button" variant="outline" onClick={previousStep}>上一步</Button> : null}{step !== "preview" ? <Button type="button" onClick={nextStep}>下一步</Button> : <Button type="button" onClick={() => void save()} disabled={saving}>{saving ? "保存中…" : "保存规则"}</Button>}</DialogFooter></DialogContent></Dialog><AlertDialog open={Boolean(deleteTarget)} onOpenChange={(next) => { if (!next) setDeleteTarget(undefined); }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>删除这个自动化规则？</AlertDialogTitle><AlertDialogDescription>删除后不会再执行该规则，历史执行记录会保留。</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>取消</AlertDialogCancel><AlertDialogAction variant="destructive" onClick={() => void deleteRule()}>确认删除</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog><Sheet open={Boolean(executionRule)} onOpenChange={(next) => { if (!next) setExecutionRule(undefined); }}><SheetContent side="right" className="w-full overflow-y-auto sm:max-w-lg"><SheetHeader><SheetTitle>{executionRule?.name ?? "执行记录"}</SheetTitle><SheetDescription>查看这条规则最近的执行结果和关联工单。</SheetDescription></SheetHeader><div className="grid gap-3 px-6 pb-6">{executionError ? <Alert variant="destructive"><AlertDescription>{executionError}</AlertDescription></Alert> : null}{executionLoading ? <LoadingState /> : executions.length ? executions.map((execution) => <Card key={execution.id} size="sm"><CardHeader className="gap-2"><div className="flex items-center justify-between gap-3"><CardTitle className="text-sm">{execution.ticket_title}</CardTitle><StatusBadge value={execution.status} /></div><CardDescription>{execution.ticket_number} · {formatDate(execution.created_at)}</CardDescription></CardHeader><CardContent className="grid gap-2 text-sm"><p>已应用 {Number(execution.output.applied ?? 0)} 个动作。</p>{execution.error ? <p className="text-destructive">{execution.error}</p> : null}<Button variant="link" className="h-auto justify-start p-0" onClick={() => void router.push(`/modules/workflow-tickets-react/tickets/${execution.ticket_id}`)}>查看工单</Button></CardContent></Card>) : <EmptyState description="这条规则还没有执行记录。" />}</div></SheetContent></Sheet></Card>;
}

function SettingsDataActions({ api }: { api: PageProps["api"] }) {
  const [message, setMessage] = useState("");
  const importData = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      await api.importData({ data: data.data ?? data, mode: "merge" });
      setMessage("导入完成。");
    } catch (err) {
      setMessage(errorMessage(err, "导入失败"));
    } finally {
      event.target.value = "";
    }
  };
  const exportData = async () => {
    try {
      const data = await api.exportData();
      const link = document.createElement("a");
      link.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
      link.download = "workflow-tickets-export.json";
      link.click();
      URL.revokeObjectURL(link.href);
      setMessage("已导出模块数据。");
    } catch (err) {
      setMessage(errorMessage(err, "导出失败"));
    }
  };
  return <Card><CardHeader><CardTitle>数据迁移</CardTitle><CardDescription>导出包含工单、版本和附件内容；导入默认合并，不覆盖现有数据。</CardDescription></CardHeader><CardContent className="flex flex-wrap items-center gap-3"><Button variant="outline" onClick={() => void exportData()}>导出 JSON</Button><Input type="file" accept="application/json" onChange={importData} aria-label="导入 JSON" />{message ? <span className="text-sm text-muted-foreground">{message}</span> : null}</CardContent></Card>;
}
