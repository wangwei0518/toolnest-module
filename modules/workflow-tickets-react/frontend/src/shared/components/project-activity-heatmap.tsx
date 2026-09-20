import { useMemo } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import type { TimelineActivity } from "../../api";

const LOOKBACK_DAYS = 365;
const ACTIVITY_DISPLAY_DAYS = 180;
const GRID_ROWS = 7;
const ACTIVITY_CELL_SIZE_PX = 15;
const ACTIVITY_CELL_GAP_PX = 4;
const YEAR_ACTIVITY_CELL_SIZE_PX = 10;
const YEAR_ACTIVITY_CELL_GAP_PX = 2.4;
const YEAR_ACTIVITY_TABLE_INSET_PX = 2.4;
const YEAR_ACTIVITY_HEADER_HEIGHT_PX = 13;
const YEAR_ACTIVITY_HEADER_GAP_PX = 4.8;
const DAYS_PER_ROW = 14;

type ActivityCell = {
  date: string;
  count: number;
  samples: string[];
  isFuture: boolean;
  isToday: boolean;
  level: number;
};

type ActivityWeek = ActivityCell[];

function startOfLocalDay(value: Date): Date {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
}

function addDays(value: Date, days: number): Date {
  const date = new Date(value);
  date.setDate(date.getDate() + days);
  return date;
}

function addMonths(value: Date, months: number): Date {
  const date = new Date(value);
  date.setMonth(date.getMonth() + months);
  return date;
}

