import { useEffect, useRef, useState, type FormEvent } from "react";
import { RiFileUploadLine, RiLink, RiUploadCloud2Line } from "@remixicon/react";
import { QRCodeSVG } from "qrcode.react";
import SparkMD5 from "spark-md5";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { api, uploadPart, type CreatedTransfer, type Settings, type Transfer, type UploadFile } from "./api/transfer";

type UploadJob = { transfer: CreatedTransfer; files: Array<{ file: File; clientId: string; remote?: UploadFile; completed: boolean }> };
type ResumeJob = { transfer: Omit<CreatedTransfer, "code">; files: Array<{ name: string; size: number; modified: number; clientId?: string; remote?: UploadFile; completed: boolean }> };
const resumeKey = "toolnest.temporary-transfer.upload.v1";
function remember(current: UploadJob) {
  const record: ResumeJob = { transfer: { id: current.transfer.id, createdAt: current.transfer.createdAt, expiresAt: current.transfer.expiresAt }, files: current.files.map((item) => ({ name: item.file.name, size: item.file.size, modified: item.file.lastModified, clientId: item.clientId, completed: item.completed, ...(item.remote ? { remote: item.remote } : {}) })) };
  try { localStorage.setItem(resumeKey, JSON.stringify(record)); } catch { /* The current tab can still retry. */ }
}
function readResume(): ResumeJob | null {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(resumeKey) ?? "null");
    if (!raw || typeof raw !== "object") return null;
    const value = raw as ResumeJob;
    if (!value.transfer || typeof value.transfer.id !== "string" || !/^[A-Za-z0-9_-]{32}$/.test(value.transfer.id) ||
        !Number.isFinite(value.transfer.createdAt) || !Number.isFinite(value.transfer.expiresAt) || value.transfer.expiresAt <= Date.now() ||
        !Array.isArray(value.files) || !value.files.length || value.files.length > 20 ||
        value.files.some((file) => !file || typeof file.name !== "string" || file.name.length > 180 ||
          !Number.isSafeInteger(file.size) || file.size < 0 || !Number.isFinite(file.modified) || typeof file.completed !== "boolean" ||
          (file.remote && (typeof file.remote.id !== "string" || !Number.isSafeInteger(file.remote.partSize) || file.remote.partSize <= 0 ||
            !Number.isSafeInteger(file.remote.partCount) || file.remote.partCount < 1 || file.remote.partCount > 10_000)))) return null;
    return value;
  } catch { return null; }
}
const bytes = (size: number) => size < 1048576 ? `${(size / 1024).toFixed(1)} KiB` : `${(size / 1048576).toFixed(1)} MiB`;

function StatusTag({ item }: { item: Transfer }) {
  const status = item.revoked_at ? "已撤销" : item.expires_at <= Date.now() ? "已过期" : item.exhausted_at ? "授权次数已用完" : item.state === "uploading" ? "上传未完成" : "可接收";
  return <Badge variant={status === "可接收" ? "default" : "secondary"}>{status}</Badge>;
}

