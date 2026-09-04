import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { ToolNestModuleRouteRenderProps } from "@toolnest/react-module-sdk";
import {
  RiAddLine,
  RiArrowRightLine,
  RiCheckLine,
  RiGitBranchLine,
  RiInboxLine,
  RiRefreshLine,
  RiSearchLine,
} from "@remixicon/react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import { cn } from "@/lib/utils";
import {
  type Overview,
  type Milestone,
  type Project,
  type Ticket,
  type TimelineActivity,
  type Workflow,
  type WorkflowApi,
} from "../api";

type OverviewPageProps = Pick<ToolNestModuleRouteRenderProps, "router"> & {
  api: WorkflowApi;
};

type StatusTagValue =
  | "completed"
  | "published"
  | "in_progress"
  | "blocked"
  | "overdue"
  | "ready"
  | "pending"
  | "draft"
  | "archived"
  | "cancelled"
  | "normal"
  | "risk"
  | "info"
  | string;

type SearchResult =
  | { kind: "ticket"; id: string; label: string; detail: string }
  | { kind: "workflow"; id: string; label: string; detail: string }
  | { kind: "node"; id: string; workflowId: string; label: string; detail: string };

const activeNodeStatuses = new Set(["ready", "in_progress", "waiting", "blocked"]);
const terminalTicketStatuses = new Set(["completed", "cancelled", "archived"]);
const ACTION_PAGE_SIZE = 5;
const ACTIVITY_CALENDAR_WEEK_COUNT = 6;
const ACTIVITY_DAY_LABELS = ["一", "二", "三", "四", "五", "六", "日"];

const statusMap: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  completed: { label: "已完成", variant: "default" },
  published: { label: "已发布", variant: "default" },
  active: { label: "进行中", variant: "outline" },
  planning: { label: "规划中", variant: "outline" },
  paused: { label: "已暂停", variant: "secondary" },
  in_progress: { label: "进行中", variant: "outline" },
  blocked: { label: "阻塞", variant: "destructive" },
  overdue: { label: "已逾期", variant: "destructive" },
  ready: { label: "待执行", variant: "default" },
  pending: { label: "待处理", variant: "outline" },
  draft: { label: "草稿", variant: "outline" },
  archived: { label: "已归档", variant: "secondary" },
  cancelled: { label: "已终止", variant: "secondary" },
  normal: { label: "正常", variant: "secondary" },
  risk: { label: "注意", variant: "outline" },
  info: { label: "信息", variant: "secondary" },
};

function StatusTag({ value }: { value: StatusTagValue }) {
  const mapped = statusMap[value] ?? { label: value || "未知", variant: "secondary" as const };
  return <Badge variant={mapped.variant}>{mapped.label}</Badge>;
}

function formatDate(value?: string | null): string {
  if (!value) return "未设置";
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "未设置";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatRelativeDate(value?: string | null): string {
  if (!value) return "未设置截止时间";
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "未设置截止时间";
  const diff = date.valueOf() - Date.now();
  if (diff < 0) return `已逾期 · ${formatDate(value)}`;
  if (diff <= 24 * 60 * 60 * 1000) return `即将到期 · ${formatDate(value)}`;
  return `截止 ${formatDate(value)}`;
}

type ActivityCell = TimelineActivity["days"][number] & { level: number };
type ActivityCalendarCell = ActivityCell & { isCurrentMonth: boolean; isToday: boolean };
type ActivityCalendar = { label: string; weeks: ActivityCalendarCell[][]; maxCount: number };

function startOfLocalDay(value: Date): Date {
  const result = new Date(value);
  result.setHours(0, 0, 0, 0);
  return result;
}

function localDateKey(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function activityRange(now = new Date()): { startAt: Date; untilAt: Date } {
  const today = startOfLocalDay(now);
  const startAt = new Date(today.getFullYear(), today.getMonth(), 1);
  const untilAt = new Date(today.getFullYear(), today.getMonth() + 1, 1);
  return { startAt, untilAt };
}

function activityLevel(count: number, maxCount: number): number {
  if (!count || !maxCount) return 0;
  return Math.min(4, Math.max(1, Math.ceil((count / maxCount) * 4)));
}

function buildActivityCalendar(activity: TimelineActivity, startAt: Date, untilAt: Date, now = new Date()): ActivityCalendar {
  const countByDate = new Map(activity.days.map((day) => [day.date, day]));
  const maxCount = Math.max(0, ...activity.days.map((day) => day.count));
  const monthStartOffset = (startAt.getDay() + 6) % 7;
  const calendarStart = new Date(startAt);
  calendarStart.setDate(startAt.getDate() - monthStartOffset);
  const today = startOfLocalDay(now);
  const weeks = Array.from({ length: ACTIVITY_CALENDAR_WEEK_COUNT }, (_, weekIndex) => (
    ACTIVITY_DAY_LABELS.map((_, dayIndex) => {
      const date = new Date(calendarStart);
      date.setDate(calendarStart.getDate() + weekIndex * 7 + dayIndex);
      const dateKey = localDateKey(date);
      const isCurrentMonth = date >= startAt && date < untilAt;
      const isToday = date.valueOf() === today.valueOf();
      const source = countByDate.get(dateKey);
      return {
        date: dateKey,
        count: isCurrentMonth ? source?.count ?? 0 : 0,
        samples: isCurrentMonth ? source?.samples ?? [] : [],
        level: isCurrentMonth ? activityLevel(source?.count ?? 0, maxCount) : 0,
        isCurrentMonth,
        isToday,
      };
    })
  ));
  return { label: `${startAt.getFullYear()}年${startAt.getMonth() + 1}月`, weeks, maxCount };
}

function activityToneClass(level: number): string {
  return cn(
    level === 0 && "bg-muted",
    level === 1 && "bg-primary/20",
    level === 2 && "bg-primary/40",
    level === 3 && "bg-primary/60",
    level === 4 && "bg-primary",
  );
}

function activityCellClass(cell: ActivityCalendarCell): string {
  return cn(
    "flex size-8 items-center justify-center rounded-[3px] border border-border/60 text-xs transition-colors",
    activityToneClass(cell.level),
    !cell.isCurrentMonth && "opacity-50",
    cell.level === 4 && "text-primary-foreground",
    cell.isToday && "font-semibold ring-2 ring-primary ring-offset-1 ring-offset-background",
  );
}

function formatActivityDate(value: string): string {
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.valueOf()) ? value : new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "numeric", day: "numeric" }).format(date);
}

