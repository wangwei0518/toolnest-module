import { createRoot } from "react-dom/client";
import type { ToolNestModuleApiClient } from "@toolnest/react-module-sdk";
import { setModuleApiClient } from "./api/client";
import { ModuleApp } from "./app";
import "./styles.css";
import "./dev.css";

const now = Date.now();
const entries = [{ id: "preview", title: "项目资料.zip", created_at: now, expires_at: now + 86400000, revoked_at: null, state: "ready", max_grants: null, grant_count: 0, content_kind: "files", file_count: 1, size: 12345678 }];
const mock = {
  async get(url: string) {
    if (url.endsWith("/share")) return { code: "123456" };
    if (url.endsWith("/transfer-settings")) return { defaultHours: 24, maxHours: 168, maxFileBytes: 536870912, maxTotalBytes: 5368709120, maxConcurrentUploads: 2, defaultMaxGrants: null, maxGrantsAllowed: 10000, r2: { configured: true, accountId: "preview", bucket: "preview" } };
    return { items: entries, usedBytes: 12345678, maxBytes: 5368709120 };
  },
  async post(url: string) {
    if (url.endsWith("/transfers")) return { id: "preview", code: "123456", createdAt: now, expiresAt: now + 86400000 };
    return { code: "123456" };
  },
  async put() { return {}; }, async patch() { return {}; }, async delete() { return {}; },
} as unknown as ToolNestModuleApiClient;
const live = new URLSearchParams(location.search).get("live") === "1";
async function request(method: string, url: string, data?: unknown) {
  const response = await fetch(`/api/v1${url}`, { method, ...(data === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(data) }) });
  const value: unknown = await response.json();
  if (!response.ok) throw new Error(typeof value === "object" && value && "message" in value ? String(value.message) : "请求失败");
  return value;
}
const liveClient = {
  get: (url: string) => request("GET", url), post: (url: string, data?: unknown) => request("POST", url, data),
  put: (url: string, data?: unknown) => request("PUT", url, data), patch: (url: string, data?: unknown) => request("PATCH", url, data),
  delete: (url: string) => request("DELETE", url),
} as ToolNestModuleApiClient;
setModuleApiClient(live ? liveClient : mock);
const root = document.getElementById("root");
if (root) createRoot(root).render(<div className="tn-dev"><ModuleApp moduleId="temporary-transfer" path={new URLSearchParams(location.search).get("view") === "settings" ? "/modules/temporary-transfer/settings" : "/modules/temporary-transfer"} params={{}} query={{}} router={{ push: () => undefined }} /></div>);