function localDateKey(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function startOfWeek(value: Date): Date {
  const date = startOfLocalDay(value);
  const mondayOffset = (date.getDay() + 6) % 7;
  return addDays(date, -mondayOffset);
}

function startOfSundayWeek(value: Date): Date {
  const date = startOfLocalDay(value);
  return addDays(date, -date.getDay());
}

function activityLevel(count: number, maximum: number): number {
  if (count <= 0 || maximum <= 0) return 0;
  return Math.min(4, Math.max(1, Math.ceil((count / maximum) * 4)));
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

function activityCellClass(cell: ActivityCell): string {
  return cn(
    "flex items-center justify-center rounded-[calc(var(--radius-sm)-4px)] border border-border/60 text-[0.5625rem] transition-colors outline-none hover:brightness-95 focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-offset-1 focus-visible:ring-offset-background",
    activityToneClass(cell.level),
    cell.isFuture && "opacity-40",
    cell.level === 4 && "text-primary-foreground",
    cell.isToday && "font-semibold ring-2 ring-primary ring-offset-1 ring-offset-background",
  );
}

function ActivityCellView({ cell, cellSize, fill }: { cell: ActivityCell; cellSize?: number; fill?: boolean }) {
  const cellLabel = cell.isFuture ? `${formatActivityDate(cell.date)}：尚未到达` : `${formatActivityDate(cell.date)}：${cell.count} 次活动`;
  return (
    <Tooltip key={cell.date}>
      <TooltipTrigger delay={0} closeDelay={0} render={<span
        className={cn(activityCellClass(cell), fill && "size-full")}
        style={fill ? undefined : cellSize ? { width: cellSize, height: cellSize } : undefined}
        data-date={cell.date}
        data-level={cell.level}
        data-updates={cell.count}
        data-future={cell.isFuture}
        role="img"
        aria-label={cellLabel}
        tabIndex={0}
      />} />
      <TooltipContent side="top" align="center" className="max-w-72">
        <div className="grid gap-1">
          <p>{formatActivityDate(cell.date)}</p>
          <p className="text-background/80">{cell.count ? `${cell.count} 次活动` : "暂无活动"}</p>
          {cell.samples.slice(0, 2).map((sample, sampleIndex) => <p key={`${sample}-${sampleIndex}`} className="max-w-64 break-words text-background/80">{sample}</p>)}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

function splitActivityDays(weeks: ActivityWeek[]): ActivityCell[][] {
  const days = weeks.flat().filter((cell) => !cell.isFuture).reverse().slice(0, ACTIVITY_DISPLAY_DAYS);
  const rows = Array.from({ length: Math.ceil(days.length / DAYS_PER_ROW) }, (_, index) => days.slice(index * DAYS_PER_ROW, (index + 1) * DAYS_PER_ROW));
  const lastRow = rows[rows.length - 1];
  if (!lastRow || lastRow.length === DAYS_PER_ROW) return rows;

  const lastCell = lastRow[lastRow.length - 1];
  if (!lastCell) return rows;
  const lastDate = new Date(`${lastCell.date}T00:00:00`);
  const existingLength = lastRow.length;
  for (let index = existingLength; index < DAYS_PER_ROW; index += 1) {
    const date = addDays(lastDate, -(index - existingLength + 1));
    lastRow.push({ date: localDateKey(date), count: 0, samples: [], isFuture: false, isToday: false, level: 0 });
  }
  return rows;
}

function buildActivityWeeks(activity: TimelineActivity | undefined, now = new Date()): ActivityWeek[] {
  const today = startOfLocalDay(now);
  const rangeStart = addDays(today, -(LOOKBACK_DAYS - 1));
  const firstWeek = startOfWeek(rangeStart);
  const countByDate = new Map((activity?.days ?? []).map((day) => [day.date, day]));
  const todayKey = localDateKey(today);
  const weeks: ActivityWeek[] = [];
  let cursor = firstWeek;

  while (cursor <= today) {
    const weekStart = new Date(cursor);
    weeks.push(Array.from({ length: GRID_ROWS }, (_, row) => {
      const date = addDays(weekStart, row);
      const dateKey = localDateKey(date);
      const source = dateKey > todayKey ? undefined : countByDate.get(dateKey);
      return {
        date: dateKey,
        count: source?.count ?? 0,
        samples: source?.samples ?? [],
        isFuture: dateKey > todayKey,
        isToday: dateKey === todayKey,
        level: 0,
      };
    }));
    cursor = addDays(cursor, GRID_ROWS);
  }

  const maximum = Math.max(0, ...weeks.flat().map((cell) => cell.count));
  return weeks.map((week) => week.map((cell) => ({ ...cell, level: activityLevel(cell.count, maximum) })));
}

function formatActivityDate(value: string): string {
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.valueOf()) ? value : new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "numeric", day: "numeric" }).format(date);
}

function formatActivityMonth(value: string): string {
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.valueOf()) ? value : new Intl.DateTimeFormat("en-US", { month: "short" }).format(date);
}

function buildActivityScaleLabels(rows: ActivityCell[][]): Array<{ label: string; rowIndex: number }> {
  const labels: Array<{ label: string; rowIndex: number }> = [];
  let previousMonth = "";

  rows.forEach((row, rowIndex) => {
    const firstCell = row[0];
    if (!firstCell) return;

    const month = firstCell.date.slice(0, 7);
    if (month === previousMonth) return;

    labels.push({ label: formatActivityMonth(firstCell.date), rowIndex });
    previousMonth = month;
  });

  return labels;
}

function buildYearMonthLabels(weeks: ActivityWeek[], now = new Date()): Array<{ label: string; columnIndex: number }> {
  const currentMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const months = Array.from({ length: 12 }, (_, index) => addMonths(currentMonth, index - 12));
  return months.map((month) => {
    const monthKey = localDateKey(month).slice(0, 7);
    const columnIndex = weeks.findIndex((week) => week[0]?.date.slice(0, 7) === monthKey);
    return { label: formatActivityMonth(localDateKey(month)), columnIndex };
  }).filter((item) => item.columnIndex >= 0);
}