function activeNode(ticket: Ticket) {
  return ticket.node_instances.find((node) => activeNodeStatuses.has(node.status));
}

function EmptyState({ description, action }: { description: string; action?: ReactNode }) {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyTitle>暂无数据</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
      {action ? <div className="flex justify-center">{action}</div> : null}
    </Empty>
  );
}

function OverviewSkeleton() {
  return (
    <div className="grid gap-5" aria-label="正在加载总览">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <Skeleton className="h-8 w-20" />
          <Skeleton className="h-8 w-20" />
          <Skeleton className="h-8 w-20" />
          <Skeleton className="h-8 w-20" />
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Skeleton className="h-7 w-20" />
          <Skeleton className="h-9 w-24" />
          <Skeleton className="h-9 w-20" />
        </div>
      </div>
      <Card>
        <CardHeader><Skeleton className="h-5 w-32" /><Skeleton className="h-4 w-64" /></CardHeader>
        <CardContent className="grid gap-3"><Skeleton className="h-20 w-full" /><Skeleton className="h-20 w-full" /><Skeleton className="h-20 w-full" /></CardContent>
      </Card>
      <Card>
        <CardHeader><Skeleton className="h-5 w-36" /><Skeleton className="h-4 w-72" /></CardHeader>
        <CardContent className="grid gap-4 xl:grid-cols-[minmax(13rem,0.72fr)_minmax(0,1.28fr)_minmax(0,1fr)]"><Skeleton className="h-56 w-full" /><Skeleton className="h-56 w-full" /><Skeleton className="h-56 w-full" /></CardContent>
      </Card>
    </div>
  );
}

