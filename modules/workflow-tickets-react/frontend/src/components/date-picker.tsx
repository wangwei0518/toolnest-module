import { useState } from "react";
import { RiCalendarLine } from "@remixicon/react";
import { format, isValid, parseISO } from "date-fns";
import { zhCN } from "date-fns/locale";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

type DatePickerProps = {
  id: string;
  value: string;
  onChange: (value: string) => void;
  withTime?: boolean;
  required?: boolean;
  readOnly?: boolean;
};

const hours = Array.from({ length: 24 }, (_, index) => String(index).padStart(2, "0"));
const minutes = Array.from({ length: 60 }, (_, index) => String(index).padStart(2, "0"));
const selectClassName = "h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-2 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none";
const formatDay = (date: Date) => format(date, "yyyy年M月d日", { locale: zhCN });

export function DatePicker({ id, value, onChange, withTime, required, readOnly }: DatePickerProps) {
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(() => new Date());
  const parsed = parseISO(value.slice(0, 10));
  const date = isValid(parsed) ? parsed : undefined;
  const time = /^(\d{2}):(\d{2})$/.exec(value.slice(11, 16));
  const hour = time?.[1] ?? "00";
  const minute = time?.[2] ?? "00";
  const displayValue = date ? `${formatDay(date)}${withTime ? ` ${hour}:${minute}` : ""}` : "";

  const selectDate = (nextDate: Date) => {
    setMonth(nextDate);
    const day = format(nextDate, "yyyy-MM-dd");
    onChange(withTime ? `${day}T${hour}:${minute}` : day);
    if (!withTime) setOpen(false);
  };

  if (readOnly) return <Input id={id} value={displayValue} placeholder="未设置" readOnly />;

  return (
    <Popover open={open} onOpenChange={(nextOpen) => {
      if (nextOpen) setMonth(date ?? new Date());
      setOpen(nextOpen);
    }}>
      <PopoverTrigger render={<Button id={id} type="button" variant="outline" data-empty={!date} className="w-full justify-start font-normal data-[empty=true]:text-muted-foreground" />}>
        <RiCalendarLine data-icon="inline-start" />
        <span className="truncate">{displayValue || (withTime ? "选择日期和时间" : "选择日期")}</span>
      </PopoverTrigger>
      <PopoverContent align="start" aria-label={withTime ? "选择日期和时间" : "选择日期"} className="w-auto max-h-(--available-height) max-w-(--available-width) gap-0 overflow-y-auto p-0">
        <Calendar
          mode="single"
          selected={date}
          onDayClick={selectDate}
          month={month}
          onMonthChange={setMonth}
          locale={zhCN}
          weekStartsOn={1}
          autoFocus
          className="max-sm:[--cell-size:--spacing(8)]"
          labels={{
            labelNav: () => "月份导航",
            labelPrevious: () => "上个月",
            labelNext: () => "下个月",
            labelGrid: (day) => format(day, "yyyy年M月", { locale: zhCN }),
            labelWeekday: (day) => format(day, "EEEE", { locale: zhCN }),
            labelDayButton: (day, modifiers) =>
              `${formatDay(day)} ${format(day, "EEEE", { locale: zhCN })}${modifiers.today ? "，今天" : ""}${modifiers.selected ? "，已选中" : ""}`,
          }}
        />
        {withTime && (
          <div className="grid grid-cols-2 gap-2 border-t px-3 py-2">
            <label className="flex min-w-0 items-center gap-2">
              小时
              <select className={selectClassName} value={hour} disabled={!date} onChange={(event) => onChange(`${value.slice(0, 10)}T${event.target.value}:${minute}`)}>
                {hours.map((option) => <option key={option}>{option}</option>)}
              </select>
            </label>
            <label className="flex min-w-0 items-center gap-2">
              分钟
              <select className={selectClassName} value={minute} disabled={!date} onChange={(event) => onChange(`${value.slice(0, 10)}T${hour}:${event.target.value}`)}>
                {minutes.map((option) => <option key={option}>{option}</option>)}
              </select>
            </label>
          </div>
        )}
        <div className="flex items-center justify-end gap-1 border-t px-2 py-2">
          {!required && <Button type="button" size="sm" variant="ghost" disabled={!date} onClick={() => { onChange(""); setOpen(false); }}>清除</Button>}
          <Button type="button" size="sm" variant="ghost" onClick={() => selectDate(new Date())}>今天</Button>
          {withTime && <Button type="button" size="sm" variant="outline" onClick={() => setOpen(false)}>完成</Button>}
        </div>
      </PopoverContent>
    </Popover>
  );
}