export function Inbox() {
  const [items, setItems] = useState<Transfer[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [used, setUsed] = useState(0);
  const [cleanupFailures, setCleanupFailures] = useState(0);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState("files");
  const [files, setFiles] = useState<File[]>([]);
  const [content, setContent] = useState("");
  const [hours, setHours] = useState(24);
  const [maxGrants, setMaxGrants] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [rate, setRate] = useState(0);
  const [eta, setEta] = useState<number | null>(null);
  const [currentFile, setCurrentFile] = useState("");
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [fileProgress, setFileProgress] = useState(0);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [share, setShare] = useState<CreatedTransfer | null>(null);
  const [confirm, setConfirm] = useState<{ kind: "revoke" | "rotate"; item: Transfer } | null>(null);
  const [resume, setResume] = useState<ResumeJob | null>(readResume);
  const [discardOpen, setDiscardOpen] = useState(false);
  const job = useRef<UploadJob | null>(null);
  const abortUpload = useRef<AbortController | null>(null);

  async function refresh() {
    try { const [list, config] = await Promise.all([api.list(), api.settings()]); setItems(list.items); setNextOffset(list.nextOffset ?? null); setUsed(list.usedBytes); setCleanupFailures(list.cleanupFailures ?? 0); setSettings(config); setHours(config.defaultHours); setMaxGrants(config.defaultMaxGrants == null ? "" : String(config.defaultMaxGrants)); setError(""); }
    catch { setError("读取投递箱失败，请重试。"); }
    finally { setLoading(false); }
  }
  useEffect(() => { void refresh(); return () => abortUpload.current?.abort(); }, []);

  async function loadMore() {
    if (nextOffset === null || loadingMore) return;
    setLoadingMore(true); setError("");
    try {
      const page = await api.list(nextOffset);
      setItems((previous) => [...previous, ...page.items.filter((item) => !previous.some((existing) => existing.id === item.id))]);
      setNextOffset(page.nextOffset);
    } catch { setError("读取更多投递失败，请重试。"); }
    finally { setLoadingMore(false); }
  }

  async function finishUpload(current: UploadJob, signal: AbortSignal) {
    const total = current.files.reduce((sum, item) => sum + item.file.size, 0);
    let completed = current.files.filter((item) => item.completed).reduce((sum, item) => sum + item.file.size, 0);
    let sent = 0;
    let currentStart = completed;
    let currentSize = 0;
    const started = performance.now();
    const active = new Map<number, number>();
    const updateProgress = () => {
      const activeBytes = [...active.values()].reduce((sum, value) => sum + value, 0);
      const loaded = Math.min(total, completed + activeBytes);
      const speed = (sent + activeBytes) / Math.max((performance.now() - started) / 1000, .1);
      setProgress(total ? loaded / total * 100 : 0); setRate(speed); setEta(speed > 0 ? Math.ceil((total - loaded) / speed) : null);
      setFileProgress(currentSize ? Math.min(100, ((completed - currentStart + activeBytes) / currentSize) * 100) : 0);
    };
    for (const [index, item] of current.files.entries()) {
      if (signal.aborted) throw new Error("上传已暂停");
      if (item.completed) continue;
      currentStart = completed; currentSize = item.file.size; setCurrentIndex(index); setFileProgress(0);
      setCurrentFile(item.file.name);
      if (!item.remote) item.remote = await api.addFile(current.transfer.id, item.file, item.clientId);
      remember(current);
      const remote = item.remote;
      const prior = await api.parts(current.transfer.id, remote.id);
      if (prior.completed) { item.completed = true; completed += item.file.size; remember(current); setProgress(total ? Math.min(100, (completed / total) * 100) : 100); continue; }
      const done = new Map(prior.parts.map((part) => [part.PartNumber, part]));
      const pending: number[] = [];
      for (let part = 1; part <= remote.partCount; part += 1) {
        const start = (part - 1) * remote.partSize;
        const chunk = item.file.slice(start, Math.min(start + remote.partSize, item.file.size));
        const existing = done.get(part);
        const matches = existing?.Size === chunk.size && existing.ETag.replaceAll('"', "").toLowerCase() === SparkMD5.ArrayBuffer.hash(await chunk.arrayBuffer());
        if (matches) completed += chunk.size;
        else pending.push(part);
      }
      updateProgress();
      const worker = async () => {
        for (;;) {
          if (signal.aborted) throw new Error("上传已暂停");
          const part = pending.shift();
          if (part === undefined) return;
          const start = (part - 1) * remote.partSize;
          const chunk = item.file.slice(start, Math.min(start + remote.partSize, item.file.size));
          const signed = await api.signPart(current.transfer.id, remote.id, part);
          try {
            await uploadPart(signed.url, chunk, (loaded) => { active.set(part, loaded); updateProgress(); }, signal);
            active.delete(part); completed += chunk.size; sent += chunk.size; updateProgress();
          } catch (error) { active.delete(part); updateProgress(); throw error; }
        }
      };
      const workers = Array.from({ length: Math.min(settings?.maxConcurrentUploads ?? 1, pending.length) }, () => worker());
      const results = await Promise.allSettled(workers);
      const failed = results.find((result) => result.status === "rejected");
      if (failed?.status === "rejected") throw failed.reason;
      await api.completeFile(current.transfer.id, remote.id);
      item.completed = true;
      remember(current);
    }
    await api.publish(current.transfer.id);
    if (!current.transfer.code) {
      try { current.transfer.code = (await api.shareCode(current.transfer.id)).code; }
      catch { current.transfer.code = (await api.rotateCode(current.transfer.id)).code; }
    }
    try { localStorage.removeItem(resumeKey); } catch { /* No local persistence available. */ }
    setResume(null);
    setShare(current.transfer); job.current = null; setFiles([]); setProgress(0); setFileProgress(0); setCurrentIndex(-1); setRate(0); setEta(null); setCurrentFile("");
    await refresh();
  }

  async function create(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      if (job.current) { const controller = new AbortController(); abortUpload.current = controller; await finishUpload(job.current, controller.signal); return; }
      if (mode === "files" && files.length === 0) throw new Error("请选择要发送的文件。");
      if (mode === "files" && (files.length > 20 || files.some((file) => file.size > (settings?.maxFileBytes ?? 0)))) throw new Error("文件数量过多或超过单文件大小限制。");
      if (mode === "files" && files.some((file) => !file.name.trim() || file.name.trim().length > 180 || /[\u0000-\u001f\u007f]/.test(file.name))) throw new Error("文件名为空、过长或包含不支持的字符。");
      if (mode === "text" && !content.trim()) throw new Error("请输入要发送的文字或链接。");
      const transfer = await api.create({ kind: mode, title: mode === "files" ? files[0]?.name ?? "文件投递" : "文字投递", content, hours, maxGrants: mode === "files" && maxGrants ? Number(maxGrants) : null });
      if (mode === "text") { setContent(""); setShare(transfer); await refresh(); }
      else { job.current = { transfer, files: files.map((file) => ({ file, clientId: crypto.randomUUID(), completed: false })) }; remember(job.current); const controller = new AbortController(); abortUpload.current = controller; await finishUpload(job.current, controller.signal); }
    } catch (reason) { setError(reason instanceof Error && !reason.message.includes("status code") ? reason.message : "创建或上传失败，请检查设置和网络后重试。"); }
    finally { abortUpload.current = null; setBusy(false); }
  }

  async function confirmAction() {
    if (!confirm) return;
    setBusy(true); setError("");
    try {
      if (confirm.kind === "revoke") { await api.revoke(confirm.item.id); setNotice("投递已撤销。"); await refresh(); }
      else { const { code } = await api.rotateCode(confirm.item.id); setShare({ id: confirm.item.id, code, createdAt: confirm.item.created_at, expiresAt: confirm.item.expires_at }); }
      setConfirm(null);
    } catch { setError("操作失败，请重试。"); }
    finally { setBusy(false); }
  }

  async function openShare(item: Transfer) {
    setBusy(true); setError("");
    try {
      const { code } = await api.shareCode(item.id);
      setShare({ id: item.id, code, createdAt: item.created_at, expiresAt: item.expires_at });
    } catch (reason) {
      const status = (reason as { response?: { status?: number } })?.response?.status;
      if (status === 404) setConfirm({ kind: "rotate", item });
      else setError("读取分享信息失败，请重试。");
    } finally { setBusy(false); }
  }

  const shareUrl = share ? `${settings?.publicBaseUrl || window.location.origin}/api/v1/modules/temporary-transfer/public/${share.id}` : "";
  function selectFiles(selected: File[]) {
    if (!resume) { setFiles(selected); return; }
    const remaining = [...selected];
    const restored: UploadJob["files"] = [];
    for (const previous of resume.files) {
      const index = remaining.findIndex((file) => file.name === previous.name && file.size === previous.size && file.lastModified === previous.modified);
      if (index < 0) { setError("请选择与中断时相同的全部文件后继续。"); return; }
      const file = remaining.splice(index, 1)[0];
      if (!file) return;
      restored.push({ file, clientId: previous.clientId ?? previous.remote?.id ?? crypto.randomUUID(), completed: previous.completed, ...(previous.remote ? { remote: previous.remote } : {}) });
    }
    if (remaining.length) { setError("所选文件与待续传任务不一致。"); return; }
    job.current = { transfer: { ...resume.transfer, code: "" }, files: restored };
    setFiles(restored.map((item) => item.file)); setError(""); setNotice("已找到待续传文件，请点击继续上传。");
  }
  async function discardResume() {
    const id = job.current?.transfer.id ?? resume?.transfer.id;
    if (!id) return;
    setBusy(true);
    try { await api.revoke(id); localStorage.removeItem(resumeKey); setResume(null); job.current = null; setFiles([]); setCurrentFile(""); setDiscardOpen(false); setNotice("已撤销待续传任务。"); await refresh(); }
    catch { setError("撤销待续传任务失败，请重试。"); }
    finally { setBusy(false); }
  }
  const copy = async (value: string) => { try { await navigator.clipboard.writeText(value); setNotice("已复制到剪贴板。"); } catch { setError("复制失败，请手动复制。"); } };
  return <div className="tn-temporary-transfer__content">
    <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(15rem,1fr)]">
      <Card><CardHeader><CardTitle>快速投递</CardTitle><CardDescription>文件、文字和链接可在设备之间限期分享。</CardDescription></CardHeader><CardContent>
        <form onSubmit={(event) => void create(event)} className="flex flex-col gap-4">
          {resume && !job.current && <p role="status">发现未完成的上传，请重新选择原来的 {resume.files.length} 个文件。<Button type="button" variant="ghost" size="sm" onClick={() => setDiscardOpen(true)}>撤销任务</Button></p>}
          <Tabs value={mode} onValueChange={(value) => { if (value) setMode(value); }}><TabsList><TabsTrigger value="files" disabled={busy || Boolean(job.current)}>文件</TabsTrigger><TabsTrigger value="text" disabled={busy || Boolean(job.current) || Boolean(resume)}>文字 / 链接</TabsTrigger></TabsList>
            <TabsContent value="files"><Field><FieldLabel htmlFor="transfer-files" className="tn-transfer-drop" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); if (!busy && !job.current) selectFiles(Array.from(event.dataTransfer.files)); }}><RiUploadCloud2Line aria-hidden="true" /><span>选择文件或拖入这里</span><span className="text-muted-foreground">支持多个文件，单次最多 20 个</span><Input id="transfer-files" className="sr-only" type="file" multiple disabled={busy || Boolean(job.current)} onChange={(event) => selectFiles(Array.from(event.target.files ?? []))} /></FieldLabel></Field>
              {files.length > 0 && <ul className="mt-3 flex flex-col gap-2">{files.map((file, index) => <li key={`${file.name}-${index}`} className="flex min-w-0 items-center justify-between gap-3"><span className="min-w-0 truncate" title={file.name}>{file.name} · {bytes(file.size)}</span>{job.current ? <span className="shrink-0 text-muted-foreground">{job.current.files[index]?.completed ? "已完成" : index === currentIndex ? busy ? `上传中 ${Math.round(fileProgress)}%` : "已暂停或失败" : "等待中"}</span> : <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => setFiles((previous) => previous.filter((_, i) => i !== index))}>移除</Button>}</li>)}</ul>}
            </TabsContent>
            <TabsContent value="text"><Field><FieldLabel htmlFor="transfer-text">文字或链接</FieldLabel><Textarea id="transfer-text" value={content} onChange={(event) => setContent(event.target.value)} placeholder="粘贴要传递的内容" rows={5} disabled={busy} /></Field></TabsContent>
          </Tabs>
          <FieldGroup className="sm:flex-row"><Field><FieldLabel htmlFor="transfer-hours">有效期（小时）</FieldLabel><Input id="transfer-hours" type="number" min="1" max={settings?.maxHours ?? 168} value={hours} onChange={(event) => setHours(Number(event.target.value))} disabled={busy || Boolean(job.current)} /></Field><Field><FieldLabel htmlFor="transfer-limit">下载授权次数（可选）</FieldLabel><Input id="transfer-limit" type="number" min="1" max={settings?.maxGrantsAllowed ?? 10000} value={maxGrants} onChange={(event) => setMaxGrants(event.target.value)} disabled={busy || Boolean(job.current) || mode === "text"} /></Field></FieldGroup>
          {currentFile && <div aria-live="polite"><p className="truncate" title={currentFile}>{busy ? "正在上传" : "等待继续"}：{currentFile}</p><div className="flex items-center gap-3"><Progress className="flex-1" value={progress} aria-label="上传进度" /><span>{Math.round(progress)}%</span></div>{busy && rate > 0 && <p className="text-muted-foreground">{bytes(rate)}/s{eta !== null ? ` · 预计剩余 ${eta} 秒` : ""}</p>}</div>}
          <Button type="submit" className="w-fit" disabled={busy}>{busy ? "处理中…" : job.current ? "继续上传" : <><RiFileUploadLine data-icon="inline-start" />创建投递</>}</Button>
          {busy && job.current && <Button type="button" variant="outline" className="w-fit" onClick={() => abortUpload.current?.abort()}>暂停上传</Button>}
          {!busy && job.current && <Button type="button" variant="ghost" className="w-fit" onClick={() => setDiscardOpen(true)}>撤销上传任务</Button>}
        </form>
      </CardContent></Card>
      <Card><CardHeader><CardTitle>存储使用</CardTitle><CardDescription>包含尚待清理的文件。</CardDescription></CardHeader><CardContent><p>{bytes(used)} / {settings ? bytes(settings.maxTotalBytes) : "—"}</p><Progress className="mt-3" value={settings ? Math.min(100, used / settings.maxTotalBytes * 100) : 0} aria-label="存储使用量" /></CardContent></Card>
    </div>
    {error && <p role="alert" className="text-destructive">{error}</p>}{cleanupFailures > 0 && <p role="alert" className="text-destructive">{cleanupFailures} 个过期或撤销文件清理失败，系统会继续重试；请检查 R2 配置和运行日志。</p>}{notice && <p role="status">{notice}</p>}
    <Card><CardHeader><CardTitle>最近投递</CardTitle><CardDescription>查看状态、分享或撤销已有投递。</CardDescription></CardHeader><CardContent>
      {loading ? <p role="status">正在读取投递…</p> : items.length === 0 ? <p className="text-muted-foreground">还没有投递，选择文件或输入文字即可开始。</p> : <ul className="divide-y">{items.map((item) => { const expired = item.expires_at <= Date.now(); const active = !item.revoked_at && !item.exhausted_at && !expired && item.state === "ready"; return <li key={item.id} className="flex flex-wrap items-center justify-between gap-3 py-3"><div className="min-w-0"><p className="truncate font-medium" title={item.title}>{item.title}</p><p className="text-muted-foreground">{item.content_kind === "files" ? `${item.file_count} 个文件` : "文字"} · {bytes(item.size ?? 0)} · 创建于 {new Date(item.created_at).toLocaleString()}</p><div className="flex flex-wrap items-center gap-2"><StatusTag item={item} />{active && <span className="text-muted-foreground">有效至 {new Date(item.expires_at).toLocaleString()}</span>}</div></div><div className="flex gap-2"><Button type="button" variant="outline" size="sm" disabled={!active || busy} onClick={() => void openShare(item)}><RiLink data-icon="inline-start" />分享</Button><DropdownMenu><DropdownMenuTrigger render={<Button type="button" variant="ghost" size="sm" aria-label={`${item.title}的更多操作`}>更多</Button>} /><DropdownMenuContent><DropdownMenuGroup><DropdownMenuItem disabled={!!item.revoked_at || busy} onClick={() => setConfirm({ kind: "revoke", item })}>撤销投递</DropdownMenuItem></DropdownMenuGroup></DropdownMenuContent></DropdownMenu></div></li>; })}</ul>}
      {nextOffset !== null && <Button type="button" variant="outline" className="mt-4" disabled={loadingMore} onClick={() => void loadMore()}>{loadingMore ? "加载中…" : "查看更多"}</Button>}
    </CardContent></Card>
    <Dialog open={Boolean(share)} onOpenChange={(open) => { if (!open) setShare(null); }}><DialogContent className="max-h-[calc(100dvh-var(--spacing)*8)] overflow-y-auto"><DialogHeader><DialogTitle>分享投递</DialogTitle><DialogDescription>接收方通过链接和提取码获取内容；建议分开发送。</DialogDescription></DialogHeader>{share && <div className="flex flex-col items-start gap-3"><QRCodeSVG value={shareUrl} size={144} /><Field><FieldLabel htmlFor="share-url">分享链接</FieldLabel><Input id="share-url" readOnly value={shareUrl} /></Field>{!settings?.publicBaseUrl && ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname) && <p className="text-muted-foreground">当前链接仅能在本机访问。请在平台设置中配置其他设备可访问的公开地址。</p>}<Button type="button" variant="outline" size="sm" onClick={() => void copy(shareUrl)}>复制链接</Button><Field><FieldLabel htmlFor="share-code">提取码</FieldLabel><Input id="share-code" readOnly value={share.code} /></Field><Button type="button" variant="outline" size="sm" onClick={() => void copy(share.code)}>复制提取码</Button><p>有效至 {new Date(share.expiresAt).toLocaleString()}</p><Button type="button" onClick={() => void copy(`${shareUrl}\n提取码：${share.code}`)}>复制分享信息</Button></div>}</DialogContent></Dialog>
    <Dialog open={Boolean(confirm)} onOpenChange={(open) => { if (!open) setConfirm(null); }}><DialogContent><DialogHeader><DialogTitle>{confirm?.kind === "revoke" ? "撤销投递？" : "重新生成提取码？"}</DialogTitle><DialogDescription>{confirm?.kind === "revoke" ? "撤销后接收方无法获取新的下载授权，已签发的短期链接可能仍暂时有效。" : "出于安全考虑，原提取码不会保存为明文。重新生成后，之前的提取码立即失效。"}</DialogDescription></DialogHeader><DialogFooter><Button type="button" variant="outline" onClick={() => setConfirm(null)}>取消</Button><Button type="button" disabled={busy} onClick={() => void confirmAction()}>{busy ? "处理中…" : "确认"}</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={discardOpen} onOpenChange={setDiscardOpen}><DialogContent><DialogHeader><DialogTitle>撤销上传任务？</DialogTitle><DialogDescription>已上传的分片将被清理，之后无法继续此任务。</DialogDescription></DialogHeader><DialogFooter><Button type="button" variant="outline" onClick={() => setDiscardOpen(false)}>取消</Button><Button type="button" disabled={busy} onClick={() => void discardResume()}>确认撤销</Button></DialogFooter></DialogContent></Dialog>
  </div>;
}