function SearchCommand({
  api,
  router,
  open,
  onOpenChange,
  floating = true,
  focusOnOpen = true,
}: OverviewPageProps & {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  floating?: boolean;
  focusOnOpen?: boolean;
}) {
  const [keyword, setKeyword] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open || !keyword.trim()) {
      setResults([]);
      setError("");
      setLoading(false);
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError("");
      void Promise.all([api.listTickets({ keyword: keyword.trim() }), api.listWorkflows(keyword.trim())])
        .then(([ticketResult, workflowResults]) => {
          if (cancelled) return;
          const ticketResults: SearchResult[] = ticketResult.items.slice(0, 6).map((ticket) => ({
            kind: "ticket",
            id: ticket.id,
            label: ticket.title,
            detail: `${ticket.number} · ${ticket.workflow_name}`,
          }));
          const templateResults: SearchResult[] = workflowResults.slice(0, 6).map((workflow) => ({
            kind: "workflow",
            id: workflow.id,
            label: workflow.name,
            detail: workflow.description || "工单模板",
          }));
          const nodeResults: SearchResult[] = [];
          for (const workflow of workflowResults) {
            const nodes = workflow.versions.flatMap((version) => version.nodes);
            for (const node of nodes) {
              if (`${node.name} ${node.key} ${node.description}`.toLocaleLowerCase().includes(keyword.trim().toLocaleLowerCase())) {
                nodeResults.push({ kind: "node", id: node.id, workflowId: workflow.id, label: node.name, detail: `${workflow.name} · 节点` });
              }
            }
          }
          setResults([...ticketResults, ...templateResults, ...nodeResults.slice(0, 6)]);
        })
        .catch((reason: unknown) => {
          if (!cancelled) setError(reason instanceof Error ? reason.message : "搜索失败，请稍后重试。");
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 180);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [api, keyword, open]);

  useEffect(() => {
    if (!open || !focusOnOpen) return;
    window.requestAnimationFrame(() => {
      document.getElementById("workflow-tickets-overview-search")?.focus();
    });
  }, [focusOnOpen, open]);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        onOpenChange(true);
        window.requestAnimationFrame(() => {
          document.getElementById("workflow-tickets-overview-search")?.focus();
        });
      }
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [onOpenChange]);

  const close = () => {
    setKeyword("");
    setResults([]);
    onOpenChange(false);
  };

  const selectResult = async (result: SearchResult) => {
    close();
    if (result.kind === "ticket") await router.push(`/modules/workflow-tickets-react/tickets/${result.id}`);
    if (result.kind === "workflow") await router.push(`/modules/workflow-tickets-react/workflows/${result.id}/designer`);
    if (result.kind === "node") await router.push(`/modules/workflow-tickets-react/workflows/${result.workflowId}/designer?node_id=${result.id}`);
  };

  const tickets = results.filter((result): result is Extract<SearchResult, { kind: "ticket" }> => result.kind === "ticket");
  const workflows = results.filter((result): result is Extract<SearchResult, { kind: "workflow" }> => result.kind === "workflow");
  const nodes = results.filter((result): result is Extract<SearchResult, { kind: "node" }> => result.kind === "node");

  return (
    <Command
      shouldFilter={false}
      className={cn(
        "relative h-auto min-h-0 w-full rounded-lg border bg-background p-1 shadow-none",
        floating && "max-w-sm",
        open && (floating ? "absolute inset-x-0 top-0 z-50 bg-popover shadow-md" : "bg-popover shadow-none")
      )}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) close();
      }}
    >
      <CommandInput
        wrapperClassName="p-1 pb-0"
        id="workflow-tickets-overview-search"
        value={keyword}
        onValueChange={(value) => { setKeyword(value); onOpenChange(true); }}
        onFocus={() => onOpenChange(true)}
        onKeyDown={(event) => { if (event.key === "Escape") close(); }}
        placeholder="搜索工单、工单模板或节点"
        aria-label="搜索工单、工单模板或节点"
        aria-expanded={open}
      />
      {open ? (
        <CommandList>
          {!keyword.trim() ? (
            <>
              <CommandGroup heading="建议">
                <CommandItem onSelect={() => { close(); void router.push("/modules/workflow-tickets-react/tickets/new"); }}>
                  <RiAddLine />新建工单<CommandShortcut>Alt N</CommandShortcut>
                </CommandItem>
                <CommandItem onSelect={() => { close(); void router.push("/modules/workflow-tickets-react/tickets"); }}>
                  <RiCheckLine />工单列表
                </CommandItem>
                <CommandItem onSelect={() => { close(); void router.push("/modules/workflow-tickets-react/workflows"); }}>
                  <RiGitBranchLine />工单模板
                </CommandItem>
              </CommandGroup>
              <CommandSeparator />
              <CommandGroup heading="快捷入口">
                <CommandItem onSelect={() => { close(); void router.push("/modules/workflow-tickets-react/inbox"); }}>
                  <RiInboxLine />收件箱
                </CommandItem>
              </CommandGroup>
            </>
          ) : null}
          {loading ? <CommandItem disabled>正在搜索…</CommandItem> : null}
          {error ? <CommandItem disabled>{error}</CommandItem> : null}
          {!loading && !error && keyword.trim() && !results.length ? <CommandEmpty>没有找到匹配的工单、模板或节点。</CommandEmpty> : null}
          {tickets.length ? <CommandGroup heading="工单">{tickets.map((result) => <CommandItem key={`ticket-${result.id}`} value={result.id} onSelect={() => void selectResult(result)}><RiCheckLine /><span className="min-w-0 truncate">{result.label}</span><span className="ml-auto truncate text-muted-foreground">{result.detail}</span></CommandItem>)}</CommandGroup> : null}
          {workflows.length ? <><CommandSeparator /><CommandGroup heading="工单模板">{workflows.map((result) => <CommandItem key={`workflow-${result.id}`} value={result.id} onSelect={() => void selectResult(result)}><RiGitBranchLine /><span className="min-w-0 truncate">{result.label}</span><span className="ml-auto truncate text-muted-foreground">{result.detail}</span></CommandItem>)}</CommandGroup></> : null}
          {nodes.length ? <><CommandSeparator /><CommandGroup heading="节点">{nodes.map((result) => <CommandItem key={`node-${result.id}`} value={result.id} onSelect={() => void selectResult(result)}><RiGitBranchLine /><span className="min-w-0 truncate">{result.label}</span><span className="ml-auto truncate text-muted-foreground">{result.detail}</span></CommandItem>)}</CommandGroup></> : null}
        </CommandList>
      ) : null}
    </Command>
  );
}

function OverviewSearch({ api, router }: OverviewPageProps) {
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<number | undefined>(undefined);

  const cancelClose = () => {
    if (closeTimer.current === undefined) return;
    window.clearTimeout(closeTimer.current);
    closeTimer.current = undefined;
  };

  const expand = () => {
    cancelClose();
    setOpen(true);
  };

  const collapseSoon = () => {
    cancelClose();
    closeTimer.current = window.setTimeout(() => {
      setOpen(false);
      closeTimer.current = undefined;
    }, 180);
  };

  useEffect(() => () => cancelClose(), []);

  return (
    <div
      className="relative h-7 w-20 min-w-0 shrink-0 self-center"
      onMouseEnter={expand}
      onMouseLeave={collapseSoon}
      onFocus={expand}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) collapseSoon();
      }}
    >
      <Button
        type="button"
        variant="outline"
        aria-label="搜索工单、工单模板或节点"
        aria-expanded={open}
        className={cn(
          "absolute inset-0 z-10 transition-[opacity,transform] duration-200 ease-out",
          open && "pointer-events-none scale-95 opacity-0"
        )}
      >
        <RiSearchLine data-icon="inline-start" />搜索
      </Button>
      <div
        aria-hidden={!open}
        className={cn(
          "absolute right-0 top-0 z-20 origin-right transition-[width,opacity,transform,visibility] duration-200 ease-out",
          open
            ? "visible w-80 max-w-[calc(100vw-2rem)] scale-100 opacity-100"
            : "invisible pointer-events-none w-20 scale-95 opacity-0"
        )}
      >
        <SearchCommand api={api} router={router} open={open} onOpenChange={setOpen} />
      </div>
    </div>
  );
}

