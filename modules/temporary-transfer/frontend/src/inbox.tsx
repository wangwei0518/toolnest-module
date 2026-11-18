import { DeliveryView } from "./delivery-view";
import { Modal } from "./components/modal";
import { useEffect, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import SparkMD5 from "spark-md5";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { api, uploadPart, type CreatedTransfer, type Settings, type Transfer, type UploadFile } from "./api/transfer";
import { getTransferErrorMessage } from "./api/errors";

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

export function Inbox() {
  const [now, setNow] = useState(Date.now);
  const [hasJob, setHasJob] = useState(false);
  const [completedFiles, setCompletedFiles] = useState<boolean[]>([]);
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
  const [durationMinutes, setDurationMinutes] = useState(24 * 60);
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
    try { const [list, config] = await Promise.all([api.list(), api.settings()]); setItems(list.items); setNextOffset(list.nextOffset ?? null); setUsed(list.usedBytes); setCleanupFailures(list.cleanupFailures ?? 0); setSettings(config); setDurationMinutes(config.defaultHours * 60); setMaxGrants(config.defaultMaxGrants == null ? "" : String(config.defaultMaxGrants)); setError(""); }
    catch (reason) { setError(getTransferErrorMessage(reason, "读取投递箱失败，请重试。")); }
    finally { setLoading(false); }
  }
  useEffect(() => { void refresh(); return () => abortUpload.current?.abort(); }, []);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(timer); }, []);

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
      if (prior.completed) { item.completed = true; setCompletedFiles(current.files.map((entry) => entry.completed)); completed += item.file.size; remember(current); setProgress(total ? Math.min(100, (completed / total) * 100) : 100); continue; }
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
      setCompletedFiles(current.files.map((entry) => entry.completed));
      remember(current);
    }
    await api.publish(current.transfer.id);
    if (!current.transfer.code) {
      try { Object.assign(current.transfer, await api.shareCode(current.transfer.id)); }
      catch { Object.assign(current.transfer, await api.rotateCode(current.transfer.id)); }
    }
    try { localStorage.removeItem(resumeKey); } catch { /* No local persistence available. */ }
    setResume(null);
    setShare(current.transfer); job.current = null; setHasJob(false); setCompletedFiles([]); setFiles([]); setProgress(0); setFileProgress(0); setCurrentIndex(-1); setRate(0); setEta(null); setCurrentFile("");
    await refresh();
  }

  async function create(durationMinutes: number) {
    if (busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      if (job.current) { const controller = new AbortController(); abortUpload.current = controller; await finishUpload(job.current, controller.signal); return; }
      if (!settings) throw new Error("尚未读取到模块配置，请刷新页面后重试。");
      if (mode === "files" && files.length === 0) throw new Error("请选择要发送的文件。");
      if (mode === "files" && (files.length > 20 || files.some((file) => file.size > (settings?.maxFileBytes ?? 0)))) throw new Error("文件数量过多或超过单文件大小限制。");
      if (mode === "files" && files.some((file) => !file.name.trim() || file.name.trim().length > 180 || Array.from(file.name).some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127))) throw new Error("文件名为空、过长或包含不支持的字符。");
      if (mode === "text" && !content.trim()) throw new Error("请输入要发送的文字或链接。");
      if (mode === "files" && maxGrants && (!Number.isSafeInteger(Number(maxGrants)) || Number(maxGrants) < 1 || Number(maxGrants) > settings.maxGrantsAllowed)) throw new Error("请输入允许范围内的整数下载授权次数，或留空表示不限。");
      const transfer = await api.create({ kind: mode, title: mode === "files" ? files[0]?.name ?? "文件投递" : "文字投递", content, durationMinutes, maxGrants: mode === "files" && maxGrants ? Number(maxGrants) : null });
      if (mode === "text") { setContent(""); setShare(transfer); await refresh(); }
      else { job.current = { transfer, files: files.map((file) => ({ file, clientId: crypto.randomUUID(), completed: false })) }; setHasJob(true); setCompletedFiles(files.map(() => false)); remember(job.current); const controller = new AbortController(); abortUpload.current = controller; await finishUpload(job.current, controller.signal); }
    } catch (reason) { setError(getTransferErrorMessage(reason, "创建或上传失败，请检查设置和网络后重试。")); }
    finally { abortUpload.current = null; setBusy(false); }
  }

  async function confirmAction() {
    if (!confirm) return;
    setBusy(true); setError("");
    try {
      if (confirm.kind === "revoke") { await api.revoke(confirm.item.id); setNotice("投递已撤销。"); await refresh(); }
      else { const { code, pickupCode } = await api.rotateCode(confirm.item.id); setShare({ id: confirm.item.id, code, pickupCode, createdAt: confirm.item.created_at, expiresAt: confirm.item.expires_at }); }
      setConfirm(null);
    } catch { setError("操作失败，请重试。"); }
    finally { setBusy(false); }
  }

  async function openShare(item: Transfer) {
    setBusy(true); setError("");
    try {
      const { code, pickupCode } = await api.shareCode(item.id);
      setShare({ id: item.id, code, pickupCode, createdAt: item.created_at, expiresAt: item.expires_at });
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
    setHasJob(true); setCompletedFiles(restored.map((entry) => entry.completed));
    setFiles(restored.map((item) => item.file)); setError(""); setNotice("已找到待续传文件，请点击继续上传。");
  }
  async function discardResume() {
    const id = job.current?.transfer.id ?? resume?.transfer.id;
    if (!id) return;
    setBusy(true);
    try { await api.revoke(id); localStorage.removeItem(resumeKey); setResume(null); job.current = null; setHasJob(false); setCompletedFiles([]); setFiles([]); setCurrentFile(""); setDiscardOpen(false); setNotice("已撤销待续传任务。"); await refresh(); }
    catch { setError("撤销待续传任务失败，请重试。"); }
    finally { setBusy(false); }
  }
  const copy = async (value: string) => { try { await navigator.clipboard.writeText(value); setNotice("已复制到剪贴板。"); } catch { setError("复制失败，请手动复制。"); } };
  return <>
    <DeliveryView {...{items,settings,used,now,loading,loadingMore,nextOffset,busy,mode,files,content,durationMinutes,maxGrants,hasJob,completedFiles,currentIndex,fileProgress,currentFile,progress,rate,eta,setMode,setFiles,setContent,setDurationMinutes,setMaxGrants,selectFiles,create,openShare,loadMore,refresh,error,notice,cleanupFailures}} resumeCount={resume?.files.length ?? 0} pause={()=>abortUpload.current?.abort()} discard={()=>setDiscardOpen(true)} revoke={item=>setConfirm({kind:"revoke",item})}/>
    <Modal open={Boolean(share)} onClose={()=>setShare(null)} title="分享投递" description="独立取件码供登录用户使用；分享链接和二维码需要六位提取码。">{share&&<>
      {share.pickupCode&&<div className="flex flex-col gap-3 rounded-lg border border-border bg-muted/40 p-4"><span className="text-xs text-muted-foreground">独立取件码</span><span className="pickup-code break-all text-2xl font-semibold">{share.pickupCode.slice(0,4)}-{share.pickupCode.slice(4)}</span><Button variant="outline" size="lg" onClick={()=>void copy(share.pickupCode??"")}>复制取件码</Button></div>}
      <div className="flex items-center gap-4"><div className="qr-surface shrink-0 rounded-lg p-2"><QRCodeSVG value={shareUrl} size={104} bgColor="transparent"/></div><div className="flex min-w-0 flex-1 flex-col gap-2"><span className="text-sm font-medium">扫码在另一台设备接收</span><span className="break-all text-xs text-muted-foreground">{shareUrl}</span><Button variant="outline" className="w-fit" onClick={()=>void copy(shareUrl)}>复制链接</Button></div></div>
      <Field><FieldLabel htmlFor="share-code">链接提取码</FieldLabel><Input id="share-code" readOnly value={share.code}/></Field><Button variant="outline" onClick={()=>void copy(share.code)}>复制提取码</Button>
      {!settings?.publicBaseUrl&&["localhost","127.0.0.1","::1"].includes(location.hostname)&&<p className="text-xs text-muted-foreground">当前链接仅能在本机访问，请配置其他设备可访问的公开地址。</p>}
      <p className="text-xs text-muted-foreground">有效至 {new Date(share.expiresAt).toLocaleString()} · 建议分开发送链接和提取码。</p><Button size="lg" onClick={()=>void copy(`${shareUrl}\n提取码：${share.code}${share.pickupCode?`\n独立取件码：${share.pickupCode}`:""}`)}>复制分享信息</Button>
    </>}</Modal>
    <Dialog open={Boolean(confirm)} onOpenChange={(open) => { if (!open) setConfirm(null); }}><DialogContent><DialogHeader><DialogTitle>{confirm?.kind === "revoke" ? "撤销投递？" : "重新生成提取码？"}</DialogTitle><DialogDescription>{confirm?.kind === "revoke" ? "撤销后接收方无法获取新的下载授权，已签发的短期链接可能仍暂时有效。" : "出于安全考虑，原提取码不会保存为明文。重新生成后，之前的提取码立即失效。"}</DialogDescription></DialogHeader><DialogFooter><Button type="button" variant="outline" onClick={() => setConfirm(null)}>取消</Button><Button type="button" disabled={busy} onClick={() => void confirmAction()}>{busy ? "处理中…" : "确认"}</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={discardOpen} onOpenChange={setDiscardOpen}><DialogContent><DialogHeader><DialogTitle>撤销上传任务？</DialogTitle><DialogDescription>已上传的分片将被清理，之后无法继续此任务。</DialogDescription></DialogHeader><DialogFooter><Button type="button" variant="outline" onClick={() => setDiscardOpen(false)}>取消</Button><Button type="button" disabled={busy} onClick={() => void discardResume()}>确认撤销</Button></DialogFooter></DialogContent></Dialog>
  </>;
}
