import { Fragment, useState, type FormEvent } from "react";
import { RiArrowRightLine, RiBarChartGroupedLine, RiCalendarLine, RiStackLine } from "@remixicon/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import type { Dashboard, TrendPoint } from "@/types";
import { calendar, displayMonth, gil, number, shiftDay } from "@/lib/income";
import { Panel, SelectField } from "./presentation";

const colors = ["< 20,000,000", "20,000,000 – 39,999,999", "40,000,000 – 59,999,999", "≥ 60,000,000"];
const weekdays = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];

export function HeatMap({ view, today, month, total, onMonth, onDay }: {
  view: Dashboard | undefined; today: string; month: string; total: number | null; onMonth: (month: string) => void; onDay: (date: string) => void;
}) {
  const values = new Map(view?.reports.map(report => [report.date, report.totalGil]));
  const dates = calendar(month);
  const months = [...new Set([today.slice(0, 7), month, ...(view?.months ?? [])])].sort().reverse();
  const received = view?.reports.length ?? 0;
  return <Panel title="月度收入热力图" icon={RiCalendarLine} action={
    <SelectField label="热力图月份" value={month} onChange={onMonth} disabled={!view} options={months.map(value => ({ value, label: displayMonth(value) }))} />
  }>
    <div className="subv-heat-body">
      <div className="subv-heat" aria-label="月度收入日历">
        {weekdays.map(day => <span key={day} className="subv-weekday">{day}</span>)}
        {dates.cells.map(date => {
          const usable = date.startsWith(month) && date <= today;
          const value = values.get(date);
          const level = !usable ? "outside" : value === undefined ? "missing" : value === 0 ? "zero" : value >= 60e6 ? 4 : value >= 40e6 ? 3 : value >= 20e6 ? 2 : 1;
          const label = date + (date > today ? " 未到日期" : !view ? " 待配置部队" : value === undefined ? " 未上报" : " " + gil(value));
          return <Button variant="ghost" size="sm" key={date} type="button" data-heat={level} className="subv-day"
            disabled={!view || !usable} aria-current={date === today ? "date" : undefined} aria-label={label} title={label}
            onClick={() => onDay(date)}>{Number(date.slice(8))}</Button>;
        })}
      </div>
      <dl className="subv-heat-legend">
        <dt>当月总收入</dt><dd className="subv-gold subv-month-total">{total === null ? "—" : gil(total)}</dd>
        <dt>已上报日均</dt><dd>{total !== null && received ? gil(Math.round(total / received)) : "—"}</dd>
        <div className="subv-colors">{[...colors].reverse().map((label, index) => <div key={label}><i data-heat={4 - index} />{label}</div>)}</div>
      </dl>
    </div>
  </Panel>;
}

