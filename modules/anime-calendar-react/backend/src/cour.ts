export const validCourMonths = [1, 4, 7, 10] as const;

export function currentCour(reference = new Date()) {
  const year = reference.getFullYear();
  const month = reference.getMonth() + 1;
  return { year, cour_month: month >= 10 ? 10 : month >= 7 ? 7 : month >= 4 ? 4 : 1 };
}

export function validateCourMonth(month: number) {
  if (!validCourMonths.includes(month as (typeof validCourMonths)[number])) {
    throw new Error("cour_month 只允许 1、4、7、10");
  }
}

export function courRange(year: number, month: number) {
  validateCourMonth(month);
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month + 2, 0));
  return { start, end, start_date: dateKey(start), end_date: dateKey(end) };
}

export function dateKey(value: Date) {
  return value.toISOString().slice(0, 10);
}

export function courLabel(year: number, month: number) {
  return `${year}年${month}月新番`;
}

export function addMonths(value: Date, months: number) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth() + months, value.getUTCDate()));
}
