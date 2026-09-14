import { addDays, addMonths, addWeeks, eachDayOfInterval, endOfMonth, endOfWeek, format, isSameDay, isSameMonth, isToday, startOfDay, startOfMonth, startOfWeek } from "date-fns";
import { zhCN } from "date-fns/locale";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import type { ToolNestModuleRouteRenderProps } from "@toolnest/react-module-sdk";
import { RiAddLine, RiArrowLeftSLine, RiArrowRightSLine, RiCalendarLine, RiCheckLine, RiCloseLine, RiRefreshLine } from "@remixicon/react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

import type { ScheduleItem, Ticket, createWorkflowApi, Workflow } from "../api";

type Router = ToolNestModuleRouteRenderProps["router"];
type WorkflowApi = ReturnType<typeof createWorkflowApi>;
type CalendarView = "day" | "week" | "month";
type CalendarEvent =
  | { id: string; kind: "schedule"; date: Date; item: ScheduleItem }
  | { id: string; kind: "ticket"; date: Date; scheduledDate: Date; ticket: Ticket; usesCreatedDate: boolean; isOngoingToday: boolean };

const weekdayLabels = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
const lunarDateFormatter = new Intl.DateTimeFormat("zh-CN-u-ca-chinese", { month: "long", day: "numeric" });
const lunarDayNumbers = ["", "一", "二", "三", "四", "五", "六", "七", "八", "九", "十"];
const lunarMonthNumbers: Record<string, number> = { 正: 1, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10, 冬: 11, 十一: 11, 腊: 12, 十二: 12 };
const solarFestivals: Record<string, string> = {
  "01-01": "元旦",
  "05-01": "劳动节",
  "06-01": "儿童节",
  "08-01": "建军节",
  "09-10": "教师节",
  "10-01": "国庆节",
};
const lunarFestivals: Record<string, string> = {
  "1-1": "春节",
  "1-15": "元宵节",
  "5-5": "端午节",
  "7-7": "七夕节",
  "7-15": "中元节",
  "8-15": "中秋节",
  "9-9": "重阳节",
  "12-8": "腊八节",
};

function parseDate(value?: string | null): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function scheduleItemDate(item: ScheduleItem): Date {
  return parseDate(item.due_at) ?? parseDate(item.created_at) ?? new Date();
}

function ticketCalendarDate(ticket: Ticket): { date: Date; usesCreatedDate: boolean } {
  const dueDate = parseDate(ticket.due_at);
  return { date: dueDate ?? parseDate(ticket.created_at) ?? new Date(), usesCreatedDate: !dueDate };
}

async function listAllTicketsForStatus(api: WorkflowApi, status: "in_progress" | "blocked"): Promise<Ticket[]> {
  const pageSize = 100;
  const firstPage = await api.listTickets({ status, page: 1, page_size: pageSize });
  const pageCount = Math.ceil(firstPage.total / pageSize);
  if (pageCount <= 1) return firstPage.items;

  const pages = [firstPage];
  const batchSize = 5;
  for (let startPage = 2; startPage <= pageCount; startPage += batchSize) {
    const pageNumbers = Array.from({ length: Math.min(batchSize, pageCount - startPage + 1) }, (_, index) => startPage + index);
    pages.push(...await Promise.all(pageNumbers.map((page) => api.listTickets({ status, page, page_size: pageSize }))));
  }
  return pages.flatMap((page) => page.items);
}

async function listActiveTickets(api: WorkflowApi): Promise<Ticket[]> {
  const [inProgress, blocked] = await Promise.all([
    listAllTicketsForStatus(api, "in_progress"),
    listAllTicketsForStatus(api, "blocked"),
  ]);
  const ticketsById = new Map<string, Ticket>();
  for (const ticket of [...inProgress, ...blocked]) ticketsById.set(ticket.id, ticket);
  return [...ticketsById.values()];
}

function dateKey(date: Date): string {
  return format(date, "yyyy-MM-dd");
}

function lunarDayLabel(day: number): string {
  if (day <= 10) return `初${lunarDayNumbers[day]}`;
  if (day < 20) return `十${lunarDayNumbers[day - 10]}`;
  if (day === 20) return "二十";
  if (day < 30) return `廿${lunarDayNumbers[day - 20]}`;
  return "三十";
}