function ActionTicketRow({ ticket, router }: { ticket: Ticket; router: OverviewPageProps["router"] }) {
  const node = activeNode(ticket);
  const dueValue = ticket.due_at ?? ticket.reminder_at;
  const isOverdue = Boolean(dueValue && new Date(dueValue).valueOf() < Date.now() && !terminalTicketStatuses.has(ticket.status));
  return (
    <div className="grid min-w-0 gap-3 rounded-md border border-border p-3 transition-colors hover:bg-muted/50 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
      <div className="grid min-w-0 gap-1.5">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="font-mono text-xs text-muted-foreground">{ticket.number}</span>
          <Button variant="link" className="h-auto min-w-0 justify-start truncate p-0 text-left font-medium" onClick={() => void router.push(`/modules/workflow-tickets-react/tickets/${ticket.id}`)}>{ticket.title}</Button>
          <StatusTag value={ticket.status} />
          {isOverdue ? <StatusTag value="overdue" /> : null}
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <span className="truncate">{ticket.workflow_name}</span>
          <span aria-hidden="true">·</span>
          <span className="truncate">当前节点：{node?.name ?? "等待流程推进"}</span>
          <span aria-hidden="true">·</span>
          <span>{formatRelativeDate(dueValue)}</span>
        </div>
      </div>
      <Button size="sm" onClick={() => void router.push(`/modules/workflow-tickets-react/tickets/${ticket.id}`)}><RiArrowRightLine data-icon="inline-end" />继续执行</Button>
    </div>
  );
}

function statusRailClass(status: string): string {
  return cn(
    "absolute inset-y-1 left-1 w-1 rounded-sm bg-primary",
    status === "blocked" && "bg-destructive",
    ["cancelled", "archived"].includes(status) && "bg-muted-foreground",
  );
}

function ticketTimeLabel(ticket: Ticket): string {
  return ticket.due_at || ticket.reminder_at ? formatRelativeDate(ticket.due_at ?? ticket.reminder_at) : `更新 ${formatDate(ticket.updated_at)}`;
}

