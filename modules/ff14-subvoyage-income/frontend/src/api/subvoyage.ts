import type { Company, Credential, Dashboard, Report, TrendPoint } from "@/types";
import { getModuleApiClient } from "./client";

const base = "/modules/ff14-subvoyage-income";
export function companies() {
  return getModuleApiClient().get<Company[]>(base + "/companies");
}
export function dashboard(companyId: string, month: string) {
  const params = new URLSearchParams({ companyId, month });
  return getModuleApiClient().get<Dashboard>(base + "/dashboard?" + params);
}
export function report(companyId: string, date: string) {
  return getModuleApiClient().get<Report | null>(base + "/reports/" + date + "?" + new URLSearchParams({ companyId }));
}
export function createCompany(companyId: string, alias: string) {
  return getModuleApiClient().post<Credential>(base + "/companies", { companyId, alias });
}
export function editCompany(companyId: string, alias: string) {
  return getModuleApiClient().patch(base + "/companies/" + companyId, { alias });
}
export function rotateToken(companyId: string) {
  return getModuleApiClient().post<Credential>(base + "/companies/" + companyId + "/token");
}
export function publicUrl() {
  return new URL(webBase() + "/public/reports", window.location.origin).toString();
}
export function iconUrl(id: number) {
  return webBase() + "/items/" + id + "/icon";
}
function webBase() {
  return (import.meta.env.VITE_API_BASE ?? "/api/v1").replace(/\/$/, "") + base;
}
export function errorText(error: unknown, fallback: string) {
  const value = error as { response?: { status?: number; data?: { message?: string } } } | null;
  if (value?.response?.status === 403) return "请使用平台管理员账号查看或配置潜航控制台。";
  return value?.response?.data?.message || fallback;
}

export function trend(companyId: string, from: string, to: string) {
  return getModuleApiClient().get<TrendPoint[]>(base + "/trend?" + new URLSearchParams({ companyId, from, to }));
}