function buildYearActivityWeeks(activity: TimelineActivity | undefined, now = new Date()): ActivityWeek[] {
  const today = startOfLocalDay(now);
  const firstWeek = startOfSundayWeek(addDays(today, -LOOKBACK_DAYS));
  const lastWeek = startOfSundayWeek(today);
  const countByDate = new Map((activity?.days ?? []).map((day) => [day.date, day]));
  const todayKey = localDateKey(today);
  const weeks: ActivityWeek[] = [];
  let cursor = firstWeek;

  while (cursor <= lastWeek) {
    const weekStart = new Date(cursor);
    weeks.push(Array.from({ length: GRID_ROWS }, (_, row) => {
      const date = addDays(weekStart, row);
      const dateKey = localDateKey(date);
      const source = dateKey > todayKey ? undefined : countByDate.get(dateKey);
      return {
        date: dateKey,
        count: source?.count ?? 0,
        samples: source?.samples ?? [],
        isFuture: dateKey > todayKey,
        isToday: dateKey === todayKey,
        level: 0,
      };
    }));
    cursor = addDays(cursor, GRID_ROWS);
  }

  const maximum = Math.max(0, ...weeks.flat().map((cell) => cell.count));
  return weeks.map((week) => week.map((cell) => ({ ...cell, level: activityLevel(cell.count, maximum) })));
}

function HeatmapGrid({ weeks, cellSize }: { weeks: ActivityWeek[]; cellSize: number }) {
  const rows = splitActivityDays(weeks);
  const gridHeight = rows.length * cellSize + Math.max(0, rows.length - 1) * ACTIVITY_CELL_GAP_PX;
  const scaleLabels = buildActivityScaleLabels(rows);

  return (
    <div className="grid w-fit max-w-full min-w-0 items-start gap-x-1" style={{ gridTemplateColumns: "2.5rem auto", justifySelf: "center" }} aria-label="项目活动热力图">
      <div className="relative self-start text-[0.625rem] leading-none text-muted-foreground" style={{ height: gridHeight }} aria-hidden="true">
        {scaleLabels.map(({ label, rowIndex }) => (
          <span key={label} data-activity-scale={label} className="absolute left-0 -translate-y-1/2 whitespace-nowrap" style={{ top: rowIndex * (cellSize + ACTIVITY_CELL_GAP_PX) + cellSize / 2 }}>
            {label}
          </span>
        ))}
      </div>
      <div className="grid min-w-0 gap-1">
        {rows.map((row, rowIndex) => (
          <div key={row[0]?.date ?? rowIndex} className="grid justify-start gap-1" style={{ gridTemplateColumns: `repeat(${row.length}, ${cellSize}px)` }}>
            {row.map((cell) => <ActivityCellView key={cell.date} cell={cell} cellSize={cellSize} />)}
          </div>
        ))}
      </div>
    </div>
  );
}

