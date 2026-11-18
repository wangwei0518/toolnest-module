import { useRef, useState, type FormEvent } from "react";
import {
  ArrowRight,
  Clock3,
  ClipboardPaste,
  File,
  FileText,
  FolderOpen,
  HardDrive,
  Inbox as InboxIcon,
  Link2,
  MoreHorizontal,
  Plus,
  Settings2,
  ShieldCheck,
  TriangleAlert,
  Upload,
  UploadCloud,
} from "lucide-react";
import { REGEXP_ONLY_DIGITS_AND_CHARS } from "input-otp";
import { Button } from "./components/ui/button";
import { Badge } from "./components/ui/badge";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
  CardAction,
} from "./components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "./components/ui/tabs";
import {
  Field,
  FieldLabel,
  FieldDescription,
  FieldError,
} from "./components/ui/field";
import { Input } from "./components/ui/input";
import { Textarea } from "./components/ui/textarea";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
  InputOTPSeparator,
} from "./components/ui/input-otp";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectGroup,
  SelectItem,
} from "./components/ui/select";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
} from "./components/ui/dropdown-menu";
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
} from "./components/ui/empty";
import { Alert, AlertDescription } from "./components/ui/alert";
import { Skeleton } from "./components/ui/skeleton";
import { Separator } from "./components/ui/separator";
import { Progress } from "./components/ui/progress";
import { Modal } from "./components/modal";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "./components/ui/table";
import { SettingsPage } from "./settings-page";
import { FileAttachments, FilePreview, type FileEntry } from "./file-previews";
import { Receiver } from "./receiver";
import {
  api,
  type Transfer,
  type Settings,
  type ReceivedTransfer,
} from "./api/transfer";
import { getTransferErrorMessage } from "./api/errors";
import { cn } from "./lib/utils";

const bytes = (n: number) =>
  n >= 1024 ** 3
    ? `${(n / 1024 ** 3).toFixed(1)} GB`
    : n < 1024 ** 2
      ? `${(n / 1024).toFixed(1)} KB`
      : `${(n / 1024 ** 2).toFixed(1)} MB`;
export const transferStatus = (t: Transfer, now: number) =>
  t.revoked_at
    ? "已撤销"
    : t.expires_at <= now
      ? "已过期"
      : t.exhausted_at
        ? "次数已用完"
        : t.state === "ready"
          ? "有效"
          : "上传未完成";
