import { useEffect, useRef, useState } from "react";
import { ArrowRight, Copy, LoaderCircle } from "lucide-react";
import { Button } from "./components/ui/button";
import { Alert, AlertDescription } from "./components/ui/alert";
import {
  FileAttachments,
  FilePreview,
  fileType,
  type FileEntry,
} from "./file-previews";
import type { ReceivedTransfer } from "./api/transfer";
import { getTransferErrorMessage } from "./api/errors";

/** Preview is explicit and consumes the same short-lived grant as a download. */
export function Receiver({
  result,
  authorize,
}: {
  result: ReceivedTransfer;
  authorize: (id: string) => Promise<{ url: string }>;
}) {
  const [preview, setPreview] = useState<FileEntry | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  const [expired, setExpired] = useState(() => result.expiresAt <= Date.now());
  useEffect(() => {
    const timer = setInterval(
      () => setExpired(result.expiresAt <= Date.now()),
      1000,
    );
    return () => clearInterval(timer);
  }, [result.expiresAt]);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  async function download(index: number) {
    const file = result.files[index];
    if (!file || busy) return;
    setBusy(true);
    setError("");
    try {
      const { url } = await authorize(file.id);
      location.assign(url);
    } catch (e) {
      setError(getTransferErrorMessage(e, "下载失败，请重试。"));
    } finally {
      setBusy(false);
    }
  }
  async function show(entry: FileEntry) {
    if (busy) return;
    setError("");
    setPreview(null);
    const file = result.files.find((f) => f.id === entry.id);
    if (!file) return;
    if (file.size > 25 * 1024 * 1024) {
      setError("此文件超过 25 MB 预览上限，请下载后查看。");
      return;
    }
    const kind = fileType(entry);
    if (["file", "archive", "document", "sheet", "slides"].includes(kind)) {
      setPreview(entry);
      return;
    }
    setBusy(true);
    const abort = new AbortController();
    controller.current = abort;
    try {
      const { url } = await authorize(file.id);
      if (abort.signal.aborted) return;
      const response = await fetch(url, {
        signal: abort.signal,
        cache: "no-store",
        credentials: "omit",
        referrerPolicy: "no-referrer",
      });
      if (!response.ok || !response.body) throw new Error("无法读取文件");
      const reader = response.body.getReader();
      const chunks: Uint8Array<ArrayBuffer>[] = [];
      let length = 0;
      const limit =
        kind === "text" || kind === "code" ? 64 * 1024 : 25 * 1024 * 1024;
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        const take = value.subarray(0, Math.max(0, limit - length));
        chunks.push(new Uint8Array(take));
        length += value.byteLength;
        if (length >= limit) {
          await reader.cancel();
          if (kind !== "text" && kind !== "code" && length > limit)
            throw new Error("文件超过预览上限");
          break;
        }
      }
      if (!abort.signal.aborted)
        setPreview({
          ...entry,
          file: new File(chunks, file.filename, {
            type: kind === "pdf" ? "application/pdf" : "",
          }),
        });
    } catch (e) {
      if (!abort.signal.aborted)
        setError(
          getTransferErrorMessage(
            e,
            "预览加载失败，请下载后查看；R2 需要允许当前网站跨域访问。",
          ),
        );
    } finally {
      if (!abort.signal.aborted) setBusy(false);
    }
  }
  if (expired)
    return (
      <Alert variant="destructive">
        <AlertDescription>
          投递已过期，无法继续预览或下载。请联系发送者重新投递。
        </AlertDescription>
      </Alert>
    );
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex min-w-0 items-center justify-between gap-2">
        <h3 className="truncate text-sm font-medium" title={result.title}>
          {result.title}
        </h3>
        <span className="shrink-0 text-xs text-muted-foreground">
          {new Date(result.expiresAt).toLocaleString()} 到期
        </span>
      </div>
      {result.content !== null && (
        <>
          <div className="max-h-64 overflow-y-auto whitespace-pre-wrap break-words rounded-lg border border-border bg-muted/30 p-4 text-sm">
            {result.content}
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(result.content ?? "");
                  setNotice("已复制。");
                } catch {
                  setError("复制失败，请手动选择文字。");
                }
              }}
            >
              <Copy />
              复制文字
            </Button>
            {/^https?:\/\/[^\s]+$/i.test(result.content.trim()) && (
              <Button
                nativeButton={false}
                render={
                  <a
                    href={result.content.trim()}
                    target="_blank"
                    rel="noopener noreferrer"
                  />
                }
              >
                打开链接
                <ArrowRight />
              </Button>
            )}
          </div>
        </>
      )}
      {result.files.length > 0 && (
        <>
          <p className="text-xs text-muted-foreground">
            点击附件预览，或使用右侧按钮下载。预览与下载均消耗一次下载授权。
          </p>
          <div className="max-h-80 overflow-y-auto px-1 py-1" aria-busy={busy}>
            <FileAttachments
              compact
              disabled={busy}
              entries={result.files.map((f) => ({
                id: f.id,
                name: f.filename,
                description: String(f.size),
              }))}
              onPreview={(e) => void show(e)}
              onDownload={(i) => void download(i)}
            />
          </div>
          {busy && (
            <p
              role="status"
              className="flex items-center gap-2 text-xs text-muted-foreground"
            >
              <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" />
              正在读取…
            </p>
          )}
          {preview && <FilePreview key={preview.name} entry={preview} />}
        </>
      )}
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {notice && (
        <p role="status" className="text-xs text-muted-foreground">
          {notice}
        </p>
      )}
    </div>
  );
}