function YearHeatmapGrid({ weeks, cellSize }: { weeks: ActivityWeek[]; cellSize: number }) {
  const monthLabels = buildYearMonthLabels(weeks);
  const weekdayLabels = ["", "Mon", "", "Wed", "", "Fri", ""];
  const gridWidth = weeks.length * cellSize + (weeks.length - 1) * YEAR_ACTIVITY_CELL_GAP_PX;
  const gridHeight = GRID_ROWS * cellSize + (GRID_ROWS - 1) * YEAR_ACTIVITY_CELL_GAP_PX;
  const columns = `repeat(${weeks.length}, ${cellSize}px)`;
  const rows = `repeat(${GRID_ROWS}, ${cellSize}px)`;

  return (
    <div className="mx-auto w-full max-w-[45.5625rem] min-w-0 justify-self-center overflow-x-auto overscroll-x-contain pt-1" aria-label="项目活动年度热力图">
      <div className="mx-auto grid w-max" style={{ gridTemplateColumns: `32.8px ${gridWidth}px`, rowGap: YEAR_ACTIVITY_HEADER_GAP_PX, padding: `${YEAR_ACTIVITY_TABLE_INSET_PX}px ${YEAR_ACTIVITY_TABLE_INSET_PX}px ${YEAR_ACTIVITY_TABLE_INSET_PX}px 0` }}>
        <span aria-hidden="true" />
        <div className="relative min-w-0 text-xs leading-[18px] text-muted-foreground" style={{ width: gridWidth, height: YEAR_ACTIVITY_HEADER_HEIGHT_PX }}>
          {monthLabels.map(({ label, columnIndex }) => (
            <span
              key={`${label}-${columnIndex}`}
              className="absolute bottom-0 whitespace-nowrap"
              style={{ left: columnIndex * (cellSize + YEAR_ACTIVITY_CELL_GAP_PX) }}
            >
              {label}
            </span>
          ))}
        </div>
        <div className="grid self-start items-center text-xs leading-[18px] text-muted-foreground" style={{ gridTemplateRows: rows, gap: YEAR_ACTIVITY_CELL_GAP_PX, height: gridHeight }} aria-hidden="true">
          {weekdayLabels.map((label, index) => <span key={index}>{label}</span>)}
        </div>
        <div className="grid w-max" style={{ gridTemplateRows: rows, gap: YEAR_ACTIVITY_CELL_GAP_PX, width: gridWidth, height: gridHeight }}>
          {Array.from({ length: GRID_ROWS }, (_, rowIndex) => (
            <div key={rowIndex} className="grid h-full" style={{ gridTemplateColumns: columns, gap: YEAR_ACTIVITY_CELL_GAP_PX }}>
              {weeks.map((week, weekIndex) => {
                const cell = week[rowIndex];
                return cell
                  ? <ActivityCellView key={cell.date} cell={cell} fill />
                  : <span key={`empty-${weekIndex}`} aria-hidden="true" />;
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function ProjectActivityHeatmap({ activity, loading, error, onRetry, variant = "compact" }: { activity: TimelineActivity | undefined; loading: boolean; error: string; onRetry: () => void; variant?: "compact" | "year" }) {
  const weeks = useMemo(() => buildActivityWeeks(activity), [activity]);
  const yearWeeks = useMemo(() => buildYearActivityWeeks(activity), [activity]);
  const isYear = variant === "year";

  return (
    <Card data-testid="project-activity-card" size="xs" className="h-fit min-w-0 self-start">
      <CardContent className="min-w-0">
        {loading && !activity ? (
          <div className="grid gap-2" aria-label="正在加载项目活动">
            <Skeleton className="h-56 w-full" />
          </div>
        ) : error ? (
          <Alert variant="destructive">
            <AlertTitle>项目活动加载失败</AlertTitle>
            <AlertDescription className="flex flex-wrap items-center gap-3">{error}<Button size="sm" variant="outline" onClick={onRetry}>重试</Button></AlertDescription>
          </Alert>
        ) : (
          <div data-testid="project-activity-heatmap" className={cn("grid min-w-0", isYear ? "gap-1 place-items-center" : "gap-4")}>
            {isYear ? <YearHeatmapGrid weeks={yearWeeks} cellSize={YEAR_ACTIVITY_CELL_SIZE_PX} /> : <HeatmapGrid weeks={weeks} cellSize={ACTIVITY_CELL_SIZE_PX} />}
            <div className={cn("flex flex-wrap items-center gap-3 text-xs text-muted-foreground", isYear ? "w-full max-w-[45.5625rem] justify-end px-8" : "justify-end")} aria-label="活动强度图例">
              <div className="flex items-center gap-2">
                <span>少</span>
                {[0, 1, 2, 3, 4].map((level) => <span key={level} className={cn("rounded-[calc(var(--radius-sm)-4px)] border border-border/60", activityToneClass(level))} style={{ width: isYear ? YEAR_ACTIVITY_CELL_SIZE_PX : ACTIVITY_CELL_SIZE_PX, height: isYear ? YEAR_ACTIVITY_CELL_SIZE_PX : ACTIVITY_CELL_SIZE_PX }} aria-hidden="true" />)}
                <span>多</span>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