export type Range = 7 | 30 | 90;
export interface DateRange { from: string; to: string }
function RangePicker({ today, value, onChange }: { today: string; value: DateRange; onChange: (range: DateRange) => void }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  function apply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const from = String(form.get("from") ?? ""), to = String(form.get("to") ?? "");
    if (!from || !to || to > today || from > to || Date.parse(to) - Date.parse(from) > 365 * 86400000) {
      setError("请选择 1 到 366 天，结束日期不能晚于今天。"); return;
    }
    onChange({ from, to }); setOpen(false);
  }
  return <Popover open={open} onOpenChange={next => { setError(""); setOpen(next); }}>
    <PopoverTrigger aria-label="自定义日期范围" render={<Button size="icon-sm" variant="outline"/>}><RiCalendarLine/></PopoverTrigger>
    <PopoverContent align="end" className="tn-ff14-subvoyage-income subv-date-popup">
      <PopoverTitle>自定义日期范围</PopoverTitle>
      {open && <form onSubmit={apply} className="subv-form">
        <Label htmlFor="subv-date-from">开始日期</Label><Input id="subv-date-from" type="date" name="from" max={today} defaultValue={value.from} required/>
        <Label htmlFor="subv-date-to">结束日期</Label><Input id="subv-date-to" type="date" name="to" max={today} defaultValue={value.to} required/>
        {error && <p role="alert">{error}</p>}<Button size="sm" type="submit">应用日期</Button>
      </form>}
    </PopoverContent>
  </Popover>;
}
export function Trend({ view, today, month, range, onRange, onDay, custom, result, onCustom }: {
  view: Dashboard | undefined; today: string; month: string; range: Range; onRange: (range: Range) => void; onDay: (date: string) => void;
  custom: DateRange | null; result: { data?: TrendPoint[]; error?: string } | undefined; onCustom: (range: DateRange) => void;
}) {
  const [focused, setFocused] = useState("");
  const end = calendar(month).end;
  const latest = custom?.to ?? (end < today ? end : today);
  const count = custom ? Math.round((Date.parse(custom.to) - Date.parse(custom.from)) / 86400000) + 1 : range;
  const observed = new Map((custom ? result?.data ?? [] : view?.trend ?? []).map(point => [point.date, point.totalGil]));
  const days = Array.from({ length: count }, (_, index) => {
    const date = shiftDay(latest, index + 1 - count);
    return { date, value: observed.get(date) };
  });
  const data = days.filter((point): point is { date: string; value: number } => point.value !== undefined);
  const max = Math.max(...data.map(point => point.value), 0);
  const size = max ? 10 ** Math.floor(Math.log10(max / 4)) : 1;
  const step = Math.max(1, Math.ceil(max / 5 / size) * size);
  const ceiling = step * 5;
  const x = (index: number) => 100 * index / Math.max(days.length - 1, 1);
  const y = (value: number) => 100 * (1 - value / ceiling);
  const ticks = [0, 1, 2, 3, 4, 5];
  const skip = Math.max(1, Math.ceil(count / 7));
  const active = data.some(point => point.date === focused) ? focused : data.at(-1)?.date;
  const groups: { x: number; y: number }[][] = [];
  let group: { x: number; y: number }[] = [];
  days.forEach((day, index) => {
    if (day.value === undefined) { if (group.length) groups.push(group); group = []; }
    else group.push({ x: x(index), y: y(day.value) });
  });
  if (group.length) groups.push(group);
  return <Panel title={custom ? "自定义日期收益趋势" : "近" + range + "日打捞收益趋势"} id="subv-trend" icon={RiBarChartGroupedLine} action={
    <div className="subv-actions"><div className="subv-segments" role="group" aria-label="趋势范围">{([7, 30, 90] as const).map(value =>
      <Button key={value} size="sm" variant="ghost" aria-pressed={!custom && value === range} onClick={() => onRange(value)}>近{value}日</Button>)}</div>{view && <RangePicker today={today} value={custom ?? { from: shiftDay(latest, 1 - count), to: latest }} onChange={onCustom}/>}</div>
  }>
    {custom && !result ? <p className="subv-empty" role="status">正在加载收益趋势…</p> : result?.error ? <p className="subv-empty" role="alert">{result.error}</p> : <div className="subv-chart" aria-label="每日 NPC 估值">
      <div className="subv-axis-y" aria-hidden="true">{ticks.map(index => <span key={index} style={{ top: index * 20 + "%" }}>{data.length ? number.format(ceiling - index * step) : "—"}</span>)}</div>
      <div>
        <div className="subv-plot">
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            <defs><linearGradient id="subv-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" className="subv-fill-top"/><stop offset="100%" className="subv-fill-bottom"/></linearGradient></defs>
            {ticks.map(index => <line className="subv-gridline" key={index} x1="0" x2="100" y1={index * 20} y2={index * 20} vectorEffect="non-scaling-stroke"/>)}
            {days.map(({ date }, index) => index % skip === 0 && <line className="subv-gridline" key={date} x1={x(index)} x2={x(index)} y1="0" y2="100" vectorEffect="non-scaling-stroke"/>)}
            {groups.map((points, index) => {
              const first = points[0], last = points.at(-1);
              if (!first || !last || points.length < 2) return null;
              const list = points.map(p => p.x + "," + p.y).join(" ");
              return <Fragment key={index}><polygon fill="url(#subv-fill)" points={first.x + ",100 " + list + " " + last.x + ",100"}/><polyline className="subv-plot-line" points={list} vectorEffect="non-scaling-stroke"/></Fragment>;
            })}
          </svg>
          {!data.length && <div className="subv-chart-empty"><p>{view ? "所选日期范围暂无上报" : "收到收益上报后显示趋势"}</p></div>}
          {days.map((point, index) => point.value !== undefined && <button key={point.date} type="button" className="subv-point"
            style={{ left: x(index) + "%", top: y(point.value) + "%" }} data-active={point.date === active} data-end={index > days.length / 2}
            aria-label={point.date + " " + gil(point.value) + "，查看当日道具"}
            onFocus={() => setFocused(point.date)} onBlur={() => setFocused("")}
            onPointerEnter={() => setFocused(point.date)} onPointerLeave={() => setFocused("")}
            onClick={() => onDay(point.date)}><span className="subv-point-tip" aria-hidden="true">{point.date.slice(5)}<b>{gil(point.value)}</b></span></button>)}
        </div>
        <div className="subv-axis-x" aria-hidden="true">{days.map((point, index) => (index === days.length - 1 || index % skip === 0 && index < days.length - skip)
          && <span key={point.date} style={{ left: x(index) + "%" }}>{point.date.slice(5)}</span>)}</div>
      </div>
    </div>}
  </Panel>;
}

export function ItemsPanel({ children, onOpen, hasItems }: { children: React.ReactNode; onOpen: () => void; hasItems: boolean }) {
  return <Panel title="打捞物品分析（本月）" id="subv-loot" icon={RiStackLine} action={
    <Button variant="ghost" size="sm" disabled={!hasItems} onClick={onOpen}>查看全部物品 <RiArrowRightLine data-icon="inline-end"/></Button>
  }>{children}</Panel>;
}