function StatusTag({ item, now }: { item: Transfer; now: number }) {
  const status = transferStatus(item, now);
  return (
    <span className="inline-flex items-center gap-1">
      {status === "已过期" && (
        <TriangleAlert className="size-3.5 text-destructive" />
      )}
      <Badge
        variant={
          status === "有效"
            ? "default"
            : status === "已过期"
              ? "destructive"
              : "secondary"
        }
      >
        {status}
      </Badge>
    </span>
  );
}
export interface DeliveryViewProps {
  items: Transfer[];
  settings: Settings | null;
  used: number;
  now: number;
  loading: boolean;
  loadingMore: boolean;
  nextOffset: number | null;
  busy: boolean;
  mode: string;
  files: File[];
  content: string;
  hours: number;
  maxGrants: string;
  hasJob: boolean;
  resumeCount: number;
  completedFiles: boolean[];
  currentIndex: number;
  fileProgress: number;
  currentFile: string;
  progress: number;
  rate: number;
  eta: number | null;
  setMode: (v: string) => void;
  setFiles: (v: File[]) => void;
  setContent: (v: string) => void;
  setHours: (v: number) => void;
  setMaxGrants: (v: string) => void;
  selectFiles: (v: File[]) => void;
  create: (e: FormEvent) => Promise<void>;
  pause: () => void;
  discard: () => void;
  openShare: (t: Transfer) => Promise<void>;
  revoke: (t: Transfer) => void;
  loadMore: () => Promise<void>;
  refresh: () => Promise<void>;
  error: string;
  notice: string;
  cleanupFailures: number;
}
export function DeliveryView(p: DeliveryViewProps) {
  const [tab, setTab] = useState("mine"),
    [code, setCode] = useState(""),
    [codeError, setCodeError] = useState(""),
    [pickupBusy, setPickupBusy] = useState(false),
    [result, setResult] = useState<ReceivedTransfer | null>(null);
  const [detail, setDetail] = useState<ReceivedTransfer | null>(null),
    [detailError, setDetailError] = useState(""),
    [opening, setOpening] = useState<string | null>(null),
    [panel, setPanel] = useState<"settings" | "more" | null>(null),
    [preview, setPreview] = useState<FileEntry | null>(null),
    [filter, setFilter] = useState("全部投递"),
    [dragging, setDragging] = useState(false);
  const [copied, setCopied] = useState("");
  const input = useRef<HTMLInputElement>(null),
    requestId = useRef(0);
  const valid = p.items
    .filter((t) => transferStatus(t, p.now) === "有效")
    .slice(0, 3);
  const filtered = p.items.filter(
    (t) => filter === "全部投递" || transferStatus(t, p.now) === filter,
  );
  const locked = p.busy || p.hasJob;
  const options = Array.from(
    new Set([1, 6, 24, 72, p.hours, p.settings?.defaultHours ?? 24]),
  )
    .filter((h) => h <= (p.settings?.maxHours ?? 168))
    .sort((a, b) => a - b)
    .map((h) => ({
      value: String(h),
      label: h > 24 && h % 24 === 0 ? `${h / 24} 天` : `${h} 小时`,
    }));
  function changeCode(v: string) {
    requestId.current++;
    setCode(v.toUpperCase());
    setResult(null);
    setCodeError("");
    setPickupBusy(false);
  }
  async function pickup(e: FormEvent) {
    e.preventDefault();
    if (code.length !== 8 || pickupBusy) return;
    const id = ++requestId.current;
    setPickupBusy(true);
    setCodeError("");
    setResult(null);
    try {
      const value = await api.pickup(code);
      if (id === requestId.current) setResult(value);
    } catch (e) {
      if (id === requestId.current)
        setCodeError(getTransferErrorMessage(e, "取件失败，请核对取件码。"));
    } finally {
      if (id === requestId.current) setPickupBusy(false);
    }
  }
  async function retrieve(t: Transfer) {
    if (t.content_kind === "files") {
      await show(t);
      return;
    }
    if (opening) return;
    setOpening(t.id);
    setDetailError("");
    try {
      const value = await api.content(t.id);
      try {
        await navigator.clipboard.writeText(value.content ?? "");
        setDetailError("");
        setCopied(t.id);
      } catch {
        setDetail(value);
      }
    } catch (e) {
      setDetailError(getTransferErrorMessage(e, "投递已失效，无法获取内容。"));
    } finally {
      setOpening(null);
    }
  }
  async function show(t: Transfer) {
    if (opening) return;
    setOpening(t.id);
    setDetailError("");
    try {
      setDetail(await api.content(t.id));
    } catch (e) {
      setDetailError(getTransferErrorMessage(e, "投递已失效，无法获取内容。"));
    } finally {
      setOpening(null);
    }
  }
  function append(next: File[]) {
    if (locked) return;
    if (p.resumeCount) {
      p.selectFiles(next);
      return;
    }
    if (p.files.length + next.length > 20) {
      setDetailError("单次投递最多 20 个文件。");
      return;
    }
    p.selectFiles([...p.files, ...next]);
  }
  const actions = (t: Transfer) => (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={`${t.title}的更多操作`}
          />
        }
      >
        <MoreHorizontal />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuGroup>
          <DropdownMenuItem
            disabled={Boolean(opening)}
            onClick={() => void show(t)}
          >
            查看详情
          </DropdownMenuItem>
          <DropdownMenuItem
            variant="destructive"
            disabled={!!t.revoked_at || p.busy}
            onClick={() => p.revoke(t)}
          >
            撤销投递
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">投递箱</h1>
        <div className="flex flex-wrap items-center gap-3">
          <span className="flex items-center gap-2 text-xs text-muted-foreground">
            <HardDrive className="size-3.5" />
            已用 {bytes(p.used)} /{" "}
            {p.settings ? bytes(p.settings.maxTotalBytes) : "—"}
            <Badge variant="outline">
              {p.settings?.r2.configured ? "R2 存储" : "本地存储"}
            </Badge>
          </span>
          <Button
            variant="outline"
            size="lg"
            onClick={() => setPanel("settings")}
          >
            <Settings2 />
            设置
          </Button>
        </div>
      </header>
      {p.notice && (
        <p role="status" className="text-sm">
          {p.notice}
        </p>
      )}
      {(p.error || detailError || p.cleanupFailures > 0) && (
        <Alert variant="destructive">
          <AlertDescription>
            {p.error ||
              detailError ||
              `${p.cleanupFailures} 个失效文件清理失败，系统将继续重试。`}
          </AlertDescription>
        </Alert>
      )}
      <div className="grid items-stretch gap-5 lg:grid-cols-2">
        <Card
          className="order-2 min-w-0 gap-3 lg:order-1"
          data-testid="send-card"
        >
          <CardHeader>
            <CardTitle>发送投递</CardTitle>
            <CardDescription>选择内容，设置有效期，即可分享。</CardDescription>
          </CardHeader>
          <form
            className="flex min-h-0 flex-1 flex-col gap-3"
            onSubmit={(e) => void p.create(e)}
          >
            <CardContent className="flex min-h-0 flex-1 flex-col gap-3">
              {p.resumeCount > 0 && !p.hasJob && (
                <Alert>
                  <AlertDescription>
                    发现未完成上传，请重新选择原来的 {p.resumeCount} 个文件。
                    <Button type="button" variant="ghost" onClick={p.discard}>
                      撤销任务
                    </Button>
                  </AlertDescription>
                </Alert>
              )}
              <Tabs
                value={p.mode}
                onValueChange={(v) => {
                  if (v) p.setMode(v);
                }}
                className="flex min-h-0 flex-1 flex-col gap-2"
              >
                <TabsList className="w-full">
                  <TabsTrigger value="files" disabled={locked}>
                    <File />
                    文件
                  </TabsTrigger>
                  <TabsTrigger
                    value="text"
                    disabled={locked || p.resumeCount > 0}
                  >
                    <Link2 />
                    文字与链接
                  </TabsTrigger>
                </TabsList>
                <div
                  className={cn(
                    "grid flex-1 grid-cols-1 grid-rows-[minmax(0,1fr)]",
                    p.files.length >= 5
                      ? "min-h-92"
                      : p.files.length === 4
                        ? "min-h-76"
                        : p.files.length === 3
                          ? "min-h-60"
                          : "min-h-48",
                  )}
                >
                  <TabsContent
                    value="files"
                    className="col-start-1 row-start-1 flex h-full min-h-0 min-w-0 flex-col pt-2"
                  >
                    <input
                      ref={input}
                      type="file"
                      multiple
                      className="sr-only"
                      aria-label="选择投递文件"
                      disabled={locked}
                      onChange={(e) => {
                        append(Array.from(e.target.files ?? []));
                        e.target.value = "";
                      }}
                    />
                    {p.files.length === 0 ? (
                      <div
                        className="drop-zone flex flex-1 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border p-4 text-center"
                        data-dragging={dragging}
                        onDragOver={(e) => {
                          e.preventDefault();
                          if (!locked) setDragging(true);
                        }}
                        onDragLeave={() => setDragging(false)}
                        onDrop={(e) => {
                          e.preventDefault();
                          setDragging(false);
                          append(Array.from(e.dataTransfer.files));
                        }}
                      >
                        <UploadCloud className="size-6 text-muted-foreground" />
                        <p className="text-sm font-medium">
                          拖拽文件到这里，或点击选择文件
                        </p>
                        <p className="text-xs text-muted-foreground">
                          单文件最大{" "}
                          {p.settings ? bytes(p.settings.maxFileBytes) : "—"} ·
                          最多 20 个文件
                        </p>
                        <Button
                          type="button"
                          variant="outline"
                          disabled={locked}
                          onClick={() => input.current?.click()}
                        >
                          <Plus />
                          选择文件
                        </Button>
                      </div>
                    ) : (
                      <div className="flex min-h-0 flex-1 flex-col gap-3">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-xs text-muted-foreground">
                            已选择 {p.files.length} 个文件 ·{" "}
                            {bytes(p.files.reduce((n, f) => n + f.size, 0))}
                          </p>
                          <Button
                            type="button"
                            variant="ghost"
                            disabled={locked}
                            onClick={() => input.current?.click()}
                          >
                            <Plus />
                            继续添加
                          </Button>
                        </div>
                        <div className="max-h-80 min-h-0 flex-1 overflow-y-auto px-1 py-1">
                          <FileAttachments
                            compact
                            state={
                              p.busy ? "uploading" : p.hasJob ? "idle" : "done"
                            }
                            disabled={locked}
                            entries={p.files.map((file, i) => ({
                              name: file.name,
                              file,
                              description: p.hasJob
                                ? p.completedFiles[i]
                                  ? "已完成"
                                  : i === p.currentIndex
                                    ? `${Math.round(p.fileProgress)}%`
                                    : "等待中"
                                : undefined,
                            }))}
                            onPreview={setPreview}
                            onRemove={
                              locked
                                ? undefined
                                : (i) =>
                                    p.setFiles(
                                      p.files.filter((_, n) => n !== i),
                                    )
                            }
                          />
                        </div>
                      </div>
                    )}
                  </TabsContent>
                  <TabsContent
                    value="text"
                    className="col-start-1 row-start-1 flex h-full min-h-0 min-w-0 flex-col pt-2"
                  >
                    <Field className="min-h-0 flex-1">
                      <FieldLabel htmlFor="send-text" className="sr-only">
                        投递内容
                      </FieldLabel>
                      <Textarea
                        id="send-text"
                        className="min-h-0 flex-1 resize-none"
                        value={p.content}
                        maxLength={100000}
                        disabled={p.busy}
                        onChange={(e) => p.setContent(e.target.value)}
                        placeholder="写下文字，或粘贴需要传递的链接…"
                      />
                      <FieldDescription className="flex justify-between">
                        <span>链接保留原文，不自动访问。</span>
                        <span>{p.content.length}/100000</span>
                      </FieldDescription>
                    </Field>
                  </TabsContent>
                </div>
              </Tabs>
              {p.currentFile && (
                <div className="flex flex-col gap-2" aria-live="polite">
                  <p className="truncate text-xs" title={p.currentFile}>
                    {p.busy ? "正在上传" : "等待继续"}：{p.currentFile}
                  </p>
                  <div className="flex items-center gap-3">
                    <Progress
                      value={p.progress}
                      className="flex-1"
                      aria-label="上传进度"
                    />
                    <span className="text-xs tabular-nums">
                      {Math.round(p.progress)}%
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-muted-foreground">
                      {p.rate > 0 && p.busy
                        ? `${bytes(p.rate)}/s${p.eta !== null ? ` · 预计 ${p.eta} 秒` : ""}`
                        : "进度已保留，可继续上传"}
                    </span>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={p.busy ? p.pause : p.discard}
                    >
                      {p.busy ? "暂停" : "撤销任务"}
                    </Button>
                  </div>
                </div>
              )}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Field orientation="horizontal" className="w-auto gap-2">
                  <FieldLabel htmlFor="expiry" className="shrink-0">
                    有效期
                  </FieldLabel>
                  <Select
                    items={options}
                    value={String(p.hours)}
                    disabled={locked}
                    onValueChange={(v) => {
                      if (v) p.setHours(Number(v));
                    }}
                  >
                    <SelectTrigger id="expiry" className="w-28">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {options.map((o) => (
                          <SelectItem key={o.value} value={o.value}>
                            {o.label}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </Field>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={locked}
                  onClick={() => setPanel("more")}
                >
                  <Settings2 />
                  更多设置
                </Button>
              </div>
            </CardContent>
            <CardFooter className="flex-col items-stretch gap-2">
              <Button type="submit" size="lg" disabled={p.busy || p.loading}>
                <Upload />
                {p.busy ? "正在创建投递…" : p.hasJob ? "继续上传" : "创建投递"}
              </Button>
              <p className="flex items-center gap-2 text-xs text-muted-foreground">
                <Clock3 className="size-3.5 shrink-0" />
                到期自动清理，请保留原始副本。
              </p>
            </CardFooter>
          </form>
        </Card>
        <Card
          className="order-1 min-w-0 gap-3 lg:order-2"
          data-testid="pickup-card"
        >
          <CardHeader>
            <CardTitle>便捷取件</CardTitle>
            <CardDescription>
              查看同账号投递，或输入取件码接收。
            </CardDescription>
          </CardHeader>
          <CardContent className="flex min-w-0 flex-1 flex-col">
            <Tabs
              value={tab}
              onValueChange={(v) => setTab(String(v))}
              className="flex-1"
            >
              <TabsList className="w-full">
                <TabsTrigger value="mine">我的投递</TabsTrigger>
                <TabsTrigger value="code">凭码取件</TabsTrigger>
              </TabsList>
              <TabsContent value="mine" className="pt-2">
                <p className="text-xs text-muted-foreground">
                  最近 3 条有效投递
                </p>
                {p.loading ? (
                  <Skeleton className="mt-3 h-40 w-full" />
                ) : valid.length ? (
                  valid.map((t) => {
                    const Icon = t.content_kind === "files" ? File : FileText;
                    return (
                      <div
                        key={t.id}
                        className="flex min-w-0 items-center gap-3 border-b border-border py-3 last:border-0"
                      >
                        <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted">
                          <Icon className="size-4 text-muted-foreground" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">
                            {t.title}
                          </p>
                          <p className="truncate text-xs text-muted-foreground">
                            {t.content_kind === "files"
                              ? `${t.file_count} 个文件 · ${bytes(t.size)}`
                              : "文字与链接"}{" "}
                            · {new Date(t.expires_at).toLocaleString()} 到期
                          </p>
                        </div>
                        <Button
                          variant="outline"
                          disabled={Boolean(opening)}
                          onClick={() => void retrieve(t)}
                        >
                          {opening === t.id
                            ? "读取中…"
                            : t.content_kind === "text"
                              ? copied === t.id
                                ? "已复制"
                                : "复制"
                              : "查看"}
                        </Button>
                      </div>
                    );
                  })
                ) : (
                  <Empty className="py-6">
                    <EmptyHeader>
                      <FolderOpen className="size-6 text-muted-foreground" />
                      <EmptyTitle>还没有有效投递</EmptyTitle>
                      <EmptyDescription>
                        在另一台设备登录同一账号，发送后即可在这里取件。
                      </EmptyDescription>
                    </EmptyHeader>
                  </Empty>
                )}
              </TabsContent>
              <TabsContent
                value="code"
                className="flex min-h-0 flex-1 flex-col gap-3 pt-3"
              >
                <form onSubmit={(e) => void pickup(e)}>
                  <Field data-invalid={!!codeError} className="gap-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-baseline gap-2">
                        <FieldLabel htmlFor="pickup-code">取件码</FieldLabel>
                        <span className="text-xs text-muted-foreground">
                          8 位字母或数字
                        </span>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={async () => {
                          try {
                            changeCode(
                              (await navigator.clipboard.readText())
                                .replace(/[^a-z0-9]/gi, "")
                                .slice(0, 8),
                            );
                          } catch {
                            setCodeError(
                              "请直接粘贴取件码，浏览器未允许读取剪贴板。",
                            );
                          }
                        }}
                      >
                        <ClipboardPaste />
                        粘贴
                      </Button>
                    </div>
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                      <InputOTP
                        id="pickup-code"
                        maxLength={8}
                        pattern={REGEXP_ONLY_DIGITS_AND_CHARS}
                        inputMode="text"
                        value={code}
                        onChange={changeCode}
                        pasteTransformer={(v) =>
                          v.replace(/[^a-z0-9]/gi, "").toUpperCase()
                        }
                        autoCapitalize="characters"
                        autoComplete="off"
                        aria-invalid={!!codeError}
                        aria-describedby={codeError ? "code-error" : undefined}
                        containerClassName="min-w-0 flex-1 gap-2"
                      >
                        <InputOTPGroup className="min-w-0 flex-1">
                          {[0, 1, 2, 3].map((i) => (
                            <InputOTPSlot
                              key={i}
                              index={i}
                              className="h-8 flex-1 text-base font-medium"
                            />
                          ))}
                        </InputOTPGroup>
                        <InputOTPSeparator />
                        <InputOTPGroup className="min-w-0 flex-1">
                          {[4, 5, 6, 7].map((i) => (
                            <InputOTPSlot
                              key={i}
                              index={i}
                              className="h-8 flex-1 text-base font-medium"
                            />
                          ))}
                        </InputOTPGroup>
                      </InputOTP>
                      <Button
                        type="submit"
                        size="lg"
                        disabled={pickupBusy || code.length !== 8}
                      >
                        {pickupBusy ? "读取中…" : "取件"}
                        <ArrowRight />
                      </Button>
                    </div>
                    {codeError && (
                      <FieldError id="code-error">{codeError}</FieldError>
                    )}
                  </Field>
                </form>
                <Separator />
                <section
                  className="flex min-h-0 flex-1 flex-col gap-2"
                  aria-label="接收结果"
                  aria-live="polite"
                >
                  <div className="flex items-center justify-between">
                    <h2 className="text-sm font-medium">接收内容</h2>
                    <Badge variant="outline">
                      {result ? "已就绪" : "待取件"}
                    </Badge>
                  </div>
                  {result ? (
                    <div className="max-h-80 overflow-y-auto py-1">
                      <Receiver
                        key={`${result.id}:${code}`}
                        result={result}
                        authorize={(file) =>
                          api.download(result.id, file, code)
                        }
                      />
                    </div>
                  ) : (
                    <Empty className="min-h-28 flex-1 gap-2 rounded-lg border border-dashed bg-muted/20 p-4">
                      <EmptyHeader className="gap-1">
                        <InboxIcon className="mb-1 size-6 text-muted-foreground" />
                        <EmptyTitle className="text-sm">等待接收</EmptyTitle>
                        <EmptyDescription className="text-xs">
                          输入取件码后，文件或文字会显示在这里。
                        </EmptyDescription>
                      </EmptyHeader>
                    </Empty>
                  )}
                </section>
                <p className="flex items-center gap-2 text-xs text-muted-foreground">
                  <ShieldCheck className="size-3.5 shrink-0" />
                  点击预览后加载内容。取件码与投递同时到期。
                </p>
              </TabsContent>
            </Tabs>
          </CardContent>
          {tab === "mine" && (
            <CardFooter className="flex-col items-stretch gap-2">
              <Button
                variant="outline"
                size="lg"
                onClick={() =>
                  document.getElementById("delivery-records")?.scrollIntoView({
                    behavior: matchMedia("(prefers-reduced-motion: reduce)")
                      .matches
                      ? "instant"
                      : "smooth",
                  })
                }
              >
                查看全部投递
                <ArrowRight />
              </Button>
              <p className="flex items-center gap-2 text-xs text-muted-foreground">
                <ShieldCheck className="size-3.5" />
                仅展示当前账号的投递。
              </p>
            </CardFooter>
          )}
        </Card>
      </div>
      <Card id="delivery-records">
        <CardHeader>
          <CardTitle>投递记录</CardTitle>
          <CardDescription>查看有效期，继续分享或随时撤销。</CardDescription>
          <CardAction>
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button variant="outline" />}>
                {filter}
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuGroup>
                  {[
                    "全部投递",
                    "有效",
                    "已过期",
                    "已撤销",
                    "次数已用完",
                    "上传未完成",
                  ].map((v) => (
                    <DropdownMenuItem key={v} onClick={() => setFilter(v)}>
                      {v}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </CardAction>
        </CardHeader>
        <CardContent>
          {p.loading ? (
            <Skeleton className="h-40 w-full" />
          ) : !filtered.length ? (
            <Empty>
              <EmptyHeader>
                <FolderOpen className="size-6 text-muted-foreground" />
                <EmptyTitle>暂无投递记录</EmptyTitle>
                <EmptyDescription>
                  创建第一份投递后，可以在这里管理。
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <>
              <div className="tn-transfer-records-desktop">
                <Table className="table-fixed">
                  <colgroup>
                    <col className="w-[29%]" />
                    <col className="w-[19%]" />
                    <col className="w-[22%]" />
                    <col className="w-[14%]" />
                    <col className="w-[16%]" />
                  </colgroup>
                  <TableHeader>
                    <TableRow>
                      {[
                        "名称 / 类型",
                        "创建时间",
                        "有效期",
                        "状态",
                        "操作",
                      ].map((x) => (
                        <TableHead key={x} scope="col" className="text-center">
                          {x}
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map((t) => (
                      <TableRow key={t.id}>
                        <TableCell className="text-center">
                          <p
                            className="truncate text-sm font-medium"
                            title={t.title}
                          >
                            {t.title}
                          </p>
                          <p className="truncate text-muted-foreground">
                            {t.content_kind === "files"
                              ? `${t.file_count} 个文件`
                              : "文字与链接"}{" "}
                            · {bytes(t.size)}
                          </p>
                        </TableCell>
                        <TableCell className="whitespace-normal text-center text-muted-foreground">
                          {new Date(t.created_at).toLocaleString()}
                        </TableCell>
                        <TableCell className="whitespace-normal text-center text-muted-foreground">
                          {new Date(t.expires_at).toLocaleString()}
                        </TableCell>
                        <TableCell className="text-center">
                          <StatusTag item={t} now={p.now} />
                        </TableCell>
                        <TableCell className="text-center">
                          <div className="flex items-center justify-center gap-1">
                            <Button
                              variant="outline"
                              disabled={p.busy || !!opening}
                              onClick={() =>
                                void (transferStatus(t, p.now) === "有效"
                                  ? p.openShare(t)
                                  : show(t))
                              }
                            >
                              {transferStatus(t, p.now) === "有效"
                                ? "分享"
                                : "详情"}
                            </Button>
                            {actions(t)}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <div className="tn-transfer-records-mobile flex-col">
                {filtered.map((t) => (
                  <div
                    key={t.id}
                    className="flex items-center gap-3 border-b border-border py-4 last:border-0"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{t.title}</p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(t.expires_at).toLocaleString()} 到期
                      </p>
                      <StatusTag item={t} now={p.now} />
                    </div>
                    <Button
                      variant="outline"
                      disabled={p.busy || !!opening}
                      onClick={() =>
                        void (transferStatus(t, p.now) === "有效"
                          ? p.openShare(t)
                          : show(t))
                      }
                    >
                      {transferStatus(t, p.now) === "有效" ? "分享" : "详情"}
                    </Button>
                    {actions(t)}
                  </div>
                ))}
              </div>
            </>
          )}
          {p.nextOffset !== null && (
            <Button
              className="mt-4"
              variant="outline"
              disabled={p.loadingMore}
              onClick={() => void p.loadMore()}
            >
              {p.loadingMore ? "加载中…" : "查看更多"}
            </Button>
          )}
        </CardContent>
      </Card>
      <Modal
        open={panel === "settings"}
        onClose={() => {
          setPanel(null);
          void p.refresh();
        }}
        title="模块设置"
        description="存储方式、期限和容量由管理员配置。"
      >
        <SettingsPage />
      </Modal>
      <Modal
        open={panel === "more"}
        onClose={() => setPanel(null)}
        title="投递选项"
      >
        <Field>
          <FieldLabel htmlFor="download-limit">下载授权次数</FieldLabel>
          <Input
            id="download-limit"
            type="number"
            min={1}
            max={p.settings?.maxGrantsAllowed ?? 10000}
            disabled={p.mode === "text"}
            value={p.maxGrants}
            onChange={(e) => p.setMaxGrants(e.target.value)}
          />
          <FieldDescription>
            留空表示不限；按签发下载地址计数，预览也计入授权次数。
          </FieldDescription>
        </Field>
        <Field>
          <FieldLabel>链接提取码</FieldLabel>
          <Input readOnly value="系统自动生成 6 位数字" />
          <FieldDescription>
            独立八位取件码另行生成，需登录平台后使用。
          </FieldDescription>
        </Field>
        <Button size="lg" onClick={() => setPanel(null)}>
          完成
        </Button>
      </Modal>
      {preview && (
        <Modal open onClose={() => setPreview(null)} title="附件预览">
          <FilePreview entry={preview} />
        </Modal>
      )}
      {detail && (
        <Modal
          open
          onClose={() => {
            setDetail(null);
            void p.refresh();
          }}
          title="接收投递"
        >
          <Receiver
            key={detail.id}
            result={detail}
            authorize={(file) => api.download(detail.id, file)}
          />
        </Modal>
      )}
    </div>
  );
}