function dayAnnotation(date: Date): string {
  const solarFestival = solarFestivals[format(date, "MM-dd")];
  if (solarFestival) return solarFestival;

  const lunarDate = lunarDateFormatter.format(date).match(/^(.+?月)(\d+)日$/);
  if (!lunarDate) return "";
  const month = lunarDate[1];
  const day = Number(lunarDate[2]);
  const monthNumber = lunarMonthNumbers[month.replace(/^闰/, "").replace(/月$/, "")];
  const festival = lunarFestivals[`${monthNumber}-${day}`];
  if (festival) return festival;
  return day === 1 ? month : lunarDayLabel(day);
}

function calendarTitle(date: Date, view: CalendarView): string {
  if (view === "month") return format(date, "yyyy年M月", { locale: zhCN });
  if (view === "day") return format(date, "yyyy年M月d日", { locale: zhCN });
  const weekStart = startOfWeek(date, { weekStartsOn: 0 });
  const weekEnd = addDays(weekStart, 6);
  if (weekStart.getFullYear() === weekEnd.getFullYear() && weekStart.getMonth() === weekEnd.getMonth()) {
    return `${format(weekStart, "yyyy年M月d日", { locale: zhCN })} – ${format(weekEnd, "d日", { locale: zhCN })}`;
  }
  return `${format(weekStart, "yyyy年M月d日", { locale: zhCN })} – ${format(weekEnd, "M月d日", { locale: zhCN })}`;
}

function itemTime(item: ScheduleItem): string {
  const date = scheduleItemDate(item);
  return format(date, "HH:mm");
}

function ScheduleCalendarEvent({ item, onOpen }: { item: ScheduleItem; onOpen: (item: ScheduleItem) => void }) {
  const completed = item.status === "completed";
  return (
    <button
      type="button"
      className="flex min-w-0 items-start gap-1 rounded-sm px-1 py-0.5 text-left text-xs leading-4 text-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      aria-label={`${itemTime(item)} ${item.title}${completed ? "，已完成" : ""}`}
      onClick={() => onOpen(item)}
    >
      <span className={`mt-1.5 size-1.5 shrink-0 rounded-full ${completed ? "bg-muted-foreground" : "bg-primary"}`} aria-hidden="true" />
      <span className={`min-w-0 truncate ${completed ? "text-muted-foreground line-through" : ""}`}>
        <span className="hidden sm:inline">{itemTime(item)} </span>{item.title}
      </span>
    </button>
  );
}

function TicketCalendarEvent({ event, onOpen }: { event: Extract<CalendarEvent, { kind: "ticket" }>; onOpen: (ticket: Ticket) => void }) {
  const { ticket, scheduledDate, usesCreatedDate, isOngoingToday } = event;
  const blocked = ticket.status === "blocked";
  const statusLabel = blocked ? "阻塞" : "进行中";
  const dateLabel = usesCreatedDate
    ? `未设置目标日期，按创建日期 ${format(scheduledDate, "yyyy年M月d日", { locale: zhCN })} 显示`
    : `目标日期 ${format(scheduledDate, "yyyy年M月d日", { locale: zhCN })}`;
  const ongoingLabel = blocked ? "今日仍处于阻塞状态" : "今日仍在进行";
  const accessibleDateLabel = isOngoingToday ? `${dateLabel}；${ongoingLabel}` : dateLabel;

  return (
    <button
      type="button"
      className="flex min-w-0 items-start gap-1 rounded-sm px-1 py-0.5 text-left text-xs leading-4 text-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      aria-label={`${ticket.title}，工单编号 ${ticket.number}，${statusLabel}，${accessibleDateLabel}`}
      title={`${ticket.title}（${ticket.number}） · ${statusLabel} · ${accessibleDateLabel}`}
      onClick={() => onOpen(ticket)}
    >
      <span
        aria-hidden="true"
        className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", blocked ? "bg-destructive" : "bg-primary")}
      />
      <span className="min-w-0 truncate">{ticket.title}</span>
      {isOngoingToday ? <Badge variant="secondary" className="hidden h-4 shrink-0 px-1 text-[10px] font-normal leading-3 md:inline-flex">今日</Badge> : null}
      {usesCreatedDate ? <Badge variant="secondary" className="hidden h-4 shrink-0 px-1 text-[10px] font-normal leading-3 md:inline-flex">创建日</Badge> : null}
    </button>
  );
}

