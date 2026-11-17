import { getModuleApiClient } from "./client";

// The host API client already supplies the /api/v1 prefix.
const base = "/modules/temporary-transfer";
export interface Transfer { id: string; title: string; created_at: number; expires_at: number; revoked_at: number | null; exhausted_at: number | null; state: string; max_grants: number | null; grant_count: number; content_kind: "text" | "files"; file_count: number; size: number; storage_backend?: string | null }
export interface Settings { defaultHours: number; maxHours: number; maxFileBytes: number; maxTotalBytes: number; maxConcurrentUploads: number; defaultMaxGrants: number | null; maxGrantsAllowed: number; publicBaseUrl?: string; canManageSettings?: boolean; adminContextAvailable?: boolean; r2: { configured: boolean; accountId?: string; bucket?: string } }
export interface CreatedTransfer { id: string; code: string; pickupCode?: string | undefined; createdAt: number; expiresAt: number }
export interface UploadFile { id: string; partSize: number; partCount: number }

export interface ReceivedTransfer { id: string; title: string; content: string | null; expiresAt: number; files: Array<{id: string; filename: string; size: number}> }
export const api = {
  content: (id: string) => getModuleApiClient().get<ReceivedTransfer>(`${base}/transfers/${id}/content`),
  pickup: (code: string) => getModuleApiClient().post<ReceivedTransfer>(`${base}/pickup`, {code}),
  download: (id: string, file: string, code?: string) => getModuleApiClient().post<{url: string}>(`${base}/${code ? 'pickup' : 'transfers'}/${id}/files/${file}/download`, code ? {code} : {}),
  list: (offset = 0) => getModuleApiClient().get<{ items: Transfer[]; nextOffset: number | null; usedBytes: number; maxBytes: number; cleanupFailures: number }>(`${base}/transfers?offset=${offset}`),
  settings: () => getModuleApiClient().get<Settings>(`${base}/transfer-settings`),
  saveSettings: (value: unknown) => getModuleApiClient().put<Settings>(`${base}/transfer-settings`, value),
  create: (value: unknown) => getModuleApiClient().post<CreatedTransfer>(`${base}/transfers`, value),
  rotateCode: (id: string) => getModuleApiClient().post<{ code: string; pickupCode?: string | undefined }>(`${base}/transfers/${id}/code`, {}),
  shareCode: (id: string) => getModuleApiClient().get<{ code: string; pickupCode?: string | undefined }>(`${base}/transfers/${id}/share`),
  revoke: (id: string) => getModuleApiClient().delete(`${base}/transfers/${id}`),
  addFile: (id: string, file: File, clientId: string) => getModuleApiClient().post<UploadFile>(`${base}/transfers/${id}/files`, { filename: file.name, size: file.size, clientId }),
  parts: (id: string, fileId: string) => getModuleApiClient().get<{ parts: Array<{ PartNumber: number; Size: number; ETag: string }>; completed: boolean }>(`${base}/transfers/${id}/files/${fileId}/parts`),
  signPart: (id: string, fileId: string, part: number) => getModuleApiClient().post<{ url: string }>(`${base}/transfers/${id}/files/${fileId}/parts/${part}`, {}),
  completeFile: (id: string, fileId: string) => getModuleApiClient().post(`${base}/transfers/${id}/files/${fileId}/complete`, {}),
  publish: (id: string) => getModuleApiClient().post(`${base}/transfers/${id}/publish`, {}),
};

export function uploadPart(url: string, bytes: Blob, onProgress: (loaded: number) => void, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    if (signal.aborted) { reject(new Error("上传已暂停")); return; }
    const abort = () => request.abort();
    signal.addEventListener("abort", abort, { once: true });
    request.onloadend = () => signal.removeEventListener("abort", abort);
    request.open("PUT", url);
    request.setRequestHeader("Content-Type", "application/octet-stream");
    request.upload.onprogress = (event) => onProgress(event.loaded);
    request.onerror = () => reject(new Error("网络连接中断，请重试"));
    request.onabort = () => reject(new Error("上传已暂停"));
    request.onload = () => request.status >= 200 && request.status < 300 ? resolve() : reject(new Error("文件上传失败，请重试"));
    request.send(bytes);
  });
}
