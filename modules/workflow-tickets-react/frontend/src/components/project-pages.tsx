import DOMPurify from "dompurify";
import { format } from "date-fns";
import { zhCN } from "date-fns/locale";
import { marked } from "marked";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { Fragment, useEffect, useMemo, useState, type CSSProperties, type FormEvent, type ReactNode } from "react";
import type { ToolNestModuleRouteRenderProps } from "@toolnest/react-module-sdk";
import { RiAddLine, RiArrowLeftLine, RiArrowRightSLine, RiBarChartLine, RiCalendarLine, RiCloseLine, RiDeleteBinLine, RiEditLine, RiExternalLinkLine, RiFileTextLine, RiFlagLine, RiGitBranchLine, RiInformationLine, RiLinkM, RiMore2Line, RiRefreshLine, RiSaveLine, RiSearchLine, RiServerLine, RiSettings3Line, RiTimeLine } from "@remixicon/react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { Calendar } from "@/components/ui/calendar";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Progress } from "@/components/ui/progress";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

import type { Milestone, Project, RelatedResource, Ticket, TimelineActivity, TimelineEvent, WorkflowApi } from "../api";
import { OverviewStatBar } from "../shared/components/overview-stat-bar";
import { ProjectActivityHeatmap } from "../shared/components/project-activity-heatmap";
import { ResourceRelationPicker } from "../shared/components/resource-relation-picker";
import { normalizeResourceType, resourceIcon, resourceSummary, resourceTypeLabel, resourceTypes } from "../shared/components/resource-types";
import { useModulePageMeta } from "./module-layout";
import { ticketStatusRailClass } from "./ticket-status-rail";
import { DetailMeta } from "./ticket-pages";

type PageProps = ToolNestModuleRouteRenderProps & { api: WorkflowApi };
type Router = PageProps["router"];
type MilestoneDraft = { name: string; goal: string; target_at: string; status: string; completion_criteria: string; risk_note: string; review_markdown: string; progress_mode: string; manual_progress: string; owner_name: string };

const projectStatuses = [{ value: "planning", label: "规划中" }, { value: "active", label: "进行中" }, { value: "paused", label: "已暂停" }, { value: "completed", label: "已完成" }];
const milestoneStatuses = [{ value: "pending", label: "计划中" }, { value: "in_progress", label: "进行中" }, { value: "completed", label: "已完成" }, { value: "cancelled", label: "已取消" }];
const milestoneModes = [{ value: "ticket_count", label: "按工单数量" }, { value: "manual", label: "手动设置" }];
const timelineLabels: Record<string, string> = { project_risk: "项目风险", milestone_due: "里程碑到期", resource_created: "资源已创建", ticket_created: "工单已创建", ticket_updated: "工单已更新", ticket_completed: "工单已完成", ticket_reopened: "工单已重新打开", ticket_cancelled: "工单已终止", node_completed: "节点已完成", node_blocked: "节点已阻塞" };
const statusLabels: Record<string, string> = { planning: "规划中", active: "进行中", paused: "已暂停", completed: "已完成", archived: "已归档", pending: "计划中", planned: "计划中", in_progress: "进行中", cancelled: "已取消", blocked: "阻塞", draft: "草稿", ready: "待执行", normal: "正常", risk: "有风险", overdue: "已逾期" };
const ticketPriorityLabels: Record<string, string> = { none: "无优先级", low: "低", medium: "中", high: "高", urgent: "紧急" };