function ScheduleCalendarCell({
  date,
  view,
  displayedMonth,
  events,
  onOpenItem,
  onOpenTicket,
  onMore,
  onSelectDate,
}: {
  date: Date;
  view: CalendarView;
  displayedMonth: Date;
  events: CalendarEvent[];
  onOpenItem: (item: ScheduleItem) => void;
  onOpenTicket: (ticket: Ticket) => void;
  onMore: (date: Date) => void;
  onSelectDate: (date: Date) => void;
}) {
  const limit = view === "month" ? 3 : Number.POSITIVE_INFINITY;
  const shownEvents = events.slice(0, limit);
  const hiddenCount = Math.max(0, events.length - shownEvents.length);
  const inDisplayedMonth = view !== "month" || isSameMonth(date, displayedMonth);
  const today = isToday(date);
  const selected = isSameDay(date, displayedMonth);

  return (
    <div
      role="gridcell"
      aria-label={`${format(date, "yyyy年M月d日", { locale: zhCN })}，${events.length} 条日程或工单`}
      className={`flex min-h-24 min-w-0 flex-col gap-1.5 border-b border-r border-border p-1.5 sm:min-h-32 sm:gap-2 sm:p-2 ${!inDisplayedMonth ? "bg-muted/30" : "bg-background"} ${today ? "bg-primary/5" : selected ? "bg-accent/40" : ""}`}
    >
      <div className="flex min-w-0 items-start justify-between gap-1">
        <button
          type="button"
          className={`grid size-6 shrink-0 place-items-center rounded-full text-xs font-medium transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:size-7 sm:text-sm ${today ? "bg-primary text-primary-foreground hover:bg-primary/90" : selected ? "text-primary ring-1 ring-primary" : inDisplayedMonth ? "text-foreground" : "text-muted-foreground"}`}
          aria-label={`选择${format(date, "yyyy年M月d日", { locale: zhCN })}`}
          aria-pressed={selected}
          onClick={() => onSelectDate(date)}
        >
          {format(date, "d")}
        </button>
        <span className={`min-w-0 truncate pt-1 text-right text-[10px] leading-4 sm:text-xs ${today ? "text-primary" : "text-muted-foreground"}`}>
          {dayAnnotation(date)}
        </span>
      </div>
      <div className="grid content-start gap-0.5">
        {shownEvents.map((event) => event.kind === "schedule"
          ? <ScheduleCalendarEvent key={event.id} item={event.item} onOpen={onOpenItem} />
          : <TicketCalendarEvent key={event.id} event={event} onOpen={onOpenTicket} />)}
        {hiddenCount > 0 ? (
          <button type="button" className="justify-self-start px-1 text-left text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => onMore(date)}>
            还有 {hiddenCount} 条
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function ScheduleCalendarContent({ api, router, quick = false }: { api: WorkflowApi; router: Router; quick?: boolean }) {
  const [items, setItems] = useState<ScheduleItem[]>([]);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [selectedDate, setSelectedDate] = useState(() => new Date());
  const [view, setView] = useState<CalendarView>("month");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [ticketLoadError, setTicketLoadError] = useState("");
  const [quickEntryOpen, setQuickEntryOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [creating, setCreating] = useState(false);
  const [selectedItem, setSelectedItem] = useState<ScheduleItem | null>(null);
  const [convertItem, setConvertItem] = useState<ScheduleItem | null>(null);
  const [workflowId, setWorkflowId] = useState("");
  const [archivingItem, setArchivingItem] = useState<ScheduleItem | null>(null);
  const [pendingItemId, setPendingItemId] = useState("");
  const [datePickerOpen, setDatePickerOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    setTicketLoadError("");
    try {
      const [itemsResult, workflowsResult, ticketsResult] = await Promise.allSettled([
        api.listScheduleItems(),
        api.listWorkflows(),
        listActiveTickets(api),
      ]);
      if (itemsResult.status === "rejected") throw itemsResult.reason;
      if (workflowsResult.status === "rejected") throw workflowsResult.reason;

      const nextItems = itemsResult.value;
      const nextWorkflows = workflowsResult.value;
      setItems(nextItems);
      setWorkflows(nextWorkflows);
      if (ticketsResult.status === "fulfilled") {
        setTickets(ticketsResult.value);
      } else {
        setTickets([]);
        setTicketLoadError(ticketsResult.reason instanceof Error ? ticketsResult.reason.message : "进行中工单加载失败。");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "日程加载失败。");
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (quick) setQuickEntryOpen(true); }, [quick]);

  const eventsByDate = useMemo(() => {
    const grouped = new Map<string, CalendarEvent[]>();
    const activeTicketIds = new Set(tickets.map((ticket) => ticket.id));
    const today = startOfDay(new Date());
    const addEvent = (event: CalendarEvent) => {
      const key = dateKey(event.date);
      const group = grouped.get(key);
      if (group) group.push(event);
      else grouped.set(key, [event]);
    };
    for (const item of items) {
      if (item.status === "converted" || (item.ticket_id && activeTicketIds.has(item.ticket_id))) continue;
      const date = scheduleItemDate(item);
      addEvent({ id: `schedule:${item.id}`, kind: "schedule", date, item });
    }
    for (const ticket of tickets) {
      const { date: scheduledDate, usesCreatedDate } = ticketCalendarDate(ticket);
      const isOngoingToday = isSameDay(scheduledDate, today);
      addEvent({ id: `ticket:${ticket.id}`, kind: "ticket", date: scheduledDate, scheduledDate, ticket, usesCreatedDate, isOngoingToday });
      if (!isOngoingToday) {
        addEvent({ id: `ticket:today:${ticket.id}`, kind: "ticket", date: today, scheduledDate, ticket, usesCreatedDate, isOngoingToday: true });
      }
    }
    for (const group of grouped.values()) {
      group.sort((first, second) => first.date.getTime() - second.date.getTime());
    }
    return grouped;
  }, [items, tickets]);

  const calendarDays = useMemo(() => {
    if (view === "day") return [startOfDay(selectedDate)];
    if (view === "week") {
      const weekStart = startOfWeek(selectedDate, { weekStartsOn: 0 });
      return eachDayOfInterval({ start: weekStart, end: addDays(weekStart, 6) });
    }
    const monthStart = startOfWeek(startOfMonth(selectedDate), { weekStartsOn: 0 });
    const monthEnd = endOfWeek(endOfMonth(selectedDate), { weekStartsOn: 0 });
    return eachDayOfInterval({ start: monthStart, end: monthEnd });
  }, [selectedDate, view]);

  const dayRows = useMemo(() => {
    if (view !== "month") return [calendarDays];
    return Array.from({ length: calendarDays.length / 7 }, (_, index) => calendarDays.slice(index * 7, index * 7 + 7));
  }, [calendarDays, view]);

  const moveCalendar = (direction: -1 | 1) => {
    setSelectedDate((date) => view === "month" ? addMonths(date, direction) : view === "week" ? addWeeks(date, direction) : addDays(date, direction));
  };

  const capture = async (event: FormEvent) => {
    event.preventDefault();
    const value = title.trim();
    if (!value || creating) return;
    setCreating(true);
    setError("");
    try {
      const created = await api.createScheduleItem({ title: value });
      setItems((current) => [created, ...current]);
      setTitle("");
      setQuickEntryOpen(false);
      setSelectedDate(scheduleItemDate(created));
    } catch (err) {
      setError(err instanceof Error ? err.message : "记录事项失败。");
    } finally {
      setCreating(false);
    }
  };

  const toggleCompleted = async (item: ScheduleItem) => {
    setPendingItemId(item.id);
    setError("");
    try {
      const updated = await api.setScheduleItemCompleted(item.id, item.status !== "completed");
      setItems((current) => current.map((candidate) => candidate.id === updated.id ? updated : candidate));
      setSelectedItem(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "更新事项状态失败。");
    } finally {
      setPendingItemId("");
    }
  };

  const convert = async () => {
    if (!convertItem || !workflowId) return;
    setPendingItemId(convertItem.id);
    setError("");
    try {
      const ticket = await api.convertScheduleItem(convertItem.id, { workflow_id: workflowId });
      setItems((current) => current.filter((item) => item.id !== convertItem.id));
      setConvertItem(null);
      await router.push(`/modules/workflow-tickets-react/tickets/${ticket.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "转换失败。");
    } finally {
      setPendingItemId("");
    }
  };

  const archive = async () => {
    if (!archivingItem) return;
    setPendingItemId(archivingItem.id);
    setError("");
    try {
      await api.archiveScheduleItem(archivingItem.id);
      setItems((current) => current.filter((item) => item.id !== archivingItem.id));
      setArchivingItem(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "归档事项失败。");
    } finally {
      setPendingItemId("");
    }
  };

  const openConvert = (item: ScheduleItem) => {
    setSelectedItem(null);
    setConvertItem(item);
    setWorkflowId(workflows.find((workflow) => workflow.status === "published")?.id ?? "");
  };

  const displayedTitle = calendarTitle(selectedDate, view);
  const visibleWeekdays = view === "day" ? [weekdayLabels[selectedDate.getDay()]] : weekdayLabels;
  const selectedItemDate = selectedItem ? scheduleItemDate(selectedItem) : null;
  const selectedItemWorkflowOptions = workflows.filter((workflow) => workflow.status === "published");

  return (
    <section className="grid gap-3" aria-busy={loading}>
      <header className="grid gap-3 border-b border-border pb-3 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] lg:items-center">
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => setQuickEntryOpen(true)}><RiAddLine data-icon="inline-start" />快速记录</Button>
          <Button variant="secondary" onClick={() => void router.push("/modules/workflow-tickets-react/tickets/new")}>新建工单</Button>
        </div>

        <div className="flex items-center justify-center gap-1.5">
          <Button size="icon-sm" variant="ghost" aria-label="上一个日期范围" onClick={() => moveCalendar(-1)}><RiArrowLeftSLine /></Button>
          <h2 className="min-w-28 text-center text-base font-semibold tabular-nums sm:min-w-36 sm:text-lg">{displayedTitle}</h2>
          <Button size="icon-sm" variant="ghost" aria-label="下一个日期范围" onClick={() => moveCalendar(1)}><RiArrowRightSLine /></Button>
        </div>

        <div className="flex flex-wrap items-center gap-2 lg:justify-end">
          <Button size="sm" variant="secondary" onClick={() => setSelectedDate(new Date())}>今天</Button>
          <div className="flex items-center gap-0.5 rounded-md border border-border p-0.5" role="group" aria-label="日历视图">
            {([ ["day", "日"], ["week", "周"], ["month", "月"] ] as const).map(([value, label]) => (
              <Button key={value} size="sm" variant={view === value ? "outline" : "ghost"} aria-pressed={view === value} onClick={() => setView(value)}>{label}</Button>
            ))}
          </div>
          <Popover open={datePickerOpen} onOpenChange={setDatePickerOpen}>
            <PopoverTrigger render={<Button size="icon-sm" variant="outline" aria-label="选择日期" />}><RiCalendarLine /></PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="end">
              <Calendar
                mode="single"
                locale={zhCN}
                selected={selectedDate}
                month={selectedDate}
                onMonthChange={setSelectedDate}
                onSelect={(date) => { if (date) { setSelectedDate(date); setDatePickerOpen(false); } }}
              />
            </PopoverContent>
          </Popover>
          <Button size="icon-sm" variant="ghost" aria-label="刷新日程" onClick={() => void load()} disabled={loading}><RiRefreshLine /></Button>
        </div>
      </header>

      {error ? <Alert variant="destructive"><AlertTitle>日程操作失败</AlertTitle><AlertDescription className="flex flex-wrap items-center gap-2">{error}<Button size="sm" variant="outline" onClick={() => void load()}>重试</Button></AlertDescription></Alert> : null}
      {ticketLoadError ? <Alert variant="destructive"><AlertTitle>工单加载失败</AlertTitle><AlertDescription className="flex flex-wrap items-center gap-2">{ticketLoadError}<Button size="sm" variant="outline" onClick={() => void load()}>重试</Button></AlertDescription></Alert> : null}
      {loading ? <p className="text-xs text-muted-foreground" role="status">正在加载日程和工单…</p> : null}

      <div className="min-w-0" role="grid" aria-label={`${displayedTitle}日历`}>
        <div role="row" className={`grid ${view === "day" ? "grid-cols-1" : "grid-cols-7"} border-l border-t border-border`}>
          {visibleWeekdays.map((weekday, index) => (
            <div key={`${weekday}-${index}`} role="columnheader" className="border-b border-r border-border px-1.5 py-2 text-xs font-medium text-muted-foreground sm:px-2 sm:text-sm">{weekday}</div>
          ))}
        </div>
        <div className="border-l border-border">
          {dayRows.map((row, rowIndex) => (
            <div key={`${row[0]?.toISOString() ?? rowIndex}`} role="row" className={`grid ${view === "day" ? "grid-cols-1" : "grid-cols-7"}`}>
              {row.map((date) => {
                const dayEvents = eventsByDate.get(dateKey(date)) ?? [];
                return <ScheduleCalendarCell key={dateKey(date)} date={date} view={view} displayedMonth={selectedDate} events={dayEvents} onOpenItem={setSelectedItem} onOpenTicket={(ticket) => void router.push(`/modules/workflow-tickets-react/tickets/${ticket.id}`)} onMore={(moreDate) => { setSelectedDate(moreDate); setView("day"); }} onSelectDate={setSelectedDate} />;
              })}
            </div>
          ))}
        </div>
      </div>

      <Dialog open={quickEntryOpen} onOpenChange={setQuickEntryOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>快速记录</DialogTitle><DialogDescription>将事项加入日程，之后也可以转换为工单。</DialogDescription></DialogHeader>
          <form className="grid gap-4" onSubmit={(event) => void capture(event)}>
            <Field><FieldLabel htmlFor="schedule-calendar-title">事项</FieldLabel><Input id="schedule-calendar-title" autoFocus maxLength={160} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="例如：确认本周发布范围" /></Field>
            <DialogFooter><Button type="button" variant="outline" onClick={() => setQuickEntryOpen(false)}>取消</Button><Button type="submit" disabled={!title.trim() || creating}>{creating ? "记录中…" : "记录事项"}</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(selectedItem)} onOpenChange={(open) => { if (!open) setSelectedItem(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="break-words">{selectedItem?.title}</DialogTitle>
            <DialogDescription>{selectedItemDate ? format(selectedItemDate, "yyyy年M月d日 HH:mm", { locale: zhCN }) : ""} · {selectedItem?.owner_name || "当前用户"}</DialogDescription>
          </DialogHeader>
          {selectedItem?.note ? <p className="whitespace-pre-wrap text-sm text-muted-foreground">{selectedItem.note}</p> : <p className="text-sm text-muted-foreground">暂无备注</p>}
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">
              {selectedItem?.status === "completed" ? <RiCheckLine aria-hidden="true" /> : <RiCalendarLine aria-hidden="true" />}
              {selectedItem?.status === "completed" ? "已完成" : "待安排"}
            </span>
          </div>
          <DialogFooter className="flex-col-reverse gap-2 sm:flex-row sm:justify-between">
            <Button variant="ghost" onClick={() => { if (selectedItem) { setArchivingItem(selectedItem); setSelectedItem(null); } }} disabled={!selectedItem || pendingItemId === selectedItem.id}><RiCloseLine data-icon="inline-start" />归档</Button>
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="outline" onClick={() => selectedItem && void toggleCompleted(selectedItem)} disabled={!selectedItem || pendingItemId === selectedItem.id}>{selectedItem?.status === "completed" ? "取消完成" : "标记完成"}</Button>
              <Button onClick={() => selectedItem && openConvert(selectedItem)} disabled={!selectedItem || selectedItem.status === "completed" || pendingItemId === selectedItem.id}>转换工单</Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(convertItem)} onOpenChange={(open) => { if (!open) setConvertItem(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>转换为工单</DialogTitle><DialogDescription>选择已发布模板，转换后事项会关联新工单。</DialogDescription></DialogHeader>
          <Field><FieldLabel>工单模板</FieldLabel><Select value={workflowId} onValueChange={(value) => setWorkflowId(value ?? "")}><SelectTrigger aria-label="工单模板"><SelectValue placeholder="选择模板" /></SelectTrigger><SelectContent><SelectGroup><SelectLabel>已发布模板</SelectLabel>{selectedItemWorkflowOptions.map((workflow) => <SelectItem key={workflow.id} value={workflow.id}>{workflow.name}</SelectItem>)}</SelectGroup></SelectContent></Select></Field>
          {selectedItemWorkflowOptions.length === 0 ? <p className="text-sm text-muted-foreground">当前没有已发布的工单模板。</p> : null}
          <DialogFooter><Button variant="outline" onClick={() => setConvertItem(null)}>取消</Button><Button onClick={() => void convert()} disabled={!workflowId || pendingItemId === convertItem?.id}>{pendingItemId === convertItem?.id ? "转换中…" : "转换"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={Boolean(archivingItem)} onOpenChange={(open) => { if (!open) setArchivingItem(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>归档这条事项？</AlertDialogTitle><AlertDialogDescription>归档后事项不会再显示在日程中。</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>取消</AlertDialogCancel><AlertDialogAction onClick={() => void archive()} disabled={pendingItemId === archivingItem?.id}>确认归档</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
