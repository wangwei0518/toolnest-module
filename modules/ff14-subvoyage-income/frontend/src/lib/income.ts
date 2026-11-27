import type { Company, Report, Vessel } from "@/types";

export const number = new Intl.NumberFormat("zh-CN");
export const percent = new Intl.NumberFormat("zh-CN", { style: "percent", maximumFractionDigits: 1 });
export const gil = (value: number) => number.format(value) + " Gil";
export const shiftDay = (date: string, offset: number) => new Date(Date.parse(date) + offset * 86400000).toISOString().slice(0, 10);
const chinaTime = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai", dateStyle: "short", timeStyle: "short" });
export const displayTime = (value: string | number) => chinaTime.format(new Date(value));
export const chinaToday = () => chinaTime.format(new Date()).slice(0, 10);
export const companyName = (company: Company) => company.alias || company.companyName || company.companyId;
export const triggerName = (trigger: Report["trigger"]) => trigger === "completion" ? "自动上报" : "手动上报";
export const displayMonth = (value: string) => value.slice(0, 4) + "年 " + Number(value.slice(5)) + "月";

export function calendar(month: string) {
  const start = month + "-01";
  const date = new Date(start);
  const end = shiftDay(new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1)).toISOString().slice(0, 10), -1);
  const days = Number(end.slice(8));
  const leading = (date.getUTCDay() + 6) % 7;
  return { days, end, cells: Array.from({ length: Math.ceil((days + leading) / 7) * 7 }, (_, index) => shiftDay(start, index - leading)) };
}

export interface Loot {
  itemId: number;
  name: string;
  quantity: number;
  subtotal: number | null;
  prices: Map<number | null, number>;
  pending: number;
}
export function aggregate(rows: readonly Report[]) {
  const all = new Map<number, Loot>();
  for (const report of rows) {
    for (const item of report.items) {
      const row: Loot = all.get(item.itemId) ?? {
        itemId: item.itemId, name: item.name, quantity: 0, subtotal: null, prices: new Map(), pending: 0,
      };
      row.name = item.name;
      row.quantity += item.quantity;
      if (item.subtotalGil === null) row.pending += item.quantity;
      else row.subtotal = (row.subtotal ?? 0) + item.subtotalGil;
      row.prices.set(item.npcUnitPriceGil, (row.prices.get(item.npcUnitPriceGil) ?? 0) + item.quantity);
      all.set(row.itemId, row);
    }
  }
  return [...all.values()].sort((a, b) => (b.subtotal ?? -1) - (a.subtotal ?? -1) || a.itemId - b.itemId);
}
export function schedule(vessel: Vessel, now: number) {
  if (vessel.nextCompletionTimestamp === null) return { status: "无返航时间", time: "—", remaining: "—", tone: "neutral" as const };
  const target = vessel.nextCompletionTimestamp * 1000;
  const time = displayTime(target);
  const minutes = Math.ceil((target - now) / 60000);
  if (minutes <= 0) return { status: "待确认", time, remaining: "预计时间已过", tone: "warning" as const };
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  const remaining = days ? "约 " + days + " 天 " + hours % 24 + " 小时"
    : hours ? "约 " + hours + " 小时 " + minutes % 60 + " 分" : minutes + " 分钟";
  return { status: hours < 30 ? "临近返航" : "航行中", time, remaining, tone: hours < 30 ? "accent" as const : "success" as const };
}
export function downloadReports(rows: readonly Report[], id: string, month: string) {
  const entries: unknown[][] = [["日期", "生成时间（北京时间）", "触发来源", "部队 ID", "道具 ID", "道具名", "数量", "NPC 单价 (Gil)", "道具小计 (Gil)", "当日已估价总额 (Gil)"]];
  for (const report of rows) {
    const items = report.items.length ? report.items : [null];
    items.forEach((item, index) => entries.push([report.date, displayTime(report.generatedAt), triggerName(report.trigger), id,
      item?.itemId, item?.name, item?.quantity, item?.npcUnitPriceGil, item?.subtotalGil, index === 0 ? report.totalGil : null]));
  }
  const cell = (value: unknown) => {
    const text = String(value ?? "");
    return '"' + (/^\s*[=+\-@]/u.test(text) ? "'" + text : text).replaceAll('"', '""') + '"';
  };
  const href = URL.createObjectURL(new Blob(["\ufeff", entries.map(row => row.map(cell).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = href;
  link.download = "潜航收益-" + id + "-" + month + ".csv";
  link.click();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}