function errorMessage(error: unknown, fallback: string) { return error instanceof Error ? error.message : fallback; }
function requiredParam(value: string | undefined, label: string) { if (!value) throw new Error(label + "参数缺失。"); return value; }
function formatDate(value?: string | null) { return value ? new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium" }).format(new Date(value)) : "未设置"; }
function formatDateTime(value?: string | null) { return value ? new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "未记录"; }
function parseDate(value?: string | null) { if (!value) return undefined; const date = new Date(value); return Number.isNaN(date.getTime()) ? undefined : date; }
function addDays(value: Date, days: number) { const date = new Date(value); date.setDate(date.getDate() + days); return date; }
function addMonths(value: Date, months: number) { const date = new Date(value); date.setMonth(date.getMonth() + months); return date; }
function projectActivityQuery() {
  const until = new Date();
  until.setHours(0, 0, 0, 0);
  until.setDate(until.getDate() + 1);
  const since = new Date(until);
  since.setDate(since.getDate() - 365);
  return { since: since.toISOString(), until: until.toISOString(), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC" };
}
function clampPercent(value: number) { return Math.min(100, Math.max(0, value)); }
function ganttPosition(value: Date, start: Date, end: Date) { return clampPercent((value.getTime() - start.getTime()) / Math.max(1, end.getTime() - start.getTime()) * 100); }
function dateInput(value?: string | null) { return value ? new Date(value).toISOString().slice(0, 10) : ""; }
function toIso(value: string) { return value ? new Date(value).toISOString() : null; }
function parseDateOnly(value: string) {
  if (!value) return undefined;
  const [year, month, day] = value.split("-").map(Number);
  if (![year, month, day].every(Number.isInteger)) return undefined;
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date : undefined;
}
function normalizeMilestoneStatus(value: string) { return value === "planned" ? "pending" : value === "active" ? "in_progress" : value; }
function statusVariant(value: string): "default" | "secondary" | "outline" | "destructive" { return ["completed", "active", "normal"].includes(value) ? "default" : ["blocked", "cancelled", "overdue", "risk"].includes(value) ? "destructive" : ["planning", "pending", "in_progress", "planned"].includes(value) ? "outline" : "secondary"; }
function StatusBadge({ value }: { value: string }) { return <Badge variant={statusVariant(value)}>{statusLabels[value] ?? (value || "未知")}</Badge>; }
function HealthBadge({ value }: { value: string }) { return <Badge variant={statusVariant(value)}>{({ normal: "状态正常", risk: "存在风险", overdue: "已逾期" } as Record<string, string>)[value] ?? statusLabels[value] ?? "状态未知"}</Badge>; }
function EmptyState({ description, action }: { description: string; action?: ReactNode }) { return <Empty><EmptyHeader><EmptyTitle>暂无数据</EmptyTitle><EmptyDescription>{description}</EmptyDescription></EmptyHeader>{action ? <div className="flex justify-center">{action}</div> : null}</Empty>; }
function LoadingState() { return <div className="grid gap-3 rounded-lg border border-dashed p-6" aria-label="正在加载"><Skeleton className="h-5 w-2/5" /><Skeleton className="h-24 w-full" /><Skeleton className="h-24 w-full" /></div>; }
function ErrorState({ message, retry }: { message: string; retry?: () => void }) { return <Alert variant="destructive"><AlertTitle>加载失败</AlertTitle><AlertDescription className="flex flex-wrap items-center gap-3">{message}{retry ? <Button size="sm" variant="outline" onClick={retry}><RiRefreshLine data-icon="inline-start" />重试</Button> : null}</AlertDescription></Alert>; }
function ProjectFrame({ children, className }: { children: ReactNode; className?: string }) { return <section className={cn("tn-workflow-tickets-project-page grid gap-5", className)}>{children}</section>; }
function countEntries(value: unknown) { return value && typeof value === "object" ? Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, Number(item) || 0] as const) : []; }
function markdownHtml(value: string) { return { __html: DOMPurify.sanitize(String(marked.parse(value || "还没有记录。", { breaks: true, gfm: true }))) }; }
function ticketProgress(ticket: Ticket) { const total = ticket.node_instances.length || 1; return Math.round(ticket.node_instances.filter((node) => node.status === "completed").length / total * 100); }
function currentTicketNode(ticket: Ticket) { return ticket.node_instances.find((node) => ["ready", "in_progress", "blocked"].includes(node.status))?.name ?? statusLabels[ticket.status] ?? ticket.status; }
function ConfirmAction({ title, description, ariaLabel, children, onConfirm, wide = false }: { title: string; description: string; ariaLabel: string; children: ReactNode; onConfirm: () => Promise<void>; wide?: boolean }) { const [open, setOpen] = useState(false); const [busy, setBusy] = useState(false); return <><Button size={wide ? "sm" : "icon-sm"} variant={wide ? "destructive" : "ghost"} aria-label={ariaLabel} onClick={() => setOpen(true)}>{children}</Button><AlertDialog open={open} onOpenChange={(value) => { if (!busy) setOpen(value); }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{title}</AlertDialogTitle><AlertDialogDescription>{description}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel disabled={busy}>取消</AlertDialogCancel><AlertDialogAction disabled={busy} onClick={(event) => { event.preventDefault(); setBusy(true); void onConfirm().then(() => setOpen(false)).finally(() => setBusy(false)); }}>{busy ? "处理中…" : "确认"}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog></>; }
function projectTicketPath(projectId: string | null | undefined, ticketId: string, projectTab: string) { if (!projectId) return "/modules/workflow-tickets-react/tickets/" + ticketId; return "/modules/workflow-tickets-react/tickets/" + ticketId + "?from=project&project_id=" + encodeURIComponent(projectId) + "&project_tab=" + encodeURIComponent(projectTab); }
function TicketButton({ ticket, router, projectId = ticket.project_id ?? undefined, projectTab = "overview" }: { ticket: Ticket; router: Router; projectId?: string | null; projectTab?: string }) { return <button type="button" className="min-w-0 text-left" onClick={() => void router.push(projectTicketPath(projectId, ticket.id, projectTab))}><span className="block truncate font-medium hover:underline">{ticket.title}</span><span className="block truncate text-xs text-muted-foreground">{ticket.number} · {ticket.workflow_name}</span></button>; }

function ProjectCreateForm({ api, router, onDone }: { api: WorkflowApi; router: Router; onDone?: () => void }) {
  const [name, setName] = useState(""); const [goal, setGoal] = useState(""); const [tags, setTags] = useState(""); const [status, setStatus] = useState("planning"); const [error, setError] = useState(""); const [saving, setSaving] = useState(false);
  const save = async (event: FormEvent) => { event.preventDefault(); if (!name.trim()) { setError("项目名称不能为空。"); return; } setSaving(true); setError(""); try { const project = await api.createProject({ name: name.trim(), goal: goal.trim(), tags: tags.split(",").map((item) => item.trim()).filter(Boolean), status, planned_start_at: null, target_at: null, default_workflow_id: null, favorite: false }); if (onDone) onDone(); else await router.push("/modules/workflow-tickets-react/projects/" + project.id); } catch (err) { setError(errorMessage(err, "创建项目失败")); } finally { setSaving(false); } };
  return <form className="grid gap-5" onSubmit={save}><FieldGroup><Field><FieldLabel htmlFor="project-name">项目名称</FieldLabel><Input id="project-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：个人知识库整理" autoFocus required /></Field><Field><FieldLabel htmlFor="project-goal">项目目标</FieldLabel><Textarea id="project-goal" value={goal} onChange={(event) => setGoal(event.target.value)} placeholder="这个项目希望达成什么？" rows={4} /></Field><Field><FieldLabel htmlFor="project-tags">标签</FieldLabel><Input id="project-tags" value={tags} onChange={(event) => setTags(event.target.value)} placeholder="例如：学习，长期，个人" /><FieldDescription>多个标签用逗号分隔。</FieldDescription></Field><Field><FieldLabel>项目状态</FieldLabel><Select value={status} onValueChange={(value) => setStatus(value ?? "planning")}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectGroup><SelectLabel>状态</SelectLabel>{projectStatuses.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectGroup></SelectContent></Select></Field></FieldGroup>{error ? <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert> : null}<div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={() => onDone?.()}>取消</Button><Button type="submit" disabled={saving}>{saving ? "创建中…" : "创建项目"}</Button></div></form>;
}

function ProjectCard({ project, milestones, router }: { project: Project; milestones: Milestone[]; router: Router }) {
  const goal = project.goal ?? project.description;
  const completed = project.completed_ticket_count ?? 0;
  const total = project.ticket_count ?? 0;
  const progress = project.progress ?? 0;
  const activeMilestones = milestones.filter((item) => ["active", "in_progress"].includes(normalizeMilestoneStatus(item.status)));
  const completedMilestones = milestones.filter((item) => normalizeMilestoneStatus(item.status) === "completed").length;
  const currentMilestone = activeMilestones[0] ?? milestones.find((item) => normalizeMilestoneStatus(item.status) === "pending");
  const milestoneCount = milestones.length || project.milestone_count || 0;
  const currentStageName = currentMilestone?.name ?? project.current_milestone_name ?? "暂无进行中的里程碑";
  const currentMilestoneTarget = currentMilestone?.target_at ?? project.target_at;
  const openProject = () => void router.push("/modules/workflow-tickets-react/projects/" + project.id);
  const currentDetails = currentMilestone;
  return <Card className="gap-0 border border-border py-0">
    <div className="grid gap-4 p-4 sm:p-5">
      <header className="flex min-w-0 items-center gap-3">
        <div className="min-w-0 flex-1">
          <span className="grid min-w-0 gap-1">
            <span className="flex min-w-0 flex-wrap items-center gap-2"><strong className="truncate text-sm font-semibold">{project.name}</strong><StatusBadge value={project.status} /><small className="truncate font-mono text-xs text-muted-foreground">{project.key}</small></span>
            <small className="block truncate text-xs text-muted-foreground">{goal || "暂未填写项目目标。"}</small>
          </span>
        </div>
        <Button type="button" variant="link" size="sm" onClick={openProject}>查看详情</Button>
      </header>
      <div className="grid gap-2">
        <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground"><span>项目进度</span><strong className="text-sm tabular-nums text-primary">{progress}%</strong></div>
        <Progress className="gap-1" value={progress} aria-label={"项目进度 " + progress + "%"} />
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs"><span className="shrink-0"><span className="text-muted-foreground">工单 </span><span className="font-medium tabular-nums text-foreground">{completed} / {total}</span></span><span aria-hidden="true" className="text-border">·</span><span className="shrink-0"><span className="text-muted-foreground">里程碑 </span><span className="font-medium tabular-nums text-foreground">{completedMilestones} / {milestoneCount}</span></span><span aria-hidden="true" className="text-border">·</span><span className="min-w-0 max-w-full truncate"><span className="text-muted-foreground">当前阶段 </span><span className="font-medium text-primary">{currentStageName}</span></span><span aria-hidden="true" className="text-border">·</span><span className="shrink-0"><span className="text-muted-foreground">目标日期 </span><span className={currentMilestoneTarget ? "font-medium text-foreground" : "text-muted-foreground"}>{formatDate(currentMilestoneTarget)}</span></span></div>
      </div>
    </div>
    <div className="grid gap-5 border-t p-4 sm:p-5 xl:grid-cols-[minmax(0,1fr)_minmax(18rem,0.36fr)]">
      <aside className="grid min-w-0 content-start gap-4 xl:order-2 xl:border-l xl:pl-5">
        <header><h3 className="m-0 text-base font-semibold tracking-tight">项目状态</h3></header>
        <dl className="grid min-w-0 divide-y divide-border text-sm">
          <div className="flex min-w-0 items-center justify-between gap-3 py-2 first:pt-0">
            <dt className="shrink-0 text-xs font-medium text-muted-foreground">当前阶段</dt>
            <dd className="min-w-0 truncate text-right font-semibold tracking-tight text-primary">{currentStageName}</dd>
          </div>
          <div className="flex min-w-0 items-center justify-between gap-3 py-2">
            <dt className="shrink-0 text-xs font-medium text-muted-foreground">当前负责人</dt>
            <dd className="min-w-0 truncate text-right font-semibold tracking-tight text-foreground">{currentDetails?.owner_name || project.owner_name || "当前用户"}</dd>
          </div>
          {project.health && project.health !== "normal" ? <div className="flex min-w-0 items-center justify-between gap-3 py-2 last:pb-0"><dt className="shrink-0 text-xs font-medium text-muted-foreground">项目健康</dt><dd className="min-w-0"><HealthBadge value={project.health} /></dd></div> : null}
        </dl>
        {currentDetails?.risk_note || currentDetails?.completion_criteria ? <div className="grid gap-3 border-t border-border pt-3">
          {currentDetails?.risk_note ? <div className="min-w-0"><span className="text-xs font-medium text-muted-foreground">风险提示</span><p className="m-0 mt-1 line-clamp-3 whitespace-pre-wrap text-sm leading-5">{currentDetails.risk_note}</p></div> : null}
          {currentDetails?.completion_criteria ? <div className="min-w-0"><span className="text-xs font-medium text-muted-foreground">完成标准</span><p className="m-0 mt-1 line-clamp-3 whitespace-pre-wrap text-sm leading-5">{currentDetails.completion_criteria}</p></div> : null}
        </div> : null}
      </aside>
      <section className="min-w-0 xl:order-1">
        <header className="grid gap-1.5"><div className="flex items-center gap-2"><h3 className="m-0 text-base font-semibold tracking-tight">里程碑路线图</h3><span className="text-xs text-muted-foreground">{milestones.length} 条</span></div><p className="m-0 text-xs leading-5 text-muted-foreground">按阶段查看项目推进和交付节点。</p></header>
        {milestones.length ? <div className="relative mt-4 grid min-w-0 gap-0">{milestones.map((milestone, index) => { const milestoneStatus = normalizeMilestoneStatus(milestone.status); const milestoneTotal = milestone.ticket_count ?? 0; const milestoneCompleted = milestone.completed_ticket_count ?? 0; const milestoneProgress = milestone.progress ?? 0; const isCurrent = currentMilestone?.id === milestone.id; const isLast = index === milestones.length - 1; const nodeClass = isCurrent ? "size-3 bg-primary ring-4 ring-primary/15" : milestoneStatus === "completed" ? "size-2.5 bg-primary/60" : milestoneStatus === "cancelled" ? "size-2.5 bg-muted-foreground/60" : "size-2.5 bg-background ring-2 ring-border"; return <div className={"grid min-w-0 grid-cols-[1rem_minmax(0,1fr)] gap-3 sm:grid-cols-[1.5rem_minmax(0,1fr)] sm:gap-4 " + (isLast ? "" : "pb-5")} key={milestone.id}><div className="relative flex justify-center"><span className={"relative z-10 mt-1 shrink-0 rounded-full " + nodeClass} aria-hidden="true" />{!isLast ? <span className="absolute left-1/2 top-3 bottom-[-1.25rem] w-px -translate-x-1/2 bg-border" aria-hidden="true" /> : null}</div><button type="button" aria-current={isCurrent ? "step" : undefined} className="group grid min-w-0 cursor-pointer gap-2 text-left transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => void router.push("/modules/workflow-tickets-react/projects/" + project.id + "/milestones/" + milestone.id)}><span className="flex min-w-0 flex-wrap items-center gap-2"><strong className={"min-w-0 truncate text-sm font-medium " + (isCurrent ? "font-semibold" : "")}>{milestone.name}</strong><StatusBadge value={milestone.status} /></span><small className="line-clamp-2 text-xs text-muted-foreground">{milestone.goal ?? milestone.description ?? "暂无阶段目标。"}</small><span className="grid min-w-0 gap-2"><span className="flex min-w-0 items-center gap-2"><Progress className="min-w-0 flex-1 gap-1" value={milestoneProgress} aria-label={milestone.name + "进度 " + milestoneProgress + "%"} /><span className="shrink-0 text-xs tabular-nums text-muted-foreground">{milestoneProgress}%</span></span><span className="flex min-w-0 flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground"><span className="shrink-0">{milestoneCompleted} / {milestoneTotal} 个工单完成</span><span className="min-w-0 truncate">负责人 {milestone.owner_name || "当前用户"}</span><span className="shrink-0">目标日期 {formatDate(milestone.target_at)}</span></span></span></button></div>; })}</div> : <div className="mt-4 grid gap-3 border-t border-dashed border-border pt-4"><p className="m-0 text-sm text-muted-foreground">暂无里程碑，进入项目详情创建第一个阶段。</p><Button className="w-fit" size="sm" variant="outline" onClick={openProject}>进入项目详情</Button></div>}
      </section>
    </div>
  </Card>;
}

export function ProjectsPage({ api, router }: PageProps) {
  const { setPageMeta } = useModulePageMeta();
  const [projects, setProjects] = useState<Project[]>([]); const [projectMilestones, setProjectMilestones] = useState<Record<string, Milestone[]>>({}); const [keyword, setKeyword] = useState(""); const [status, setStatus] = useState("all"); const [loading, setLoading] = useState(true); const [error, setError] = useState(""); const [createOpen, setCreateOpen] = useState(false);
  useEffect(() => { setPageMeta({ title: "项目", description: "围绕目标组织工单、里程碑和复盘数据。" }); }, [setPageMeta]);
  const load = async () => { setLoading(true); setError(""); try { const nextProjects = await api.listProjects(); const milestoneEntries = await Promise.all(nextProjects.map(async (project) => [project.id, await api.listMilestones(project.id)] as const)); setProjects(nextProjects); setProjectMilestones(Object.fromEntries(milestoneEntries)); } catch (err) { setError(errorMessage(err, "项目暂时无法加载")); } finally { setLoading(false); } };
  useEffect(() => { void load(); }, []);
  const filtered = useMemo(() => { const query = keyword.trim().toLowerCase(); return projects.filter((project) => { const values = [project.name, project.key, project.goal ?? project.description, ...(project.tags ?? [])].join(" ").toLowerCase(); return (!query || values.includes(query)) && (status === "all" || project.status === status); }); }, [keyword, projects, status]);
  return <ProjectFrame><div className="flex min-w-0 items-center gap-3"><InputGroup className="min-w-0 flex-1"><InputGroupAddon><RiSearchLine className="size-3.5 opacity-60" aria-hidden="true" /></InputGroupAddon><InputGroupInput value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="搜索项目、目标或标签" aria-label="搜索项目、目标或标签" /></InputGroup><div className="flex h-5 items-center"><Separator orientation="vertical" /></div><Select value={status} onValueChange={(value) => setStatus(value ?? "all")}><SelectTrigger className="w-36 shrink-0"><SelectValue placeholder="全部状态" /></SelectTrigger><SelectContent><SelectGroup><SelectLabel>项目状态</SelectLabel><SelectItem value="all">全部状态</SelectItem>{projectStatuses.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectGroup></SelectContent></Select><Button className="shrink-0" onClick={() => setCreateOpen(true)}><RiAddLine data-icon="inline-start" />新建项目</Button></div>{error ? <ErrorState message={error} retry={() => void load()} /> : null}{loading ? <div className="grid gap-4">{Array.from({ length: 4 }, (_, index) => <Card key={index} className="grid gap-4 p-5"><Skeleton className="h-6 w-3/5" /><Skeleton className="h-10 w-full" /><Skeleton className="h-4 w-4/5" /><Skeleton className="h-2 w-full" /></Card>)}</div> : filtered.length ? <div className="grid gap-4">{filtered.map((project) => <ProjectCard key={project.id} project={project} milestones={projectMilestones[project.id] ?? []} router={router} />)}</div> : <Card><EmptyState description={projects.length ? "还没有匹配的项目" : "还没有项目，创建一个项目开始组织工单。"} action={<Button onClick={() => setCreateOpen(true)}><RiAddLine data-icon="inline-start" />{projects.length ? "创建项目" : "创建第一个项目"}</Button>} /></Card>}<Dialog open={createOpen} onOpenChange={setCreateOpen}><DialogContent className="sm:max-w-xl"><DialogHeader><DialogTitle>新建项目</DialogTitle><DialogDescription>围绕一个目标组织工单、里程碑和复盘数据。</DialogDescription></DialogHeader><ProjectCreateForm api={api} router={router} onDone={() => { setCreateOpen(false); void load(); }} /></DialogContent></Dialog></ProjectFrame>;
}

function ProjectEditDialog({ api, project, onSaved }: { api: WorkflowApi; project: Project; onSaved: (project: Project) => void }) {
  const [open, setOpen] = useState(false); const [name, setName] = useState(project.name); const [goal, setGoal] = useState(project.goal ?? project.description); const [status, setStatus] = useState(project.status); const [tags, setTags] = useState((project.tags ?? []).join(", ")); const [note, setNote] = useState(project.note); const [error, setError] = useState(""); const [saving, setSaving] = useState(false);
  const start = () => { setName(project.name); setGoal(project.goal ?? project.description); setStatus(project.status); setTags((project.tags ?? []).join(", ")); setNote(project.note); setError(""); setOpen(true); };
  const save = async () => { setSaving(true); setError(""); try { const next = await api.updateProject(project.id, { name: name.trim(), goal: goal.trim(), status, tags: tags.split(",").map((item) => item.trim()).filter(Boolean), note }); onSaved(next); setOpen(false); } catch (err) { setError(errorMessage(err, "保存项目失败")); } finally { setSaving(false); } };
  return <><Button variant="outline" onClick={start}><RiEditLine data-icon="inline-start" />编辑项目</Button><Dialog open={open} onOpenChange={setOpen}><DialogContent className="sm:max-w-xl"><DialogHeader><DialogTitle>编辑项目</DialogTitle><DialogDescription>更新项目目标、标签、状态和注意事项。</DialogDescription></DialogHeader><FieldGroup><Field><FieldLabel>项目名称</FieldLabel><Input value={name} onChange={(event) => setName(event.target.value)} /></Field><Field><FieldLabel>项目目标</FieldLabel><Textarea value={goal} onChange={(event) => setGoal(event.target.value)} rows={3} /></Field><Field><FieldLabel>标签</FieldLabel><Input value={tags} onChange={(event) => setTags(event.target.value)} /></Field><Field><FieldLabel>项目状态</FieldLabel><Select value={status} onValueChange={(value) => setStatus(value ?? "planning")}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectGroup><SelectLabel>状态</SelectLabel>{projectStatuses.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectGroup></SelectContent></Select></Field><Field><FieldLabel>注意事项</FieldLabel><Textarea value={note} onChange={(event) => setNote(event.target.value)} rows={4} /></Field></FieldGroup>{error ? <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert> : null}<DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>取消</Button><Button disabled={saving || !name.trim()} onClick={() => void save()}>{saving ? "保存中…" : "保存项目"}</Button></DialogFooter></DialogContent></Dialog></>;
}

function ProjectActionBar({ project, router, api, onSaved, onArchived }: { project: Project; router: Router; api: WorkflowApi; onSaved: (project: Project) => void; onArchived: () => Promise<void> }) {
  return <div className="flex w-fit max-w-full shrink-0 flex-wrap items-center justify-start gap-2"><ProjectEditDialog api={api} project={project} onSaved={onSaved} /><ConfirmAction title="归档这个项目？" description="归档后项目默认隐藏，但工单、里程碑和资源都会保留。" ariaLabel="归档项目" onConfirm={onArchived} wide><RiDeleteBinLine data-icon="inline-start" />归档项目</ConfirmAction><Button onClick={() => void router.push("/modules/workflow-tickets-react/tickets/new?project_id=" + project.id)}><RiAddLine data-icon="inline-start" />新建工单</Button></div>;
}

function ProjectOverviewMetrics({ project, milestones, tickets }: { project: Project; milestones: Milestone[]; tickets: Ticket[] }) {
  const incompleteTickets = Math.max(0, (project.ticket_count ?? tickets.length) - (project.completed_ticket_count ?? 0));
  return <OverviewStatBar ariaLabel="项目概览统计" items={[
    { id: "progress", label: "整体进度", value: (project.progress ?? 0) + "%" },
    { id: "incomplete-tickets", label: "未完成工单", value: incompleteTickets },
    { id: "milestones", label: "里程碑", value: project.milestone_count ?? milestones.length, railClassName: "bg-muted-foreground/60" },
    { id: "current-milestone", label: "当前里程碑", value: <span className="max-w-36 truncate">{project.current_milestone_name || "暂无"}</span> },
  ]} />;
}

function ProjectOverviewContext({ project }: { project: Project }) {
  const goal = project.goal?.trim() || project.description?.trim();
  return <div className="grid min-w-0 gap-3 rounded-md border border-border/70 bg-muted/20 p-3 sm:grid-cols-[minmax(0,1.7fr)_repeat(3,minmax(0,0.75fr))] sm:items-center">
    <div className="min-w-0"><span className="text-[11px] font-medium text-muted-foreground">项目目标</span><p className="m-0 mt-1 line-clamp-2 text-sm leading-5 text-foreground">{goal || "暂未填写项目目标。"}</p></div>
    <div className="min-w-0"><span className="text-[11px] font-medium text-muted-foreground">项目状态</span><div className="mt-1"><StatusBadge value={project.status} /></div></div>
    <div className="min-w-0"><span className="text-[11px] font-medium text-muted-foreground">负责人</span><p className="m-0 mt-1 truncate text-sm font-medium">{project.owner_name || "当前用户"}</p></div>
    <div className="min-w-0"><span className="text-[11px] font-medium text-muted-foreground">目标日期</span><p className="m-0 mt-1 truncate text-sm font-medium">{formatDate(project.target_at)}</p></div>
  </div>;
}

function OverviewMilestoneRow({ projectId, milestone, router }: { projectId: string; milestone: Milestone; router: Router }) {
  const status = normalizeMilestoneStatus(milestone.status);
  const progress = milestone.progress ?? 0;
  return <button type="button" className="relative grid min-w-0 gap-1.5 rounded-md border border-border bg-card px-3 py-2 pl-5 text-left transition-colors hover:border-primary/40 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => void router.push("/modules/workflow-tickets-react/projects/" + projectId + "/milestones/" + milestone.id)}>
    <span className={milestoneStatusRailClass(status)} aria-hidden="true" />
    <span className="flex min-w-0 items-center gap-2"><span className="min-w-0 truncate text-sm font-medium">{milestone.name}</span><StatusBadge value={milestone.status} /></span>
    <span className="line-clamp-1 text-xs text-muted-foreground">{milestone.goal || milestone.description || "暂无阶段目标。"}</span>
    <span className="flex min-w-0 items-center gap-2"><Progress className="h-1.5 min-w-0 flex-1" value={progress} aria-label={milestone.name + "进度 " + progress + "%"} /><span className="shrink-0 text-xs tabular-nums text-muted-foreground">{progress}% · 目标 {formatDate(milestone.target_at)}</span></span>
  </button>;
}

function OverviewTab({ project, milestones, tickets, router, setTab, actions, activity, activityLoading, activityError, onRetryActivity }: { project: Project; milestones: Milestone[]; tickets: Ticket[]; router: Router; setTab: (tab: string) => void; actions?: ReactNode; activity?: TimelineActivity; activityLoading: boolean; activityError: string; onRetryActivity: () => void }) {
  const recent = [...tickets].sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, 5);
  const activeMilestones = milestones.filter((item) => !["completed", "cancelled"].includes(normalizeMilestoneStatus(item.status))).slice(0, 4);
  return <div className="grid gap-4">
    <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"><ProjectOverviewMetrics project={project} milestones={milestones} tickets={tickets} />{actions ? <div className="flex min-w-0 justify-end">{actions}</div> : null}</div>
    <ProjectOverviewContext project={project} />
    <div className="grid min-w-0 items-start gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(20rem,0.65fr)]">
      <div className="grid min-w-0 items-start gap-4">
        <Card size="sm" className="min-w-0"><CardHeader className="flex-row items-start justify-between gap-3"><div><CardTitle>近期工单</CardTitle><CardDescription>项目中最近更新的执行任务。</CardDescription></div><Button variant="ghost" size="sm" onClick={() => setTab("tickets")}>查看全部</Button></CardHeader><CardContent className="grid min-w-0 gap-2">{recent.length ? recent.map((ticket) => <MilestoneTicketRow key={ticket.id} ticket={ticket} router={router} />) : <EmptyState description="还没有关联工单。" action={<Button size="sm" onClick={() => void router.push("/modules/workflow-tickets-react/tickets/new?project_id=" + project.id)}><RiAddLine data-icon="inline-start" />新建工单</Button>} />}</CardContent></Card>
        <Card size="sm" className="min-w-0"><CardHeader className="flex-row items-start justify-between gap-3"><div><CardTitle>里程碑</CardTitle><CardDescription>按阶段查看项目推进情况。</CardDescription></div><Button variant="ghost" size="sm" onClick={() => setTab("milestones")}>查看全部</Button></CardHeader><CardContent className="grid min-w-0 gap-2">{activeMilestones.length ? activeMilestones.map((milestone) => <OverviewMilestoneRow key={milestone.id} projectId={project.id} milestone={milestone} router={router} />) : <EmptyState description="暂无进行中的里程碑。" action={<Button size="sm" onClick={() => setTab("milestones")}><RiAddLine data-icon="inline-start" />创建里程碑</Button>} />}</CardContent></Card>
      </div>
      <ProjectActivityHeatmap activity={activity} loading={activityLoading} error={activityError} onRetry={onRetryActivity} />
    </div>
  </div>;
}

function TimelineList({ items }: { items: TimelineEvent[] }) { return items.length ? <div className="grid gap-0">{items.map((item) => <div key={item.id} className="relative grid grid-cols-[auto_minmax(0,1fr)] gap-3 pb-5 last:pb-0"><span className="mt-1 flex size-7 items-center justify-center rounded-full bg-muted text-muted-foreground"><RiTimeLine className="size-4" /></span><div className="min-w-0"><p className="font-medium">{timelineLabels[item.type] ?? item.title}</p><p className="mt-1 text-sm text-muted-foreground">{item.detail || item.title}</p><p className="mt-1 text-xs text-muted-foreground">{formatDateTime(item.created_at)} · {item.actor_name}</p></div></div>)}</div> : <EmptyState description="暂无动态。" />; }

function MilestoneDetailSection({ icon, title, count, description, action, children }: { icon: ReactNode; title: string; count?: string; description?: string; action?: ReactNode; children: ReactNode }) {
  return <section className="grid min-w-0 gap-3"><header className="flex min-w-0 flex-wrap items-start justify-between gap-3"><div className="grid min-w-0 gap-1.5"><div className="flex min-w-0 items-center gap-2"><span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted/70 text-primary">{icon}</span><h2 className="min-w-0 truncate text-base font-semibold tracking-tight">{title}</h2>{count ? <span className="shrink-0 text-xs text-muted-foreground">{count}</span> : null}</div>{description ? <p className="m-0 text-xs text-muted-foreground">{description}</p> : null}</div>{action}</header>{children}</section>;
}

function MilestoneSummaryStrip({ project, milestone, tickets, activeCount, onEdit }: { project: Project; milestone: Milestone; tickets: Ticket[]; activeCount: number; onEdit: () => void }) {
  const total = milestone.ticket_count ?? tickets.length;
  return <div className="flex min-w-0 flex-wrap items-center gap-2 xl:flex-nowrap" aria-label="里程碑摘要">
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2 xl:flex-nowrap">
      <DetailMeta icon={<RiSettings3Line />} label="负责人" value={milestone.owner_name || "当前用户"} />
      <DetailMeta icon={<RiInformationLine />} label="项目 / 里程碑" value={<span className="min-w-0 truncate">{project.name} · {milestone.name}</span>} />
      <DetailMeta icon={<RiFileTextLine />} label="关联工单" value={<span className="flex min-w-0 items-center gap-1"><span>{total} 个已关联</span><span className="text-muted-foreground">· {activeCount} 待处理</span></span>} />
      <DetailMeta icon={<RiTimeLine />} label="目标时间" value={formatDate(milestone.target_at)} />
    </div>
    <Button className="shrink-0" onClick={onEdit}><RiEditLine data-icon="inline-start" />编辑里程碑</Button>
  </div>;
}

function MilestoneInfoRow({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return <div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-3 py-3 first:pt-0 last:pb-0"><span className="flex size-5 shrink-0 items-center justify-center text-muted-foreground">{icon}</span><div className="grid min-w-0 gap-0.5 sm:grid-cols-[5.5rem_minmax(0,1fr)] sm:items-center sm:gap-3"><dt className="text-xs text-muted-foreground">{label}</dt><dd className="m-0 min-w-0 truncate text-sm font-medium text-foreground sm:text-right">{children}</dd></div></div>;
}

function MilestoneInfoRail({ project, milestone, timeline, resources }: { project: Project; milestone: Milestone; timeline: TimelineEvent[]; resources: RelatedResource[] }) {
  const progress = milestone.progress ?? 0;
  return <aside className="grid min-w-0 content-start gap-4">
    <Card className="min-w-0">
      <CardHeader className="pb-3">
        <CardTitle className="flex min-w-0 items-center gap-2"><span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted/70 text-primary"><RiBarChartLine /></span><span className="truncate">阶段进度</span></CardTitle>
        <CardAction><span className="text-lg font-semibold tabular-nums text-primary">{progress}%</span></CardAction>
      </CardHeader>
      <CardContent className="grid gap-2 pt-0">
        <Progress value={progress} aria-label={"阶段进度 " + progress + "%"} />
        <span className="text-xs text-muted-foreground">{milestone.progress_mode === "manual" ? "手动进度" : "按工单数量"}</span>
      </CardContent>
    </Card>
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle className="flex min-w-0 items-center gap-2"><span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted/70 text-primary"><RiCalendarLine /></span><span className="truncate">里程碑信息</span></CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="grid min-w-0 divide-y divide-border">
          <MilestoneInfoRow icon={<RiFlagLine />} label="所属项目">{project.name}</MilestoneInfoRow>
          <MilestoneInfoRow icon={<RiCalendarLine />} label="里程碑"><span className="inline-flex max-w-full items-center justify-end gap-2"><span className="min-w-0 truncate">{milestone.name}</span><StatusBadge value={milestone.status} /></span></MilestoneInfoRow>
          <MilestoneInfoRow icon={<RiTimeLine />} label="目标日期">{formatDate(milestone.target_at)}</MilestoneInfoRow>
          <MilestoneInfoRow icon={<RiTimeLine />} label="当前负责人">{milestone.owner_name || "当前用户"}</MilestoneInfoRow>
          <MilestoneInfoRow icon={<RiBarChartLine />} label="进度计算">{milestone.progress_mode === "manual" ? "手动设置" : "按工单数量"}</MilestoneInfoRow>
          <MilestoneInfoRow icon={<RiTimeLine />} label="创建时间">{formatDateTime(milestone.created_at)}</MilestoneInfoRow>
          <MilestoneInfoRow icon={<RiRefreshLine />} label="更新时间">{formatDateTime(milestone.updated_at)}</MilestoneInfoRow>
        </dl>
      </CardContent>
    </Card>
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle className="flex min-w-0 items-center gap-2"><span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted/70 text-primary"><RiTimeLine /></span><span className="truncate">里程碑动态</span></CardTitle>
        <CardDescription>记录当前阶段的重要变化。</CardDescription>
        <CardAction><span className="text-xs text-muted-foreground">{timeline.length} 条</span></CardAction>
      </CardHeader>
      <CardContent>{timeline.length ? <TimelineList items={timeline} /> : <p className="m-0 text-sm text-muted-foreground">暂无动态。</p>}</CardContent>
    </Card>
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle className="flex min-w-0 items-center gap-2"><span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted/70 text-primary"><RiLinkM /></span><span className="truncate">关联资源</span></CardTitle>
        <CardDescription>当前阶段可使用的项目资源。</CardDescription>
        <CardAction><span className="text-xs text-muted-foreground">{resources.length} 项</span></CardAction>
      </CardHeader>
      <CardContent>{resources.length ? <div className="grid min-w-0 divide-y divide-border">{resources.map((resource) => <div key={resource.id} className="flex min-w-0 items-center gap-3 py-3 first:pt-0 last:pb-0"><RiLinkM className="size-4 shrink-0 text-muted-foreground" /><span className="min-w-0 truncate text-sm">{resource.name}</span></div>)}</div> : <p className="m-0 text-sm text-muted-foreground">暂未关联资源。</p>}</CardContent>
    </Card>
  </aside>;
}

type GanttScale = "month" | "week" | "day" | "hour" | "quarter-hour";
type GanttBucket = { key: string; start: Date; label: string };
type GanttSegment = { id: string; name: string; status: string; start: Date; end: Date; stageIndex: number };
type GanttSegmentLayout = GanttSegment & { left: number; width: number; lane: number; stacked: boolean };
type GanttTicketTimeline = { created: Date | undefined; completed: Date | undefined; segments: GanttSegment[] };

const ganttStageClasses = ["bg-gantt-stage-1", "bg-gantt-stage-2", "bg-gantt-stage-3", "bg-gantt-stage-4", "bg-gantt-stage-5"];

function ganttStatusClass(value: string) {
  if (value === "blocked") return "bg-destructive";
  if (["completed", "in_progress"].includes(value)) return "bg-primary";
  if (["cancelled", "archived"].includes(value)) return "bg-muted-foreground/50";
  return "bg-muted-foreground/35";
}

function ganttSegmentClass(nodeStatus: string, ticketStatus: string, stageIndex: number) {
  if (["blocked", "overdue"].includes(nodeStatus) || ticketStatus === "blocked") return "bg-destructive";
  if (["cancelled", "archived"].includes(nodeStatus) || ["cancelled", "archived"].includes(ticketStatus)) return "bg-muted-foreground/50";
  return ganttStageClasses[stageIndex % ganttStageClasses.length] ?? ganttStatusClass(nodeStatus);
}

function ganttShortDate(value: Date) { return `${value.getMonth() + 1}/${value.getDate()}`; }

function addHours(value: Date, hours: number) { return new Date(value.getTime() + hours * 3_600_000); }
function addMinutes(value: Date, minutes: number) { return new Date(value.getTime() + minutes * 60_000); }

function ganttScaleStep(value: Date, scale: GanttScale) {
  if (scale === "month") return addMonths(value, 1);
  if (scale === "week") return addDays(value, 7);
  if (scale === "day") return addDays(value, 1);
  if (scale === "hour") return addHours(value, 1);
  return addMinutes(value, 15);
}

function ganttBucketLabel(value: Date, scale: GanttScale) {
  if (scale === "month") return `${value.getFullYear()}年${value.getMonth() + 1}月`;
  if (scale === "week" || scale === "day") return ganttShortDate(value);
  const hours = String(value.getHours()).padStart(2, "0");
  const minutes = String(value.getMinutes()).padStart(2, "0");
  return scale === "hour" ? `${ganttShortDate(value)} ${hours}:${minutes}` : `${hours}:${minutes}`;
}

function ganttDefaultScale(range: { start: Date; end: Date }): GanttScale {
  const hours = (range.end.getTime() - range.start.getTime()) / 3_600_000;
  if (hours <= 12) return "quarter-hour";
  if (hours <= 24) return "hour";
  const days = hours / 24;
  if (days > 90) return "month";
  if (days > 14) return "week";
  return "day";
}

function ganttLabelInterval(scale: GanttScale, bucketCount: number) {
  if (scale === "quarter-hour") return bucketCount > 192 ? 48 : bucketCount > 96 ? 12 : 1;
  if (scale === "hour") return bucketCount > 72 ? 12 : bucketCount > 36 ? 6 : 1;
  if (scale === "day") return bucketCount > 31 ? 7 : 1;
  return 1;
}

function ganttGridStyle(bucketCount: number): CSSProperties {
  const cellWidth = 100 / Math.max(1, bucketCount);
  return { backgroundImage: `repeating-linear-gradient(to right, color-mix(in oklch, var(--border), transparent 50%) 0 1px, transparent 1px ${cellWidth}%)` };
}

function latestDate(values: Array<Date | undefined>) {
  return values.filter((value): value is Date => Boolean(value)).sort((left, right) => right.getTime() - left.getTime())[0];
}

function ganttTicketTimeline(ticket: Ticket, now: Date): GanttTicketTimeline {
  const created = parseDate(ticket.created_at);
  let previousEnd = created;
  const segments: GanttSegment[] = [];
  ticket.node_instances.forEach((node, index) => {
    const active = ["ready", "in_progress", "blocked", "waiting"].includes(node.status);
    const ended = parseDate(node.completed_at) ?? (active ? now : node.status === "cancelled" ? parseDate(ticket.updated_at) : undefined);
    if (!ended) return;
    const started = index === 0 ? (created ?? parseDate(node.started_at)) : (parseDate(node.started_at) ?? previousEnd);
    if (!started) return;
    const end = ended.getTime() >= started.getTime() ? ended : started;
    segments.push({ id: node.id, name: node.name, status: node.status, start: started, end, stageIndex: index });
    previousEnd = end;
  });
  const completed = latestDate(ticket.node_instances.map((node) => parseDate(node.completed_at)));
  return { created, completed, segments };
}

function ganttTicketEnd(ticket: Ticket, now: Date) {
  const timeline = ganttTicketTimeline(ticket, now);
  const ended = ["completed", "cancelled", "archived"].includes(ticket.status);
  return ended ? timeline.completed ?? parseDate(ticket.updated_at) ?? now : now;
}

function ganttSegmentLayouts(segments: GanttSegment[], range: { start: Date; end: Date }): GanttSegmentLayout[] {
  const raw = segments.map((segment) => {
    const left = ganttPosition(segment.start, range.start, range.end);
    const right = ganttPosition(segment.end, range.start, range.end);
    return { segment, left, width: Math.max(1.5, right - left) };
  });
  const layouts: GanttSegmentLayout[] = [];
  for (const [index, item] of raw.entries()) {
    const overlaps = raw.some((other, otherIndex) => otherIndex !== index && item.left < other.left + other.width && other.left < item.left + item.width);
    const previousLanes = layouts.filter((other) => item.left < other.left + other.width && other.left < item.left + other.width).map((other) => other.lane);
    let lane = 0;
    while (previousLanes.includes(lane)) lane += 1;
    layouts.push({ ...item.segment, left: item.left, width: item.width, lane, stacked: overlaps });
  }
  return layouts;
}

function ganttRange(tickets: Ticket[], now: Date) {
  const starts = tickets.map((ticket) => parseDate(ticket.created_at)).filter((value): value is Date => Boolean(value));
  const ends = tickets.map((ticket) => ganttTicketEnd(ticket, now));
  const start = starts.length ? new Date(Math.min(...starts.map((value) => value.getTime()))) : new Date(now);
  const latest = ends.length ? new Date(Math.max(...ends.map((value) => value.getTime()))) : new Date(start);
  const end = latest.getTime() > start.getTime() ? latest : addHours(start, 1);
  return { start, end };
}

function ganttBuckets(range: { start: Date; end: Date }, scale: GanttScale): GanttBucket[] {
  const result: GanttBucket[] = [];
  let cursor = new Date(range.start);
  while (cursor < range.end) {
    result.push({ key: cursor.toISOString(), start: new Date(cursor), label: ganttBucketLabel(cursor, scale) });
    cursor = ganttScaleStep(cursor, scale);
  }
  return result;
}

function GanttLegend({ stageCount }: { stageCount: number }) {
  const visibleStageCount = Math.min(Math.max(stageCount, 1), ganttStageClasses.length);
  const stageItems = ganttStageClasses.slice(0, visibleStageCount).map((className, index) => [`阶段${index + 1}`, className]);
  const items = [...stageItems, ["阻塞", "bg-destructive"], ["终止", "bg-muted-foreground/50"]];
  return <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground" aria-label="甘特图节点颜色图例"><span className="font-medium text-foreground">节点颜色</span>{items.map(([label, className]) => <span key={label} className="inline-flex items-center gap-1.5"><span className={`size-2 rounded-sm ${className}`} aria-hidden="true" />{label}</span>)}</div>;
}

type GanttTicketRowProps = { ticket: Ticket; selected: boolean; onSelect: () => void };

function GanttTicketSelection({ ticket, selected, onSelect, children }: GanttTicketRowProps & { children: ReactNode }) {
  return <div className={cn("h-12 min-w-0 border-b border-border/60 transition-colors", selected ? "bg-primary/5" : "bg-card")} role="button" tabIndex={0} aria-selected={selected} aria-label={"选择工单 " + ticket.title} onClick={onSelect} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(); } }}>{children}</div>;
}

function GanttTicketInfoRow({ ticket, selected, onSelect }: GanttTicketRowProps) {
  const current = currentTicketNode(ticket);
  return <GanttTicketSelection ticket={ticket} selected={selected} onSelect={onSelect}><div className="grid h-full min-w-0 grid-cols-[minmax(0,1fr)_minmax(5.5rem,5.5rem)]">
    <div className="grid min-w-0 content-center gap-0.5 px-3 sm:px-4"><span className="truncate text-sm font-semibold text-primary" title={ticket.title}>{ticket.title}</span><span className="truncate text-[10px] text-muted-foreground" title={ticket.number}>{ticket.number}</span></div>
    <div className="flex min-w-0 items-center justify-center border-l border-border/60 px-2"><Badge variant="outline" className="max-w-full truncate border-primary/30 bg-primary/5 text-primary" title={current}>{current}</Badge></div>
  </div></GanttTicketSelection>;
}

function GanttTicketTimelineRow({ ticket, milestones, buckets, range, now, today, selected, onSelect, chartGrid }: { ticket: Ticket; milestones: Milestone[]; buckets: GanttBucket[]; range: { start: Date; end: Date }; now: Date; today: Date; selected: boolean; onSelect: () => void; chartGrid: CSSProperties }) {
  const timeline = ganttTicketTimeline(ticket, now);
  const segmentLayouts = ganttSegmentLayouts(timeline.segments, range);
  const markerPosition = timeline.created ? ganttPosition(timeline.created, range.start, range.end) : 0;
  const todayPosition = ["completed", "cancelled", "archived"].includes(ticket.status) ? null : Math.min(ganttPosition(today, range.start, range.end), 98.5);
  return <GanttTicketSelection ticket={ticket} selected={selected} onSelect={onSelect}><div className="relative h-full min-w-0 px-3 sm:px-4">
    <div className="pointer-events-none absolute inset-0" style={chartGrid} />
    {milestones.map((milestone) => { const target = parseDate(milestone.target_at); if (!target) return null; return <span key={milestone.id} className="pointer-events-none absolute inset-y-0 border-l border-dashed border-primary/35" style={{ left: ganttPosition(target, range.start, range.end) + "%" }} aria-hidden="true" />; })}
    {todayPosition !== null ? <span className="pointer-events-none absolute inset-y-0 border-l border-dashed border-primary/70" style={{ left: todayPosition + "%" }} aria-hidden="true" /> : null}
    {segmentLayouts.length ? segmentLayouts.map((segment, segmentIndex) => { const summary = segment.name + " · " + formatDate(segment.start.toISOString()) + " 至 " + formatDate(segment.end.toISOString()); const top = segment.stacked ? (segment.lane === 0 ? "calc(50% - 0.75rem)" : "calc(50% + 0.75rem)") : "50%"; const left = Math.min(segment.left, 99); const width = Math.min(segment.width, 100 - left); const hasNeighbors = segmentLayouts.length > 1; const insetStart = hasNeighbors && segmentIndex > 0 ? 2 : 0; const insetEnd = hasNeighbors && segmentIndex < segmentLayouts.length - 1 ? 2 : 0; return <Fragment key={segment.id}><span className={"absolute z-10 h-5 -translate-y-1/2 rounded-[calc(var(--radius-sm)-4px)] " + ganttSegmentClass(segment.status, ticket.status, segment.stageIndex)} style={{ left: `calc(${left}% + ${insetStart}px)`, width: `max(2px, calc(${width}% - ${insetStart + insetEnd}px))`, top }} title={summary} aria-label={summary} /></Fragment>; }) : <span className="absolute top-1/2 flex -translate-y-1/2 items-center gap-2" style={{ left: markerPosition + "%" }} title={ticket.title + " · 尚未开始执行"}><span className="size-2.5 shrink-0 rounded-full border-2 border-card bg-muted-foreground/50" /><span className="whitespace-nowrap text-xs text-muted-foreground">待开始 · {timeline.created ? ganttShortDate(timeline.created) : ""}</span></span>}
  </div></GanttTicketSelection>;
}

type GanttGroupData = { key: string; title: string; tickets: Ticket[] };

function ganttGroups(milestones: Milestone[], tickets: Ticket[]): GanttGroupData[] {
  const groups = milestones.map((milestone) => ({ key: milestone.id, title: milestone.name, tickets: [] as Ticket[] }));
  const byMilestone = new Map(groups.map((group) => [group.key, group]));
  const unknown = new Map<string, GanttGroupData>();
  const unassigned: Ticket[] = [];
  for (const ticket of tickets) {
    if (!ticket.milestone_id) { unassigned.push(ticket); continue; }
    const known = byMilestone.get(ticket.milestone_id);
    if (known) { known.tickets.push(ticket); continue; }
    const group = unknown.get(ticket.milestone_id) ?? { key: ticket.milestone_id, title: ticket.milestone_name || "未命名里程碑", tickets: [] };
    group.tickets.push(ticket); unknown.set(ticket.milestone_id, group);
  }
  const sortTickets = (items: Ticket[]) => items.sort((left, right) => (parseDate(left.created_at)?.getTime() ?? Number.MAX_SAFE_INTEGER) - (parseDate(right.created_at)?.getTime() ?? Number.MAX_SAFE_INTEGER));
  return [...groups, ...unknown.values(), ...(unassigned.length ? [{ key: "unassigned", title: "未关联里程碑", tickets: unassigned }] : [])].filter((group) => group.tickets.length).map((group) => ({ ...group, tickets: sortTickets(group.tickets) }));
}

function GanttGroup({ title, tickets, pane, ...props }: { title: string; tickets: Ticket[]; pane: "info" | "timeline"; projectId: string; milestones: Milestone[]; buckets: GanttBucket[]; range: { start: Date; end: Date }; now: Date; today: Date; selectedId: string; onSelect: (id: string) => void; router: Router; chartGrid: CSSProperties }) {
  const groupHeader = pane === "info" ? <div className="flex h-8 min-w-0 items-center gap-2 border-b border-border/60 bg-muted/30 px-3 text-xs font-medium sm:px-4"><span className="truncate">{title}</span><span className="shrink-0 text-muted-foreground">{tickets.length} 条</span></div> : <div className="h-8 border-b border-border/60 bg-muted/30" aria-hidden="true" />;
  return <>{groupHeader}{tickets.map((ticket) => pane === "info" ? <GanttTicketInfoRow key={ticket.id} ticket={ticket} selected={props.selectedId === ticket.id} onSelect={() => props.onSelect(ticket.id)} /> : <GanttTicketTimelineRow key={ticket.id} ticket={ticket} {...props} selected={props.selectedId === ticket.id} onSelect={() => props.onSelect(ticket.id)} />)}</>;
}

function GanttBoard({ milestones, tickets, projectId, selectedId, onSelect, router }: { milestones: Milestone[]; tickets: Ticket[]; projectId: string; selectedId: string; onSelect: (id: string) => void; router: Router }) {
  const now = new Date();
  const today = now;
  const [scale, setScale] = useState<GanttScale>(() => {
    const defaultRange = ganttRange(tickets, new Date());
    return ganttDefaultScale(defaultRange);
  });
  const range = useMemo(() => ganttRange(tickets, now), [tickets, now.getTime()]);
  const shortScalesAllowed = range.end.getTime() - range.start.getTime() <= 24 * 3_600_000;
  useEffect(() => { if (!shortScalesAllowed && ["hour", "quarter-hour"].includes(scale)) setScale("day"); }, [scale, shortScalesAllowed]);
  const buckets = useMemo(() => ganttBuckets(range, scale), [range, scale]);
  const groups = useMemo(() => ganttGroups(milestones, tickets), [milestones, tickets]);
  const chartGrid = useMemo(() => ganttGridStyle(buckets.length), [buckets.length]);
  const milestoneMarkers = milestones.map((milestone) => {
    const target = parseDate(milestone.target_at);
    return target && target >= range.start && target <= range.end ? { milestone, position: ganttPosition(target, range.start, range.end) } : null;
  }).filter((item): item is { milestone: Milestone; position: number } => Boolean(item));
  const todayPosition = tickets.some((ticket) => !["completed", "cancelled", "archived"].includes(ticket.status)) ? ganttPosition(today, range.start, range.end) : null;
  const todayLinePosition = todayPosition === null ? null : Math.min(todayPosition, 98.5);
  const todayLabelAlignment = todayLinePosition !== null && todayLinePosition > 88 ? "-translate-x-full" : "-translate-x-1/2";

  const stageCount = Math.max(1, ...tickets.map((ticket) => ticket.node_instances.length));
  return <Card className="min-w-0 gap-2 py-2">
    <CardHeader className="p-2 sm:p-2.5">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 flex-1"><GanttLegend stageCount={stageCount} /></div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Select value={scale} onValueChange={(value) => { if (!shortScalesAllowed && ["hour", "quarter-hour"].includes(value ?? "")) return; setScale((value as GanttScale) || "day"); }}><SelectTrigger className="w-28" aria-label="甘特图时间尺度"><SelectValue /></SelectTrigger><SelectContent><SelectGroup><SelectLabel>时间尺度</SelectLabel>{shortScalesAllowed ? <><SelectItem value="quarter-hour">按15分钟</SelectItem><SelectItem value="hour">按小时</SelectItem></> : null}<SelectItem value="day">按天</SelectItem><SelectItem value="week">按周</SelectItem><SelectItem value="month">按月</SelectItem></SelectGroup></SelectContent></Select>
        </div>
      </div>
    </CardHeader>
    <CardContent className="min-w-0 px-0 pb-2 pt-0 sm:pb-3">
      {tickets.length ? <div className="grid min-w-0 grid-cols-[minmax(11rem,12.5rem)_minmax(0,1fr)] border-y border-border/70" aria-label="项目工单甘特图">
        <div className="min-w-0 border-r border-border/60">
          <div className="grid h-12 min-w-0 grid-cols-[minmax(0,1fr)_minmax(5.5rem,5.5rem)] border-b border-border/60 bg-muted/70">
            <div className="flex min-w-0 items-center gap-1.5 px-3 text-xs font-medium text-muted-foreground sm:px-4"><RiFileTextLine className="size-3.5 shrink-0 text-primary" aria-hidden="true" /><span className="truncate">工单标题</span></div><div className="flex min-w-0 items-center justify-center border-l border-border/60 px-2 text-xs font-medium text-muted-foreground">当前节点</div>
          </div>
          {groups.map((group) => <GanttGroup key={group.key} pane="info" title={group.title} tickets={group.tickets} projectId={projectId} milestones={milestones} buckets={buckets} range={range} now={now} today={today} selectedId={selectedId} onSelect={onSelect} router={router} chartGrid={chartGrid} />)}
        </div>
        <div className="tn-workflow-tickets-gantt__timeline min-w-0">
          <div className="min-w-0" aria-label="甘特图日期区域">
            <div className="min-w-0">
              <div className="relative h-12 min-w-0 border-b border-border/60 bg-muted/20 px-3 sm:px-4">
                <div className="pointer-events-none absolute inset-0" style={chartGrid} />
                <div className="pointer-events-none absolute inset-0">{buckets.map((bucket, index) => { const interval = ganttLabelInterval(scale, buckets.length); if (index % interval !== 0) return null; const left = index / Math.max(1, buckets.length) * 100; const width = Math.min(interval / Math.max(1, buckets.length) * 100, 100 - left); return <span key={bucket.key} className="absolute inset-y-0 flex min-w-0 items-center overflow-hidden px-1.5 text-[11px] text-muted-foreground sm:px-2" style={{ left: left + "%", width: width + "%" }}><span className="truncate">{bucket.label}</span></span>; })}</div>
                {milestoneMarkers.map(({ milestone, position }) => <span key={milestone.id} className="absolute top-1 z-10 max-w-28 -translate-x-1/2 truncate text-[10px] font-medium text-primary" style={{ left: position + "%" }} title={milestone.name + " · " + formatDate(milestone.target_at)}>{milestone.name}</span>)}
                {todayLinePosition !== null ? <><span className={cn("absolute top-1/2 z-10 -translate-y-1/2 whitespace-nowrap rounded-sm bg-card px-1 text-[10px] font-medium text-primary", todayLabelAlignment)} style={{ left: todayLinePosition + "%" }}>今天</span><span className="absolute inset-y-0 border-l-2 border-dashed border-primary/70" style={{ left: todayLinePosition + "%" }} aria-label="今天" /></> : null}
              </div>
              {groups.map((group) => <GanttGroup key={group.key} pane="timeline" title={group.title} tickets={group.tickets} projectId={projectId} milestones={milestones} buckets={buckets} range={range} now={now} today={today} selectedId={selectedId} onSelect={onSelect} router={router} chartGrid={chartGrid} />)}
            </div>
          </div>
        </div>
      </div> : <div className="px-4 sm:px-5"><EmptyState description="暂无关联工单。" /></div>}
    </CardContent>
  </Card>;
}

function TicketDetailRow({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return <div className="flex min-w-0 items-center justify-between gap-3 py-2 first:pt-0 last:pb-0"><dt className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground"><span className="flex size-4 shrink-0 items-center justify-center">{icon}</span><span className="truncate">{label}</span></dt><dd className="m-0 min-w-0 truncate text-right text-sm font-medium text-foreground">{children}</dd></div>;
}

function TicketDetailsRail({ selectedTicket, timeline, loading, projectId, router }: { selectedTicket: Ticket | undefined; timeline: TimelineEvent[]; loading: boolean; projectId: string; router: Router }) {
  if (!selectedTicket) return <Card className="min-w-0"><CardHeader><CardTitle>工单动态</CardTitle><CardDescription>选择一个工单查看详情和活动记录。</CardDescription></CardHeader><CardContent><p className="m-0 text-sm text-muted-foreground">暂无可查看的工单。</p></CardContent></Card>;
  const progress = ticketProgress(selectedTicket);
  return <Card className="min-w-0 self-start">
    <CardHeader className="gap-2">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0"><CardTitle>工单详情</CardTitle><CardDescription className="truncate">{selectedTicket.number}</CardDescription></div>
        <StatusBadge value={selectedTicket.status} />
      </div>
      <CardAction><Button type="button" size="sm" variant="outline" onClick={() => void router.push(projectTicketPath(projectId, selectedTicket.id, "tickets"))}><RiExternalLinkLine data-icon="inline-start" />进入工单</Button></CardAction>
    </CardHeader>
    <CardContent className="grid min-w-0 gap-4 pt-0">
      <div className="grid gap-1"><h3 className="m-0 min-w-0 truncate text-base font-semibold">{selectedTicket.title}</h3>{selectedTicket.note ? <p className="m-0 line-clamp-2 text-xs text-muted-foreground">{selectedTicket.note}</p> : null}</div>
      <div className="grid gap-2">
        <div className="flex items-center justify-between gap-3 text-xs"><span className="text-muted-foreground">进度</span><span className="font-medium tabular-nums text-primary">{progress}%</span></div>
        <Progress value={progress} aria-label={selectedTicket.title + "进度 " + progress + "%"} />
      </div>
      <dl className="grid divide-y divide-border/70 border-y border-border/70">
        <TicketDetailRow icon={<RiSettings3Line />} label="当前节点">{currentTicketNode(selectedTicket)}</TicketDetailRow>
        <TicketDetailRow icon={<RiSettings3Line />} label="负责人">{selectedTicket.owner_name || "当前用户"}</TicketDetailRow>
        <TicketDetailRow icon={<RiCalendarLine />} label="目标完成时间">{selectedTicket.due_at ? formatDateTime(selectedTicket.due_at) : "未设置"}</TicketDetailRow>
        <TicketDetailRow icon={<RiFlagLine />} label="所属里程碑">{selectedTicket.milestone_name || "未关联里程碑"}</TicketDetailRow>
        <TicketDetailRow icon={<RiInformationLine />} label="优先级">{ticketPriorityLabels[selectedTicket.priority] ?? "无优先级"}</TicketDetailRow>
      </dl>
      <section className="grid gap-3 border-t border-border/70 pt-4">
        <div className="flex min-w-0 items-center justify-between gap-3"><h3 className="m-0 text-base font-semibold">活动记录</h3><span className="shrink-0 text-xs text-muted-foreground">{timeline.length} 条</span></div>
        {loading ? <p className="m-0 text-sm text-muted-foreground">正在加载活动记录…</p> : timeline.length ? <TimelineList items={timeline} /> : <p className="m-0 text-sm text-muted-foreground">暂无活动记录。</p>}
      </section>
    </CardContent>
  </Card>;
}

function TicketsTab({ api, projectId, milestones, tickets, router }: { api: WorkflowApi; projectId: string; milestones: Milestone[]; tickets: Ticket[]; router: Router }) {
  const initialSelectedId = tickets.find((ticket) => !["completed", "cancelled", "archived"].includes(ticket.status))?.id ?? tickets[0]?.id ?? "";
  const [selectedId, setSelectedId] = useState(initialSelectedId);
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const selectedTicket = tickets.find((ticket) => ticket.id === selectedId);

  useEffect(() => { if (!tickets.some((ticket) => ticket.id === selectedId)) setSelectedId(initialSelectedId); }, [initialSelectedId, selectedId, tickets]);
  useEffect(() => { if (!selectedId) { setTimeline([]); return; } setLoading(true); void api.getTimeline({ ticket_id: selectedId }).then(setTimeline).catch(() => setTimeline([])).finally(() => setLoading(false)); }, [api, selectedId]);

  return <div className="grid min-w-0 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(20rem,0.4fr)]">
    <GanttBoard milestones={milestones} tickets={tickets} projectId={projectId} selectedId={selectedId} onSelect={setSelectedId} router={router} />
    <TicketDetailsRail selectedTicket={selectedTicket} timeline={timeline} loading={loading} projectId={projectId} router={router} />
  </div>;
}

function MilestoneFormDialog({ api, projectId, milestone, open, onOpenChange, onSaved }: { api: WorkflowApi; projectId: string; milestone: Milestone | undefined; open: boolean; onOpenChange: (open: boolean) => void; onSaved: () => Promise<void> }) {
  const [draft, setDraft] = useState<MilestoneDraft>({ name: "", goal: "", target_at: "", status: "pending", completion_criteria: "", risk_note: "", review_markdown: "", progress_mode: "ticket_count", manual_progress: "0", owner_name: "" }); const [error, setError] = useState(""); const [saving, setSaving] = useState(false);
  useEffect(() => { if (!open) return; setDraft({ name: milestone?.name ?? "", goal: milestone?.goal ?? milestone?.description ?? "", target_at: dateInput(milestone?.target_at), status: normalizeMilestoneStatus(milestone?.status ?? "pending"), completion_criteria: milestone?.completion_criteria ?? "", risk_note: milestone?.risk_note ?? "", review_markdown: milestone?.review_markdown ?? milestone?.review ?? "", progress_mode: milestone?.progress_mode === "manual" ? "manual" : "ticket_count", manual_progress: String(milestone?.manual_progress ?? milestone?.progress ?? 0), owner_name: milestone?.owner_name ?? "" }); setError(""); }, [milestone, open]);
  const update = (key: keyof MilestoneDraft, value: string) => setDraft((current) => ({ ...current, [key]: value }));
  const save = async (event: FormEvent) => { event.preventDefault(); if (!draft.name.trim()) { setError("里程碑名称不能为空。"); return; } setSaving(true); setError(""); try { const payload = { name: draft.name.trim(), goal: draft.goal.trim(), target_at: toIso(draft.target_at), status: draft.status, completion_criteria: draft.completion_criteria, risk_note: draft.risk_note, review_markdown: draft.review_markdown, progress_mode: draft.progress_mode, manual_progress: Number(draft.manual_progress) || 0, owner_name: draft.owner_name }; if (milestone) await api.updateMilestone(projectId, milestone.id, payload); else await api.createMilestone(projectId, payload); await onSaved(); onOpenChange(false); } catch (err) { setError(errorMessage(err, milestone ? "保存里程碑失败" : "创建里程碑失败")); } finally { setSaving(false); } };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-lg" style={{ maxWidth: "var(--container-4xl)" }}>
        <DialogHeader>
          <DialogTitle>{milestone ? "编辑里程碑" : "新建里程碑"}</DialogTitle>
          <DialogDescription>用阶段目标、完成标准和复盘记录推动项目进展。</DialogDescription>
        </DialogHeader>
        <form className="grid min-h-0 gap-4" onSubmit={save}>
          <FieldGroup className="gap-3">
            <Field><FieldLabel>里程碑名称</FieldLabel><Input value={draft.name} onChange={(event) => update("name", event.target.value)} autoFocus /></Field>
            <Field><FieldLabel>阶段目标</FieldLabel><Textarea value={draft.goal} onChange={(event) => update("goal", event.target.value)} rows={2} /></Field>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field><FieldLabel>目标日期</FieldLabel><MilestoneDatePicker value={draft.target_at} onChange={(value) => update("target_at", value)} /></Field>
              <Field><FieldLabel>状态</FieldLabel><Select value={draft.status} onValueChange={(value) => update("status", value ?? "pending")}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectGroup><SelectLabel>状态</SelectLabel>{milestoneStatuses.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectGroup></SelectContent></Select></Field>
              <Field><FieldLabel>负责人</FieldLabel><Input value={draft.owner_name} onChange={(event) => update("owner_name", event.target.value)} placeholder="默认当前用户" /></Field>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field><FieldLabel>完成标准</FieldLabel><Textarea value={draft.completion_criteria} onChange={(event) => update("completion_criteria", event.target.value)} rows={2} /></Field>
              <Field><FieldLabel>风险说明</FieldLabel><Textarea value={draft.risk_note} onChange={(event) => update("risk_note", event.target.value)} rows={2} /></Field>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field><FieldLabel>进度计算</FieldLabel><Select value={draft.progress_mode} onValueChange={(value) => update("progress_mode", value ?? "ticket_count")}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectGroup><SelectLabel>计算方式</SelectLabel>{milestoneModes.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectGroup></SelectContent></Select></Field>
              {draft.progress_mode === "manual" ? <Field><FieldLabel>手动进度（%）</FieldLabel><Input type="number" min="0" max="100" value={draft.manual_progress} onChange={(event) => update("manual_progress", event.target.value)} /></Field> : null}
            </div>
            <Field><FieldLabel>里程碑复盘</FieldLabel><Textarea value={draft.review_markdown} onChange={(event) => update("review_markdown", event.target.value)} rows={3} placeholder={"# 阶段结果\n\n记录完成情况和经验。"} /></Field>
          </FieldGroup>
          {error ? <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert> : null}
          <DialogFooter><Button type="button" variant="outline" onClick={() => onOpenChange(false)}>取消</Button><Button type="submit" disabled={saving}>{saving ? "保存中…" : milestone ? "保存修改" : "创建里程碑"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function defaultMilestoneId(milestones: Milestone[]) {
  return milestones.find((item) => normalizeMilestoneStatus(item.status) === "in_progress")?.id ?? milestones.find((item) => normalizeMilestoneStatus(item.status) === "pending")?.id ?? milestones[0]?.id;
}

function MilestoneDatePicker({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  const date = parseDateOnly(value);
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger render={<Button type="button" variant="outline" data-empty={!date} aria-label="选择目标日期" className="w-full justify-start text-left font-normal data-[empty=true]:text-muted-foreground" />}>
      <RiCalendarLine data-icon="inline-start" />
      {date ? format(date, "yyyy年M月d日", { locale: zhCN }) : <span>未设置</span>}
    </PopoverTrigger>
    <PopoverContent className="w-auto p-0" align="start">
      <Calendar className="rounded-md border border-foreground/20" locale={zhCN} mode="single" selected={date} onSelect={(nextDate) => { onChange(nextDate ? format(nextDate, "yyyy-MM-dd") : ""); window.setTimeout(() => setOpen(false), 0); }} />
    </PopoverContent>
  </Popover>;
}

function MilestoneWorkspaceHeader({ milestones, onCreate }: { milestones: Milestone[]; onCreate: () => void }) {
  return <>
    <CardHeader className="gap-0 border-b border-border/60 px-4 py-2.5 sm:px-4">
      <div className="min-w-0"><CardTitle className="flex items-baseline gap-2 text-lg"><span>里程碑</span><span className="text-xs font-normal text-muted-foreground">{milestones.length} 个阶段</span></CardTitle></div>
      <CardAction><Button className="shrink-0" size="sm" onClick={onCreate}><RiAddLine data-icon="inline-start" />新建里程碑</Button></CardAction>
    </CardHeader>
  </>;
}

function milestoneNavigatorToneClass(status: string, selected: boolean) {
  if (selected) return "border-primary/35 bg-primary/5";
  if (status === "completed") return "border-primary/15 bg-primary/[0.03]";
  if (status === "in_progress") return "border-primary/20 bg-primary/[0.04]";
  if (status === "blocked") return "border-destructive/20 bg-destructive/5";
  if (status === "cancelled") return "border-border bg-muted/40";
  return "border-border/70 bg-card";
}

function milestoneStatusRailClass(status: string) {
  return cn(
    "absolute inset-y-1 left-1 w-1 rounded-sm bg-primary",
    status === "completed" && "bg-primary/65",
    status === "pending" && "bg-muted-foreground/60",
    status === "blocked" && "bg-destructive",
    status === "cancelled" && "bg-muted-foreground/45",
  );
}

function MilestonePhaseNavigator({ milestones, ticketsByMilestone, selectedId, onSelect, onEdit, onDelete }: { milestones: Milestone[]; ticketsByMilestone: Map<string, Ticket[]>; selectedId: string | null; onSelect: (id: string) => void; onEdit: (milestone: Milestone) => void; onDelete: (milestone: Milestone) => Promise<void> }) {
  return <nav className="grid min-w-0 gap-2 p-2 sm:p-3" aria-label="里程碑阶段">
    {milestones.map((milestone, index) => {
      const selected = selectedId === milestone.id;
      const status = normalizeMilestoneStatus(milestone.status);
      const linked = ticketsByMilestone.get(milestone.id) ?? [];
      const total = milestone.ticket_count ?? linked.length;
      const progress = milestone.progress ?? 0;
      const completed = milestone.completed_ticket_count ?? linked.filter((ticket) => ticket.status === "completed").length;
      return <div key={milestone.id} className={cn("relative grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-1 rounded-md border px-2.5 py-2 pl-4", milestoneNavigatorToneClass(status, selected), !selected && "hover:border-border hover:bg-muted/40")}>
        <span className={milestoneStatusRailClass(status)} aria-hidden="true" />
        <button type="button" aria-current={selected ? "step" : undefined} className="group grid min-w-0 gap-1.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => onSelect(milestone.id)}>
          <span className="flex min-w-0 items-center gap-2"><span className="flex size-5 shrink-0 items-center justify-center rounded-sm bg-muted/70 text-[10px] font-semibold tabular-nums text-muted-foreground">{String(index + 1).padStart(2, "0")}</span><span className="min-w-0 truncate text-sm font-semibold" title={milestone.name}>{milestone.name}</span><StatusBadge value={milestone.status} /></span>
          <span className="flex min-w-0 items-center gap-2"><Progress className="h-1.5 min-w-0 flex-1" value={progress} aria-label={milestone.name + "进度 " + progress + "%"} /><span className="shrink-0 text-xs tabular-nums text-muted-foreground">{progress}%</span></span>
          <span className="line-clamp-1 text-xs leading-4 text-muted-foreground">{milestone.goal ?? milestone.description ?? "暂无阶段目标。"}</span>
          <span className="flex min-w-0 flex-wrap gap-x-2 gap-y-0.5 text-[11px] leading-4 text-muted-foreground"><span className="shrink-0">{completed} / {total} 个工单</span><span className="flex min-w-0 items-center gap-1"><RiCalendarLine className="size-3 shrink-0" aria-hidden="true" /><span className="truncate">{formatDate(milestone.target_at)}</span></span><span className="min-w-0 truncate">负责人 {milestone.owner_name || "当前用户"}</span></span>
        </button>
        <div className="flex items-center gap-0.5"><Button size="icon-sm" variant="ghost" aria-label="编辑里程碑" onClick={(event) => { event.stopPropagation(); onEdit(milestone); }}><RiEditLine /></Button><ConfirmAction title="删除这个里程碑？" description="删除后，关联工单会解除里程碑关联。" ariaLabel="删除里程碑" onConfirm={() => onDelete(milestone)}><RiDeleteBinLine /></ConfirmAction></div>
      </div>;
    })}
  </nav>;
}

function MilestoneTicketRow({ ticket, router }: { ticket: Ticket; router: Router }) {
  const progress = ticketProgress(ticket);
  const currentNode = currentTicketNode(ticket);
  return <article className="relative flex min-h-12 w-full min-w-0 items-stretch gap-2 rounded-md border border-border bg-card pl-4 pr-3 text-left outline-none transition-colors hover:bg-accent focus-within:ring-2 focus-within:ring-ring">
    <span className={ticketStatusRailClass(ticket.status)} aria-hidden="true" />
    <div className="grid min-w-0 flex-1 gap-1 py-2">
      <div className="flex min-w-0 items-start gap-3"><div className="min-w-0 flex-1"><TicketButton ticket={ticket} router={router} /></div><div className="grid shrink-0 justify-items-end gap-1"><StatusBadge value={ticket.status} /><span className="text-xs tabular-nums text-muted-foreground">{progress}%</span></div></div>
      <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground"><span className="min-w-0 truncate">当前节点：{currentNode}</span><Progress className="h-1 w-20 shrink-0" value={progress} aria-label={ticket.title + "进度 " + progress + "%"} /></div>
    </div>
  </article>;
}

function MilestoneMetaItem({ label, value, railClassName }: { label: string; value: ReactNode; railClassName?: string }) {
  return <div className="relative flex h-7 min-w-20 w-fit max-w-full items-center justify-between gap-3 rounded-md border border-border bg-card px-3 pl-4 text-xs/relaxed"><span className={cn("absolute inset-y-1 left-1 w-1 rounded-sm bg-primary", railClassName)} aria-hidden="true" /><span className="min-w-0 truncate text-muted-foreground">{label}</span><span className="min-w-0 truncate font-semibold tabular-nums text-foreground" title={typeof value === "string" ? value : undefined}>{value}</span></div>;
}

function MilestoneDetailPanel({ project, milestone, tickets, projectId, router, onEdit, onClose }: { project: Project; milestone: Milestone | undefined; tickets: Ticket[]; projectId: string; router: Router; onEdit: () => void; onClose: () => void }) {
  if (!milestone) return <Card className="min-w-0"><CardContent className="p-6"><Empty className="min-h-0 items-start border-0 p-0 text-left"><EmptyHeader className="items-start gap-1"><EmptyTitle>选择一个里程碑</EmptyTitle><EmptyDescription>从左侧阶段导航中选择一个里程碑查看执行详情。</EmptyDescription></EmptyHeader></Empty></CardContent></Card>;
  const completionCriteria = milestone.completion_criteria?.trim();
  const riskNote = milestone.risk_note?.trim();
  const review = (milestone.review_markdown ?? milestone.review)?.trim();
  const progress = milestone.progress ?? 0;
  const goal = milestone.goal?.trim() || milestone.description?.trim();
  return <Card className="min-w-0 gap-0">
    <CardHeader className="gap-2 border-b border-border/60 px-4 py-3 sm:px-5">
      <div className="flex min-w-0 flex-wrap items-center gap-2"><div className="flex min-w-0 items-center gap-2"><span className="shrink-0 text-xs font-medium text-muted-foreground">阶段详情</span><CardTitle className="truncate text-lg" title={milestone.name}>{milestone.name}</CardTitle></div><StatusBadge value={milestone.status} /><div className="ml-auto flex shrink-0 items-center gap-1"><Button size="sm" variant="outline" onClick={onEdit}><RiEditLine data-icon="inline-start" />编辑</Button><Button size="sm" variant="ghost" onClick={() => void router.push("/modules/workflow-tickets-react/projects/" + projectId + "/milestones/" + milestone.id)}><RiExternalLinkLine data-icon="inline-start" />查看详情</Button><Button size="icon-sm" variant="ghost" aria-label="关闭里程碑详情" onClick={onClose}><RiCloseLine /></Button></div></div>
      {goal ? <CardDescription className="line-clamp-1 text-xs leading-4">{goal}</CardDescription> : null}
    </CardHeader>
    <CardContent className="grid min-w-0 gap-5 px-4 pb-4 pt-0 sm:px-5">
      <div className="flex min-w-0 flex-wrap items-center gap-2 border-b border-border/60 py-2"><MilestoneMetaItem label="阶段进度" value={<span className="text-primary">{progress}%</span>} /><MilestoneMetaItem railClassName="bg-muted-foreground/60" label="目标日期" value={formatDate(milestone.target_at)} /><MilestoneMetaItem label="负责人" value={milestone.owner_name || "当前用户"} /><MilestoneMetaItem label="关联工单" value={tickets.length + " 条"} /></div>
      <section className="grid min-w-0 gap-3"><div className="flex items-center justify-between gap-3"><h2 className="m-0 text-base font-semibold">关联工单</h2><span className="text-xs text-muted-foreground">{tickets.length} 条</span></div>{tickets.length ? <div className="flex min-w-0 flex-wrap items-start gap-2">{tickets.map((ticket) => <div key={ticket.id} className="w-full max-w-80"><MilestoneTicketRow ticket={ticket} router={router} /></div>)}</div> : <Empty className="min-h-0 items-start border border-dashed border-border/70 bg-muted/20 p-4 text-left"><EmptyHeader className="items-start gap-0.5"><EmptyTitle>还没有关联工单。</EmptyTitle><EmptyDescription>关联工单后，可以在这里跟踪阶段执行进度。</EmptyDescription></EmptyHeader></Empty>}</section>
      {completionCriteria || riskNote ? <section className="grid min-w-0 gap-4 border-t border-border/60 pt-5 sm:grid-cols-2">{completionCriteria ? <div className="min-w-0"><h2 className="m-0 text-sm font-semibold">完成标准</h2><p className="m-0 mt-2 line-clamp-5 whitespace-pre-wrap text-sm leading-5 text-muted-foreground">{completionCriteria}</p></div> : null}{riskNote ? <div className="min-w-0"><h2 className="m-0 text-sm font-semibold">风险说明</h2><p className="m-0 mt-2 line-clamp-5 whitespace-pre-wrap text-sm leading-5 text-muted-foreground">{riskNote}</p></div> : null}</section> : null}
      {review ? <section className="grid min-w-0 gap-2 border-t border-border/60 pt-5"><h2 className="m-0 text-sm font-semibold">里程碑复盘</h2><article className="tn-workflow-tickets-markdown-preview line-clamp-6 min-w-0 text-sm leading-5" dangerouslySetInnerHTML={markdownHtml(review)} /></section> : null}
      <section className="grid min-w-0 gap-3 border-t border-border/60 pt-5"><h2 className="m-0 text-sm font-semibold">项目上下文</h2><div className="grid min-w-0 gap-3 text-sm sm:grid-cols-3"><div className="min-w-0"><span className="block text-xs text-muted-foreground">项目</span><span className="block truncate font-medium" title={project.name}>{project.name}</span><span className="block truncate font-mono text-xs text-muted-foreground" title={project.key}>{project.key}</span></div><div className="min-w-0"><span className="block text-xs text-muted-foreground">项目状态</span><StatusBadge value={project.status} /></div><div className="min-w-0"><span className="block text-xs text-muted-foreground">项目目标日期</span><span className="block truncate font-medium">{formatDate(project.target_at)}</span></div></div></section>
    </CardContent>
  </Card>;
}

function MilestonesTab({ api, project, projectId, milestones, tickets, router, reload }: { api: WorkflowApi; project: Project; projectId: string; milestones: Milestone[]; tickets: Ticket[]; router: Router; reload: () => Promise<void> }) {
  const defaultSelectedId = defaultMilestoneId(milestones);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Milestone>();
  const [selectedMilestoneId, setSelectedMilestoneId] = useState<string | null>(defaultSelectedId ?? null);
  const ticketsByMilestone = useMemo(() => { const map = new Map<string, Ticket[]>(); tickets.forEach((ticket) => { if (!ticket.milestone_id) return; const current = map.get(ticket.milestone_id) ?? []; current.push(ticket); map.set(ticket.milestone_id, current); }); return map; }, [tickets]);
  const selectedMilestone = milestones.find((item) => item.id === selectedMilestoneId);
  const selectedTickets = selectedMilestone ? ticketsByMilestone.get(selectedMilestone.id) ?? [] : [];
  useEffect(() => { setSelectedMilestoneId((current) => current && milestones.some((item) => item.id === current) ? current : defaultSelectedId ?? null); }, [defaultSelectedId, milestones]);
  const edit = (milestone?: Milestone) => { setEditing(milestone); setOpen(true); };
  const deleteMilestone = async (milestone: Milestone) => { await api.deleteMilestone(projectId, milestone.id); await reload(); };
  return <div className="grid min-w-0 items-start gap-5 xl:grid-cols-[minmax(18rem,0.43fr)_minmax(0,1fr)]">
    <Card className="min-w-0"><MilestoneWorkspaceHeader milestones={milestones} onCreate={() => edit()} />{milestones.length ? <MilestonePhaseNavigator milestones={milestones} ticketsByMilestone={ticketsByMilestone} selectedId={selectedMilestoneId} onSelect={setSelectedMilestoneId} onEdit={edit} onDelete={deleteMilestone} /> : <Empty className="min-h-0 items-start border-0 p-6 text-left"><EmptyHeader className="items-start"><EmptyTitle>还没有里程碑。</EmptyTitle><EmptyDescription>点击右上角新建里程碑，开始组织阶段目标。</EmptyDescription></EmptyHeader></Empty>}</Card>
    <MilestoneDetailPanel project={project} milestone={selectedMilestone} tickets={selectedTickets} projectId={projectId} router={router} onEdit={() => edit(selectedMilestone)} onClose={() => setSelectedMilestoneId(null)} />
    <MilestoneFormDialog api={api} projectId={projectId} milestone={editing} open={open} onOpenChange={setOpen} onSaved={reload} />
  </div>;
}

type ResourceCardDraft = {
  name: string;
  resource_type: string;
  identifier: string;
  external_url: string;
  description: string;
  protocol: string;
  port: string;
  environment: string;
  provider: string;
  branch: string;
  repository_path: string;
  document_type: string;
  document_owner: string;
  document_version: string;
  ticket_ids: string[];
  milestone_ids: string[];
};

const emptyResourceCardDraft: ResourceCardDraft = {
  name: "",
  resource_type: "custom",
  identifier: "",
  external_url: "",
  description: "",
  protocol: "ssh",
  port: "",
  environment: "production",
  provider: "github",
  branch: "main",
  repository_path: "",
  document_type: "online",
  document_owner: "",
  document_version: "",
  ticket_ids: [],
  milestone_ids: [],
};

function ResourceCardFormDialog({ api, projectId, tickets, milestones, editing, open, onOpenChange, onSaved }: { api: WorkflowApi; projectId: string; tickets: Ticket[]; milestones: Milestone[]; editing?: RelatedResource; open: boolean; onOpenChange: (open: boolean) => void; onSaved: () => Promise<void> }) {
  const [draft, setDraft] = useState<ResourceCardDraft>(emptyResourceCardDraft);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!open) return;
    const attrs = editing?.attributes ?? {};
    setDraft({
      ...emptyResourceCardDraft,
      name: editing?.name ?? "",
      resource_type: normalizeResourceType(editing?.resource_type ?? editing?.type),
      identifier: editing?.identifier ?? "",
      external_url: editing?.external_url ?? editing?.url ?? "",
      description: editing?.description ?? "",
      protocol: String(attrs.protocol ?? "ssh"),
      port: String(attrs.port ?? ""),
      environment: String(attrs.environment ?? "production"),
      provider: String(attrs.provider ?? "github"),
      branch: String(attrs.branch ?? "main"),
      repository_path: String(attrs.path ?? ""),
      document_type: String(attrs.document_type ?? "online"),
      document_owner: String(attrs.owner ?? ""),
      document_version: String(attrs.version ?? ""),
      ticket_ids: editing?.ticket_ids ?? [],
      milestone_ids: editing?.milestone_ids ?? [],
    });
    setError("");
  }, [editing, open]);
  const update = <K extends keyof ResourceCardDraft>(key: K, value: ResourceCardDraft[K]) => setDraft((current) => ({ ...current, [key]: value }));
  const save = async (event: FormEvent) => {
    event.preventDefault();
    const type = normalizeResourceType(draft.resource_type);
    if (!draft.name.trim()) { setError("资源名称不能为空。"); return; }
    if (type !== "custom" && !draft.identifier.trim()) { setError("请填写资源标识。"); return; }
    if (draft.external_url.trim() && !/^https?:\/\//i.test(draft.external_url.trim())) { setError("外部链接必须以 http:// 或 https:// 开头。"); return; }
    if (type === "server" && draft.port.trim() && (!/^\d+$/.test(draft.port.trim()) || Number(draft.port) < 1 || Number(draft.port) > 65535)) { setError("端口必须是 1 到 65535 之间的数字。"); return; }
    const attributes = type === "server"
      ? { protocol: draft.protocol, port: draft.port, environment: draft.environment }
      : type === "repository"
        ? { provider: draft.provider, branch: draft.branch, path: draft.repository_path }
        : type === "document"
          ? { document_type: draft.document_type, owner: draft.document_owner, version: draft.document_version }
          : {};
    setSaving(true);
    setError("");
    try {
      const payload = {
        project_id: projectId,
        name: draft.name.trim(),
        type,
        resource_type: type,
        identifier: draft.identifier.trim(),
        url: draft.external_url.trim() || null,
        external_url: draft.external_url.trim() || null,
        description: draft.description.trim(),
        attributes,
        ticket_ids: draft.ticket_ids,
        milestone_ids: draft.milestone_ids,
      };
      if (editing) await api.updateResource(editing.id, payload);
      else await api.createResource(payload);
      await onSaved();
      onOpenChange(false);
    } catch (err) {
      setError(errorMessage(err, editing ? "保存资源失败" : "创建资源失败"));
    } finally {
      setSaving(false);
    }
  };
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="max-h-[min(760px,calc(100vh-2rem))] overflow-y-auto sm:max-w-3xl">
      <DialogHeader><DialogTitle>{editing ? "编辑资源" : "关联资源"}</DialogTitle><DialogDescription>登记项目上下文，并把资源连接到相关工单和里程碑。</DialogDescription></DialogHeader>
      <form className="grid gap-5" onSubmit={save}>
        <FieldGroup>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field><FieldLabel>资源名称</FieldLabel><Input value={draft.name} onChange={(event) => update("name", event.target.value)} autoFocus /></Field>
            <Field><FieldLabel>资源类型</FieldLabel><Select value={draft.resource_type} onValueChange={(value) => update("resource_type", value ?? "custom")}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectGroup><SelectLabel>类型</SelectLabel>{resourceTypes.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectGroup></SelectContent></Select></Field>
          </div>
          <Field><FieldLabel>{draft.resource_type === "server" ? "主机地址" : draft.resource_type === "repository" ? "仓库地址" : draft.resource_type === "document" ? "文档标识" : "资源标识"}</FieldLabel><Input value={draft.identifier} onChange={(event) => update("identifier", event.target.value)} placeholder={draft.resource_type === "server" ? "例如：192.168.1.20" : draft.resource_type === "repository" ? "例如：wangwei0518/toolnest" : draft.resource_type === "document" ? "例如：项目需求文档" : "例如：设计稿或外部系统编号"} /></Field>
          {draft.resource_type === "server" ? <div className="grid gap-4 sm:grid-cols-3"><Field><FieldLabel>协议</FieldLabel><Select value={draft.protocol} onValueChange={(value) => update("protocol", value ?? "ssh")}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectGroup><SelectLabel>协议</SelectLabel><SelectItem value="ssh">SSH</SelectItem><SelectItem value="http">HTTP</SelectItem><SelectItem value="https">HTTPS</SelectItem><SelectItem value="other">其他</SelectItem></SelectGroup></SelectContent></Select></Field><Field><FieldLabel>端口</FieldLabel><Input inputMode="numeric" value={draft.port} onChange={(event) => update("port", event.target.value)} placeholder="22" /></Field><Field><FieldLabel>环境</FieldLabel><Select value={draft.environment} onValueChange={(value) => update("environment", value ?? "production")}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectGroup><SelectLabel>环境</SelectLabel><SelectItem value="development">开发</SelectItem><SelectItem value="staging">预发布</SelectItem><SelectItem value="production">生产</SelectItem><SelectItem value="other">其他</SelectItem></SelectGroup></SelectContent></Select></Field></div> : null}
          {draft.resource_type === "repository" ? <div className="grid gap-4 sm:grid-cols-3"><Field><FieldLabel>平台</FieldLabel><Select value={draft.provider} onValueChange={(value) => update("provider", value ?? "github")}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectGroup><SelectLabel>平台</SelectLabel><SelectItem value="github">GitHub</SelectItem><SelectItem value="gitlab">GitLab</SelectItem><SelectItem value="self_hosted">自建平台</SelectItem><SelectItem value="other">其他</SelectItem></SelectGroup></SelectContent></Select></Field><Field><FieldLabel>默认分支</FieldLabel><Input value={draft.branch} onChange={(event) => update("branch", event.target.value)} placeholder="main" /></Field><Field><FieldLabel>目录路径</FieldLabel><Input value={draft.repository_path} onChange={(event) => update("repository_path", event.target.value)} placeholder="可选" /></Field></div> : null}
          {draft.resource_type === "document" ? <div className="grid gap-4 sm:grid-cols-3"><Field><FieldLabel>文档类型</FieldLabel><Select value={draft.document_type} onValueChange={(value) => update("document_type", value ?? "online")}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectGroup><SelectLabel>类型</SelectLabel><SelectItem value="online">在线文档</SelectItem><SelectItem value="knowledge_base">知识库</SelectItem><SelectItem value="design">设计文档</SelectItem><SelectItem value="spec">技术规范</SelectItem><SelectItem value="runbook">运行手册</SelectItem><SelectItem value="other">其他</SelectItem></SelectGroup></SelectContent></Select></Field><Field><FieldLabel>负责人</FieldLabel><Input value={draft.document_owner} onChange={(event) => update("document_owner", event.target.value)} placeholder="可选" /></Field><Field><FieldLabel>版本</FieldLabel><Input value={draft.document_version} onChange={(event) => update("document_version", event.target.value)} placeholder="可选" /></Field></div> : null}
          <Field><FieldLabel>外部链接</FieldLabel><Input type="url" value={draft.external_url} onChange={(event) => update("external_url", event.target.value)} placeholder="https://" /></Field>
          <Field><FieldLabel>描述</FieldLabel><Textarea value={draft.description} onChange={(event) => update("description", event.target.value)} rows={3} placeholder="说明该资源在项目中的用途。" /></Field>
          <div className="grid gap-4 sm:grid-cols-2"><Field><FieldLabel>关联工单</FieldLabel><ResourceRelationPicker label="工单" items={tickets} selectedIds={draft.ticket_ids} onChange={(ids) => update("ticket_ids", ids)} getLabel={(ticket) => ticket.title} getMeta={(ticket) => `${ticket.number} · ${statusLabels[ticket.status] ?? ticket.status}`} emptyMessage="当前项目暂无工单" /></Field><Field><FieldLabel>关联里程碑</FieldLabel><ResourceRelationPicker label="里程碑" items={milestones} selectedIds={draft.milestone_ids} onChange={(ids) => update("milestone_ids", ids)} getLabel={(milestone) => milestone.name} getMeta={(milestone) => statusLabels[milestone.status] ?? milestone.status} emptyMessage="当前项目暂无里程碑" /></Field></div>
        </FieldGroup>
        {error ? <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert> : null}
        <DialogFooter><Button type="button" variant="outline" onClick={() => onOpenChange(false)}>取消</Button><Button type="submit" disabled={saving}>{saving ? "保存中…" : editing ? "保存修改" : "关联资源"}</Button></DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}

function ResourceDetailSheet({ resource, tickets, milestones, open, onOpenChange, onEdit, router }: { resource?: RelatedResource; tickets: Ticket[]; milestones: Milestone[]; open: boolean; onOpenChange: (open: boolean) => void; onEdit: (resource: RelatedResource) => void; router: Router }) {
  if (!resource) return null;
  const type = normalizeResourceType(resource.resource_type ?? resource.type);
  const Icon = resourceIcon(type);
  const linkedTickets = tickets.filter((ticket) => resource.ticket_ids?.includes(ticket.id));
  const linkedMilestones = milestones.filter((milestone) => resource.milestone_ids?.includes(milestone.id));
  const attributes = resource.attributes ?? {};
  const detailRows = type === "server"
    ? [["主机地址", resource.identifier], ["协议", attributes.protocol ? String(attributes.protocol).toUpperCase() : "未设置"], ["端口", attributes.port || "未设置"], ["环境", ({ development: "开发", staging: "预发布", production: "生产", other: "其他" } as Record<string, string>)[String(attributes.environment)] ?? "未设置"]]
    : type === "repository"
      ? [["仓库地址", resource.identifier], ["平台", ({ github: "GitHub", gitlab: "GitLab", self_hosted: "自建平台", other: "其他" } as Record<string, string>)[String(attributes.provider)] ?? "未设置"], ["默认分支", attributes.branch || "未设置"], ["目录路径", attributes.path || "根目录"]]
      : type === "document"
        ? [["文档标识", resource.identifier], ["文档类型", ({ online: "在线文档", knowledge_base: "知识库", design: "设计文档", spec: "技术规范", runbook: "运行手册", other: "其他" } as Record<string, string>)[String(attributes.document_type)] ?? "未设置"], ["负责人", attributes.owner || "未设置"], ["版本", attributes.version || "未设置"]]
        : [["资源标识", resource.identifier || "未设置"]];
  return <Sheet open={open} onOpenChange={onOpenChange}><SheetContent className="w-full gap-0 p-0 sm:max-w-lg"><SheetHeader className="border-b"><div className="flex items-start gap-3 pr-8"><span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted"><Icon className="size-5" /></span><div className="min-w-0"><SheetTitle className="truncate text-base">{resource.name}</SheetTitle><SheetDescription className="mt-1"><Badge variant="outline">{resourceTypeLabel(type)}</Badge><span className="ml-2">{resourceSummary(resource)}</span></SheetDescription></div></div></SheetHeader><div className="min-h-0 flex-1 overflow-y-auto px-6 py-5"><div className="grid gap-5"><section className="grid gap-3"><h3 className="text-sm font-medium">资源信息</h3><dl className="grid gap-2 rounded-lg border p-3">{detailRows.map(([label, value]) => <div key={label} className="flex items-start justify-between gap-4 text-sm"><dt className="shrink-0 text-muted-foreground">{label}</dt><dd className="min-w-0 truncate text-right font-medium">{String(value || "未设置")}</dd></div>)}</dl>{resource.description ? <p className="whitespace-pre-wrap text-sm leading-6 text-muted-foreground">{resource.description}</p> : <p className="text-sm text-muted-foreground">未填写描述。</p>}{resource.url || resource.external_url ? <a className="flex items-center gap-2 text-sm text-primary hover:underline" href={resource.url ?? resource.external_url ?? "#"} target="_blank" rel="noreferrer"><RiExternalLinkLine />打开外部链接</a> : null}</section><Separator /><section className="grid gap-3"><div className="flex items-center justify-between"><h3 className="text-sm font-medium">关联工单</h3><span className="text-xs text-muted-foreground">{linkedTickets.length} 个</span></div>{linkedTickets.length ? <div className="grid gap-2">{linkedTickets.map((ticket) => <div key={ticket.id} className="flex items-center justify-between gap-2 rounded-md border px-3 py-2"><TicketButton ticket={ticket} router={router} /><StatusBadge value={ticket.status} /></div>)}</div> : <p className="text-sm text-muted-foreground">暂无关联工单。</p>}</section><section className="grid gap-3"><div className="flex items-center justify-between"><h3 className="text-sm font-medium">关联里程碑</h3><span className="text-xs text-muted-foreground">{linkedMilestones.length} 个</span></div>{linkedMilestones.length ? <div className="grid gap-2">{linkedMilestones.map((milestone) => <button type="button" className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-left text-sm hover:bg-muted" key={milestone.id} onClick={() => void router.push(`/modules/workflow-tickets-react/projects/${milestone.project_id}/milestones/${milestone.id}`)}><span className="min-w-0 truncate">{milestone.name}</span><StatusBadge value={milestone.status} /></button>)}</div> : <p className="text-sm text-muted-foreground">暂无关联里程碑。</p>}</section><p className="text-xs text-muted-foreground">最近更新：{formatDateTime(resource.updated_at)}</p></div></div><SheetFooter className="border-t"><Button type="button" onClick={() => onEdit(resource)}><RiEditLine data-icon="inline-start" />编辑资源</Button></SheetFooter></SheetContent></Sheet>;
}

function ResourcesTab({ api, projectId, resources, tickets, milestones, reload, router }: { api: WorkflowApi; projectId: string; resources: RelatedResource[]; tickets: Ticket[]; milestones: Milestone[]; reload: () => Promise<void>; router: Router }) {
  const [keyword, setKeyword] = useState("");
  const [type, setType] = useState("all");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<RelatedResource>();
  const [details, setDetails] = useState<RelatedResource>();
  const [deleting, setDeleting] = useState<RelatedResource>();
  const filtered = useMemo(() => {
    const query = keyword.trim().toLocaleLowerCase();
    return resources.filter((resource) => {
      const resourceType = normalizeResourceType(resource.resource_type ?? resource.type);
      return (type === "all" || resourceType === type) && (!query || [resource.name, resource.identifier, resource.description, resourceSummary(resource)].join(" ").toLocaleLowerCase().includes(query));
    });
  }, [keyword, resources, type]);
  const edit = (resource?: RelatedResource) => { setDetails(undefined); setEditing(resource); setFormOpen(true); };
  const remove = async () => { if (!deleting) return; await api.deleteResource(deleting.id); setDeleting(undefined); await reload(); };
  return <div className="grid min-w-0 gap-4"><Card className="min-w-0"><CardHeader className="flex-row items-start justify-between gap-3"><div><CardTitle>关联资源</CardTitle><CardDescription>按类型登记项目上下文，并与工单和里程碑建立连接。</CardDescription></div><Button onClick={() => edit()}><RiAddLine data-icon="inline-start" />关联资源</Button></CardHeader><CardContent className="grid min-w-0 gap-4"><div className="flex min-w-0 flex-col gap-3 sm:flex-row"><div className="relative min-w-0 flex-1"><RiSearchLine className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" /><Input className="pl-9" value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="搜索资源名称、标识或描述" aria-label="搜索资源" /></div><Select value={type} onValueChange={(value) => setType(value ?? "all")}><SelectTrigger className="w-full sm:w-40"><SelectValue /></SelectTrigger><SelectContent><SelectGroup><SelectLabel>资源类型</SelectLabel><SelectItem value="all">全部资源</SelectItem>{resourceTypes.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectGroup></SelectContent></Select></div>{filtered.length ? <div className="grid items-start gap-3 md:grid-cols-2 xl:grid-cols-3">{filtered.map((resource) => { const resourceType = normalizeResourceType(resource.resource_type ?? resource.type); const Icon = resourceIcon(resourceType); return <Card key={resource.id} size="sm" className="min-w-0 self-start"><CardHeader className="gap-2"><div className="flex min-w-0 items-start justify-between gap-2"><button type="button" className="flex min-w-0 items-start gap-3 text-left" onClick={() => setDetails(resource)}><span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted"><Icon className="size-5" /></span><span className="min-w-0"><span className="block truncate text-sm font-medium">{resource.name}</span><span className="mt-1 block"><Badge variant="outline">{resourceTypeLabel(resourceType)}</Badge></span></span></button><DropdownMenu><DropdownMenuTrigger render={<Button type="button" size="icon-sm" variant="ghost" aria-label={`更多${resource.name}操作`} />}><RiMore2Line /></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem onClick={() => edit(resource)}><RiEditLine />编辑资源</DropdownMenuItem><DropdownMenuSeparator /><DropdownMenuItem variant="destructive" onClick={() => setDeleting(resource)}><RiDeleteBinLine />删除资源</DropdownMenuItem></DropdownMenuContent></DropdownMenu></div><button type="button" className="line-clamp-2 text-left text-xs text-muted-foreground hover:text-foreground" onClick={() => setDetails(resource)}>{resourceSummary(resource)}</button></CardHeader><CardContent className="grid gap-3"><p className={cn("text-sm leading-5", resource.description ? "line-clamp-2 text-muted-foreground" : "text-muted-foreground/70")}>{resource.description || "未填写描述。"}</p><div className="flex flex-wrap gap-1.5"><Badge variant="secondary">{resource.ticket_ids?.length ?? 0} 个工单</Badge><Badge variant="secondary">{resource.milestone_ids?.length ?? 0} 个里程碑</Badge></div></CardContent><CardFooter className="justify-between gap-2 border-t text-xs text-muted-foreground"><span>更新于 {formatDateTime(resource.updated_at)}</span><Button type="button" size="sm" variant="ghost" onClick={() => setDetails(resource)}>查看详情</Button></CardFooter></Card> })}</div> : <EmptyState description={resources.length ? "还没有匹配的资源。" : "暂未关联资源。"} action={<Button onClick={() => edit()}><RiAddLine data-icon="inline-start" />关联第一个资源</Button>} />}</CardContent></Card><ResourceCardFormDialog api={api} projectId={projectId} tickets={tickets} milestones={milestones} editing={editing} open={formOpen} onOpenChange={(value) => { setFormOpen(value); if (!value) setEditing(undefined); }} onSaved={reload} /><ResourceDetailSheet resource={details} tickets={tickets} milestones={milestones} open={Boolean(details)} onOpenChange={(value) => { if (!value) setDetails(undefined); }} onEdit={edit} router={router} /><AlertDialog open={Boolean(deleting)} onOpenChange={(value) => { if (!value) setDeleting(undefined); }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>删除这个关联资源？</AlertDialogTitle><AlertDialogDescription>删除后资源会从项目上下文中移除，关联关系也会一并删除。</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>取消</AlertDialogCancel><AlertDialogAction variant="destructive" onClick={(event) => { event.preventDefault(); void remove(); }}>确认删除</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog></div>;
}

function analyticsDuration(analytics: Record<string, unknown>) {
  return (analytics.duration_hours && typeof analytics.duration_hours === "object" ? analytics.duration_hours : {}) as Record<string, unknown>;
}

function analyticsTrend(analytics: Record<string, unknown>) {
  return Array.isArray(analytics.trend) ? analytics.trend as Array<Record<string, unknown>> : [];
}

function analyticsStatusEntries(analytics: Record<string, unknown>) {
  const order = ["in_progress", "ready", "pending", "blocked", "completed", "cancelled", "archived", "draft"];
  return countEntries(analytics.status_counts).sort(([left], [right]) => {
    const leftIndex = order.indexOf(left);
    const rightIndex = order.indexOf(right);
    return (leftIndex < 0 ? order.length : leftIndex) - (rightIndex < 0 ? order.length : rightIndex);
  });
}

function isCompletedTicket(ticket: Ticket) { return ticket.status === "completed"; }
function isOpenTicket(ticket: Ticket) { return !["completed", "cancelled", "archived"].includes(ticket.status); }

function ProjectHealthPanel({ project, tickets, analytics }: { project: Project; tickets: Ticket[]; analytics: Record<string, unknown> }) {
  const blocked = Number(analytics.blocked_count) || tickets.filter((ticket) => ticket.status === "blocked").length;
  const overdue = Number(analytics.overdue_count) || 0;
  const completed = tickets.filter(isCompletedTicket).length;
  const health = project.health || (blocked > 0 ? "risk" : overdue > 0 ? "overdue" : "normal");
  const progress = clampPercent(Number(project.progress) || 0);

  return <Card size="sm" className="min-w-0 self-start"><CardHeader className="gap-1"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><CardTitle>项目健康</CardTitle><CardDescription>当前执行风险与交付进度。</CardDescription></div><HealthBadge value={health} /></div></CardHeader><CardContent className="grid gap-4"><div className="grid grid-cols-2 gap-3"><div className="min-w-0 border-l-2 border-destructive pl-3"><span className="text-xs text-muted-foreground">阻塞工单</span><strong className="mt-1 block text-xl font-semibold tabular-nums">{blocked}</strong></div><div className="min-w-0 border-l-2 border-destructive/50 pl-3"><span className="text-xs text-muted-foreground">逾期工单</span><strong className="mt-1 block text-xl font-semibold tabular-nums">{overdue}</strong></div></div><div className="grid gap-2"><div className="flex items-center justify-between gap-3 text-sm"><span className="text-muted-foreground">项目进度</span><strong className="tabular-nums text-primary">{progress}%</strong></div><Progress value={progress} aria-label={`项目进度 ${progress}%`} /><span className="text-xs text-muted-foreground">已完成 {completed} / {tickets.length} 个工单</span></div><Separator /><div className="grid grid-cols-2 gap-3 text-sm"><div className="min-w-0"><span className="block text-xs text-muted-foreground">项目状态</span><div className="mt-1"><StatusBadge value={project.status} /></div></div><div className="min-w-0"><span className="block text-xs text-muted-foreground">目标日期</span><span className="mt-1 block truncate font-medium">{formatDate(project.target_at)}</span></div><div className="min-w-0"><span className="block text-xs text-muted-foreground">负责人</span><span className="mt-1 block truncate font-medium">{project.owner_name || "当前用户"}</span></div><div className="min-w-0"><span className="block text-xs text-muted-foreground">当前里程碑</span><span className="mt-1 block truncate font-medium">{project.current_milestone_name || "暂无"}</span></div></div></CardContent></Card>;
}

const analyticsTrendChartConfig = {
  created: { label: "创建", color: "var(--primary)" },
  completed: { label: "完成", color: "var(--muted-foreground)" },
} satisfies ChartConfig;

function AnalyticsTrendPanel({ trend }: { trend: Array<Record<string, unknown>> }) {
  const data = trend.map((item) => ({ date: String(item.date), created: Math.max(0, Number(item.created) || 0), completed: Math.max(0, Number(item.completed) || 0) }));
  if (!data.length || data.every((item) => item.created === 0 && item.completed === 0)) return null;
  const dataMax = Math.max(1, ...data.flatMap((item) => [item.created, item.completed]));

  return <Card size="sm" className="min-w-0 self-start gap-2"><CardHeader className="gap-2"><div className="flex flex-wrap items-start justify-between gap-3"><div><CardTitle>工单趋势</CardTitle><CardDescription>近 14 天创建与完成的工单数量。</CardDescription></div><div className="flex items-center gap-3 text-xs text-muted-foreground" aria-label="趋势图例"><span className="flex items-center gap-1.5"><i className="size-2 rounded-sm bg-primary" aria-hidden="true" />创建</span><span className="flex items-center gap-1.5"><i className="size-2 rounded-sm bg-muted-foreground/50" aria-hidden="true" />完成</span></div></div></CardHeader><CardContent><ChartContainer config={analyticsTrendChartConfig} className="h-48 min-h-0 w-full aspect-auto" aria-label="近 14 天创建与完成趋势"><BarChart accessibilityLayer data={data} margin={{ left: -16, right: 4 }}><CartesianGrid vertical={false} /><XAxis dataKey="date" tickLine={false} axisLine={false} tickMargin={8} interval={1} tickFormatter={(value) => String(value).slice(5)} /><YAxis tickLine={false} axisLine={false} width={24} allowDecimals={false} domain={[0, dataMax]} /><ChartTooltip cursor={false} content={<ChartTooltipContent indicator="dot" labelFormatter={(value) => String(value)} />} /><Bar dataKey="created" fill="var(--color-created)" radius={[3, 3, 0, 0]} maxBarSize={18} /><Bar dataKey="completed" fill="var(--color-completed)" radius={[3, 3, 0, 0]} maxBarSize={18} /></BarChart></ChartContainer></CardContent></Card>;
}

function AnalyticsStatusPanel({ entries }: { entries: Array<readonly [string, number]> }) {
  if (!entries.length) return null;
  const total = Math.max(1, entries.reduce((sum, [, count]) => sum + count, 0));
  return <Card size="sm" className="min-w-0 self-start"><CardHeader><CardTitle>状态分布</CardTitle><CardDescription>当前项目工单状态。</CardDescription></CardHeader><CardContent className="grid gap-3">{entries.map(([status, count]) => <div className="grid gap-1.5" key={status}><div className="flex min-w-0 items-center justify-between gap-3"><StatusBadge value={status} /><span className="shrink-0 text-xs tabular-nums text-muted-foreground">{count} 个 · {Math.round(count / total * 100)}%</span></div><Progress className="h-1.5" value={count / total * 100} aria-label={`${statusLabels[status] ?? status} ${count} 个`} /></div>)}</CardContent></Card>;
}

function AnalyticsEfficiencyPanel({ duration, completedCount }: { duration: Record<string, unknown>; completedCount: number }) {
  if (!completedCount) return null;
  const metrics = [["平均耗时", Number(duration.average) || 0], ["中位数", Number(duration.median) || 0], ["P75", Number(duration.p75) || 0]] as const;
  const maximum = Math.max(1, ...metrics.map(([, value]) => value));
  return <Card size="sm" className="min-w-0 self-start"><CardHeader><CardTitle>交付效率</CardTitle><CardDescription>已完成工单的处理时长。</CardDescription></CardHeader><CardContent className="grid gap-3">{metrics.map(([label, value]) => <div className="grid gap-1.5" key={label}><div className="flex items-center justify-between gap-3 text-sm"><span>{label}</span><span className="shrink-0 font-medium tabular-nums">{value.toFixed(1)} 小时</span></div><Progress className="h-1.5" value={value / maximum * 100} aria-label={`${label} ${value.toFixed(1)} 小时`} /></div>)}</CardContent></Card>;
}

function OptionalAnalyticsDetails({ nodeDurations, paths }: { nodeDurations: Array<Record<string, unknown>>; paths: Array<Record<string, unknown>> }) {
  if (!nodeDurations.length && !paths.length) return null;
  const maxNodeDuration = Math.max(1, ...nodeDurations.map((item) => Number(item.hours) || 0));
  return <div className="grid min-w-0 gap-4 lg:grid-cols-2">{nodeDurations.length ? <Card size="sm" className="min-w-0"><CardHeader><CardTitle>节点耗时</CardTitle><CardDescription>识别流程中最可能形成瓶颈的节点。</CardDescription></CardHeader><CardContent className="grid gap-3">{nodeDurations.map((item) => <div className="grid gap-1.5" key={String(item.name)}><div className="flex min-w-0 items-center justify-between gap-3 text-sm"><span className="min-w-0 truncate font-medium">{String(item.name)}</span><span className="shrink-0 text-xs text-muted-foreground">{Number(item.hours) || 0} 小时 · {Number(item.count) || 0} 次</span></div><Progress className="h-1.5" value={(Number(item.hours) || 0) / maxNodeDuration * 100} aria-label={`${String(item.name)} 节点耗时`} /></div>)}</CardContent></Card> : null}{paths.length ? <Card size="sm" className="min-w-0"><CardHeader><CardTitle>常见流转路径</CardTitle><CardDescription>按实际完成节点序列聚合。</CardDescription></CardHeader><CardContent className="grid gap-2">{paths.map((item) => <div className="flex min-w-0 items-center justify-between gap-3 border-b border-border/70 py-2 text-sm last:border-b-0" key={String(item.path)}><span className="min-w-0 truncate">{String(item.path)}</span><Badge variant="outline">{Number(item.count) || 0} 次</Badge></div>)}</CardContent></Card> : null}</div>;
}

function AnalyticsTab({ project, tickets, analytics, activity, activityLoading, activityError, onRetryActivity }: { project: Project; tickets: Ticket[]; analytics: Record<string, unknown>; activity?: TimelineActivity; activityLoading: boolean; activityError: string; onRetryActivity: () => void }) {
  const duration = analyticsDuration(analytics);
  const trend = analyticsTrend(analytics);
  const statusEntries = analyticsStatusEntries(analytics);
  const nodeDurations = Array.isArray(analytics.node_durations) ? analytics.node_durations as Array<Record<string, unknown>> : [];
  const paths = Array.isArray(analytics.path_distribution) ? analytics.path_distribution as Array<Record<string, unknown>> : [];
  const completed = tickets.filter(isCompletedTicket).length;
  const open = tickets.filter(isOpenTicket).length;
  const progress = clampPercent(Number(project.progress) || 0);

  return <div className="grid min-w-0 items-start gap-4"><OverviewStatBar ariaLabel="项目分析统计" items={[{ id: "progress", label: "项目进度", value: `${progress}%` }, { id: "open", label: "未完成工单", value: open }, { id: "completed", label: "已完成工单", value: completed, railClassName: "bg-primary" }, { id: "blocked", label: "阻塞工单", value: Number(analytics.blocked_count) || 0, railClassName: "bg-destructive" }, { id: "duration", label: "平均耗时", value: completed ? `${(Number(duration.average) || 0).toFixed(1)} 小时` : "—", railClassName: "bg-muted-foreground/60" }]} /><div className="grid min-w-0 items-start gap-4 xl:grid-cols-[minmax(0,1.55fr)_minmax(18rem,0.75fr)]"><div className="grid min-w-0 items-start gap-4"><ProjectActivityHeatmap variant="year" activity={activity} loading={activityLoading} error={activityError} onRetry={onRetryActivity} /><AnalyticsTrendPanel trend={trend} /></div><div className="grid min-w-0 items-start gap-4"><ProjectHealthPanel project={project} tickets={tickets} analytics={analytics} /><AnalyticsStatusPanel entries={statusEntries} /><AnalyticsEfficiencyPanel duration={duration} completedCount={completed} /></div></div><OptionalAnalyticsDetails nodeDurations={nodeDurations} paths={paths} />{!tickets.length ? <div className="rounded-md border border-dashed border-border p-4"><EmptyState description="还没有工单，完成更多执行后会显示趋势和效率分析。" /></div> : null}</div>;
}

function ActivityTab({ timeline }: { timeline: TimelineEvent[] }) { return <Card><CardHeader><CardTitle>项目动态</CardTitle><CardDescription>记录项目、里程碑、资源和工单的重要变化。</CardDescription></CardHeader><CardContent><TimelineList items={timeline} /></CardContent></Card>; }

function NotesTab({ api, project, onSaved }: { api: WorkflowApi; project: Project; onSaved: (project: Project) => void }) {
  const [draft, setDraft] = useState(project.review_markdown ?? project.note ?? ""); const [editing, setEditing] = useState(false); const [saving, setSaving] = useState(false); const [error, setError] = useState("");
  useEffect(() => { setDraft(project.review_markdown ?? project.note ?? ""); }, [project]);
  const save = async () => { setSaving(true); setError(""); try { onSaved(await api.updateProject(project.id, { review_markdown: draft })); setEditing(false); } catch (err) { setError(errorMessage(err, "保存注意事项失败")); } finally { setSaving(false); } };
  return <Card><CardHeader className="flex-row items-start justify-between gap-3"><div><CardTitle>注意事项</CardTitle><CardDescription>支持 Markdown，用于记录项目复盘、约束和后续行动。</CardDescription></div>{editing ? <div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => { setDraft(project.review_markdown ?? project.note ?? ""); setEditing(false); }}>取消</Button><Button size="sm" disabled={saving} onClick={() => void save()}><RiSaveLine data-icon="inline-start" />{saving ? "保存中…" : "保存"}</Button></div> : <Button size="sm" onClick={() => setEditing(true)}><RiEditLine data-icon="inline-start" />编辑注意事项</Button>}</CardHeader><CardContent>{editing ? <Textarea value={draft} onChange={(event) => setDraft(event.target.value)} rows={14} placeholder={"# 项目复盘\n\n记录值得保留的经验。"} /> : draft.trim() ? <article className="tn-workflow-tickets-markdown-preview" dangerouslySetInnerHTML={markdownHtml(draft)} /> : <EmptyState description="还没有注意事项。" action={<Button size="sm" onClick={() => setEditing(true)}>添加注意事项</Button>} />}{error ? <Alert variant="destructive" className="mt-4"><AlertDescription>{error}</AlertDescription></Alert> : null}</CardContent></Card>;
}

function SettingsTab({ api, project, onSaved, onArchived }: { api: WorkflowApi; project: Project; onSaved: (project: Project) => void; onArchived: () => Promise<void> }) {
  const [name, setName] = useState(project.name); const [goal, setGoal] = useState(project.goal ?? project.description); const [status, setStatus] = useState(project.status); const [tags, setTags] = useState((project.tags ?? []).join(", ")); const [favorite, setFavorite] = useState(Boolean(project.favorite)); const [saving, setSaving] = useState(false); const [error, setError] = useState("");
  useEffect(() => { setName(project.name); setGoal(project.goal ?? project.description); setStatus(project.status); setTags((project.tags ?? []).join(", ")); setFavorite(Boolean(project.favorite)); }, [project]);
  const save = async () => { setSaving(true); setError(""); try { onSaved(await api.updateProject(project.id, { name, goal, status, tags: tags.split(",").map((item) => item.trim()).filter(Boolean), favorite })); } catch (err) { setError(errorMessage(err, "保存项目设置失败")); } finally { setSaving(false); } };
  return <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.7fr)]"><Card><CardHeader><CardTitle>基本设置</CardTitle><CardDescription>更新项目基本信息和个人偏好。</CardDescription></CardHeader><CardContent className="grid gap-5"><FieldGroup><Field><FieldLabel>项目名称</FieldLabel><Input value={name} onChange={(event) => setName(event.target.value)} /></Field><Field><FieldLabel>项目目标</FieldLabel><Textarea value={goal} onChange={(event) => setGoal(event.target.value)} rows={4} /></Field><Field><FieldLabel>项目状态</FieldLabel><Select value={status} onValueChange={(value) => setStatus(value ?? "planning")}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectGroup><SelectLabel>状态</SelectLabel>{projectStatuses.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectGroup></SelectContent></Select></Field><Field><FieldLabel>标签</FieldLabel><Input value={tags} onChange={(event) => setTags(event.target.value)} /></Field><Field orientation="horizontal"><Switch checked={favorite} onCheckedChange={setFavorite} /><div><FieldLabel>收藏项目</FieldLabel><FieldDescription>收藏状态用于后续项目筛选和排序。</FieldDescription></div></Field></FieldGroup>{error ? <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert> : null}</CardContent><CardFooter><Button disabled={saving || !name.trim()} onClick={() => void save()}><RiSaveLine data-icon="inline-start" />{saving ? "保存中…" : "保存设置"}</Button></CardFooter></Card><div className="grid content-start gap-5"><Card><CardHeader><CardTitle>项目信息</CardTitle><CardDescription>由系统维护的只读信息。</CardDescription></CardHeader><CardContent className="grid gap-3 text-sm"><div className="flex justify-between gap-3"><span className="text-muted-foreground">项目编号</span><span className="font-mono">{project.key}</span></div><div className="flex justify-between gap-3"><span className="text-muted-foreground">负责人</span><span>{project.owner_name || "当前用户"}</span></div><div className="flex justify-between gap-3"><span className="text-muted-foreground">创建时间</span><span>{formatDateTime(project.created_at)}</span></div><div className="flex justify-between gap-3"><span className="text-muted-foreground">最近更新</span><span>{formatDateTime(project.updated_at)}</span></div></CardContent></Card><Card><CardHeader><CardTitle>项目组成</CardTitle><CardDescription>计划和执行由下方对象共同维护。</CardDescription></CardHeader><CardContent className="grid gap-4"><div className="flex items-start gap-3"><RiFileTextLine className="mt-0.5 size-5 shrink-0 text-muted-foreground" /><div><p className="font-medium">任意工单组合</p><p className="mt-1 text-sm text-muted-foreground">工单可按需要加入项目，不绑定单一模板。</p></div></div><div className="flex items-start gap-3"><RiCalendarLine className="mt-0.5 size-5 shrink-0 text-muted-foreground" /><div><p className="font-medium">里程碑控制计划</p><p className="mt-1 text-sm text-muted-foreground">阶段目标、日期和复盘在各自里程碑中维护。</p></div></div><div className="flex items-start gap-3"><RiLinkM className="mt-0.5 size-5 shrink-0 text-muted-foreground" /><div><p className="font-medium">资源独立关联</p><p className="mt-1 text-sm text-muted-foreground">服务器、仓库、文档等资源按实际范围关联。</p></div></div></CardContent></Card><Card className="border-destructive/40"><CardHeader><CardTitle>危险操作</CardTitle><CardDescription>归档项目不会删除关联数据。</CardDescription></CardHeader><CardContent><ConfirmAction title="归档这个项目？" description="项目归档后将从默认列表中隐藏，关联工单、里程碑和资源会保留。" ariaLabel="归档项目" onConfirm={onArchived} wide><RiDeleteBinLine data-icon="inline-start" />归档项目</ConfirmAction></CardContent></Card></div></div>;
}

export function ProjectDetailPage({ api, router, params, query }: PageProps) {
  const { setPageMeta } = useModulePageMeta();
  const projectId = requiredParam(params.projectId || params.id, "项目"); const requestedTab = String(query.tab || "overview") === "review" ? "notes" : String(query.tab || "overview"); const [project, setProject] = useState<Project>(); const [milestones, setMilestones] = useState<Milestone[]>([]); const [tickets, setTickets] = useState<Ticket[]>([]); const [resources, setResources] = useState<RelatedResource[]>([]); const [analytics, setAnalytics] = useState<Record<string, unknown>>({}); const [timeline, setTimeline] = useState<TimelineEvent[]>([]); const [activity, setActivity] = useState<TimelineActivity>(); const [activityLoading, setActivityLoading] = useState(true); const [activityError, setActivityError] = useState(""); const [tab, setTab] = useState(requestedTab); const [loading, setLoading] = useState(true); const [error, setError] = useState("");
  useEffect(() => { setTab(requestedTab); }, [requestedTab]);
  useEffect(() => { const goal = project?.goal || project?.description || "查看项目进展、工单、里程碑和复盘。"; const owner = project?.owner_name || "当前用户"; setPageMeta({ title: project?.name || "项目详情", description: project ? `${goal} · ${project.key} · 负责人：${owner}` : goal }); }, [project, setPageMeta]);
  const load = async () => { setLoading(true); setError(""); try { const [nextProject, nextMilestones, ticketPage, nextResources, nextAnalytics, nextTimeline] = await Promise.all([api.getProject(projectId), api.listMilestones(projectId), api.listTickets({ project_id: projectId }), api.listResources({ project_id: projectId }), api.getProjectAnalytics(projectId), api.getTimeline({ project_id: projectId })]); setProject(nextProject); setMilestones(nextMilestones); setTickets(ticketPage.items); setResources(nextResources); setAnalytics(nextAnalytics); setTimeline(nextTimeline); } catch (err) { setError(errorMessage(err, "项目详情加载失败")); } finally { setLoading(false); } };
  const loadActivity = async () => { setActivityLoading(true); setActivityError(""); try { setActivity(await api.getTimelineActivity({ project_id: projectId, ...projectActivityQuery() })); } catch (err) { setActivityError(errorMessage(err, "项目活动暂时无法加载")); } finally { setActivityLoading(false); } };
  useEffect(() => { void load(); void loadActivity(); }, [projectId]);
  if (loading && !project) return <ProjectFrame><LoadingState /></ProjectFrame>; if (error && !project) return <ProjectFrame><ErrorState message={error} retry={() => void load()} /></ProjectFrame>; if (!project) return null;
  const switchTab = (value: string) => { setTab(value); void router.push("/modules/workflow-tickets-react/projects/" + projectId + (value === "overview" ? "" : "?tab=" + value)); }; const archived = async () => { await api.archiveProject(project.id); await router.push("/modules/workflow-tickets-react/projects"); }; const updateProject = (next: Project) => setProject(next);
 return <ProjectFrame>{error ? <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert> : null}<Tabs value={tab} onValueChange={switchTab} className="min-w-0 max-w-full"><TabsContent value="overview"><OverviewTab project={project} milestones={milestones} tickets={tickets} router={router} setTab={switchTab} activity={activity} activityLoading={activityLoading} activityError={activityError} onRetryActivity={() => void loadActivity()} actions={<ProjectActionBar project={project} router={router} api={api} onSaved={updateProject} onArchived={archived} />} /></TabsContent><TabsContent value="tickets"><TicketsTab api={api} projectId={project.id} milestones={milestones} tickets={tickets} router={router} /></TabsContent><TabsContent value="milestones"><MilestonesTab api={api} project={project} projectId={project.id} milestones={milestones} tickets={tickets} router={router} reload={load} /></TabsContent><TabsContent value="analysis"><AnalyticsTab project={project} tickets={tickets} analytics={analytics} activity={activity} activityLoading={activityLoading} activityError={activityError} onRetryActivity={() => void loadActivity()} /></TabsContent><TabsContent value="activity"><ActivityTab timeline={timeline} /></TabsContent><TabsContent value="resources"><ResourcesTab api={api} projectId={project.id} resources={resources} tickets={tickets} milestones={milestones} reload={load} router={router} /></TabsContent><TabsContent value="notes"><NotesTab api={api} project={project} onSaved={updateProject} /></TabsContent><TabsContent value="settings"><SettingsTab api={api} project={project} onSaved={updateProject} onArchived={archived} /></TabsContent></Tabs></ProjectFrame>;
}

export function ProjectCreatePage({ api, router }: PageProps) { const { setPageMeta } = useModulePageMeta(); useEffect(() => { setPageMeta({ title: "新建项目", description: "为一组关联工单建立协作上下文。" }); }, [setPageMeta]); return <ProjectFrame><header className="flex items-center gap-3"><Button size="icon-sm" variant="ghost" aria-label="返回项目列表" onClick={() => void router.push("/modules/workflow-tickets-react/projects")}><RiArrowLeftLine /></Button><div><h1 className="text-2xl font-semibold tracking-tight">新建项目</h1><p className="mt-1 text-sm text-muted-foreground">为一组关联工单建立协作上下文。</p></div></header><Card><CardContent className="pt-5"><ProjectCreateForm api={api} router={router} /></CardContent></Card></ProjectFrame>; }

export function MilestoneDetailPage({ api, router, params }: PageProps) {
  const { setPageMeta } = useModulePageMeta();
  const projectId = requiredParam(params.projectId, "项目"); const milestoneId = requiredParam(params.milestoneId, "里程碑"); const [project, setProject] = useState<Project>(); const [milestone, setMilestone] = useState<Milestone>(); const [tickets, setTickets] = useState<Ticket[]>([]); const [resources, setResources] = useState<RelatedResource[]>([]); const [timeline, setTimeline] = useState<TimelineEvent[]>([]); const [open, setOpen] = useState(false); const [error, setError] = useState("");
  useEffect(() => { setPageMeta({ title: milestone?.name || "里程碑详情", description: milestone?.goal || milestone?.description || "查看阶段目标、工单进度与风险复盘。" }); }, [milestone, setPageMeta]);
  const load = async () => { setError(""); try { const [nextProject, nextMilestone, ticketPage, nextResources, nextTimeline] = await Promise.all([api.getProject(projectId), api.getMilestone(projectId, milestoneId), api.listTickets({ milestone_id: milestoneId }), api.listResources({ project_id: projectId, milestone_id: milestoneId }), api.getTimeline({ project_id: projectId, milestone_id: milestoneId })]); setProject(nextProject); setMilestone(nextMilestone); setTickets(ticketPage.items); setResources(nextResources); setTimeline(nextTimeline); } catch (err) { setError(errorMessage(err, "里程碑详情加载失败")); } };
  useEffect(() => { void load(); }, [projectId, milestoneId]); if (error && !milestone) return <ProjectFrame><ErrorState message={error} retry={() => void load()} /></ProjectFrame>; if (!project || !milestone) return <ProjectFrame><LoadingState /></ProjectFrame>; const activeCount = tickets.filter((ticket) => !["completed", "cancelled", "archived"].includes(ticket.status)).length;
  return <ProjectFrame className="gap-3">
    {error ? <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert> : null}
    <MilestoneSummaryStrip project={project} milestone={milestone} tickets={tickets} activeCount={activeCount} onEdit={() => setOpen(true)} />
    <div className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(18rem,0.58fr)]">
      <main className="min-w-0">
        <Card className="min-w-0">
          <CardContent className="grid min-w-0 gap-8">
        <MilestoneDetailSection icon={<RiFlagLine className="size-4" />} title="阶段目标" action={<span className="text-xs text-muted-foreground">{milestone.progress_mode === "manual" ? "手动进度" : "按工单数量"}</span>}>
          <div className="grid min-w-0 gap-4">
            <div className="rounded-md border-l-2 border-primary/30 bg-muted/30 px-4 py-4 sm:px-5"><p className="m-0 max-w-3xl whitespace-pre-wrap text-sm leading-6 text-foreground">{milestone.goal || milestone.description || "暂未填写阶段目标。"}</p></div>
            {milestone.completion_criteria || milestone.risk_note ? <div className="grid min-w-0 gap-4 sm:grid-cols-2">
              {milestone.completion_criteria ? <div className="min-w-0"><span className="text-xs font-medium text-muted-foreground">完成标准</span><p className="m-0 mt-1 line-clamp-3 whitespace-pre-wrap text-sm leading-5">{milestone.completion_criteria}</p></div> : null}
              {milestone.risk_note ? <div className="min-w-0"><span className="text-xs font-medium text-muted-foreground">风险说明</span><p className="m-0 mt-1 line-clamp-3 whitespace-pre-wrap text-sm leading-5">{milestone.risk_note}</p></div> : null}
            </div> : null}
          </div>
        </MilestoneDetailSection>
        <MilestoneDetailSection icon={<RiFileTextLine className="size-4" />} title="关联工单" count={tickets.length + " 条"} description="当前阶段内的执行任务和完成进度。">
          {tickets.length ? <div className="grid min-w-0 divide-y divide-border">{tickets.map((ticket) => <div key={ticket.id} className="grid min-w-0 gap-3 py-3 first:pt-0 last:pb-0 sm:grid-cols-[minmax(0,1fr)_minmax(12rem,auto)] sm:items-center"><div className="flex min-w-0 items-start gap-3"><span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted/70 text-muted-foreground"><RiFileTextLine className="size-4" /></span><div className="min-w-0"><TicketButton ticket={ticket} router={router} /></div></div><div className="grid min-w-0 gap-1.5 sm:justify-items-end"><div className="flex w-full min-w-0 items-center gap-2 sm:w-32"><Progress className="min-w-0 flex-1" value={ticketProgress(ticket)} aria-label={ticket.title + "进度 " + ticketProgress(ticket) + "%"} /><span className="shrink-0 text-xs tabular-nums text-muted-foreground">{ticketProgress(ticket)}%</span></div><StatusBadge value={ticket.status} /></div></div>)}</div> : <Empty className="min-h-0 items-start rounded-md border border-border/60 bg-muted/20 px-4 py-5 text-left"><EmptyHeader className="items-start"><EmptyTitle>还没有关联工单。</EmptyTitle><EmptyDescription>关联工单后，可以在这里跟踪阶段执行进度。</EmptyDescription></EmptyHeader></Empty>}
        </MilestoneDetailSection>
        <MilestoneDetailSection icon={<RiTimeLine className="size-4" />} title="里程碑复盘" description="记录阶段结果、偏差和后续行动。" action={<Button size="sm" variant="outline" onClick={() => setOpen(true)}><RiEditLine data-icon="inline-start" />{milestone.review_markdown || milestone.review ? "编辑复盘" : "添加复盘"}</Button>}>
          {milestone.review_markdown || milestone.review ? <article className="tn-workflow-tickets-markdown-preview min-w-0" dangerouslySetInnerHTML={markdownHtml(milestone.review_markdown ?? milestone.review)} /> : <Empty className="min-h-0 items-start rounded-md border border-border/60 bg-muted/20 px-4 py-5 text-left"><EmptyHeader className="items-start"><EmptyTitle>还没有复盘记录。</EmptyTitle></EmptyHeader><EmptyContent className="items-start"><Button className="w-fit" size="sm" variant="outline" onClick={() => setOpen(true)}><RiEditLine data-icon="inline-start" />添加复盘</Button></EmptyContent></Empty>}
        </MilestoneDetailSection>
          </CardContent>
        </Card>
      </main>
      <MilestoneInfoRail project={project} milestone={milestone} timeline={timeline} resources={resources} />
    </div>
    <MilestoneFormDialog api={api} projectId={projectId} milestone={milestone} open={open} onOpenChange={setOpen} onSaved={load} />
  </ProjectFrame>;
}
