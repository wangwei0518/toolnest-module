import { useState, type FormEvent } from "react";
import { createRoot } from "react-dom/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import "./guest.css";

type Result = { title: string; content: string | null; expiresAt: number; files: Array<{ id: string; filename: string; size: number }> };
const id = (import.meta.env.DEV ? new URLSearchParams(location.search).get("id") : null) ?? location.pathname.split("/").filter(Boolean).at(-1) ?? "";
const base = `/api/v1/modules/temporary-transfer/public/${encodeURIComponent(id)}`;

function GuestPage() {
  const [code, setCode] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  async function request<T>(url: string): Promise<T> {
    const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code }), cache: "no-store" });
    const data: unknown = await response.json();
    if (!response.ok) throw new Error(typeof data === "object" && data && "message" in data && typeof data.message === "string" ? data.message : "请求失败，请重试。");
    return data as T;
  }
  async function verify(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try { setResult(await request<Result>(`${base}/verify`)); } catch (reason) { setError(reason instanceof Error ? reason.message : "无法打开投递。"); }
    finally { setBusy(false); }
  }
  async function download(fileId: string) {
    setBusy(true); setError("");
    try { const { url } = await request<{ url: string }>(`${base}/files/${encodeURIComponent(fileId)}/download`); location.assign(url); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "下载失败。"); }
    finally { setBusy(false); }
  }
  async function copy() {
    try { await navigator.clipboard.writeText(result?.content ?? ""); setMessage("已复制。"); }
    catch { setError("复制失败，请手动选择内容复制。"); }
  }
  return <main className="tn-guest"><div className="tn-guest__shell"><div className="tn-guest__brand">ToolNest</div><Card><CardHeader><CardTitle>{result ? result.title : "你收到一份投递"}</CardTitle><CardDescription>{result ? `有效至 ${new Date(result.expiresAt).toLocaleString()}` : "请输入发送方提供的提取码。"}</CardDescription></CardHeader><CardContent>
    {!result ? <form onSubmit={(event) => void verify(event)} className="tn-guest__stack"><Field><FieldLabel htmlFor="guest-code">提取码</FieldLabel><Input id="guest-code" value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" maxLength={6} required /></Field><Button type="submit" disabled={busy || code.length !== 6}>{busy ? "验证中…" : "查看内容"}</Button></form> : <div className="tn-guest__stack">
      {result.content !== null && <><p className="tn-guest__text">{result.content}</p><Button type="button" variant="outline" onClick={() => void copy()}>复制文字</Button>{/^https?:\/\/[^\s]+$/i.test(result.content.trim()) && <a href={result.content.trim()} target="_blank" rel="noopener noreferrer">打开链接：{result.content.trim()}</a>}</>}
      {result.files.length > 0 && <ul className="tn-guest__files">{result.files.map((file) => <li key={file.id}><span className="tn-guest__filename" title={file.filename}>{file.filename}</span><Button type="button" size="sm" disabled={busy} onClick={() => void download(file.id)}>下载</Button></li>)}</ul>}
    </div>}
    {error && <p className="tn-guest__error" role="alert">{error}</p>}{message && <p role="status">{message}</p>}
  </CardContent></Card></div></main>;
}

const root = document.getElementById("root");
if (root) createRoot(root).render(<GuestPage />);