function RecentUpdatesHeatmap({ activity, loading, error, onRetry }: { activity: TimelineActivity | undefined; loading: boolean; error: string; onRetry: () => void }) {
  const range = activityRange();
  const heatmap = buildActivityCalendar(activity ?? { total: 0, days: [] }, range.startAt, range.untilAt);
  const renderGrid = activity !== undefined || !loading;
  return (
    <Card className="min-w-0 self-start">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">最近更新 <Badge variant="secondary">{activity?.total ?? 0}</Badge></CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        {loading && !activity ? (
          <div className="grid gap-2" aria-label="正在加载最近更新">
            <Skeleton className="h-56 w-full" />
          </div>
        ) : error ? (
          <Alert variant="destructive">
            <AlertTitle>最近更新加载失败</AlertTitle>
            <AlertDescription className="flex flex-wrap items-center gap-3">{error}<Button size="sm" variant="outline" onClick={onRetry}>重试</Button></AlertDescription>
          </Alert>
        ) : renderGrid ? (
          <div className="grid min-w-0 gap-3" data-testid="recent-updates-heatmap">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-medium">{heatmap.label}</span>
              <span className="text-xs text-muted-foreground">周一至周日</span>
            </div>
            <div className="grid grid-cols-7 gap-1 text-center text-[0.625rem] leading-none text-muted-foreground" aria-hidden="true">
              {ACTIVITY_DAY_LABELS.map((label) => <span key={label}>{label}</span>)}
            </div>
            <div className="grid grid-cols-7 justify-items-center gap-1" aria-label={`${heatmap.label}更新热力图`}>
              {heatmap.weeks.flatMap((week) => week.map((cell) => {
                const cellLabel = cell.isCurrentMonth ? `${formatActivityDate(cell.date)}：${cell.count} 次更新` : `${formatActivityDate(cell.date)}：非本月日期`;
                return (
                  <Tooltip key={cell.date}>
                    <TooltipTrigger render={<span className={activityCellClass(cell)} data-date={cell.date} data-level={cell.level} data-current-month={cell.isCurrentMonth} role="img" aria-label={cellLabel} tabIndex={0} />} />
                    <TooltipContent side="top" align="center">
                      <div className="grid gap-1">
                        <p>{cellLabel}</p>
                        {cell.samples.length ? cell.samples.map((sample) => <p key={sample} className="max-w-56 truncate text-background/80">{sample}</p>) : cell.isCurrentMonth ? <p className="text-background/80">暂无更新</p> : null}
                      </div>
                    </TooltipContent>
                  </Tooltip>
                );
              }))}
            </div>
            <div className="flex items-center justify-end gap-2 text-[0.625rem] text-muted-foreground" aria-label="更新数量图例">
              <span>少</span>
              {[0, 1, 2, 3, 4].map((level) => <span key={level} className={cn("size-2.5 rounded-[3px] border border-border/60", activityToneClass(level))} aria-hidden="true" />)}
              <span>多</span>
            </div>
            {!activity?.total ? <p className="text-center text-xs text-muted-foreground">本月暂无更新</p> : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function ProjectRow({ project, selected, onSelect }: { project: Project; selected: boolean; onSelect: () => void }) {
  return (
    <Button
      type="button"
      variant="ghost"
      aria-pressed={selected}
      className={cn(
        "h-auto min-h-14 w-full min-w-0 justify-start rounded-md border border-border px-3 py-2 text-left transition-colors hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring",
        selected && "bg-accent hover:bg-accent",
      )}
      onClick={onSelect}
    >
      <span className="grid min-w-0 flex-1 gap-1.5">
        <span className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 truncate text-sm font-medium">{project.name}</span>
          <span className="shrink-0 font-mono text-[0.6875rem] text-muted-foreground">{project.key}</span>
        </span>
        <span className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
          <StatusTag value={project.health ?? project.status ?? "normal"} />
          <span>{project.ticket_count ?? 0} 条工单</span>
        </span>
      </span>
    </Button>
  );
}

function ProjectTicketRow({ ticket, router }: { ticket: Ticket; router: OverviewPageProps["router"] }) {
  const node = activeNode(ticket);
  const dueValue = ticket.due_at ?? ticket.reminder_at;
  const isOverdue = Boolean(dueValue && new Date(dueValue).valueOf() < Date.now() && !terminalTicketStatuses.has(ticket.status));
  return (
    <button
      type="button"
      aria-label={ticket.title}
      className="relative flex min-h-12 w-full min-w-0 items-stretch gap-2 rounded-md border border-border bg-card pl-4 pr-3 text-left outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
      onClick={() => void router.push(`/modules/workflow-tickets-react/tickets/${ticket.id}`)}
    >
      <span className={statusRailClass(ticket.status)} aria-hidden="true" />
      <span className="grid min-w-0 flex-1 gap-1 py-2">
        <span className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 truncate text-sm font-medium">{ticket.title}</span>
          <StatusTag value={ticket.status} />
          {isOverdue ? <StatusTag value="overdue" /> : null}
        </span>
        <span className="flex min-w-0 flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
          <span className="truncate">{node?.name ?? "等待流程推进"}</span>
          <span aria-hidden="true">·</span>
          <span className="shrink-0">{ticketTimeLabel(ticket)}</span>
        </span>
      </span>
    </button>
  );
}

function MilestoneRow({ milestone, router }: { milestone: Milestone; router: OverviewPageProps["router"] }) {
  const progress = Math.max(0, Math.min(100, Number(milestone.progress) || 0));
  return (
    <button
      type="button"
      aria-label={milestone.name}
      className="relative flex min-h-12 w-full min-w-0 items-stretch gap-2 rounded-md border border-border bg-card pl-4 pr-3 text-left outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
      onClick={() => void router.push(`/modules/workflow-tickets-react/projects/${milestone.project_id}/milestones/${milestone.id}`)}
    >
      <span className={statusRailClass(milestone.status)} aria-hidden="true" />
      <span className="grid min-w-0 flex-1 gap-1 py-2">
        <span className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 truncate text-sm font-medium">{milestone.name}</span>
          <StatusTag value={milestone.status} />
        </span>
        <span className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>目标：{formatDate(milestone.target_at)}</span>
          <span>{progress}%</span>
        </span>
        <Progress value={progress} aria-label={`${milestone.name}进度 ${progress}%`} />
      </span>
    </button>
  );
}

function ColumnSkeleton({ rowClassName = "h-12" }: { rowClassName?: string }) {
  return <div className="grid gap-2" aria-label="正在加载"><Skeleton className={rowClassName} /><Skeleton className={rowClassName} /><Skeleton className={rowClassName} /></div>;
}

function NewMilestoneDialog({ api, projectId, onCreated }: { api: WorkflowApi; projectId: string; onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!name.trim()) return;
    try {
      setSaving(true);
      setError("");
      await api.createMilestone(projectId, { name: name.trim() });
      setName("");
      setOpen(false);
      onCreated();
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "里程碑创建失败，请稍后重试。");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Button onClick={() => { setError(""); setOpen(true); }}>新建里程碑</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>新建里程碑</DialogTitle>
            <DialogDescription>为当前项目添加一个阶段目标。</DialogDescription>
          </DialogHeader>
          <form className="grid gap-4" onSubmit={(event) => void save(event)}>
            <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="里程碑名称" aria-label="里程碑名称" autoFocus />
            {error ? <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert> : null}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>取消</Button>
              <Button type="submit" disabled={saving || !name.trim()}>{saving ? "创建中…" : "创建里程碑"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

function WorkspaceColumnHeading({ title, count, action }: { title: string; count?: number; action?: ReactNode }) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-3">
      <h3 className="min-w-0 truncate text-sm font-medium">{title}</h3>
      <span className="flex shrink-0 items-center gap-2">
        {typeof count === "number" ? <Badge variant="secondary">{count}</Badge> : null}
        {action}
      </span>
    </div>
  );
}

function ProjectWorkspace({
  projects,
  selectedProjectId,
  onSelectProject,
  tickets,
  milestones,
  ticketsLoading,
  milestonesLoading,
  ticketsError,
  milestonesError,
  retryTickets,
  retryMilestones,
  api,
  router,
}: {
  projects: Project[];
  selectedProjectId: string;
  onSelectProject: (projectId: string) => void;
  tickets: Ticket[];
  milestones: Milestone[];
  ticketsLoading: boolean;
  milestonesLoading: boolean;
  ticketsError: string;
  milestonesError: string;
  retryTickets: () => void;
  retryMilestones: () => void;
  api: WorkflowApi;
  router: OverviewPageProps["router"];
}) {
  const selectedProject = projects.find((project) => project.id === selectedProjectId);
  return (
    <Card>
      <CardHeader>
        <CardTitle>项目工作区</CardTitle>
        <CardDescription>从项目出发查看所属工单和阶段目标，工单时间轴可进入详情查看。</CardDescription>
        <CardAction><Button size="sm" variant="outline" onClick={() => void router.push("/modules/workflow-tickets-react/projects")}>查看全部</Button></CardAction>
      </CardHeader>
      <CardContent className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)]">
        <section className="grid min-w-0 content-start gap-3" aria-label="项目列表">
          <WorkspaceColumnHeading title="项目" count={projects.length} action={<Button size="sm" variant="link" className="h-auto p-0" onClick={() => void router.push("/modules/workflow-tickets-react/projects/new")}>新建</Button>} />
          {projects.length ? <div className="grid min-w-0 content-start gap-2">{projects.map((project) => <ProjectRow key={project.id} project={project} selected={project.id === selectedProjectId} onSelect={() => onSelectProject(project.id)} />)}</div> : <EmptyState description="暂无未归档项目。" action={<Button onClick={() => void router.push("/modules/workflow-tickets-react/projects/new")}>新建项目</Button>} />}
        </section>

        <Separator orientation="vertical" className="tn-workflow-tickets-react__workspace-divider" />

        <section className="grid min-w-0 content-start gap-3" aria-label="里程碑">
          <WorkspaceColumnHeading title="里程碑" count={selectedProject ? milestones.length : 0} />
          {!selectedProject ? <EmptyState description="先选择一个项目查看里程碑。" /> : milestonesLoading ? <ColumnSkeleton rowClassName="h-16" /> : milestonesError ? <Alert variant="destructive"><AlertTitle>里程碑加载失败</AlertTitle><AlertDescription className="flex flex-wrap items-center gap-3">{milestonesError}<Button size="sm" variant="outline" onClick={retryMilestones}>重试</Button></AlertDescription></Alert> : milestones.length ? <div className="grid min-w-0 content-start gap-2">{milestones.map((milestone) => <MilestoneRow key={milestone.id} milestone={milestone} router={router} />)}</div> : <EmptyState description="这个项目还没有里程碑。" action={<NewMilestoneDialog api={api} projectId={selectedProject.id} onCreated={retryMilestones} />} />}
        </section>

        <Separator orientation="vertical" className="tn-workflow-tickets-react__workspace-divider" />

        <section className="grid min-w-0 content-start gap-3" aria-label="项目所属工单">
          <WorkspaceColumnHeading title="项目所属工单" count={selectedProject ? tickets.length : 0} />
          {!selectedProject ? <EmptyState description="先选择一个项目查看所属工单。" /> : ticketsLoading ? <ColumnSkeleton /> : ticketsError ? <Alert variant="destructive"><AlertTitle>工单加载失败</AlertTitle><AlertDescription className="flex flex-wrap items-center gap-3">{ticketsError}<Button size="sm" variant="outline" onClick={retryTickets}>重试</Button></AlertDescription></Alert> : tickets.length ? <div className="grid min-w-0 content-start gap-2">{tickets.map((ticket) => <ProjectTicketRow key={ticket.id} ticket={ticket} router={router} />)}</div> : <EmptyState description="这个项目还没有关联工单。" action={<Button onClick={() => void router.push(`/modules/workflow-tickets-react/tickets/new?project_id=${selectedProject.id}`)}>新建工单</Button>} />}
        </section>
      </CardContent>
    </Card>
  );
}

function QuickEntryCards({ inboxCount, projects, workflows, router }: { inboxCount: number; projects: Project[]; workflows: Workflow[]; router: OverviewPageProps["router"] }) {
  const visibleProjects = projects.filter((project) => project.status !== "archived").slice(0, 2);
  const publishedWorkflows = workflows.filter((workflow) => workflow.status === "published");
  const riskyProjects = visibleProjects.filter((project) => project.health === "risk" || project.health === "overdue").length;
  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><RiInboxLine />收件箱</CardTitle>
          <CardDescription>先记录，再整理成可执行工单。</CardDescription>
        </CardHeader>
        <CardContent className="flex items-center justify-between gap-3">
          <div><p className="text-2xl font-semibold">{inboxCount}</p><p className="text-xs text-muted-foreground">条待整理事项</p></div>
          <Button variant="outline" onClick={() => void router.push("/modules/workflow-tickets-react/inbox")}>打开收件箱</Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>项目</CardTitle>
          <CardDescription>保持目标和执行上下文可见。</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          <div className="flex items-center justify-between gap-3 text-sm"><span className="text-muted-foreground">进行中的项目</span><Badge variant="secondary">{projects.filter((project) => project.status === "active").length}</Badge></div>
          <div className="flex items-center justify-between gap-3 text-sm"><span className="text-muted-foreground">需要关注</span><Badge variant={riskyProjects ? "destructive" : "secondary"}>{riskyProjects}</Badge></div>
          {visibleProjects.length ? <div className="grid gap-1.5">{visibleProjects.map((project) => <Button key={project.id} variant="link" className="h-auto min-w-0 justify-start truncate p-0 text-left" onClick={() => void router.push(`/modules/workflow-tickets-react/projects/${project.id}`)}>{project.name}</Button>)}</div> : null}
          <Button variant="outline" className="w-fit" onClick={() => void router.push("/modules/workflow-tickets-react/projects")}>查看项目</Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>工单模板</CardTitle>
          <CardDescription>从已发布模板快速创建工单。</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          <div className="flex items-center justify-between gap-3 text-sm"><span className="text-muted-foreground">已发布模板</span><Badge variant="secondary">{publishedWorkflows.length}</Badge></div>
          {publishedWorkflows.slice(0, 2).map((workflow) => <Button key={workflow.id} variant="link" className="h-auto min-w-0 justify-start truncate p-0 text-left" onClick={() => void router.push(`/modules/workflow-tickets-react/workflows/${workflow.id}/designer`)}>{workflow.name}</Button>)}
          <Button variant="outline" className="w-fit" onClick={() => void router.push("/modules/workflow-tickets-react/workflows")}>管理模板</Button>
        </CardContent>
      </Card>
    </div>
  );
}

function OverviewStats({ data, router }: { data: Overview; router: OverviewPageProps["router"] }) {
  const stats = [
    ["待处理", data.todo.length, "/modules/workflow-tickets-react/tickets?view=mine", "bg-primary"],
    ["进行中", data.in_progress.length, "/modules/workflow-tickets-react/tickets?status=in_progress", "bg-primary"],
    ["已完成", data.counts.completed ?? 0, "/modules/workflow-tickets-react/tickets?status=completed", "bg-muted-foreground"],
    ["阻塞", data.counts.blocked ?? 0, "/modules/workflow-tickets-react/tickets?status=blocked", "bg-destructive"],
  ] as const;
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2" role="group" aria-label="工单状态统计">
      {stats.map(([label, value, path, railClass]) => (
        <Button key={label} type="button" size="default" variant="outline" className="relative min-w-20 justify-between gap-3 px-3 pl-4" aria-label={`${label} ${value}`} onClick={() => void router.push(path)}>
          <span aria-hidden="true" className={cn("absolute inset-y-1 left-1 w-1 rounded-sm", railClass)} />
          <span className="text-muted-foreground">{label}</span>
          <span className="font-semibold tabular-nums text-foreground">{value}</span>
        </Button>
      ))}
    </div>
  );
}

export function OverviewPage({ api, router }: OverviewPageProps) {
  const [data, setData] = useState<Overview>();
  const [activity, setActivity] = useState<TimelineActivity>();
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [projectTickets, setProjectTickets] = useState<Ticket[]>([]);
  const [projectMilestones, setProjectMilestones] = useState<Milestone[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activityLoading, setActivityLoading] = useState(true);
  const [activityError, setActivityError] = useState("");
  const [projectTicketsLoading, setProjectTicketsLoading] = useState(false);
  const [projectMilestonesLoading, setProjectMilestonesLoading] = useState(false);
  const [error, setError] = useState("");
  const [projectTicketsError, setProjectTicketsError] = useState("");
  const [projectMilestonesError, setProjectMilestonesError] = useState("");
  const [projectTicketsReloadKey, setProjectTicketsReloadKey] = useState(0);
  const [projectMilestonesReloadKey, setProjectMilestonesReloadKey] = useState(0);
  const [actionPage, setActionPage] = useState(1);

  const loadActivity = async () => {
    setActivityLoading(true);
    setActivityError("");
    try {
      const range = activityRange();
      const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
      setActivity(await api.getTimelineActivity({ since: range.startAt.toISOString(), until: range.untilAt.toISOString(), timezone: timeZone }));
    } catch (reason: unknown) {
      setActivityError(reason instanceof Error ? reason.message : "最近更新加载失败，请稍后重试。");
    } finally {
      setActivityLoading(false);
    }
  };

  const load = async () => {
    setRefreshing(true);
    setError("");
    try {
      const [nextOverview, nextWorkflows, nextProjects] = await Promise.all([api.getOverview(), api.listWorkflows(), api.listProjects()]);
      setData(nextOverview);
      setWorkflows(nextWorkflows);
      setProjects(nextProjects);
      setActionPage(1);
      setSelectedProjectId((current) => nextProjects.some((project) => project.id === current) ? current : [...nextProjects].sort((left, right) => new Date(right.updated_at).valueOf() - new Date(left.updated_at).valueOf())[0]?.id ?? "");
      setProjectTicketsReloadKey((value) => value + 1);
      setProjectMilestonesReloadKey((value) => value + 1);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "总览加载失败，请稍后重试。");
    } finally {
      setLoading(false);
    }
    await loadActivity();
    setRefreshing(false);
  };

  useEffect(() => { void load(); }, []);

  const visibleProjects = useMemo(
    () => projects.filter((project) => project.status !== "archived").sort((left, right) => new Date(right.updated_at).valueOf() - new Date(left.updated_at).valueOf()),
    [projects],
  );
  const actionTotalPages = Math.max(1, Math.ceil((data?.todo.length ?? 0) / ACTION_PAGE_SIZE));
  const visibleActionTickets = useMemo(() => {
    if (!data) return [];
    const start = (actionPage - 1) * ACTION_PAGE_SIZE;
    return data.todo.slice(start, start + ACTION_PAGE_SIZE);
  }, [actionPage, data]);

  useEffect(() => {
    if (!visibleProjects.some((project) => project.id === selectedProjectId)) setSelectedProjectId(visibleProjects[0]?.id ?? "");
  }, [selectedProjectId, visibleProjects]);

  useEffect(() => {
    if (!selectedProjectId) {
      setProjectTickets([]);
      setProjectTicketsError("");
      setProjectTicketsLoading(false);
      return;
    }
    let cancelled = false;
    setProjectTicketsLoading(true);
    setProjectTicketsError("");
    setProjectTickets([]);
    void api.listTickets({ project_id: selectedProjectId })
      .then((result) => { if (!cancelled) setProjectTickets(result.items); })
      .catch((reason: unknown) => { if (!cancelled) setProjectTicketsError(reason instanceof Error ? reason.message : "项目工单加载失败，请稍后重试。"); })
      .finally(() => { if (!cancelled) setProjectTicketsLoading(false); });
    return () => { cancelled = true; };
  }, [api, projectTicketsReloadKey, selectedProjectId]);

  useEffect(() => {
    if (!selectedProjectId) {
      setProjectMilestones([]);
      setProjectMilestonesError("");
      setProjectMilestonesLoading(false);
      return;
    }
    let cancelled = false;
    setProjectMilestonesLoading(true);
    setProjectMilestonesError("");
    setProjectMilestones([]);
    void api.listMilestones(selectedProjectId)
      .then((items) => { if (!cancelled) setProjectMilestones(items); })
      .catch((reason: unknown) => { if (!cancelled) setProjectMilestonesError(reason instanceof Error ? reason.message : "项目里程碑加载失败，请稍后重试。"); })
      .finally(() => { if (!cancelled) setProjectMilestonesLoading(false); });
    return () => { cancelled = true; };
  }, [api, projectMilestonesReloadKey, selectedProjectId]);

  if (loading && !data) return <OverviewSkeleton />;
  if (error && !data) return <Alert variant="destructive"><AlertTitle>总览加载失败</AlertTitle><AlertDescription className="flex flex-wrap items-center gap-3">{error}<Button variant="outline" size="sm" onClick={() => void load()}>重试</Button></AlertDescription></Alert>;
  if (!data) return null;

  return (
    <section className="grid gap-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <OverviewStats data={data} router={router} />
        <div className="flex flex-wrap items-center justify-end gap-2">
          <OverviewSearch api={api} router={router} />
          <Button type="button" onClick={() => void router.push("/modules/workflow-tickets-react/tickets/new")}><RiAddLine data-icon="inline-start" />新建工单</Button>
          <Button type="button" variant="outline" onClick={() => void load()} disabled={refreshing}><RiRefreshLine data-icon="inline-start" />{refreshing ? "刷新中" : "刷新"}</Button>
        </div>
      </div>

      {error ? <Alert variant="destructive"><AlertDescription className="flex flex-wrap items-center gap-3">{error}<Button variant="outline" size="sm" onClick={() => void load()}>重试</Button></AlertDescription></Alert> : null}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(18rem,0.65fr)]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">需要行动 <Badge variant="secondary">{data.todo.length}</Badge></CardTitle>
            <CardDescription>当前有可执行节点的工单，按最近更新优先显示。</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            {data.todo.length ? (
              <>
                <div className="grid gap-3">
                  {visibleActionTickets.map((ticket) => <ActionTicketRow key={ticket.id} ticket={ticket} router={router} />)}
                </div>
                {actionTotalPages > 1 ? (
                  <div className="flex flex-col items-center justify-between gap-2 border-t border-border pt-3 text-sm text-muted-foreground sm:flex-row">
                    <span>共 {data.todo.length} 条，第 {actionPage} / {actionTotalPages} 页</span>
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" disabled={actionPage <= 1} onClick={() => setActionPage((page) => Math.max(1, page - 1))}>上一页</Button>
                      <Button variant="outline" size="sm" disabled={actionPage >= actionTotalPages} onClick={() => setActionPage((page) => Math.min(actionTotalPages, page + 1))}>下一页</Button>
                    </div>
                  </div>
                ) : null}
              </>
            ) : <EmptyState description="暂无需要立即处理的工单。" action={<Button onClick={() => void router.push("/modules/workflow-tickets-react/tickets/new")}>新建工单</Button>} />}
          </CardContent>
        </Card>
        <RecentUpdatesHeatmap activity={activity} loading={activityLoading} error={activityError} onRetry={() => { void loadActivity(); }} />
      </div>

      <ProjectWorkspace
        projects={visibleProjects}
        selectedProjectId={selectedProjectId}
        onSelectProject={setSelectedProjectId}
        tickets={projectTickets}
        milestones={projectMilestones}
        ticketsLoading={projectTicketsLoading}
        milestonesLoading={projectMilestonesLoading}
        ticketsError={projectTicketsError}
        milestonesError={projectMilestonesError}
        retryTickets={() => setProjectTicketsReloadKey((value) => value + 1)}
        retryMilestones={() => setProjectMilestonesReloadKey((value) => value + 1)}
        api={api}
        router={router}
      />

      <QuickEntryCards inboxCount={data.inbox_count} projects={visibleProjects} workflows={workflows} router={router} />
    </section>
  );
}
