import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Activity,
  AlertTriangle,
  Archive,
  ArrowLeft,
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  CircleDot,
  Clock3,
  Code2,
  Copy,
  Database,
  FileCode2,
  FileText,
  Folder,
  FolderOpen,
  History,
  Info,
  LayoutDashboard,
  ListChecks,
  MoreHorizontal,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  Server,
  Settings2,
  Square,
  Terminal,
  Trash2,
  Upload,
  Workflow,
  XCircle,
} from "lucide-react";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { ToolNestModuleRouteRenderProps } from "@toolnest/react-module-sdk";

import {
  cleanupProject,
  clearPersistentLogs,
  clearProjectData,
  createEnvironment,
  createExecution,
  createPersistentTask,
  createSchedule,
  deleteEnvironment,
  deleteExecution,
  deletePersistent,
  deleteSchedule,
  deleteUpload,
  getEnvironment,
  getExecution,
  getExecutionLogs,
  getInstallLog,
  getOverview,
  getPersistentEvents,
  getPersistentTask,
  getPersistentLogs,
  getProjectConfig,
  getProjectStorage,
  getSecurity,
  getSchedule,
  getTimeline,
  getUpload,
  installRequirements,
  listExecutions,
  listPersistentTasks,
  listSchedules,
  listUploads,
  previewFile,
  rebuildEnvironment,
  restartPersistent,
  rollbackUpload,
  rerunExecution,
  runProject,
  runSchedule,
  saveProjectConfig,
  scanInline,
  scanSecurity,
  startPersistent,
  stopExecution,
  stopPersistent,
  toggleSchedule,
  updatePersistentTask,
  updateSchedule,
  updateUpload,
  uploadProject,
  type CreateExecutionPayload,
  type ExecutionSource,
  type NotificationConfig,
  type PersistentTask,
  type PersistentTaskEvent,
  type ProjectConfig,
  type ProjectEnvironment,
  type ProjectFileNode,
  type ProjectCleanupTarget,
  type ProjectStorage,
  type ProjectUpdateResult,
  type ProjectUpload,
  type PythonExecution,
  type PythonOverview,
  type ScheduledTask,
  type SecurityScan,
  type TimelineEvent,
} from "./api";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  ButtonGroup,
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Checkbox,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  ConfirmDialog,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyMedia,
  Field as ShadcnField,
  FieldDescription as ShadcnFieldDescription,
  FieldGroup,
  FieldLabel as ShadcnFieldLabel,
  FieldLegend,
  FieldSet,
  Input,
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationNext,
  PaginationPrevious,
  Progress,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
  Spinner,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./components/ui";
import { PythonCodeEditor } from "./components/python-code-editor";
import { pythonRunnerRuntime as runtime } from "./runtime-context";

const moduleBase = "/modules/python-runner";
const navigation = [
  { label: "总览", path: "", icon: LayoutDashboard },
  { label: "快速运行", path: "run", icon: Play },
  { label: "项目仓库", path: "projects", icon: Archive },
  { label: "执行历史", path: "executions", icon: History },
  { label: "定时任务", path: "schedules", icon: CalendarClock },
  { label: "常驻任务", path: "persistent", icon: Server },
];

type StatusVariant = "default" | "secondary" | "outline" | "destructive";
const statusMeta: Record<string, { label: string; variant: StatusVariant }> = {
  success: { label: "成功", variant: "default" },
  skipped: { label: "已跳过", variant: "secondary" },
  ready: { label: "就绪", variant: "default" },
  installing: { label: "安装中", variant: "outline" },
  enabled: { label: "已启用", variant: "default" },
  running: { label: "运行中", variant: "default" },
  starting: { label: "启动中", variant: "outline" },
  stopping: { label: "停止中", variant: "outline" },
  restarting: { label: "重启中", variant: "outline" },
  pending: { label: "排队中", variant: "outline" },
  creating: { label: "创建中", variant: "outline" },
  upcoming: { label: "即将执行", variant: "outline" },
  disabled: { label: "已停用", variant: "secondary" },
  stopped: { label: "已停止", variant: "secondary" },
  finished: { label: "成功", variant: "default" },
  exited: { label: "已退出", variant: "secondary" },
  completed: { label: "已完成", variant: "secondary" },
  failed: { label: "失败", variant: "destructive" },
  timeout: { label: "超时", variant: "destructive" },
  blocked: { label: "已阻断", variant: "destructive" },
  high: { label: "高风险", variant: "destructive" },
  medium: { label: "中风险", variant: "outline" },
  low: { label: "低风险", variant: "default" },
  warning: { label: "受影响", variant: "outline" },
  missing: { label: "未创建", variant: "outline" },
  invalid: { label: "异常", variant: "destructive" },
  unknown: { label: "未知", variant: "secondary" },
};

function statusText(value: string) {
  return statusMeta[value]?.label ?? "未知";
}
function StatusBadge({ value }: { value: string }) {
  const meta = statusMeta[value] ?? {
    label: "未知",
    variant: "secondary" as const,
  };
  return (
    <Badge variant={meta.variant}>
      <span className="tn-python-module__status-dot" aria-hidden="true" />
      {meta.label}
    </Badge>
  );
}
function formatTime(value: string | null | undefined) {
  return value
    ? new Date(value).toLocaleString("zh-CN", { hour12: false })
    : "—";
}
function formatShortTime(value: string | null | undefined) {
  return value
    ? new Date(value).toLocaleString("zh-CN", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      })
    : "—";
}
function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}
function hasEnvironmentState(value: string | null | undefined) {
  return Boolean(value && !["missing", "not_created"].includes(value));
}
function environmentStatusText(value: ProjectEnvironment | null | undefined) {
  if (!value) return "尚未创建";
  return value.status === "ready"
    ? "项目虚拟环境已就绪"
    : statusText(value.status);
}
function uploadSourceText(value: string) {
  return (
    (
      {
        zip: "ZIP 项目包",
        folder: "本地文件夹",
      } as Record<string, string>
    )[value] ?? "项目包"
  );
}
function formatDuration(value: number | null | undefined) {
  if (value === null || value === undefined) return "—";
  if (value < 1000) return `${value} ms`;
  if (value < 60_000) return `${(value / 1000).toFixed(2)} s`;
  const minutes = Math.floor(value / 60_000);
  const seconds = Math.round((value % 60_000) / 1000);
  return `${minutes} min ${String(seconds).padStart(2, "0")} s`;
}
function cleanupTargetText(target: ProjectCleanupTarget) {
  return (
    {
      workspaces: "执行工作区",
      execution_snapshots: "执行快照",
      install_logs: "安装日志",
      project_data: "项目数据",
      venv: "虚拟环境",
      backups: "项目备份",
    } as Record<ProjectCleanupTarget, string>
  )[target];
}
function formatElapsed(value: number | null | undefined) {
  if (value === null || value === undefined) return "未运行";
  return formatDuration(value);
}
function textFromArgs(args: string[]) {
  return args.join("\n");
}
function argsFromText(value: string) {
  return value
    .trim()
    .split(/\s+/)
    .map((item) => item.trim())
    .filter(Boolean);
}
function triggerText(value: string | null | undefined) {
  const labels: Record<string, string> = {
    manual: "手动执行",
    once: "手动执行",
    scheduled: "定时触发",
    schedule: "定时触发",
    rerun: "重新运行",
    persistent: "常驻任务",
    persistent_start: "常驻启动",
    persistent_restart: "常驻重启",
    persistent_auto_start: "自动启动",
    persistent_auto_restart: "自动重启",
  };
  return labels[value ?? ""] ?? "手动执行";
}
function scheduleText(type: string, expression: string | null | undefined) {
  return type === "cron" ? expression || "Cron 计划" : "一次性任务";
}
function timelineTimeText(event: TimelineEvent, now: number) {
  if (event.status === "upcoming") {
    const diff = new Date(event.event_time).getTime() - now;
    if (diff <= 0) return "即将执行";
    const minute = 60_000;
    const hour = 60 * minute;
    const day = 24 * hour;
    if (diff < minute) return "不到 1 分钟后执行";
    if (diff < hour) return `${Math.floor(diff / minute)} 分钟后执行`;
    if (diff < day) {
      const hours = Math.floor(diff / hour);
      const minutes = Math.floor((diff % hour) / minute);
      return minutes
        ? `${hours} 小时 ${minutes} 分后执行`
        : `${hours} 小时后执行`;
    }
    return formatShortTime(event.event_time);
  }
  if (event.status === "running") return "运行中";
  return event.title;
}
function timelineMetaText(event: TimelineEvent, now: number) {
  if (event.status === "upcoming") {
    return event.schedule_text
      ? `Cron 计划 · ${event.schedule_text}`
      : "单次执行 · 一次性任务";
  }
  if (event.status === "running") {
    const elapsed = Math.max(0, now - new Date(event.event_time).getTime());
    return `${triggerText(event.trigger_type)} · 已运行 ${formatDuration(elapsed)}`;
  }
  if (event.status === "failed") {
    return `${triggerText(event.trigger_type)} · 失败 · 退出码 ${event.exit_code ?? "-"}`;
  }
  if (event.status === "stopped") {
    return `${triggerText(event.trigger_type)} · 已停止`;
  }
  return `${triggerText(event.trigger_type)} · 成功 · 用时 ${formatDuration(event.duration_ms)}`;
}
function timelineExtraText(event: TimelineEvent) {
  if (event.status === "upcoming")
    return `预计执行时间：${formatTime(event.event_time)}`;
  if (event.status === "failed" && event.error_summary)
    return `错误摘要：${event.error_summary}`;
  return `执行时间：${formatShortTime(event.event_time)}`;
}
function TimelineEventTitle({ event }: { event: TimelineEvent }) {
  if (event.execution_id) {
    return (
      <InternalLink
        href={`${moduleBase}/executions/${event.execution_id}`}
        className="tn-python-module__timeline-title"
      >
        {event.title}
      </InternalLink>
    );
  }
  if (event.schedule_id) {
    return (
      <InternalLink
        href={`${moduleBase}/schedules/${event.schedule_id}/edit`}
        className="tn-python-module__timeline-title"
      >
        {event.title}
      </InternalLink>
    );
  }
  return (
    <strong className="tn-python-module__timeline-title">
      {event.title}
    </strong>
  );
}
function runtimeEnvironmentText(value: string | null | undefined) {
  return (
    (
      {
        auto: "自动选择",
        project_venv: "项目虚拟环境",
        system: "系统 Python",
      } as Record<string, string>
    )[value ?? ""] ?? "自动选择"
  );
}
function securityIssueCount(scan: SecurityScan) {
  return Object.values(scan.summary).reduce(
    (total, count) => total + Number(count || 0),
    0,
  );
}
function securityModeText(scan: SecurityScan) {
  const runner =
    (
      {
        local_venv: "项目虚拟环境",
        system_python: "系统 Python",
      } as Record<string, string>
    )[scan.runner_mode] ?? scan.runner_mode;
  const mode =
    ({ guarded: "受控模式" } as Record<string, string>)[scan.security_mode] ??
    scan.security_mode;
  return `${runner} · ${mode}`;
}
function restartPolicyText(value: string | null | undefined) {
  return (
    (
      {
        never: "从不自动重启",
        on_failure: "异常退出时重启",
        always: "进程退出后始终重启",
      } as Record<string, string>
    )[value ?? ""] ?? "从不自动重启"
  );
}
function notificationTriggersText(
  config: NotificationConfig | null | undefined,
) {
  if (!config) return "—";
  const labels: string[] = [];
  if (config.notify_on_failure) labels.push("失败");
  if (config.notify_on_success) labels.push("成功");
  if (config.notify_on_recovered) labels.push("恢复成功");
  return labels.length ? labels.join("、") : "未启用";
}
function notificationChannelsText(
  config: NotificationConfig | null | undefined,
) {
  if (!config) return "—";
  if (config.channels !== "custom") return "平台默认";
  const labels: Record<string, string> = {
    web_internal: "站内通知",
    qqbot: "QQBot",
    email: "Email",
    webhook: "Webhook",
  };
  return config.custom_channels.length
    ? config.custom_channels.map((item) => labels[item] ?? item).join("、")
    : "未选择";
}
function notificationOutputText(config: NotificationConfig | null | undefined) {
  if (!config?.notify_on_success || !config.forward_output_on_success)
    return "未转发";
  const labels: Record<string, string> = {
    summary: "摘要",
    stdout: "标准输出",
    stderr: "错误输出",
    both: "标准输出和错误输出",
  };
  return labels[config.output_mode] ?? config.output_mode;
}
function eventTypeText(value: string | null | undefined) {
  return (
    (
      {
        created: "已创建",
        started: "已启动",
        stopped: "已停止",
        failed: "执行失败",
        exited: "已退出",
        updated: "已更新",
        restarted: "已重启",
      } as Record<string, string>
    )[value ?? ""] ?? "生命周期事件"
  );
}
function sourceProjectId(source: ExecutionSource | undefined) {
  if (!source || source.type !== "archive") return "";
  return source.project_id ?? source.upload_id ?? "";
}
function projectEntryFiles(project: ProjectUpload | undefined) {
  if (!project) return [];
  return project.entry_candidates.length
    ? project.entry_candidates
    : project.python_files;
}
function findProjectFile(nodes: ProjectFileNode[], filename: string): string {
  for (const node of nodes) {
    if (
      node.type === "file" &&
      (node.path === filename ||
        node.name === filename ||
        node.path.endsWith(`/${filename}`))
    ) {
      return node.path;
    }
    if (node.children) {
      const match = findProjectFile(node.children, filename);
      if (match) return match;
    }
  }
  return "";
}
type ConfigField = {
  path: string;
  kind: "string" | "number" | "boolean" | "json";
  sensitive: boolean;
};
function cloneConfigValues(value: Record<string, unknown> | undefined) {
  return JSON.parse(JSON.stringify(value ?? {})) as Record<string, unknown>;
}
function configPathParts(path: string) {
  return path.replace(/\]/g, "").replace(/\[/g, ".").split(".").filter(Boolean);
}
function readConfigPath(value: unknown, path: string): unknown {
  let current = value;
  for (const part of configPathParts(path)) {
    if (Array.isArray(current) && /^\d+$/.test(part)) {
      current = current[Number(part)];
    } else if (current && typeof current === "object") {
      current = (current as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  return current;
}
function writeConfigPath(
  value: Record<string, unknown>,
  path: string,
  nextValue: unknown,
) {
  const parts = configPathParts(path);
  if (!parts.length) return;
  let current: unknown = value;
  for (let index = 0; index < parts.length - 1; index += 1) {
    const part = parts[index];
    const nextPart = parts[index + 1];
    if (part === undefined || nextPart === undefined) return;
    if (Array.isArray(current) && /^\d+$/.test(part)) {
      const position = Number(part);
      if (!current[position] || typeof current[position] !== "object") {
        current[position] = /^\d+$/.test(nextPart) ? [] : {};
      }
      current = current[position];
    } else if (current && typeof current === "object") {
      const record = current as Record<string, unknown>;
      if (!record[part] || typeof record[part] !== "object") {
        record[part] = /^\d+$/.test(nextPart) ? [] : {};
      }
      current = record[part];
    } else {
      return;
    }
  }
  const last = parts[parts.length - 1];
  if (last === undefined) return;
  if (Array.isArray(current) && /^\d+$/.test(last)) {
    current[Number(last)] = nextValue;
  } else if (current && typeof current === "object") {
    (current as Record<string, unknown>)[last] = nextValue;
  }
}
function flattenConfigFields(
  value: unknown,
  prefix: string,
  sensitivePaths: string[],
): ConfigField[] {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const entries = Object.entries(value);
    if (!entries.length && prefix) {
      return [{ path: prefix, kind: "json", sensitive: false }];
    }
    return entries.flatMap(([key, nested]) => {
      const path = prefix ? `${prefix}.${key}` : key;
      if (nested && typeof nested === "object") {
        return flattenConfigFields(nested, path, sensitivePaths);
      }
      if (typeof nested === "boolean") {
        return [
          {
            path,
            kind: "boolean" as const,
            sensitive: sensitivePaths.includes(path),
          },
        ];
      }
      if (typeof nested === "number") {
        return [
          {
            path,
            kind: "number" as const,
            sensitive: sensitivePaths.includes(path),
          },
        ];
      }
      if (typeof nested === "string") {
        return [
          {
            path,
            kind: "string" as const,
            sensitive: sensitivePaths.includes(path),
          },
        ];
      }
      return [
        {
          path,
          kind: "json" as const,
          sensitive: sensitivePaths.includes(path),
        },
      ];
    });
  }
  return prefix ? [{ path: prefix, kind: "json", sensitive: false }] : [];
}
async function copyText(value: string, message = "内容已复制。") {
  if (!value) return;
  try {
    await navigator.clipboard?.writeText(value);
    runtime?.notify({ type: "success", content: message });
  } catch (error) {
    runtime?.notify({ type: "error", content: errorMessage(error) });
  }
}
function errorMessage(error: unknown) {
  if (error && typeof error === "object") {
    const data = (error as { response?: { data?: { message?: unknown } } })
      .response?.data;
    if (typeof data?.message === "string" && data.message.trim())
      return data.message;
  }
  return error instanceof Error ? error.message : "请稍后重试。";
}
function extractSecurity(error: unknown): SecurityScan | null {
  if (!error || typeof error !== "object") return null;
  return (
    (error as { response?: { data?: { data?: { security?: SecurityScan } } } })
      .response?.data?.data?.security ?? null
  );
}
function extractProjectImpact(error: unknown): ProjectUpdateResult | null {
  if (!error || typeof error !== "object") return null;
  return (
    (
      error as {
        response?: { data?: { data?: { impact?: ProjectUpdateResult } } };
      }
    ).response?.data?.data?.impact ?? null
  );
}

function InternalLink({
  href,
  children,
  className,
}: {
  href: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <a
      className={
        className
          ? `${className} tn-python-module__link`
          : "tn-python-module__link"
      }
      href={href}
      onClick={(event) => {
        if (!runtime) return;
        event.preventDefault();
        void runtime.router.push(href);
      }}
    >
      {children}
    </a>
  );
}

function ActionLinkButton({
  href,
  children,
  variant = "outline",
  size = "sm",
}: {
  href: string;
  children: ReactNode;
  variant?: React.ComponentProps<typeof Button>["variant"];
  size?: React.ComponentProps<typeof Button>["size"];
}) {
  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      onClick={() => {
        if (runtime) void runtime.router.push(href);
      }}
    >
      {children}
    </Button>
  );
}

function BusyButton({
  children,
  pending = false,
  ...props
}: React.ComponentProps<typeof Button> & { pending?: boolean }) {
  return (
    <Button
      {...props}
      disabled={pending || props.disabled}
      aria-busy={pending || undefined}
    >
      {pending ? (
        <>
          <Spinner data-icon="inline-start" aria-hidden="true" />
          处理中…
        </>
      ) : (
        children
      )}
    </Button>
  );
}

function TableActionMenu({
  items,
  onClick,
}: {
  items: Array<{
    key: string;
    label: string;
    destructive?: boolean;
    disabled?: boolean;
  }>;
  onClick: (key: string) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="ghost" size="icon" aria-label="更多操作" />}
      >
        <MoreHorizontal aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {items.map((item) => (
          <DropdownMenuItem
            key={item.key}
            variant={item.destructive ? "destructive" : "default"}
            disabled={item.disabled}
            onClick={() => onClick(item.key)}
          >
            {item.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Field({
  label,
  children,
  help,
  tooltip,
  htmlFor,
}: {
  label: string;
  children: ReactNode;
  help?: string | undefined;
  tooltip?: string | undefined;
  htmlFor?: string | undefined;
}) {
  return (
    <ShadcnField className="tn-python-module__field">
      <div className="tn-python-module__field-label">
        <ShadcnFieldLabel htmlFor={htmlFor}>{label}</ShadcnFieldLabel>
        {tooltip ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`${label}说明`}
                />
              }
            >
              <Info aria-hidden="true" />
            </TooltipTrigger>
            <TooltipContent side="top" align="start">
              {tooltip}
            </TooltipContent>
          </Tooltip>
        ) : null}
      </div>
      {children}
      {help ? (
        <ShadcnFieldDescription className="tn-python-module__field-help">
          {help}
        </ShadcnFieldDescription>
      ) : null}
    </ShadcnField>
  );
}

function SelectField({
  label,
  value,
  onValueChange,
  options,
  placeholder = "请选择",
  disabled = false,
  help,
}: {
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  options: Array<{ label: string; value: string }>;
  placeholder?: string;
  disabled?: boolean;
  help?: string;
}) {
  return (
    <Field label={label} help={help}>
      <Select
        value={value}
        onValueChange={(next) => {
          if (next !== null) onValueChange(next);
        }}
        disabled={disabled}
      >
        <SelectTrigger className="w-full" aria-label={label}>
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectLabel>{label}</SelectLabel>
            {options.map((option) => (
              <SelectItem value={option.value} key={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </Field>
  );
}

function MultiSelectField({
  label,
  value,
  onValueChange,
  options,
  placeholder = "请选择",
  disabled = false,
  help,
}: {
  label: string;
  value: string[];
  onValueChange: (value: string[]) => void;
  options: Array<{ label: string; value: string }>;
  placeholder?: string;
  disabled?: boolean;
  help?: string;
}) {
  return (
    <Field label={label} tooltip={help}>
      <Select
        multiple
        items={options}
        value={value}
        onValueChange={(next) => onValueChange(next)}
        disabled={disabled}
      >
        <SelectTrigger className="w-full" aria-label={label}>
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectLabel>{label}</SelectLabel>
            {options.map((option) => (
              <SelectItem value={option.value} key={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </Field>
  );
}

function CheckboxField({
  checked,
  onCheckedChange,
  children,
}: {
  checked: boolean;
  onCheckedChange: (value: boolean) => void;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <ShadcnField
      orientation="horizontal"
      className="tn-python-module__checkbox-row"
    >
      <Checkbox
        id={id}
        checked={checked}
        onCheckedChange={(value) => onCheckedChange(Boolean(value))}
      />
      <ShadcnFieldLabel htmlFor={id}>{children}</ShadcnFieldLabel>
    </ShadcnField>
  );
}
function SwitchField({
  checked,
  onCheckedChange,
  children,
}: {
  checked: boolean;
  onCheckedChange: (value: boolean) => void;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <ShadcnField
      orientation="horizontal"
      className="tn-python-module__checkbox-row tn-python-module__switch-row"
    >
      <ShadcnFieldLabel htmlFor={id}>{children}</ShadcnFieldLabel>
      <Switch
        id={id}
        checked={checked}
        onCheckedChange={(value) => onCheckedChange(Boolean(value))}
      />
    </ShadcnField>
  );
}

function LoadingState({ text = "正在加载…" }: { text?: string }) {
  return (
    <div className="tn-python-module__loading" role="status">
      <Spinner aria-label={text} />
      <span>{text}</span>
    </div>
  );
}
function EmptyState({
  text,
  action,
  className,
}: {
  text: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <Empty
      className={
        className
          ? `tn-python-module__empty ${className}`
          : "tn-python-module__empty"
      }
    >
      <EmptyMedia variant="icon">
        <CircleDot aria-hidden="true" />
      </EmptyMedia>
      <EmptyDescription>{text}</EmptyDescription>
      {action ? <EmptyContent>{action}</EmptyContent> : null}
    </Empty>
  );
}
function ErrorState({
  error,
  title = "加载失败",
  onRetry,
}: {
  error: unknown;
  title?: string | undefined;
  onRetry?: (() => void) | undefined;
}) {
  return (
    <Alert variant="destructive">
      <AlertTriangle aria-hidden="true" />
      <div>
        <AlertTitle>{title}</AlertTitle>
        <AlertDescription>{errorMessage(error)}</AlertDescription>
        {onRetry ? (
          <BusyButton variant="outline" size="sm" onClick={onRetry}>
            重试
          </BusyButton>
        ) : null}
      </div>
    </Alert>
  );
}
function PageError({
  error,
  title,
  onRetry,
}: {
  error: unknown;
  title?: string | undefined;
  onRetry?: (() => void) | undefined;
}) {
  return (
    <div className="tn-python-module__error">
      <ErrorState error={error} title={title} onRetry={onRetry} />
    </div>
  );
}

function PaginationControls({
  page,
  pageCount,
  summary,
  onPageChange,
}: {
  page: number;
  pageCount: number;
  summary: ReactNode;
  onPageChange: (page: number) => void;
}) {
  if (pageCount <= 1) return null;
  const canGoPrevious = page > 1;
  const canGoNext = page < pageCount;
  return (
    <div className="tn-python-module__pagination">
      <span className="tn-python-module__muted">{summary}</span>
      <Pagination className="mx-0 w-auto justify-end">
        <PaginationContent>
          <PaginationItem>
            <PaginationPrevious
              aria-disabled={!canGoPrevious}
              tabIndex={!canGoPrevious ? -1 : undefined}
              className={
                !canGoPrevious ? "pointer-events-none opacity-50" : undefined
              }
              onClick={(event) => {
                event.preventDefault();
                if (canGoPrevious) onPageChange(page - 1);
              }}
            />
          </PaginationItem>
          <PaginationItem>
            <PaginationNext
              aria-disabled={!canGoNext}
              tabIndex={!canGoNext ? -1 : undefined}
              className={
                !canGoNext ? "pointer-events-none opacity-50" : undefined
              }
              onClick={(event) => {
                event.preventDefault();
                if (canGoNext) onPageChange(page + 1);
              }}
            />
          </PaginationItem>
        </PaginationContent>
      </Pagination>
    </div>
  );
}

function ModuleShell({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  const pathname =
    typeof window === "undefined" ? moduleBase : window.location.pathname;
  const activePath = pathname
    .replace(`${moduleBase}/`, "")
    .replace(moduleBase, "")
    .split("/")[0];
  const activeTab = activePath === "services" ? "persistent" : activePath;
  return (
    <TooltipProvider>
      <main className="tn-python-module">
        <div className="tn-python-module__nav">
          <div className="tn-python-module__brand">
            <span className="tn-python-module__brand-mark">
              <Code2 aria-hidden="true" />
            </span>
            <div className="tn-python-module__brand-copy">
              <strong className="tn-python-module__brand-title">
                Python 工具
              </strong>
              <span className="tn-python-module__brand-description">
                项目、执行与任务运行中心
              </span>
            </div>
          </div>
          <nav
            className="tn-python-module__navigation"
            aria-label="Python 工具导航"
          >
            <Tabs
              value={activeTab}
              onValueChange={(value) => {
                if (value === null) return;
                const target = navigation.find((item) => item.path === value);
                if (!target || !runtime) return;
                void runtime.router.push(
                  `${moduleBase}${target.path ? `/${target.path}` : ""}`,
                );
              }}
              className="max-w-full min-w-0"
            >
              <TabsList className="w-full max-w-full overflow-x-auto overflow-y-hidden sm:w-fit">
                {navigation.map((item) => {
                  const Icon = item.icon;
                  return (
                    <TabsTrigger key={item.path} value={item.path}>
                      <Icon aria-hidden="true" />
                      {item.label}
                    </TabsTrigger>
                  );
                })}
              </TabsList>
            </Tabs>
          </nav>
        </div>
        <div className="tn-python-module__page">
          {children}
        </div>
      </main>
    </TooltipProvider>
  );
}

function StatCard({
  label,
  value,
  meta,
  icon: Icon,
  tooltip,
  onClick,
  tone = "normal",
}: {
  label: string;
  value: ReactNode;
  meta: string;
  icon: typeof Activity;
  tooltip: string;
  onClick?: () => void;
  tone?: "normal" | "danger";
}) {
  return (
    <Card
      className={`tn-python-module__stat${tone === "danger" ? " is-danger" : ""}`}
      onClick={onClick}
    >
      <CardContent>
        <div className="tn-python-module__stat-top">
          <span>{label}</span>
          <Tooltip>
            <TooltipTrigger
              render={
                <span
                  className="tn-python-module__stat-icon"
                  aria-label={`${label}说明`}
                >
                  <Icon aria-hidden="true" />
                </span>
              }
            />
            <TooltipContent>{tooltip}</TooltipContent>
          </Tooltip>
        </div>
        <div className="tn-python-module__stat-value">{value}</div>
        <div className="tn-python-module__stat-meta">{meta}</div>
      </CardContent>
    </Card>
  );
}

function TimelineCard({
  events,
  loading,
  onRefresh,
}: {
  events: TimelineEvent[];
  loading: boolean;
  onRefresh: () => void;
}) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>执行时间轴</CardTitle>
          <CardDescription>按时间查看最近的运行和调度事件。</CardDescription>
        </div>
        <CardAction>
          <BusyButton
            variant="outline"
            size="sm"
            pending={loading}
            onClick={onRefresh}
          >
            <RefreshCw aria-hidden="true" />
            刷新
          </BusyButton>
        </CardAction>
      </CardHeader>
      <CardContent>
        {events.length ? (
          <div className="tn-python-module__timeline">
            {events.slice(0, 8).map((event) => (
              <div
                className={`tn-python-module__timeline-item tn-python-module__timeline-item--${event.status}`}
                key={event.id}
              >
                <span
                  className="tn-python-module__timeline-dot"
                  aria-hidden="true"
                />
                <div className="tn-python-module__timeline-copy">
                  <div className="tn-python-module__timeline-row">
                    {event.status === "upcoming" || event.status === "running" ? (
                      <span className="tn-python-module__timeline-time-label">
                        {timelineTimeText(event, now)}
                      </span>
                    ) : (
                      <TimelineEventTitle event={event} />
                    )}
                    <StatusBadge
                      value={
                        event.status === "upcoming" ? "upcoming" : event.status
                      }
                    />
                  </div>
                  {event.status === "upcoming" || event.status === "running" ? (
                    <TimelineEventTitle event={event} />
                  ) : null}
                  <span className="tn-python-module__timeline-meta">
                    {timelineMetaText(event, now)}
                  </span>
                  <span className="tn-python-module__timeline-extra">
                    {timelineExtraText(event)}
                  </span>
                </div>
                <time className="tn-python-module__timeline-time">
                  {formatShortTime(event.event_time)}
                </time>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            className="tn-python-module__empty--overview"
            text="暂无时间轴事件。"
          />
        )}
      </CardContent>
      <CardFooter>
        <ActionLinkButton href={`${moduleBase}/executions`}>
          查看全部执行记录 <ArrowRight aria-hidden="true" />
        </ActionLinkButton>
      </CardFooter>
    </Card>
  );
}

function OverviewProjects({ projects }: { projects: ProjectUpload[] }) {
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>项目仓库</CardTitle>
          <CardDescription>最近更新的 Python 项目。</CardDescription>
        </div>
        <CardAction>
          <ActionLinkButton href={`${moduleBase}/projects`}>管理项目</ActionLinkButton>
        </CardAction>
      </CardHeader>
      <CardContent>
        {projects.length ? (
          <div className="tn-python-module__list">
            {projects.slice(0, 5).map((project) => (
              <div className="tn-python-module__list-item" key={project.id}>
                <div className="tn-python-module__list-main">
                  <InternalLink
                    href={`${moduleBase}/projects/${project.id}`}
                    className="tn-python-module__list-title"
                  >
                    {project.name}
                  </InternalLink>
                  <span className="tn-python-module__muted">
                    {project.file_count} 个文件 ·{" "}
                    {formatBytes(project.total_size)} · 入口{" "}
                    {projectEntryFiles(project)[0] ?? "未识别"}
                  </span>
                </div>
                <time className="tn-python-module__muted">
                  {formatShortTime(project.updated_at)}
                </time>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            className="tn-python-module__empty--overview"
            text="暂无已上传项目。"
            action={
              <ActionLinkButton href={`${moduleBase}/projects`}>
                去上传项目 <ArrowRight aria-hidden="true" />
              </ActionLinkButton>
            }
          />
        )}
      </CardContent>
    </Card>
  );
}

function RecentExecutions({ items }: { items: PythonExecution[] }) {
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>最近执行</CardTitle>
          <CardDescription>最近 10 条执行结果和输出状态。</CardDescription>
        </div>
        <CardAction>
          <ActionLinkButton href={`${moduleBase}/executions`}>
            查看全部
          </ActionLinkButton>
        </CardAction>
      </CardHeader>
      <CardContent>
        {items.length ? (
          <div className="tn-python-module__list">
            {items.slice(0, 6).map((item) => (
              <div className="tn-python-module__list-item" key={item.id}>
                <div className="tn-python-module__list-main">
                  <InternalLink
                    href={`${moduleBase}/executions/${item.id}`}
                    className="tn-python-module__list-title"
                  >
                    {item.name}
                  </InternalLink>
                  <span className="tn-python-module__muted">
                    {item.source_type === "archive" ? "项目运行" : "内联脚本"} ·{" "}
                    {item.entry_file || "自动入口"} ·{" "}
                    {formatShortTime(item.created_at)}
                  </span>
                </div>
                <div className="tn-python-module__actions">
                  <StatusBadge value={item.status} />
                  <span className="tn-python-module__muted">
                    {formatDuration(item.duration_ms)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            text="还没有执行记录。"
            action={
              <ActionLinkButton href={`${moduleBase}/run`}>
                开始快速运行 <ArrowRight aria-hidden="true" />
              </ActionLinkButton>
            }
          />
        )}
      </CardContent>
    </Card>
  );
}

type UpcomingSchedule = PythonOverview["upcoming_schedules"][number];

function UpcomingSchedulesCard({ items }: { items: UpcomingSchedule[] }) {
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>即将执行</CardTitle>
          <CardDescription>按下一次执行时间排列的启用计划。</CardDescription>
        </div>
        <CardAction>
          <ActionLinkButton href={`${moduleBase}/schedules`}>管理计划</ActionLinkButton>
        </CardAction>
      </CardHeader>
      <CardContent>
        {items.length ? (
          <div className="tn-python-module__list">
            {items.map((item) => (
              <div className="tn-python-module__list-item" key={item.id}>
                <div className="tn-python-module__list-main">
                  <InternalLink
                    href={`${moduleBase}/schedules/${item.id}/edit`}
                    className="tn-python-module__list-title"
                  >
                    {item.name}
                  </InternalLink>
                  <span className="tn-python-module__muted">
                    {scheduleText(item.schedule_type, item.cron_expression)}
                    {item.description ? ` · ${item.description}` : ""}
                  </span>
                </div>
                <time className="tn-python-module__muted">
                  {formatShortTime(item.next_run_at)}
                </time>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            className="tn-python-module__empty--overview"
            text="暂无即将执行的计划。"
            action={
              <ActionLinkButton href={`${moduleBase}/schedules/create`}>
                创建定时任务 <ArrowRight aria-hidden="true" />
              </ActionLinkButton>
            }
          />
        )}
      </CardContent>
    </Card>
  );
}

type OverviewLog = PythonOverview["recent_logs"][number];

function RecentLogsCard({
  recent,
  errors,
}: {
  recent: OverviewLog[];
  errors: OverviewLog[];
}) {
  const [tab, setTab] = useState<"recent" | "errors">("recent");
  const items = tab === "errors" ? errors : recent;
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>执行日志</CardTitle>
          <CardDescription>
            从执行记录中提取的最新输出和错误信息。
          </CardDescription>
        </div>
        <Tabs
          value={tab}
          onValueChange={(value) =>
            setTab(value === "errors" ? "errors" : "recent")
          }
        >
          <TabsList aria-label="日志类型">
            <TabsTrigger value="recent">最近输出</TabsTrigger>
            <TabsTrigger value="errors">错误日志</TabsTrigger>
          </TabsList>
        </Tabs>
      </CardHeader>
      <CardContent>
        {items.length ? (
          <div className="tn-python-module__log-list">
            {items.slice(0, 10).map((item, index) => (
              <div
                className="tn-python-module__log-item"
                key={`${item.execution_id}-${item.type}-${item.timestamp}-${index}`}
              >
                <div className="tn-python-module__log-item-head">
                  <Badge
                    variant={
                      item.type === "stderr" ? "destructive" : "secondary"
                    }
                  >
                    {item.type === "stderr" ? "错误输出" : "标准输出"}
                  </Badge>
                  <InternalLink
                    href={`${moduleBase}/executions/${item.execution_id}`}
                  >
                    {item.execution_name}
                  </InternalLink>
                  <time className="tn-python-module__muted">
                    {formatShortTime(item.timestamp)}
                  </time>
                </div>
                <pre className="tn-python-module__log tn-python-module__log--small">
                  {item.content}
                </pre>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            text={tab === "errors" ? "暂无错误日志。" : "暂无输出日志。"}
          />
        )}
      </CardContent>
    </Card>
  );
}

function OverviewPage() {
  const overview = useQuery({
    queryKey: ["python-runner", "overview"],
    queryFn: getOverview,
    refetchInterval: (query) => query.state.data?.recent_executions.some((item) => item.status === "running") ? 5_000 : 60_000,
    refetchIntervalInBackground: false,
  });
  const timeline = useQuery({
    queryKey: ["python-runner", "timeline"],
    queryFn: () => getTimeline(30),
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  });
  const projects = useQuery({
    queryKey: ["python-runner", "uploads"],
    queryFn: listUploads,
    staleTime: 10_000,
  });
  if (overview.isPending)
    return (
      <ModuleShell
        title="Python 工具"
        description="管理本地 Python 项目、执行和任务。"
      >
        <LoadingState text="正在读取运行概览…" />
      </ModuleShell>
    );
  if (overview.isError)
    return (
      <ModuleShell
        title="Python 工具"
        description="管理本地 Python 项目、执行和任务。"
      >
        <PageError
          error={overview.error}
          onRetry={() => void overview.refetch()}
        />
      </ModuleShell>
    );
  const {
    stats,
    recent_executions: recent,
    upcoming_schedules: upcoming,
    recent_logs: recentLogs,
    error_logs: errorLogs,
  } = overview.data;
  return (
    <ModuleShell
      title="Python 工具"
      description="集中管理项目源码、即时执行、定时任务和常驻进程。"
    >
      <div className="tn-python-module__grid">
        <StatCard
          label="定时任务"
          value={stats.enabled_schedule_count}
          meta={
            stats.next_schedule_time
              ? `下次 ${formatShortTime(stats.next_schedule_time)}`
              : "暂无计划"
          }
          icon={CalendarClock}
          tooltip="当前已启用的 Cron 或一次性任务数量。"
          onClick={() => runtime?.router.push(`${moduleBase}/schedules`)}
        />
        <StatCard
          label="常驻任务"
          value={stats.running_persistent_count}
          meta={
            stats.failed_persistent_count
              ? `异常 ${stats.failed_persistent_count} 个`
              : "运行正常"
          }
          icon={Server}
          tooltip="当前正在运行的常驻 Python 进程数量。"
          onClick={() => runtime?.router.push(`${moduleBase}/persistent`)}
          tone={stats.failed_persistent_count ? "danger" : "normal"}
        />
        <StatCard
          label="今日执行"
          value={stats.today_total}
          meta={`成功率 ${stats.success_rate}%`}
          icon={Activity}
          tooltip="从今天零点开始统计的 Python 执行次数。"
          onClick={() => runtime?.router.push(`${moduleBase}/executions`)}
        />
        <StatCard
          label="今日失败"
          value={stats.today_failed}
          meta={stats.today_failed ? "需要关注" : "暂无异常"}
          icon={AlertTriangle}
          tooltip="今天失败、超时或手动停止的执行次数。"
          onClick={() =>
            runtime?.router.push(`${moduleBase}/executions?status=failed`)
          }
          tone={stats.today_failed ? "danger" : "normal"}
        />
      </div>
      <div className="tn-python-module__overview-layout">
        <div className="tn-python-module__overview-column">
          <TimelineCard
            events={timeline.data?.items ?? []}
            loading={timeline.isFetching}
            onRefresh={() => void timeline.refetch()}
          />
        </div>
        <div className="tn-python-module__overview-column">
          <OverviewProjects projects={projects.data ?? []} />
          <UpcomingSchedulesCard items={upcoming} />
        </div>
      </div>
      <RecentExecutions items={recent} />
      <RecentLogsCard recent={recentLogs} errors={errorLogs} />
    </ModuleShell>
  );
}

function SecurityConfirmation({
  scan,
  checked,
  onChange,
}: {
  scan: SecurityScan | null;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  if (!scan) return null;
  if (scan.risk_level === "blocked") {
    return (
      <Alert variant="destructive" className="tn-python-module__security">
        <AlertTriangle aria-hidden="true" />
        <div>
          <AlertTitle>项目已被安全策略阻断</AlertTitle>
          <AlertDescription>
            {scan.message || "当前扫描结果不允许继续执行。"}
          </AlertDescription>
        </div>
      </Alert>
    );
  }
  if (!["medium", "high"].includes(scan.risk_level)) return null;
  return (
    <Alert variant="warning" className="tn-python-module__security">
      <AlertTriangle aria-hidden="true" />
      <div>
        <AlertTitle>检测到需要确认的风险</AlertTitle>
        <AlertDescription>{scan.message}</AlertDescription>
        <CheckboxField checked={checked} onCheckedChange={onChange}>
          我已确认当前扫描结果和代码来源可信
        </CheckboxField>
      </div>
    </Alert>
  );
}

function RunPage({
  initialProjectId,
  initialEntryFile,
}: {
  initialProjectId?: string | undefined;
  initialEntryFile?: string | undefined;
}) {
  const projects = useQuery({
    queryKey: ["python-runner", "uploads"],
    queryFn: listUploads,
    staleTime: 10_000,
  });
  const [mode, setMode] = useState<"inline" | "project">(
    initialProjectId ? "project" : "inline",
  );
  const [name, setName] = useState("测试脚本");
  const [code, setCode] = useState("print('Hello ToolNest')\n");
  const [projectId, setProjectId] = useState(initialProjectId ?? "");
  const [entryFile, setEntryFile] = useState(initialEntryFile ?? "");
  const [args, setArgs] = useState("");
  const [timeout, setTimeoutValue] = useState(30);
  const [environment, setEnvironment] =
    useState<CreateExecutionPayload["runtime_environment"]>("auto");
  const [activeExecutionId, setActiveExecutionId] = useState<string | null>(
    null,
  );
  const [scan, setScan] = useState<SecurityScan | null>(null);
  const [riskConfirmed, setRiskConfirmed] = useState(false);
  const [logTab, setLogTab] = useState<"merged" | "stdout" | "stderr">(
    "merged",
  );
  const [logsCleared, setLogsCleared] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const logConsoleRef = useRef<HTMLPreElement>(null);
  const [historyDeleteTarget, setHistoryDeleteTarget] =
    useState<PythonExecution | null>(null);
  const history = useQuery({
    queryKey: ["python-runner", "run-history"],
    queryFn: listExecutions,
    refetchInterval: (query) => query.state.data?.some((item) => item.status === "running") ? 5_000 : false,
  });
  const inlineScan = useMutation({
    mutationFn: () => scanInline(code),
    onSuccess: (next) => {
      setScan(next);
      setRiskConfirmed(false);
    },
  });
  const projectSecurity = useQuery({
    queryKey: ["python-runner", "security", projectId],
    queryFn: () => getSecurity(projectId),
    enabled: mode === "project" && Boolean(projectId),
  });
  const run = useMutation({
    mutationFn: () => {
      const payload = {
        name: name.trim() || "未命名脚本",
        args: argsFromText(args),
        timeout_seconds: timeout,
        runtime_environment: environment,
      };
      return mode === "inline"
        ? createExecution({
            ...payload,
            source: { type: "inline", code },
            ...(riskConfirmed && scan
              ? { security: { risk_confirmed: true, scan_id: scan.scan_id } }
              : {}),
          })
        : runProject(projectId, entryFile, environment, {
            ...payload,
            ...(riskConfirmed && scan
              ? { security: { risk_confirmed: true, scan_id: scan.scan_id } }
              : {}),
          });
    },
    onSuccess: (result) => {
      setActiveExecutionId(result.id);
      void history.refetch();
      runtime?.notify({
        type: "success",
        content: `执行已创建：${statusText(result.status)}`,
      });
    },
    onError: (error) => {
      const next = extractSecurity(error);
      if (next) {
        setScan(next);
        setRiskConfirmed(false);
      }
    },
  });
  const historyRerun = useMutation({
    mutationFn: (item: PythonExecution) => rerunExecution(item.id),
    onSuccess: (result) => {
      setActiveExecutionId(result.id);
      void history.refetch();
      runtime?.notify({ type: "success", content: "已创建重新运行任务。" });
    },
  });
  const historyDelete = useMutation({
    mutationFn: (item: PythonExecution) => deleteExecution(item.id),
    onSuccess: (_result, item) => {
      if (activeExecutionId === item.id) setActiveExecutionId(null);
      setHistoryDeleteTarget(null);
      void history.refetch();
      runtime?.notify({ type: "success", content: "执行记录已删除。" });
    },
  });
  const execution = useQuery({
    queryKey: ["python-runner", "run-execution", activeExecutionId],
    queryFn: () => getExecution(activeExecutionId ?? ""),
    enabled: Boolean(activeExecutionId),
    refetchInterval: (query) =>
      query.state.data?.status === "running" ? 2_000 : false,
  });
  const logs = useQuery({
    queryKey: ["python-runner", "run-logs", activeExecutionId],
    queryFn: () => getExecutionLogs(activeExecutionId ?? "", undefined, 500),
    enabled: Boolean(activeExecutionId),
    refetchInterval: execution.data?.status === "running" ? 2_000 : false,
  });
  const stop = useMutation({
    mutationFn: () => stopExecution(activeExecutionId ?? ""),
    onSuccess: () => {
      runtime?.notify({ type: "success", content: "执行已停止。" });
      void execution.refetch();
      void logs.refetch();
      void history.refetch();
    },
  });
  const project = projects.data?.find((item) => item.id === projectId);
  const activeScan = mode === "project" ? (projectSecurity.data ?? null) : scan;
  const currentExecution =
    execution.data ??
    (activeExecutionId && activeExecutionId === run.data?.id
      ? run.data
      : undefined);
  const selectHistory = (item: PythonExecution) => {
    setActiveExecutionId(item.id);
    setName(item.name);
    setArgs(item.args.join("\n"));
    setTimeoutValue(item.timeout_seconds);
    setRiskConfirmed(false);
    if (item.source_type === "inline") {
      setMode("inline");
      setCode(item.code_snapshot ?? "");
      setProjectId("");
      setEntryFile("");
      return;
    }
    const source = item.source_config ?? {};
    setMode("project");
    setProjectId(String(source.project_id ?? source.upload_id ?? ""));
    setEntryFile(
      item.entry_file ||
        (typeof source.entry_file === "string" ? source.entry_file : ""),
    );
  };
  const allLogs = logsCleared
    ? []
    : (logs.data ?? []).filter(
        (item) => item.type === "stdout" || item.type === "stderr",
      );
  const visibleLogs = allLogs.filter(
    (item) => logTab === "merged" || item.type === logTab,
  );
  const fallbackLogs = currentExecution
    ? [
        ...(currentExecution.stdout
          ? [{ type: "stdout", content: currentExecution.stdout }]
          : []),
        ...(currentExecution.stderr
          ? [{ type: "stderr", content: currentExecution.stderr }]
          : []),
      ]
    : [];
  const renderedLogs = visibleLogs.length ? visibleLogs : fallbackLogs;
  useEffect(() => {
    if (!autoScroll || !logConsoleRef.current) return;
    logConsoleRef.current.scrollTop = logConsoleRef.current.scrollHeight;
  }, [autoScroll, currentExecution?.id, logs.data, logsCleared, logTab]);
  return (
    <ModuleShell
      title="快速运行"
      description="运行内联 Python 代码，或从已导入项目选择入口执行。"
    >
      <Card>
        <CardHeader>
          <div>
            <CardTitle>创建一次性执行</CardTitle>
            <CardDescription>
              执行前可扫描代码；高风险代码必须显式确认后才会提交。
            </CardDescription>
          </div>
          <CardAction>
            <ActionLinkButton href={`${moduleBase}/executions`}>
              <History aria-hidden="true" />
              执行历史
            </ActionLinkButton>
          </CardAction>
        </CardHeader>
        <CardContent className="tn-python-module__form">
          <Tabs
            value={mode}
            onValueChange={(value) => setMode(value as "inline" | "project")}
          >
            <TabsList>
              <TabsTrigger value="inline">内联脚本</TabsTrigger>
              <TabsTrigger value="project">项目入口</TabsTrigger>
            </TabsList>
          </Tabs>
          <Field label="任务名称">
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="例如：每日数据同步"
            />
          </Field>
          {mode === "inline" ? (
            <Field label="Python 代码" help="建议先扫描代码，再开始执行。">
              <PythonCodeEditor
                value={code}
                onChange={(value) => {
                  setCode(value);
                  setScan(null);
                }}
              />
            </Field>
          ) : (
            <FieldGroup className="tn-python-module__form-grid">
              <SelectField
                label="项目"
                value={projectId}
                onValueChange={(value) => {
                  setProjectId(value);
                  setEntryFile("");
                }}
                options={(projects.data ?? []).map((item) => ({
                  value: item.id,
                  label: item.name,
                }))}
                placeholder={
                  projects.isPending ? "正在加载项目…" : "选择已导入项目"
                }
                disabled={projects.isPending}
              />
              <SelectField
                label="入口文件"
                value={entryFile}
                onValueChange={setEntryFile}
                options={projectEntryFiles(project).map((item) => ({
                  value: item,
                  label: item,
                }))}
                placeholder="自动选择入口"
                disabled={!projectId}
              />
            </FieldGroup>
          )}
          <div className="tn-python-module__run-grid">
            <div className="tn-python-module__form">
              <Field
                label="命令行参数"
                help="每行一个参数，控制字符和过长参数会被后端拒绝。"
              >
                <Textarea
                  className="tn-python-module__code--compact"
                  value={args}
                  onChange={(event) => setArgs(event.target.value)}
                  placeholder="--date\n2026-08-31"
                />
              </Field>
              <div className="tn-python-module__actions">
                {mode === "inline" ? (
                  <BusyButton
                    variant="outline"
                    pending={inlineScan.isPending}
                    onClick={() => inlineScan.mutate()}
                  >
                    <CheckCircle2 data-icon="inline-start" aria-hidden="true" />
                    扫描代码
                  </BusyButton>
                ) : null}
                <BusyButton
                  pending={run.isPending}
                  disabled={
                    (mode === "inline" ? !code.trim() : !projectId) ||
                    activeScan?.risk_level === "blocked"
                  }
                  onClick={() => run.mutate()}
                >
                  <Play aria-hidden="true" />
                  运行脚本
                </BusyButton>
                {currentExecution ? (
                  <ActionLinkButton
                    href={`${moduleBase}/executions/${currentExecution.id}`}
                  >
                    查看执行详情 <ArrowRight aria-hidden="true" />
                  </ActionLinkButton>
                ) : null}
              </div>
              {run.isError ? (
                <ErrorState error={run.error} title="脚本运行失败" />
              ) : null}
            </div>
            <div className="tn-python-module__run-sidebar">
              <SelectField
                label="运行环境"
                value={environment}
                onValueChange={(value) =>
                  setEnvironment(
                    value as CreateExecutionPayload["runtime_environment"],
                  )
                }
                options={[
                  { value: "auto", label: "自动选择" },
                  { value: "project_venv", label: "项目虚拟环境" },
                  { value: "system", label: "系统 Python" },
                ]}
                help="auto 会优先使用项目虚拟环境。"
              />
              <Field label="超时时间（秒）">
                <Input
                  type="number"
                  min={1}
                  max={600}
                  value={timeout}
                  onChange={(event) =>
                    setTimeoutValue(
                      Math.min(
                        600,
                        Math.max(1, Number(event.target.value) || 1),
                      ),
                    )
                  }
                />
              </Field>
              {activeScan ? (
                <SecurityConfirmation
                  scan={activeScan}
                  checked={riskConfirmed}
                  onChange={setRiskConfirmed}
                />
              ) : null}
            </div>
          </div>
        </CardContent>
      </Card>
      {currentExecution ? (
        <Card>
          <CardHeader>
            <div>
              <CardTitle>实时日志</CardTitle>
              <CardDescription>
                {currentExecution.name} ·{" "}
                {currentExecution.status === "running"
                  ? "执行中，每 2 秒刷新"
                  : `执行${statusText(currentExecution.status)}`}
              </CardDescription>
            </div>
            <CardAction>
              <div className="tn-python-module__actions">
                <Badge
                  variant={
                    currentExecution.status === "running"
                      ? "default"
                      : "secondary"
                  }
                >
                  {currentExecution.status === "running"
                    ? "轮询中"
                    : "离线快照"}
                </Badge>
                {currentExecution.status === "running" ? (
                  <BusyButton
                    variant="outline"
                    size="sm"
                    pending={stop.isPending}
                    onClick={() => stop.mutate()}
                  >
                    <Square aria-hidden="true" />
                    停止
                  </BusyButton>
                ) : null}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setAutoScroll((value) => !value)}
                >
                  {autoScroll ? (
                    <Pause aria-hidden="true" />
                  ) : (
                    <Play aria-hidden="true" />
                  )}
                  {autoScroll ? "暂停滚动" : "继续滚动"}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setLogsCleared(false);
                    void logs.refetch();
                    void execution.refetch();
                  }}
                >
                  <RefreshCw aria-hidden="true" />
                  刷新
                </Button>
              </div>
            </CardAction>
          </CardHeader>
          <CardContent className="tn-python-module__form">
            <Tabs
              value={logTab}
              onValueChange={(value) =>
                setLogTab(value as "merged" | "stdout" | "stderr")
              }
            >
              <TabsList>
                <TabsTrigger value="merged">合并</TabsTrigger>
                <TabsTrigger value="stdout">标准输出</TabsTrigger>
                <TabsTrigger value="stderr">错误输出</TabsTrigger>
              </TabsList>
            </Tabs>
            <pre ref={logConsoleRef} className="tn-python-module__log">
              {renderedLogs.length
                ? renderedLogs
                    .filter(
                      (item) => logTab === "merged" || item.type === logTab,
                    )
                    .map((item) => `[${item.type}] ${item.content}`)
                    .join("\n")
                : "暂无日志。"}
            </pre>
            <div className="tn-python-module__actions">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  const content = renderedLogs
                    .filter(
                      (item) => logTab === "merged" || item.type === logTab,
                    )
                    .map((item) => `[${item.type}] ${item.content}`)
                    .join("\n");
                  void navigator.clipboard?.writeText(content);
                }}
              >
                复制日志
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setLogsCleared(true)}
              >
                清空显示
              </Button>
              {currentExecution ? (
                <ActionLinkButton
                  href={`${moduleBase}/executions/${currentExecution.id}`}
                >
                  查看完整详情 <ArrowRight aria-hidden="true" />
                </ActionLinkButton>
              ) : null}
            </div>
            {logs.isError ? (
              <ErrorState error={logs.error} title="日志读取失败" />
            ) : null}
          </CardContent>
        </Card>
      ) : null}
      <RunHistoryCard
        items={history.data ?? []}
        loading={history.isFetching}
        onRefresh={() => void history.refetch()}
        onSelect={selectHistory}
        onRerun={(item) => historyRerun.mutate(item)}
        onCopy={(item) =>
          void copyText(item.code_snapshot ?? "", "代码已复制。")
        }
        onDelete={setHistoryDeleteTarget}
      />
      <ConfirmDialog
        open={Boolean(historyDeleteTarget)}
        onOpenChange={(open) => {
          if (!open && !historyDelete.isPending) setHistoryDeleteTarget(null);
        }}
        title="删除执行记录"
        description={
          historyDeleteTarget ? `确定删除“${historyDeleteTarget.name}”吗？` : ""
        }
        confirmLabel="删除记录"
        destructive
        pending={historyDelete.isPending}
        onConfirm={() => {
          if (historyDeleteTarget) historyDelete.mutate(historyDeleteTarget);
        }}
      />
    </ModuleShell>
  );
}

async function archiveFolder(
  files: FileList | File[],
  onProgress?: (value: number) => void,
) {
  const entries: Record<string, Uint8Array> = {};
  const sourceFiles = Array.from(files);
  for (const [index, file] of sourceFiles.entries()) {
    entries[file.webkitRelativePath || file.name] = new Uint8Array(
      await file.arrayBuffer(),
    );
    if (sourceFiles.length) {
      onProgress?.(Math.round(((index + 1) / sourceFiles.length) * 80));
    }
  }
  const { zipSync } = await import("fflate");
  const archive = zipSync(entries);
  onProgress?.(100);
  const firstPath =
    sourceFiles[0]?.webkitRelativePath ||
    sourceFiles[0]?.name ||
    "project-folder";
  const rootName =
    (firstPath.split(/[\\/]/)[0] ?? "project-folder")
      .replace(/[^\p{L}\p{N}._-]+/gu, "-")
      .replace(/^[-.]+|[-.]+$/g, "") || "project-folder";
  return new File([archive], `${rootName}.zip`, { type: "application/zip" });
}

interface DroppedFileEntry {
  name: string;
  isFile: boolean;
  isDirectory: boolean;
}
interface DroppedFileEntryFile extends DroppedFileEntry {
  isFile: true;
  file: (
    onSuccess: (file: File) => void,
    onError?: (error: DOMException) => void,
  ) => void;
}
interface DroppedFileEntryDirectory extends DroppedFileEntry {
  isDirectory: true;
  createReader: () => {
    readEntries: (
      onSuccess: (entries: DroppedFileEntry[]) => void,
      onError?: (error: DOMException) => void,
    ) => void;
  };
}

function withRelativePath(file: File, relativePath: string) {
  Object.defineProperty(file, "webkitRelativePath", {
    configurable: true,
    value: relativePath,
  });
  return file;
}

function readDroppedFile(entry: DroppedFileEntryFile) {
  return new Promise<File>((resolve, reject) => entry.file(resolve, reject));
}

async function readDroppedDirectory(entry: DroppedFileEntryDirectory) {
  const reader = entry.createReader();
  const entries: DroppedFileEntry[] = [];
  while (true) {
    const batch = await new Promise<DroppedFileEntry[]>((resolve, reject) =>
      reader.readEntries(resolve, reject),
    );
    if (!batch.length) break;
    entries.push(...batch);
  }
  return entries;
}

async function readDroppedEntry(
  entry: DroppedFileEntry,
  parentPath: string,
): Promise<File[]> {
  const relativePath = parentPath ? `${parentPath}/${entry.name}` : entry.name;
  if (entry.isFile)
    return [
      withRelativePath(
        await readDroppedFile(entry as DroppedFileEntryFile),
        relativePath,
      ),
    ];
  if (!entry.isDirectory) return [];
  const children = await readDroppedDirectory(
    entry as DroppedFileEntryDirectory,
  );
  return (
    await Promise.all(
      children.map((child) => readDroppedEntry(child, relativePath)),
    )
  ).flat();
}

async function getDroppedProjectFiles(dataTransfer: DataTransfer | null) {
  if (!dataTransfer) return [];
  const entries = Array.from(dataTransfer.items ?? [])
    .map(
      (item) =>
        (
          item as unknown as {
            webkitGetAsEntry?: () => DroppedFileEntry | null;
          }
        ).webkitGetAsEntry?.() ?? null,
    )
    .filter((entry): entry is DroppedFileEntry => Boolean(entry));
  if (!entries.length) return Array.from(dataTransfer.files ?? []);
  return (
    await Promise.all(entries.map((entry) => readDroppedEntry(entry, "")))
  ).flat();
}

function ProjectsPage() {
  const query = useQuery({
    queryKey: ["python-runner", "uploads"],
    queryFn: listUploads,
    staleTime: 60_000,
  });
  const zipInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [projectPage, setProjectPage] = useState(1);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [preparingUpload, setPreparingUpload] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [updateTarget, setUpdateTarget] = useState<ProjectUpload | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ProjectUpload | null>(null);
  const upload = useMutation({
    mutationFn: ({
      file,
      source,
    }: {
      file: File;
      source: "zip" | "folder";
    }) => {
      setUploadProgress(0);
      return uploadProject(file, name.trim(), source, (value) =>
        setUploadProgress(
          source === "folder" ? 40 + Math.round(value * 0.6) : value,
        ),
      );
    },
    onSuccess: () => {
      setName("");
      setUploadOpen(false);
      void query.refetch();
      runtime?.notify({ type: "success", content: "项目导入完成。" });
    },
  });
  const remove = useMutation({
    mutationFn: deleteUpload,
    onSuccess: () => {
      setDeleteTarget(null);
      void query.refetch();
      runtime?.notify({ type: "success", content: "项目已删除。" });
    },
  });
  const uploadBusy = upload.isPending || preparingUpload;
  const projectPageSize = 6;
  const projectPageCount = Math.max(
    1,
    Math.ceil((query.data?.length ?? 0) / projectPageSize),
  );
  const visibleProjects = (query.data ?? []).slice(
    (projectPage - 1) * projectPageSize,
    projectPage * projectPageSize,
  );
  useEffect(() => {
    setProjectPage((current) => Math.min(current, projectPageCount));
  }, [projectPageCount]);
  const pickZip = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) upload.mutate({ file, source: "zip" });
  };
  const pickFolder = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    event.target.value = "";
    if (!files?.length) return;
    setPreparingUpload(true);
    setUploadProgress(0);
    try {
      const file = await archiveFolder(files, (value) =>
        setUploadProgress(Math.round(value * 0.4)),
      );
      setPreparingUpload(false);
      upload.mutate({ file, source: "folder" });
    } catch (error) {
      setPreparingUpload(false);
      runtime?.notify({ type: "error", content: errorMessage(error) });
    }
  };
  const handleProjectDrop = async (event: React.DragEvent<HTMLDivElement>) => {
    if (uploadBusy) return;
    const files = await getDroppedProjectFiles(event.dataTransfer);
    if (!files.length) return;
    try {
      const zipFile = files.find((file) =>
        file.name.toLowerCase().endsWith(".zip"),
      );
      if (zipFile && files.length === 1) {
        upload.mutate({ file: zipFile, source: "zip" });
        return;
      }
      setPreparingUpload(true);
      setUploadProgress(0);
      const file = await archiveFolder(files, (value) =>
        setUploadProgress(Math.round(value * 0.4)),
      );
      setPreparingUpload(false);
      upload.mutate({
        file,
        source: "folder",
      });
    } catch (error) {
      setPreparingUpload(false);
      runtime?.notify({ type: "error", content: errorMessage(error) });
    }
  };
  const openUpdate = (project: ProjectUpload) => {
    setUpdateTarget(project);
  };
  const requestedUpdateId =
    typeof window === "undefined"
      ? ""
      : (new URLSearchParams(window.location.search).get("update") ?? "");
  const openedUpdateId = useRef("");
  useEffect(() => {
    if (!requestedUpdateId || openedUpdateId.current === requestedUpdateId)
      return;
    const project = query.data?.find((item) => item.id === requestedUpdateId);
    if (!project) return;
    openedUpdateId.current = requestedUpdateId;
    openUpdate(project);
  }, [query.data, requestedUpdateId]);
  if (query.isPending)
    return (
      <ModuleShell
        title="项目仓库"
        description="管理 Python 项目源码、入口和依赖环境。"
      >
        <LoadingState text="正在读取项目仓库…" />
      </ModuleShell>
    );
  if (query.isError)
    return (
      <ModuleShell
        title="项目仓库"
        description="管理 Python 项目源码、入口和依赖环境。"
      >
        <PageError error={query.error} onRetry={() => void query.refetch()} />
      </ModuleShell>
    );
  return (
    <ModuleShell
      title="项目仓库"
      description="管理 Python 项目源码、入口和依赖环境。"
    >
      <Card>
        <CardHeader>
          <div>
            <CardTitle>项目列表</CardTitle>
            <CardDescription>
              支持 ZIP
              项目包和本地文件夹，上传后可统一查看、运行、配置依赖和创建任务。
            </CardDescription>
          </div>
          <CardAction>
            <Dialog open={uploadOpen} onOpenChange={setUploadOpen}>
              <DialogTrigger
                render={
                  <Button>
                    <Upload aria-hidden="true" />
                    上传项目
                  </Button>
                }
              />
              <DialogContent className="tn-python-module__dialog tn-python-module__dialog--upload">
                <DialogHeader>
                  <DialogTitle>上传 Python 项目</DialogTitle>
                  <DialogDescription>
                    支持 ZIP 项目包、文件夹和拖放导入。上传后会自动识别入口文件与依赖声明。
                  </DialogDescription>
                </DialogHeader>
                <div className="tn-python-module__form">
                  <Field label="项目名称" help="可选；留空时使用压缩包或文件夹名称。">
                    <Input
                      aria-label="项目名称"
                      placeholder="项目名称（可选）"
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                    />
                  </Field>
                  <input
                    ref={zipInput}
                    hidden
                    type="file"
                    accept=".zip,application/zip"
                    onChange={pickZip}
                  />
                  <input
                    ref={folderInput}
                    hidden
                    type="file"
                    {...({ webkitdirectory: "", directory: "" } as Record<
                      string,
                      string
                    >)}
                    onChange={(event) => void pickFolder(event)}
                  />
                  {upload.isError ? (
                    <ErrorState error={upload.error} title="项目导入失败" />
                  ) : null}
                  <div
                    className="tn-python-module__drop-zone"
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={(event) => {
                      event.preventDefault();
                      void handleProjectDrop(event);
                    }}
                  >
                    <span className="tn-python-module__drop-zone-icon">
                      <Archive aria-hidden="true" />
                    </span>
                    <strong>导入一个 Python 项目</strong>
                    <span className="tn-python-module__muted">
                      选择 ZIP 或文件夹，系统会自动识别入口文件和 requirements.txt。
                    </span>
                    <div className="tn-python-module__actions">
                      <BusyButton
                        variant="outline"
                        size="sm"
                        pending={uploadBusy}
                        onClick={() => zipInput.current?.click()}
                      >
                        <Upload aria-hidden="true" />
                        选择 ZIP
                      </BusyButton>
                      <BusyButton
                        variant="outline"
                        size="sm"
                        pending={uploadBusy}
                        onClick={() => folderInput.current?.click()}
                      >
                        <FolderOpen aria-hidden="true" />
                        选择文件夹
                      </BusyButton>
                    </div>
                    {uploadBusy ? <Progress value={uploadProgress} /> : null}
                  </div>
                </div>
                <DialogFooter>
                  <DialogClose render={<Button variant="outline" />}>
                    取消
                  </DialogClose>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </CardAction>
        </CardHeader>
        <CardContent className="tn-python-module__form">
          {query.data.length ? (
            <div className="tn-python-module__project-list">
              {visibleProjects.map((project) => (
                <Card
                  className="tn-python-module__project-card"
                  key={project.id}
                >
                  <CardContent className="tn-python-module__project-card-content">
                    <div className="tn-python-module__project-card-main">
                      <InternalLink
                        href={`${moduleBase}/projects/${project.id}`}
                        className="tn-python-module__project-card-title"
                      >
                        {project.name}
                      </InternalLink>
                      <div className="tn-python-module__project-card-meta">
                        <span>
                          <StatusBadge value={project.status} />
                        </span>
                        <span>{project.file_count} 个文件</span>
                        <span>{formatBytes(project.total_size)}</span>
                        <span>
                          入口 {projectEntryFiles(project)[0] ?? "未识别"}
                        </span>
                        <span>
                          更新于 {formatShortTime(project.updated_at)}
                        </span>
                      </div>
                      <span className="tn-python-module__muted">
                        {project.dependency_files.length
                          ? `依赖：${project.dependency_files.join("、")}`
                          : "未发现 requirements.txt"}
                      </span>
                    </div>
                    <div className="tn-python-module__project-card-actions">
                      <BusyButton
                        size="sm"
                        onClick={() =>
                          runtime?.router.push(
                            `${moduleBase}/run?project=${encodeURIComponent(project.id)}`,
                          )
                        }
                      >
                        <Play data-icon="inline-start" aria-hidden="true" />
                        运行
                      </BusyButton>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          runtime?.router.push(
                            `${moduleBase}/projects/${project.id}`,
                          )
                        }
                      >
                        查看详情
                      </Button>
                      <TableActionMenu
                        items={[
                          { key: "schedule", label: "创建定时任务" },
                          { key: "persistent", label: "创建常驻任务" },
                          {
                            key: "update",
                            label: "更新项目",
                          },
                          {
                            key: "delete",
                            label: "删除项目",
                            destructive: true,
                          },
                        ]}
                        onClick={(key) => {
                          const entry = projectEntryFiles(project)[0] ?? "";
                          const query = entry
                            ? `&entry_file=${encodeURIComponent(entry)}`
                            : "";
                          if (key === "schedule")
                            runtime?.router.push(
                              `${moduleBase}/schedules/create?upload_id=${encodeURIComponent(project.id)}${query}`,
                            );
                          if (key === "persistent")
                            runtime?.router.push(
                              `${moduleBase}/services/create?upload_id=${encodeURIComponent(project.id)}${query}`,
                            );
                          if (key === "update") openUpdate(project);
                          if (key === "delete") setDeleteTarget(project);
                        }}
                      />
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <EmptyState text="还没有项目，可从上方导入 ZIP 或文件夹。" />
          )}
          <PaginationControls
            page={projectPage}
            pageCount={projectPageCount}
            summary={
              <>
                共 {query.data.length} 个项目 · 第 {projectPage} 页
              </>
            }
            onPageChange={setProjectPage}
          />
        </CardContent>
      </Card>
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title="删除项目"
        description={
          deleteTarget
            ? `确定删除“${deleteTarget.name}”吗？项目源码、虚拟环境和运行数据都会被移除。`
            : ""
        }
        confirmLabel="删除项目"
        destructive
        pending={remove.isPending}
        onConfirm={() => {
          if (deleteTarget) remove.mutate(deleteTarget.id);
        }}
      />
      <ProjectUpdateDialog
        project={updateTarget}
        open={Boolean(updateTarget)}
        onOpenChange={(open) => {
          if (!open) setUpdateTarget(null);
        }}
        onUpdated={() => void query.refetch()}
      />
    </ModuleShell>
  );
}

function ProjectUpdateDialog({
  project,
  open,
  onOpenChange,
  onUpdated,
}: {
  project: ProjectUpload | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdated?: () => void;
}) {
  const updateInput = useRef<HTMLInputElement>(null);
  const updateFolderInput = useRef<HTMLInputElement>(null);
  const [updateProgress, setUpdateProgress] = useState(0);
  const [preparingUpdate, setPreparingUpdate] = useState(false);
  const [pendingImpact, setPendingImpact] = useState<{
    project: ProjectUpload;
    file: File;
    uploadSource: "zip" | "folder";
    impact: ProjectUpdateResult;
  } | null>(null);
  const update = useMutation({
    mutationFn: ({
      project: target,
      file,
      confirmScheduleImpact = false,
      uploadSource = "zip",
    }: {
      project: ProjectUpload;
      file: File;
      confirmScheduleImpact?: boolean;
      uploadSource?: "zip" | "folder";
    }) =>
      updateUpload(
        target.id,
        file,
        target.name,
        confirmScheduleImpact,
        uploadSource,
        (value) =>
          setUpdateProgress(
            uploadSource === "folder" ? 40 + Math.round(value * 0.6) : value,
          ),
      ),
    onSuccess: () => {
      setPendingImpact(null);
      onOpenChange(false);
      onUpdated?.();
      runtime?.notify({ type: "success", content: "项目新版本已上传。" });
    },
    onError: (error, variables) => {
      const impact = extractProjectImpact(error);
      if (impact)
        setPendingImpact({
          project: variables.project,
          file: variables.file,
          uploadSource: variables.uploadSource ?? "zip",
          impact,
        });
    },
  });
  const updateBusy = update.isPending || preparingUpdate;
  useEffect(() => {
    if (!open) return;
    setPendingImpact(null);
    setUpdateProgress(0);
    setPreparingUpdate(false);
  }, [open, project?.id]);
  const pickUpdate = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file && project)
      update.mutate({ project, file, uploadSource: "zip" });
  };
  const pickUpdateFolder = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const files = event.target.files;
    event.target.value = "";
    if (!files?.length || !project) return;
    setPreparingUpdate(true);
    setUpdateProgress(0);
    try {
      const file = await archiveFolder(files, (value) =>
        setUpdateProgress(Math.round(value * 0.4)),
      );
      setPreparingUpdate(false);
      update.mutate({ project, file, uploadSource: "folder" });
    } catch (error) {
      setPreparingUpdate(false);
      runtime?.notify({ type: "error", content: errorMessage(error) });
    }
  };
  const handleUpdateDrop = async (event: React.DragEvent<HTMLDivElement>) => {
    if (updateBusy || !project) return;
    const files = await getDroppedProjectFiles(event.dataTransfer);
    if (!files.length) return;
    try {
      const zipFile = files.find((file) =>
        file.name.toLowerCase().endsWith(".zip"),
      );
      if (zipFile && files.length === 1) {
        update.mutate({ project, file: zipFile, uploadSource: "zip" });
        return;
      }
      setPreparingUpdate(true);
      setUpdateProgress(0);
      const file = await archiveFolder(files, (value) =>
        setUpdateProgress(Math.round(value * 0.4)),
      );
      setPreparingUpdate(false);
      update.mutate({ project, file, uploadSource: "folder" });
    } catch (error) {
      setPreparingUpdate(false);
      runtime?.notify({ type: "error", content: errorMessage(error) });
    }
  };
  return (
    <>
      <input
        ref={updateInput}
        hidden
        type="file"
        accept=".zip,application/zip"
        onChange={pickUpdate}
      />
      <input
        ref={updateFolderInput}
        hidden
        type="file"
        {...({ webkitdirectory: "", directory: "" } as Record<
          string,
          string
        >)}
        onChange={(event) => void pickUpdateFolder(event)}
      />
      <Dialog
        open={open}
        onOpenChange={(nextOpen) => {
          if (nextOpen || !updateBusy) {
            if (!nextOpen) setPendingImpact(null);
            onOpenChange(nextOpen);
          }
        }}
      >
        <DialogContent className="tn-python-module__dialog tn-python-module__dialog--update max-h-[min(90dvh,42rem)] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>更新项目</DialogTitle>
            <DialogDescription>
              {project
                ? `为“${project.name}”上传新的 ZIP 项目包，或拖入本地文件夹。更新前会保留当前版本备份。`
                : "选择新的项目源码。"}
            </DialogDescription>
          </DialogHeader>
          {project ? (
            <>
              <div className="tn-python-module__detail-list">
                <div className="tn-python-module__detail-row">
                  <span>当前入口</span>
                  <strong>{projectEntryFiles(project)[0] ?? "未识别"}</strong>
                </div>
                <div className="tn-python-module__detail-row">
                  <span>当前依赖</span>
                  <strong>
                    {project.dependency_files.length
                      ? project.dependency_files.join("、")
                      : "未发现 requirements.txt"}
                  </strong>
                </div>
              </div>
              {pendingImpact ? (
                <Alert variant="warning">
                  <AlertTriangle aria-hidden="true" />
                  <div>
                    <AlertTitle>项目更新会影响现有任务</AlertTitle>
                    <AlertDescription>
                      {pendingImpact.impact.impacted_tasks.length
                        ? `将刷新 ${pendingImpact.impact.impacted_tasks.length} 个定时或常驻任务的源码引用。`
                        : "检测到任务引用了本项目。"}
                      {pendingImpact.impact.missing_entry_tasks.length
                        ? `其中 ${pendingImpact.impact.missing_entry_tasks.length} 个任务的入口文件需要重新确认。`
                        : ""}
                    </AlertDescription>
                    <ul className="tn-python-module__finding-list">
                      {pendingImpact.impact.impacted_tasks
                        .slice(0, 8)
                        .map((task, index) => (
                          <li
                            className="tn-python-module__finding"
                            key={`${String(task.id ?? "task")}-${index}`}
                          >
                            <StatusBadge value="warning" />
                            <span>
                              {String(task.name ?? "关联任务")}
                              {task.entry_file
                                ? ` · ${String(task.entry_file)}`
                                : ""}
                            </span>
                          </li>
                        ))}
                    </ul>
                    <div className="tn-python-module__actions">
                      <BusyButton
                        pending={updateBusy}
                        onClick={() =>
                          update.mutate({
                            project: pendingImpact.project,
                            file: pendingImpact.file,
                            confirmScheduleImpact: true,
                            uploadSource: pendingImpact.uploadSource,
                          })
                        }
                      >
                        确认继续更新
                      </BusyButton>
                      <Button
                        variant="outline"
                        disabled={updateBusy}
                        onClick={() => setPendingImpact(null)}
                      >
                        取消
                      </Button>
                    </div>
                  </div>
                </Alert>
              ) : null}
              {update.isError && !pendingImpact ? (
                <ErrorState error={update.error} title="项目更新失败" />
              ) : null}
              <div
                className="tn-python-module__drop-zone"
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  void handleUpdateDrop(event);
                }}
              >
                <span className="tn-python-module__drop-zone-icon">
                  <Upload aria-hidden="true" />
                </span>
                <strong>拖入新的项目源码</strong>
                <span className="tn-python-module__muted">
                  支持 ZIP 或文件夹；也可以使用下方按钮选择。
                </span>
                <div className="tn-python-module__actions">
                  <Button
                    variant="outline"
                    disabled={updateBusy}
                    onClick={() => updateInput.current?.click()}
                  >
                    选择 ZIP
                  </Button>
                  <Button
                    variant="outline"
                    disabled={updateBusy}
                    onClick={() => updateFolderInput.current?.click()}
                  >
                    选择文件夹
                  </Button>
                </div>
                {updateBusy ? <Progress value={updateProgress} /> : null}
              </div>
            </>
          ) : null}
          <DialogFooter>
            <Button
              variant="outline"
              disabled={updateBusy}
              onClick={() => {
                setPendingImpact(null);
                onOpenChange(false);
              }}
            >
              关闭
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ProjectRunCompatPage({
  uploadId,
  entryFile,
}: {
  uploadId?: string | undefined;
  entryFile?: string | undefined;
}) {
  return uploadId ? (
    <ProjectDetailPage projectId={uploadId} initialEntryFile={entryFile} />
  ) : (
    <ProjectsPage />
  );
}

function RunHistoryCard({
  items,
  loading,
  onRefresh,
  onSelect,
  onRerun,
  onCopy,
  onDelete,
}: {
  items: PythonExecution[];
  loading: boolean;
  onRefresh: () => void;
  onSelect: (item: PythonExecution) => void;
  onRerun: (item: PythonExecution) => void;
  onCopy: (item: PythonExecution) => void;
  onDelete: (item: PythonExecution) => void;
}) {
  const pageSize = 8;
  const [page, setPage] = useState(1);
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const visibleItems = items.slice((page - 1) * pageSize, page * pageSize);
  useEffect(() => {
    setPage((current) => Math.min(current, pageCount));
  }, [pageCount]);
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>执行历史</CardTitle>
          <CardDescription>
            选择历史记录可以继续编辑或重新运行。
          </CardDescription>
        </div>
        <CardAction>
          <BusyButton
            variant="outline"
            size="sm"
            pending={loading}
            onClick={onRefresh}
          >
            <RefreshCw aria-hidden="true" />
            刷新
          </BusyButton>
        </CardAction>
      </CardHeader>
      <CardContent>
        {items.length ? (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead style={{ width: "28%" }}>任务</TableHead>
                  <TableHead style={{ width: "16%" }}>触发方式</TableHead>
                  <TableHead style={{ width: "14%" }}>执行结果</TableHead>
                  <TableHead style={{ width: "20%" }}>开始时间</TableHead>
                  <TableHead style={{ width: "10%" }}>耗时</TableHead>
                  <TableHead
                    className="tn-python-module__right"
                    style={{ width: "12%" }}
                  >
                    操作
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleItems.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>
                      <Button
                        variant="link"
                        size="sm"
                        className="tn-python-module__table-primary"
                        onClick={() => onSelect(item)}
                      >
                        {item.name}
                      </Button>
                      <div className="tn-python-module__table-subtitle">
                        {item.source_type === "archive"
                          ? "项目运行"
                          : "内联脚本"}
                      </div>
                    </TableCell>
                    <TableCell>{triggerText(item.trigger_type)}</TableCell>
                    <TableCell>
                      <StatusBadge value={item.status} />
                    </TableCell>
                    <TableCell className="tn-python-module__nowrap">
                      {formatShortTime(item.started_at ?? item.created_at)}
                    </TableCell>
                    <TableCell>{formatDuration(item.duration_ms)}</TableCell>
                    <TableCell>
                      <div className="tn-python-module__table-actions">
                        <Button
                          variant="link"
                          size="sm"
                          onClick={() => onSelect(item)}
                        >
                          载入
                        </Button>
                        <TableActionMenu
                          items={[
                            { key: "rerun", label: "重新运行" },
                            {
                              key: "copy",
                              label: "复制代码",
                              disabled: !item.code_snapshot,
                            },
                            {
                              key: "delete",
                              label: "删除记录",
                              destructive: true,
                            },
                          ]}
                          onClick={(key) => {
                            if (key === "rerun") onRerun(item);
                            if (key === "copy") onCopy(item);
                            if (key === "delete") onDelete(item);
                          }}
                        />
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <PaginationControls
              page={page}
              pageCount={pageCount}
              summary={
                <>
                  共 {items.length} 条 · 第 {page} 页
                </>
              }
              onPageChange={setPage}
            />
          </>
        ) : (
          <EmptyState text="还没有执行记录。" />
        )}
      </CardContent>
    </Card>
  );
}

function FileTree({
  nodes,
  selected,
  onSelect,
}: {
  nodes: ProjectFileNode[];
  selected: string;
  onSelect: (path: string) => void;
}) {
  return (
    <div className="tn-python-module__file-tree">
      {nodes.map((node) => (
        <FileTreeNode
          key={node.path}
          node={node}
          selected={selected}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}

function FileTreeNode({
  node,
  selected,
  onSelect,
}: {
  node: ProjectFileNode;
  selected: string;
  onSelect: (path: string) => void;
}) {
  const [open, setOpen] = useState(true);

  if (node.type === "directory") {
    return (
      <Collapsible open={open} onOpenChange={(next) => setOpen(next)}>
        <CollapsibleTrigger
          render={
            <Button
              variant="ghost"
              className="tn-python-module__file-directory"
            />
          }
        >
          <ChevronDown
            aria-hidden="true"
            className={`tn-python-module__file-chevron${open ? " is-open" : ""}`}
          />
          <Folder aria-hidden="true" />
          {node.name}
        </CollapsibleTrigger>
        <CollapsibleContent className="tn-python-module__file-children">
          <FileTree
            nodes={node.children ?? []}
            selected={selected}
            onSelect={onSelect}
          />
        </CollapsibleContent>
      </Collapsible>
    );
  }

  return (
    <Button
      variant="ghost"
      className={`tn-python-module__file-button${selected === node.path ? " is-selected" : ""}`}
      onClick={() => onSelect(node.path)}
    >
      <FileCode2 aria-hidden="true" />
      {node.name}
    </Button>
  );
}

function DetailRows({ rows }: { rows: Array<[string, ReactNode]> }) {
  return (
    <div className="tn-python-module__detail-list">
      {rows.map(([label, value]) => (
        <div className="tn-python-module__detail-row" key={label}>
          <span>{label}</span>
          <strong>{value}</strong>
        </div>
      ))}
    </div>
  );
}
function PersistentEventTimeline({
  events,
  isPending,
  isError,
  error,
  onRetry,
  resetKey,
}: {
  events: PersistentTaskEvent[];
  isPending: boolean;
  isError: boolean;
  error: unknown;
  onRetry: () => void;
  resetKey?: string;
}) {
  const pageSize = 8;
  const [page, setPage] = useState(1);
  const pageCount = Math.max(1, Math.ceil(events.length / pageSize));
  const visibleEvents = useMemo(
    () => events.slice((page - 1) * pageSize, page * pageSize),
    [events, page],
  );
  useEffect(() => {
    setPage((current) => Math.min(current, pageCount));
  }, [pageCount]);
  useEffect(() => {
    setPage(1);
  }, [resetKey]);

  if (isPending) return <LoadingState text="正在读取生命周期事件…" />;
  if (isError)
    return <ErrorState error={error} title="事件读取失败" onRetry={onRetry} />;
  if (!events.length) return <EmptyState text="暂无生命周期事件。" />;

  return (
    <>
      <div className="tn-python-module__timeline">
        {visibleEvents.map((event) => (
          <div className="tn-python-module__timeline-item" key={event.id}>
            <span
              className="tn-python-module__timeline-dot"
              aria-hidden="true"
            />
            <div className="tn-python-module__timeline-copy">
              <strong className="tn-python-module__timeline-title">
                {event.message}
              </strong>
              <span className="tn-python-module__timeline-meta">
                {event.error_summary || event.status_after
                  ? `${event.error_summary || ""}${event.error_summary && event.status_after ? " · " : ""}${event.status_after ? statusText(event.status_after) : ""}`
                  : eventTypeText(event.event_type)}
              </span>
            </div>
            <time className="tn-python-module__timeline-time">
              {formatShortTime(event.created_at)}
            </time>
          </div>
        ))}
      </div>
      {pageCount > 1 ? (
        <PaginationControls
          page={page}
          pageCount={pageCount}
          summary={
            <>
              第 {page} / {pageCount} 页 · 最近 {events.length} 条
            </>
          }
          onPageChange={setPage}
        />
      ) : null}
    </>
  );
}
function StorageSummary({ storage }: { storage: ProjectStorage }) {
  const total = Math.max(storage.total_size, 1);
  const items = [
    ["源码", storage.source_size],
    ["虚拟环境", storage.venv_size],
    ["项目数据", storage.data_size],
    ["执行工作区", storage.workspace_size],
    ["日志", storage.logs_size],
    ["项目备份", storage.backup_size],
  ] as const;
  return (
    <div className="tn-python-module__summary-list">
      {items.map(([label, value]) => (
        <div className="tn-python-module__summary-item" key={label}>
          <div className="tn-python-module__summary-row">
            <span>{label}</span>
            <strong>{formatBytes(value)}</strong>
          </div>
          <Progress value={Math.round((value / total) * 100)} />
        </div>
      ))}
      <div className="tn-python-module__summary-row">
        <span>总计</span>
        <strong>{formatBytes(storage.total_size)}</strong>
      </div>
      <span className="tn-python-module__muted">
        执行工作区：{storage.workspace_count} 个 · 项目备份：
        {storage.backup_count} 个
      </span>
    </div>
  );
}

function SecurityFindingsDialog({
  open,
  onOpenChange,
  security,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  security: SecurityScan | null | undefined;
}) {
  const [filter, setFilter] = useState("all");
  useEffect(() => {
    if (!open) setFilter("all");
  }, [open]);
  const findings = useMemo(() => {
    const items = security?.findings ?? [];
    return filter === "all"
      ? items
      : items.filter((item) => item.level === filter);
  }, [filter, security?.findings]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>安全扫描详情</DialogTitle>
          <DialogDescription>
            查看项目扫描发现的风险项、文件位置和处理建议。
          </DialogDescription>
        </DialogHeader>
        <div className="tn-python-module__security-detail-toolbar">
          <SelectField
            label="风险级别"
            value={filter}
            onValueChange={setFilter}
            options={[
              { label: "全部", value: "all" },
              { label: "低风险", value: "low" },
              { label: "中风险", value: "medium" },
              { label: "高风险", value: "high" },
              { label: "阻断", value: "blocked" },
            ]}
          />
          <span className="tn-python-module__muted">
            共 {findings.length} 项
          </span>
        </div>
        {findings.length ? (
          <div className="tn-python-module__security-findings">
            {findings.map((finding) => (
              <Card size="sm" key={finding.id}>
                <CardHeader>
                  <div className="tn-python-module__security-finding-head">
                    <CardTitle>
                      <span className="tn-python-module__status-line">
                        <StatusBadge value={finding.level} />
                        {finding.category}
                      </span>
                    </CardTitle>
                    {finding.file ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          void copyText(
                            finding.line
                              ? `${finding.file}:${finding.line}`
                              : finding.file,
                            "路径已复制。",
                          )
                        }
                      >
                        <Copy aria-hidden="true" />
                        复制路径
                      </Button>
                    ) : null}
                  </div>
                  <CardDescription>
                    {finding.file || "项目"}
                    {finding.line ? `:${finding.line}` : ""}
                  </CardDescription>
                </CardHeader>
                <CardContent className="tn-python-module__security-finding-content">
                  <p>{finding.message}</p>
                  <span className="tn-python-module__muted">
                    {finding.suggestion}
                  </span>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <EmptyState text="当前筛选下没有风险项。" />
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            关闭
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ProjectDetailPage({
  projectId,
  initialEntryFile,
}: {
  projectId: string;
  initialEntryFile?: string | undefined;
}) {
  const project = useQuery({
    queryKey: ["python-runner", "project", projectId],
    queryFn: () => getUpload(projectId),
  });
  const security = useQuery({
    queryKey: ["python-runner", "security", projectId],
    queryFn: () => getSecurity(projectId),
    enabled: Boolean(project.data),
  });
  const environment = useQuery({
    queryKey: ["python-runner", "environment", projectId],
    queryFn: () => getEnvironment(projectId),
    enabled: Boolean(project.data),
    refetchInterval: (query) => query.state.data?.status === "installing" ? 2_000 : false,
  });
  const storage = useQuery({
    queryKey: ["python-runner", "storage", projectId],
    queryFn: () => getProjectStorage(projectId),
    enabled: Boolean(project.data),
  });
  const config = useQuery({
    queryKey: ["python-runner", "config", projectId],
    queryFn: () => getProjectConfig(projectId),
    enabled: Boolean(project.data),
  });
  const [selectedFile, setSelectedFile] = useState(initialEntryFile ?? "");
  const [selectedEntryFile, setSelectedEntryFile] = useState(
    initialEntryFile ?? "",
  );
  const [configContent, setConfigContent] = useState("");
  const [configMode, setConfigMode] = useState<"basic" | "advanced">("basic");
  const [configDraft, setConfigDraft] = useState<Record<string, unknown>>({});
  const [configJsonError, setConfigJsonError] = useState("");
  const [riskConfirmed, setRiskConfirmed] = useState(false);
  const [securityDetailOpen, setSecurityDetailOpen] = useState(false);
  const [quickScheduleOpen, setQuickScheduleOpen] = useState(false);
  const [updateOpen, setUpdateOpen] = useState(false);
  const [installLogOpen, setInstallLogOpen] = useState(false);
  const [confirmAction, setConfirmAction] = useState<
    "environment" | "data" | "rollback" | null
  >(null);
  const [cleanupTarget, setCleanupTarget] =
    useState<ProjectCleanupTarget | null>(null);
  const [rollbackImpact, setRollbackImpact] =
    useState<ProjectUpdateResult | null>(null);
  const preview = useQuery({
    queryKey: ["python-runner", "preview", projectId, selectedFile],
    queryFn: () => previewFile(projectId, selectedFile),
    enabled: Boolean(selectedFile),
  });
  const installLog = useQuery({
    queryKey: ["python-runner", "install-log", projectId],
    queryFn: () => getInstallLog(projectId),
    enabled: installLogOpen,
  });
  const scan = useMutation({
    mutationFn: () => scanSecurity(projectId),
    onSuccess: () => {
      setRiskConfirmed(false);
      void security.refetch();
      runtime?.notify({ type: "success", content: "项目安全扫描完成。" });
    },
  });
  const createEnv = useMutation({
    mutationFn: () => createEnvironment(projectId),
    onSuccess: () => void environment.refetch(),
  });
  const install = useMutation({
    mutationFn: () =>
      installRequirements(projectId, {
        confirm_risk: riskConfirmed,
        scan_id: security.data?.scan_id,
      }),
    onSuccess: () => void environment.refetch(),
  });
  const rebuild = useMutation({
    mutationFn: () => rebuildEnvironment(projectId),
    onSuccess: () => void environment.refetch(),
  });
  const removeEnv = useMutation({
    mutationFn: () => deleteEnvironment(projectId),
    onSuccess: () => void environment.refetch(),
  });
  const clearData = useMutation({
    mutationFn: () => clearProjectData(projectId),
    onSuccess: () => {
      void environment.refetch();
      void storage.refetch();
    },
  });
  const rollback = useMutation({
    mutationFn: (confirmScheduleImpact: boolean) =>
      rollbackUpload(projectId, confirmScheduleImpact),
    onSuccess: () => {
      setRollbackImpact(null);
      void project.refetch();
      void security.refetch();
      void environment.refetch();
      void storage.refetch();
    },
    onError: (error) => {
      const impact = extractProjectImpact(error);
      if (impact) setRollbackImpact(impact);
    },
  });
  const saveConfig = useMutation({
    mutationFn: (payload: {
      values?: Record<string, unknown>;
      content?: string;
    }) => saveProjectConfig(projectId, payload),
    onSuccess: (next) => {
      setConfigContent(next.content || JSON.stringify(next.values, null, 2));
      setConfigDraft(cloneConfigValues(next.values));
      setConfigJsonError("");
      void config.refetch();
    },
  });
  const cleanup = useMutation({
    mutationFn: (target: ProjectCleanupTarget) =>
      cleanupProject(projectId, target),
    onSuccess: (result, target) => {
      setCleanupTarget(null);
      void storage.refetch();
      if (target === "venv") void environment.refetch();
      runtime?.notify({
        type: "success",
        content: `${result.message}，释放 ${formatBytes(result.freed_bytes)}。`,
      });
    },
  });
  useEffect(() => {
    if (!config.data) return;
    setConfigContent(
      config.data.content || JSON.stringify(config.data.values, null, 2),
    );
    setConfigDraft(cloneConfigValues(config.data.values));
    setConfigJsonError("");
  }, [config.data]);
  const configFields = useMemo(
    () =>
      flattenConfigFields(configDraft, "", config.data?.sensitive_paths ?? []),
    [config.data?.sensitive_paths, configDraft],
  );
  const configuredSensitivePaths = useMemo(
    () => new Set(config.data?.configured_sensitive_paths ?? []),
    [config.data?.configured_sensitive_paths],
  );
  const updateConfigField = (
    field: ConfigField,
    value: string | number | boolean | null,
  ) => {
    let nextValue: unknown = value;
    if (field.kind === "number") nextValue = Number(value) || 0;
    if (field.kind === "json") {
      try {
        nextValue = JSON.parse(String(value || "null"));
        setConfigJsonError("");
      } catch {
        setConfigJsonError(`${field.path} 不是有效的 JSON 值`);
        return;
      }
    }
    setConfigDraft((current) => {
      const next = cloneConfigValues(current);
      writeConfigPath(next, field.path, nextValue);
      setConfigContent(JSON.stringify(next, null, 2));
      return next;
    });
  };
  useEffect(() => {
    if (!selectedFile && project.data) {
      setSelectedFile(
        initialEntryFile ||
          project.data.entry_candidates[0] ||
          project.data.python_files[0] ||
          "",
      );
    }
  }, [initialEntryFile, project.data, selectedFile]);
  useEffect(() => {
    if (!selectedEntryFile && project.data) {
      setSelectedEntryFile(
        initialEntryFile ||
          project.data.entry_candidates[0] ||
          project.data.python_files[0] ||
          "",
      );
    }
  }, [initialEntryFile, project.data, selectedEntryFile]);
  if (project.isPending)
    return (
      <ModuleShell
        title="项目详情"
        description="查看项目源码、风险和运行环境。"
      >
        <LoadingState text="正在读取项目详情…" />
      </ModuleShell>
    );
  if (project.isError)
    return (
      <ModuleShell
        title="项目详情"
        description="查看项目源码、风险和运行环境。"
      >
        <PageError
          error={project.error}
          onRetry={() => void project.refetch()}
        />
      </ModuleShell>
    );
  const item = project.data;
  const securityData = extractSecurity(install.error) ?? security.data;
  const risky = ["medium", "high"].includes(securityData?.risk_level ?? "");
  const securityBlocked = securityData?.risk_level === "blocked";
  const runHref = `${moduleBase}/run?project=${encodeURIComponent(item.id)}${selectedEntryFile ? `&entry_file=${encodeURIComponent(selectedEntryFile)}` : ""}`;
  const entryQuery =
    selectedEntryFile || item.entry_candidates[0] || item.python_files[0] || "";
  const requirementFile = findProjectFile(item.file_tree, "requirements.txt");
  const scheduleHref = `${moduleBase}/schedules/create?upload_id=${encodeURIComponent(item.id)}${entryQuery ? `&entry_file=${encodeURIComponent(entryQuery)}` : ""}`;
  const persistentHref = `${moduleBase}/services/create?upload_id=${encodeURIComponent(item.id)}${entryQuery ? `&entry_file=${encodeURIComponent(entryQuery)}` : ""}`;
  const runConfirmedAction = () => {
    if (confirmAction === "environment") removeEnv.mutate();
    if (confirmAction === "data") clearData.mutate();
    if (confirmAction === "rollback") rollback.mutate(false);
    setConfirmAction(null);
  };
  return (
    <ModuleShell
      title={item.name}
      description={`${item.filename} · 最近更新 ${formatTime(item.updated_at)}`}
    >
      <div className="tn-python-module__page-toolbar">
        <ButtonGroup aria-label="项目操作">
          <ButtonGroup aria-label="项目导航">
            <ActionLinkButton href={`${moduleBase}/projects`} size="sm">
              <ArrowLeft aria-hidden="true" />
              返回项目仓库
            </ActionLinkButton>
          </ButtonGroup>
          <ButtonGroup aria-label="项目维护">
            <BusyButton
              size="sm"
              onClick={() => runtime?.router.push(runHref)}
            >
              <Play aria-hidden="true" />
              运行项目
            </BusyButton>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setUpdateOpen(true)}
            >
              <Upload aria-hidden="true" />
              更新项目
            </Button>
          </ButtonGroup>
          <ButtonGroup aria-label="项目任务">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setQuickScheduleOpen(true)}
            >
              <CalendarClock aria-hidden="true" />
              创建定时任务
            </Button>
            <ActionLinkButton href={persistentHref} size="sm">
              <Server aria-hidden="true" />
              创建常驻任务
            </ActionLinkButton>
          </ButtonGroup>
        </ButtonGroup>
      </div>
      <div className="tn-python-module__grid">
        <StatCard
          label="源码文件"
          value={item.file_count}
          meta={`${formatBytes(item.total_size)} 源码`}
          icon={FileText}
          tooltip="项目归档中的文件数量和源码总大小。"
        />
        <StatCard
          label="安全等级"
          value={
            security.data ? (
              <StatusBadge value={security.data.risk_level} />
            ) : (
              "读取中"
            )
          }
          meta={
            security.data
              ? formatShortTime(security.data.scanned_at)
              : "等待扫描"
          }
          icon={Settings2}
          tooltip="最近一次项目安全扫描结果。"
        />
        <StatCard
          label="运行环境"
          value={
            environment.data ? (
              <StatusBadge value={environment.data.status} />
            ) : (
              "读取中"
            )
          }
          meta={environmentStatusText(environment.data)}
          icon={Terminal}
          tooltip="项目虚拟环境和 requirements 状态。"
        />
        <StatCard
          label="项目存储"
          value={storage.data ? formatBytes(storage.data.total_size) : "读取中"}
          meta={
            storage.data ? `${storage.data.backup_count} 个备份` : "等待读取"
          }
          icon={Database}
          tooltip="源码、虚拟环境、数据和备份的占用总量。"
        />
      </div>
      <Card>
        <CardHeader>
          <div>
            <CardTitle>项目概览</CardTitle>
            <CardDescription>
              当前归档来源、入口候选和依赖声明。
            </CardDescription>
          </div>
          <CardAction>
            <Badge variant="outline">
              {uploadSourceText(item.upload_source)}
            </Badge>
          </CardAction>
        </CardHeader>
        <CardContent className="tn-python-module__form">
          <div className="tn-python-module__detail-grid">
            <DetailRows
              rows={[
                ["项目名称", item.name],
                ["项目文件", item.filename],
                ["文件数", `${item.file_count} 个`],
                ["源码大小", formatBytes(item.total_size)],
              ]}
            />
            <div className="tn-python-module__form">
              <span className="tn-python-module__muted">入口候选</span>
              {item.entry_candidates.length ? (
                <div className="tn-python-module__actions">
                  {item.entry_candidates.slice(0, 4).map((entry) => (
                    <Badge variant="secondary" key={entry}>
                      {entry}
                    </Badge>
                  ))}
                </div>
              ) : (
                <EmptyState text="未识别入口，请从文件树选择 .py 文件。" />
              )}
              <span className="tn-python-module__muted">依赖文件</span>
              {item.dependency_files.length ? (
                <div className="tn-python-module__actions">
                  {item.dependency_files.map((file) => (
                    <Badge variant="outline" key={file}>
                      {file}
                    </Badge>
                  ))}
                </div>
              ) : (
                <span className="tn-python-module__muted">
                  未发现 requirements.txt。
                </span>
              )}
            </div>
          </div>
          {item.dependency_files.length ? (
            <Alert variant="warning">
              <AlertTriangle aria-hidden="true" />
              <AlertTitle>检测到依赖文件</AlertTitle>
              <AlertDescription>
                当前版本不会自动安装依赖，请确保运行环境已具备相关依赖。
              </AlertDescription>
            </Alert>
          ) : null}
        </CardContent>
      </Card>
      <div className="tn-python-module__workspace">
        <Card>
          <CardHeader className="tn-python-module__file-card-header">
            <div className="tn-python-module__file-card-copy">
              <CardTitle>项目文件</CardTitle>
              <CardDescription>
                点击 Python 文件预览源码；当前入口：
                {selectedEntryFile || "未选择"}。
              </CardDescription>
            </div>
            <CardAction className="tn-python-module__file-card-action">
              <div className="tn-python-module__actions">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!selectedEntryFile}
                  onClick={() => setSelectedFile(selectedEntryFile)}
                >
                  查看入口文件
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!requirementFile}
                  onClick={() => setSelectedFile(requirementFile)}
                >
                  查看 requirements.txt
                </Button>
              </div>
            </CardAction>
          </CardHeader>
          <CardContent>
            {item.file_tree.length ? (
              <FileTree
                nodes={item.file_tree}
                selected={selectedFile}
                onSelect={setSelectedFile}
              />
            ) : (
              <EmptyState text="项目没有可显示的文件。" />
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <div>
              <CardTitle>文件预览</CardTitle>
              <CardDescription>
                {preview.data
                  ? `${preview.data.filename} · ${preview.data.language} · ${formatBytes(preview.data.size)}`
                  : "只读预览，不会修改项目源码。"}
              </CardDescription>
            </div>
            <CardAction>
              {preview.data ? (
                <BusyButton
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    void navigator.clipboard?.writeText(
                      preview.data?.content ?? "",
                    );
                    runtime?.notify({
                      type: "success",
                      content: "文件内容已复制。",
                    });
                  }}
                >
                  <Copy aria-hidden="true" />
                  复制
                </BusyButton>
              ) : null}
              {selectedFile.toLowerCase().endsWith(".py") ? (
                <Button
                  variant={
                    selectedEntryFile === selectedFile ? "secondary" : "outline"
                  }
                  size="sm"
                  onClick={() => setSelectedEntryFile(selectedFile)}
                >
                  {selectedEntryFile === selectedFile ? "当前入口" : "设为入口"}
                </Button>
              ) : null}
            </CardAction>
          </CardHeader>
          <CardContent>
            {preview.isPending ? (
              <LoadingState text="正在读取文件…" />
            ) : preview.isError ? (
              <ErrorState error={preview.error} title="文件不可预览" />
            ) : preview.data ? (
              <pre className="tn-python-module__preview-code">
                {preview.data.content || "文件为空。"}
              </pre>
            ) : (
              <EmptyState
                text={
                  selectedFile
                    ? "该文件暂不支持预览。"
                    : "从左侧文件树选择文本文件。"
                }
              />
            )}
          </CardContent>
        </Card>
      </div>
      <div className="tn-python-module__columns">
        <Card>
          <CardHeader>
            <div>
              <CardTitle>安全扫描</CardTitle>
              <CardDescription>
                项目执行和依赖安装前的风险检查。
              </CardDescription>
            </div>
            <CardAction>
              <div className="tn-python-module__actions">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!security.data}
                  onClick={() => setSecurityDetailOpen(true)}
                >
                  查看详情
                </Button>
                <BusyButton
                  variant="outline"
                  size="sm"
                  pending={scan.isPending}
                  onClick={() => scan.mutate()}
                >
                  <RefreshCw aria-hidden="true" />
                  重新扫描
                </BusyButton>
              </div>
            </CardAction>
          </CardHeader>
          <CardContent className="tn-python-module__form">
            {security.isPending ? (
              <LoadingState text="正在读取安全状态…" />
            ) : security.isError ? (
              <ErrorState error={security.error} title="安全扫描结果读取失败" />
            ) : security.data ? (
              <>
                <div className="tn-python-module__status-line">
                  <StatusBadge value={security.data.risk_level} />
                  <span className="tn-python-module__muted">
                    {security.data.message}
                  </span>
                </div>
                <div className="tn-python-module__security-metrics">
                  <span>问题 {securityIssueCount(security.data)}</span>
                  <span>扫描 {formatShortTime(security.data.scanned_at)}</span>
                  <span>模式 {securityModeText(security.data)}</span>
                </div>
                {security.data.findings.length ? (
                  <ul className="tn-python-module__finding-list">
                    {security.data.findings.slice(0, 50).map((finding) => (
                      <li
                        className="tn-python-module__finding"
                        key={finding.id}
                      >
                        <StatusBadge value={finding.level} />
                        <span>
                          {finding.file}
                          {finding.line ? `:${finding.line}` : ""} ·{" "}
                          {finding.message}
                          <br />
                          {finding.suggestion}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <EmptyState text="未发现明显风险。" />
                )}
              </>
            ) : (
              <EmptyState text="尚未完成安全扫描。" />
            )}
            {risky ? (
              <CheckboxField
                checked={riskConfirmed}
                onCheckedChange={setRiskConfirmed}
              >
                确认当前扫描结果后允许安装依赖
              </CheckboxField>
            ) : null}
            {install.isError ? (
              <ErrorState error={install.error} title="依赖安装失败" />
            ) : null}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <div>
              <CardTitle>项目配置</CardTitle>
              <CardDescription>
                读取 config.json、config.yaml 或 config.yml，敏感值保持脱敏。
              </CardDescription>
            </div>
            <CardAction>
              <div className="tn-python-module__actions">
                <Badge
                  variant={
                    config.isError
                      ? "destructive"
                      : config.data?.override_exists ||
                          config.data?.source_exists
                        ? "default"
                        : "outline"
                  }
                >
                  {config.isPending
                    ? "读取中"
                    : config.isError
                      ? "格式错误"
                      : config.data?.override_exists
                        ? "已保存覆盖配置"
                        : config.data?.source_exists
                          ? `已识别 ${config.data.file_name}`
                          : "未检测到配置"}
                </Badge>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={config.isPending || saveConfig.isPending}
                  onClick={() => void config.refetch()}
                >
                  <RefreshCw aria-hidden="true" />
                  刷新
                </Button>
                <BusyButton
                  pending={saveConfig.isPending}
                  disabled={
                    config.isPending ||
                    config.isError ||
                    (configMode === "basic" && Boolean(configJsonError))
                  }
                  onClick={() =>
                    saveConfig.mutate(
                      configMode === "advanced"
                        ? { content: configContent }
                        : { values: cloneConfigValues(configDraft) },
                    )
                  }
                >
                  保存配置
                </BusyButton>
              </div>
            </CardAction>
          </CardHeader>
          <CardContent>
            {config.isPending ? (
              <LoadingState text="正在读取配置…" />
            ) : config.isError ? (
              <ErrorState error={config.error} title="配置读取失败" />
            ) : (
              <div className="tn-python-module__form">
                <span className="tn-python-module__muted">
                  {config.data?.file_name ?? "config.json"}
                  {config.data?.configured_sensitive_paths.length
                    ? ` · 已脱敏 ${config.data.configured_sensitive_paths.length} 项敏感值`
                    : ""}
                  {!config.data?.detected ? " · 可从空配置开始创建" : ""}
                </span>
                <Tabs
                  value={configMode}
                  onValueChange={(value) =>
                    setConfigMode(value === "advanced" ? "advanced" : "basic")
                  }
                >
                  <TabsList>
                    <TabsTrigger value="basic">基础配置</TabsTrigger>
                    <TabsTrigger value="advanced">
                      高级 {config.data?.file_name ?? "JSON"}
                    </TabsTrigger>
                  </TabsList>
                  <TabsContent value="basic">
                    {configFields.length ? (
                      <FieldGroup className="tn-python-module__form-grid">
                        {configFields.map((field) => {
                          const value = readConfigPath(configDraft, field.path);
                          return (
                            <Field
                              key={field.path}
                              label={field.path}
                              help={
                                field.sensitive &&
                                configuredSensitivePaths.has(field.path)
                                  ? "已配置，留空可保持原值"
                                  : undefined
                              }
                            >
                              {field.kind === "boolean" ? (
                                <Switch
                                  checked={Boolean(value)}
                                  onCheckedChange={(next) =>
                                    updateConfigField(field, Boolean(next))
                                  }
                                />
                              ) : field.kind === "number" ? (
                                <Input
                                  type="number"
                                  value={typeof value === "number" ? value : ""}
                                  onChange={(event) =>
                                    updateConfigField(field, event.target.value)
                                  }
                                />
                              ) : field.kind === "json" ? (
                                <Textarea
                                  className="tn-python-module__code--compact"
                                  value={JSON.stringify(value ?? null, null, 2)}
                                  onChange={(event) =>
                                    updateConfigField(field, event.target.value)
                                  }
                                  spellCheck={false}
                                />
                              ) : (
                                <Input
                                  type={
                                    field.sensitive &&
                                    configuredSensitivePaths.has(field.path)
                                      ? "password"
                                      : "text"
                                  }
                                  value={String(value ?? "")}
                                  placeholder={
                                    field.sensitive &&
                                    configuredSensitivePaths.has(field.path)
                                      ? "已配置，留空保持不变"
                                      : "请输入配置值"
                                  }
                                  autoComplete="off"
                                  onChange={(event) =>
                                    updateConfigField(field, event.target.value)
                                  }
                                />
                              )}
                            </Field>
                          );
                        })}
                      </FieldGroup>
                    ) : (
                      <EmptyState text="暂无可填写字段，可在高级编辑中创建配置。" />
                    )}
                    {configJsonError ? (
                      <Alert variant="destructive">
                        <AlertTriangle aria-hidden="true" />
                        <AlertDescription>{configJsonError}</AlertDescription>
                      </Alert>
                    ) : null}
                  </TabsContent>
                  <TabsContent value="advanced">
                    <Field
                      label={config.data?.file_name ?? "config.json"}
                      help="保存时由后端校验配置格式；敏感值会继续保持脱敏。"
                    >
                      <Textarea
                        className="tn-python-module__code tn-python-module__code--compact"
                        value={configContent}
                        onChange={(event) =>
                          setConfigContent(event.target.value)
                        }
                        spellCheck={false}
                      />
                    </Field>
                  </TabsContent>
                </Tabs>
                {saveConfig.isError ? (
                  <ErrorState error={saveConfig.error} title="配置保存失败" />
                ) : null}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
      <SecurityFindingsDialog
        open={securityDetailOpen}
        onOpenChange={setSecurityDetailOpen}
        security={security.data}
      />
      <QuickScheduleDialog
        open={quickScheduleOpen}
        onOpenChange={setQuickScheduleOpen}
        project={item}
        entryFile={entryQuery}
        environment={environment.data}
        environmentLoading={environment.isPending}
        security={security.data}
        securityLoading={security.isPending}
        fullCreateHref={scheduleHref}
      />
      <ProjectUpdateDialog
        project={item}
        open={updateOpen}
        onOpenChange={setUpdateOpen}
        onUpdated={() => {
          void project.refetch();
          void security.refetch();
          void environment.refetch();
          void storage.refetch();
          void config.refetch();
        }}
      />
      <Card>
        <CardHeader>
          <div>
            <CardTitle>运行环境</CardTitle>
            <CardDescription>
              {environment.data ? (
                `${environmentStatusText(environment.data)} · ${
                  environment.data.has_requirements
                    ? "检测到 requirements.txt"
                    : "没有 requirements.txt"
                }${
                  environment.data.requirements_changed ? " · 依赖声明已变化" : ""
                }`
              ) : (
                "尚未创建虚拟环境"
              )}
            </CardDescription>
          </div>
          <CardAction>
            <StatusBadge value={environment.data?.status ?? "unknown"} />
          </CardAction>
        </CardHeader>
        <CardContent className="tn-python-module__form">
          {environment.isPending ? (
            <LoadingState text="正在读取项目环境状态…" />
          ) : environment.isError ? (
            <ErrorState
              error={environment.error}
              title="项目环境读取失败"
              onRetry={() => void environment.refetch()}
            />
          ) : environment.data ? (
            <DetailRows
              rows={[
                [
                  "requirements.txt",
                  environment.data.has_requirements ? "已识别" : "未发现",
                ],
                [
                  "风险提示",
                  environment.data.risky_requirements.length
                    ? `${environment.data.risky_requirements.length} 项需确认`
                    : "未发现风险项",
                ],
                [
                  "上次安装",
                  environment.data.requirements_changed
                    ? "依赖已变化"
                    : environment.data.last_install_status
                      ? statusText(environment.data.last_install_status)
                      : "尚未安装",
                ],
                ...(environment.data.last_error
                  ? [
                      ["最近错误", environment.data.last_error] as [
                        string,
                        ReactNode,
                      ],
                    ]
                  : []),
              ]}
            />
          ) : (
            <EmptyState text="尚未创建项目环境。" />
          )}
          {environment.data?.status === "installing" ? (
            <Alert>
              <Spinner aria-hidden="true" />
              <div>
                <AlertTitle>正在安装 requirements.txt</AlertTitle>
                <AlertDescription>
                  安装过程可能需要一些时间，请不要关闭当前页面。
                </AlertDescription>
              </div>
            </Alert>
          ) : environment.data?.requirements_changed ? (
            <Alert variant="warning">
              <AlertTriangle aria-hidden="true" />
              <AlertDescription>
                检测到 requirements.txt 已变化，建议重新安装依赖。
              </AlertDescription>
            </Alert>
          ) : null}
          <div className="tn-python-module__actions">
            <BusyButton
              variant="outline"
              pending={createEnv.isPending}
              disabled={
                createEnv.isPending ||
                install.isPending ||
                rebuild.isPending ||
                removeEnv.isPending ||
                environment.data?.status === "ready" ||
                environment.data?.status === "creating" ||
                environment.data?.status === "installing"
              }
              onClick={() => createEnv.mutate()}
            >
              <Server aria-hidden="true" />
              {environment.data?.status === "failed" ? "重新创建" : "创建环境"}
            </BusyButton>
            <BusyButton
              pending={install.isPending}
              disabled={
                !environment.data?.has_requirements ||
                !environment.data?.python_executable ||
                (risky && !riskConfirmed) ||
                securityBlocked ||
                createEnv.isPending ||
                rebuild.isPending ||
                removeEnv.isPending ||
                environment.data?.status === "creating" ||
                environment.data?.status === "installing"
              }
              onClick={() => install.mutate()}
            >
              <ArrowRight data-icon="inline-start" aria-hidden="true" />
              {environment.data?.requirements_changed ||
              environment.data?.last_install_status === "success"
                ? "重新安装依赖"
                : "安装 requirements"}
            </BusyButton>
            <BusyButton
              variant="outline"
              pending={rebuild.isPending}
              disabled={
                !environment.data ||
                !hasEnvironmentState(environment.data.status) ||
                createEnv.isPending ||
                install.isPending ||
                removeEnv.isPending
              }
              onClick={() => rebuild.mutate()}
            >
              <RotateCcw aria-hidden="true" />
              重建环境
            </BusyButton>
            <Button
              variant="ghost"
              disabled={
                removeEnv.isPending ||
                createEnv.isPending ||
                install.isPending ||
                rebuild.isPending ||
                !environment.data ||
                !hasEnvironmentState(environment.data.status)
              }
              onClick={() => setConfirmAction("environment")}
            >
              <Trash2 aria-hidden="true" />
              删除环境
            </Button>
            <Button
              variant="outline"
              disabled={installLog.isPending || environment.isPending}
              onClick={() => setInstallLogOpen(true)}
            >
              查看安装日志
            </Button>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <div>
            <CardTitle>版本与存储</CardTitle>
            <CardDescription>
              更新项目会自动创建备份，必要时可以回滚上一版本。
            </CardDescription>
          </div>
          <CardAction>
            <Button
              variant="outline"
              disabled={rollback.isPending || !storage.data?.backup_count}
              onClick={() => setConfirmAction("rollback")}
            >
              <RotateCcw aria-hidden="true" />
              回滚上一版本
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent>
          {storage.data ? (
            <StorageSummary storage={storage.data} />
          ) : (
            <LoadingState text="正在读取存储统计…" />
          )}
          {rollback.isError ? (
            <ErrorState error={rollback.error} title="项目回滚失败" />
          ) : null}
        </CardContent>
      </Card>
      <div className="tn-python-module__columns">
        <Card>
          <CardHeader>
            <div>
              <CardTitle>项目数据</CardTitle>
              <CardDescription>
                运行期间写入 TOOLNEST_PROJECT_DATA_DIR 的持久化数据。
              </CardDescription>
            </div>
            <CardAction>
              <Badge
                variant={
                  (environment.data?.data_size ?? 0) > 0
                    ? "default"
                    : "secondary"
                }
              >
                {(environment.data?.data_size ?? 0) > 0 ? "有数据" : "空目录"}
              </Badge>
            </CardAction>
          </CardHeader>
          <CardContent className="tn-python-module__form">
            {environment.data ? (
              <DetailRows
                rows={[
                  [
                    "存储状态",
                    environment.data.data_size > 0
                      ? "运行数据已保存"
                      : "暂无持久化数据",
                  ],
                  ["当前占用", formatBytes(environment.data.data_size)],
                ]}
              />
            ) : environment.isError ? (
              <ErrorState error={environment.error} title="项目数据读取失败" />
            ) : (
              <LoadingState text="正在读取项目数据状态…" />
            )}
            <div className="tn-python-module__actions">
              <Button
                variant="outline"
                disabled={
                  clearData.isPending ||
                  !environment.data ||
                  environment.data.data_size <= 0
                }
                onClick={() => setConfirmAction("data")}
              >
                清空数据
              </Button>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <div>
              <CardTitle>空间维护</CardTitle>
              <CardDescription>
                按需清理运行产物，源码和上传记录会保留。
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <div className="tn-python-module__maintenance-list">
              {[
                ["workspaces", "执行工作区", "清理临时运行目录和源码快照。"],
                [
                  "execution_snapshots",
                  "执行快照",
                  "删除执行时保留的项目快照。",
                ],
                ["install_logs", "安装日志", "删除依赖安装日志，不影响环境。"],
                ["venv", "虚拟环境", "删除项目虚拟环境，后续需重新创建。"],
                ["backups", "项目备份", "清理更新前备份，清理后无法回滚。"],
              ].map(([target, label, description]) => (
                <div className="tn-python-module__maintenance-row" key={target}>
                  <div className="tn-python-module__maintenance-copy">
                    <strong>{label}</strong>
                    <span className="tn-python-module__muted">
                      {description}
                    </span>
                  </div>
                  <BusyButton
                    variant="outline"
                    size="sm"
                    pending={cleanup.isPending && cleanup.variables === target}
                    disabled={cleanup.isPending}
                    onClick={() =>
                      setCleanupTarget(target as ProjectCleanupTarget)
                    }
                  >
                    清理
                  </BusyButton>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
      <Dialog open={installLogOpen} onOpenChange={setInstallLogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>requirements 安装日志</DialogTitle>
            <DialogDescription>
              日志为只读内容，过长时会按后端限制截断。
            </DialogDescription>
          </DialogHeader>
          {installLog.isPending ? (
            <LoadingState text="正在读取安装日志…" />
          ) : installLog.isError ? (
            <ErrorState error={installLog.error} title="日志读取失败" />
          ) : (
            <pre className="tn-python-module__log">
              {installLog.data?.content || "暂无安装日志。"}
            </pre>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setInstallLogOpen(false)}>
              关闭
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={Boolean(confirmAction)}
        onOpenChange={(open) => {
          if (!open) setConfirmAction(null);
        }}
        title={
          confirmAction === "environment"
            ? "删除项目环境"
            : confirmAction === "data"
              ? "清理项目数据"
              : "回滚项目版本"
        }
        description={
          confirmAction === "environment"
            ? "删除虚拟环境后，已安装依赖需要重新安装。"
            : confirmAction === "data"
              ? "项目运行产生的数据会被清理，源码和配置不会改变。"
              : "项目将恢复到上一份备份，当前版本仍会保留为备份。"
        }
        confirmLabel="继续"
        destructive={confirmAction !== "rollback"}
        pending={
          removeEnv.isPending || clearData.isPending || rollback.isPending
        }
        onConfirm={runConfirmedAction}
      />
      <ConfirmDialog
        open={Boolean(rollbackImpact)}
        onOpenChange={(open) => {
          if (!open && !rollback.isPending) setRollbackImpact(null);
        }}
        title="确认回滚对现有任务的影响"
        description={
          rollbackImpact
            ? `回滚后 ${rollbackImpact.impacted_tasks.length} 个定时或常驻任务将使用上一版本代码${
                rollbackImpact.missing_entry_tasks.length
                  ? `，其中 ${rollbackImpact.missing_entry_tasks.length} 个入口需要重新确认`
                  : ""
              }。${rollbackImpact.impacted_tasks
                .slice(0, 3)
                .map((task) => String(task.name ?? task.id ?? "未命名任务"))
                .join("、")}${
                rollbackImpact.impacted_tasks.length > 3 ? "等" : ""
              }`
            : ""
        }
        confirmLabel="确认回滚"
        pending={rollback.isPending}
        onConfirm={() => rollback.mutate(true)}
      />
      <ConfirmDialog
        open={Boolean(cleanupTarget)}
        onOpenChange={(open) => {
          if (!open && !cleanup.isPending) setCleanupTarget(null);
        }}
        title={
          cleanupTarget ? `清理${cleanupTargetText(cleanupTarget)}` : "确认清理"
        }
        description={
          cleanupTarget
            ? `确认清理当前项目的${cleanupTargetText(cleanupTarget)}吗？该操作会删除对应的运行数据，且通常无法恢复。`
            : ""
        }
        confirmLabel="确认清理"
        destructive
        pending={cleanup.isPending}
        onConfirm={() => {
          if (cleanupTarget) cleanup.mutate(cleanupTarget);
        }}
      />
    </ModuleShell>
  );
}
function flattenTree(nodes: ProjectFileNode[]): ProjectFileNode[] {
  return nodes.flatMap((node) => [
    node,
    ...(node.children ? flattenTree(node.children) : []),
  ]);
}

function ExecutionTable({
  items,
  onRerun,
  onCopy,
  onDelete,
  rerunning,
  deleting,
}: {
  items: PythonExecution[];
  onRerun: (id: string) => void;
  onCopy: (item: PythonExecution) => void;
  onDelete: (item: PythonExecution) => void;
  rerunning?: string | undefined;
  deleting?: string | undefined;
}) {
  if (!items.length)
    return (
      <EmptyState
        text="没有符合条件的执行记录。"
        action={
          <ActionLinkButton href={`${moduleBase}/run`}>
            开始快速运行 <ArrowRight aria-hidden="true" />
          </ActionLinkButton>
        }
      />
    );
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead style={{ width: "28%" }}>任务</TableHead>
          <TableHead style={{ width: "17%" }}>触发方式</TableHead>
          <TableHead style={{ width: "12%" }}>状态</TableHead>
          <TableHead style={{ width: "18%" }}>开始时间</TableHead>
          <TableHead style={{ width: "12%" }}>耗时</TableHead>
          <TableHead
            className="tn-python-module__right"
            style={{ width: "13%" }}
          >
            操作
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((item) => (
          <TableRow key={item.id}>
            <TableCell>
              <InternalLink
                href={`${moduleBase}/executions/${item.id}`}
                className="tn-python-module__list-title"
              >
                {item.name}
              </InternalLink>
              <div className="tn-python-module__table-subtitle">
                {item.entry_file || "自动入口"}
              </div>
            </TableCell>
            <TableCell>
              {triggerText(item.trigger_type || item.task_mode)}
            </TableCell>
            <TableCell className="tn-python-module__center">
              <StatusBadge value={item.status} />
            </TableCell>
            <TableCell className="tn-python-module__nowrap">
              {formatTime(item.started_at ?? item.created_at)}
            </TableCell>
            <TableCell className="tn-python-module__center">
              {formatDuration(item.duration_ms)}
            </TableCell>
            <TableCell>
              <div className="tn-python-module__table-actions">
                <ActionLinkButton href={`${moduleBase}/executions/${item.id}`}>
                  查看
                </ActionLinkButton>
                {item.status !== "running" ? (
                  <TableActionMenu
                    items={[
                      {
                        key: "rerun",
                        label: "重跑",
                        disabled: Boolean(rerunning),
                      },
                      {
                        key: "copy",
                        label: "复制代码",
                        disabled: !item.code_snapshot,
                      },
                      {
                        key: "delete",
                        label: "删除记录",
                        destructive: true,
                        disabled: Boolean(deleting),
                      },
                    ]}
                    onClick={(key) => {
                      if (key === "rerun") onRerun(item.id);
                      if (key === "copy") onCopy(item);
                      if (key === "delete") onDelete(item);
                    }}
                  />
                ) : null}
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function ExecutionsPage({
  initialStatus,
}: {
  initialStatus?: string | undefined;
}) {
  const query = useQuery({
    queryKey: ["python-runner", "executions"],
    queryFn: listExecutions,
    refetchInterval: (query) => query.state.data?.some((item) => item.status === "running") ? 3_000 : 60_000,
    refetchIntervalInBackground: false,
  });
  const [keyword, setKeyword] = useState("");
  const [status, setStatus] = useState(initialStatus || "all");
  const [page, setPage] = useState(1);
  const [deleteTarget, setDeleteTarget] = useState<PythonExecution | null>(
    null,
  );
  const rerun = useMutation({
    mutationFn: rerunExecution,
    onSuccess: () => void query.refetch(),
  });
  const remove = useMutation({
    mutationFn: deleteExecution,
    onSuccess: () => {
      setDeleteTarget(null);
      void query.refetch();
    },
  });
  const items = useMemo(
    () =>
      (query.data ?? []).filter(
        (item) =>
          (!keyword.trim() ||
            item.name.toLowerCase().includes(keyword.trim().toLowerCase())) &&
          (status === "all" || item.status === status),
      ),
    [keyword, query.data, status],
  );
  const pageSize = 8;
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const visibleItems = items.slice((page - 1) * pageSize, page * pageSize);
  useEffect(() => {
    setPage(1);
  }, [keyword, status]);
  useEffect(() => {
    setPage((current) => Math.min(current, pageCount));
  }, [pageCount]);
  if (query.isPending)
    return (
      <ModuleShell
        title="执行历史"
        description="查看 Python 脚本的输出、状态和运行历史。"
      >
        <LoadingState text="正在读取执行历史…" />
      </ModuleShell>
    );
  if (query.isError)
    return (
      <ModuleShell
        title="执行历史"
        description="查看 Python 脚本的输出、状态和运行历史。"
      >
        <PageError error={query.error} onRetry={() => void query.refetch()} />
      </ModuleShell>
    );
  return (
    <ModuleShell
      title="执行历史"
      description="查看 Python 脚本的输出、状态和运行历史。"
    >
      <Card>
        <CardHeader>
          <div>
            <CardTitle>全部执行</CardTitle>
            <CardDescription>支持按任务名称和执行状态筛选。</CardDescription>
          </div>
          <CardAction>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void query.refetch()}
            >
              <RefreshCw aria-hidden="true" />
              刷新
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent className="tn-python-module__form">
          <div className="tn-python-module__filter">
            <Field label="搜索任务">
              <Input
                value={keyword}
                onChange={(event) => setKeyword(event.target.value)}
                placeholder="搜索任务名称"
              />
            </Field>
            <SelectField
              label="执行状态"
              value={status}
              onValueChange={setStatus}
              options={[
                { value: "all", label: "全部状态" },
                ...Object.entries(statusMeta)
                  .filter(([key]) =>
                    [
                      "success",
                      "failed",
                      "running",
                      "stopped",
                      "timeout",
                      "pending",
                    ].includes(key),
                  )
                  .map(([value, meta]) => ({ value, label: meta.label })),
              ]}
            />
            <span className="tn-python-module__muted">
              共 {items.length} 条
            </span>
          </div>
          <ExecutionTable
            items={visibleItems}
            rerunning={rerun.isPending ? rerun.variables : undefined}
            deleting={remove.isPending ? remove.variables : undefined}
            onRerun={(id) => rerun.mutate(id)}
            onCopy={(item) =>
              void copyText(item.code_snapshot ?? "", "代码已复制。")
            }
            onDelete={setDeleteTarget}
          />
          <PaginationControls
            page={page}
            pageCount={pageCount}
            summary={
              <>
                共 {items.length} 条 · 第 {page} 页
              </>
            }
            onPageChange={setPage}
          />
        </CardContent>
      </Card>
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title="删除执行记录"
        description={
          deleteTarget
            ? `确定删除“${deleteTarget.name}”吗？日志和执行快照都会被删除。`
            : ""
        }
        confirmLabel="删除记录"
        destructive
        pending={remove.isPending}
        onConfirm={() => {
          if (deleteTarget) remove.mutate(deleteTarget.id);
        }}
      />
    </ModuleShell>
  );
}

function ExecutionDetailPage({ executionId }: { executionId: string }) {
  const query = useQuery({
    queryKey: ["python-runner", "execution", executionId],
    queryFn: () => getExecution(executionId),
    refetchInterval: (value) =>
      value.state.data?.status === "running" ? 2_000 : false,
  });
  const logs = useQuery({
    queryKey: ["python-runner", "execution-logs", executionId],
    queryFn: () => getExecutionLogs(executionId, undefined, 500),
    refetchInterval: query.data?.status === "running" ? 2_000 : false,
  });
  const stop = useMutation({
    mutationFn: () => stopExecution(executionId),
    onSuccess: () => void query.refetch(),
  });
  const rerun = useMutation({
    mutationFn: () => rerunExecution(executionId),
    onSuccess: (next) =>
      runtime?.router.push(`${moduleBase}/executions/${next.id}`),
  });
  const remove = useMutation({
    mutationFn: () => deleteExecution(executionId),
    onSuccess: () => runtime?.router.push(`${moduleBase}/executions`),
  });
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [logTab, setLogTab] = useState<"merged" | "stdout" | "stderr">(
    "merged",
  );
  const [logsCleared, setLogsCleared] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const logConsoleRef = useRef<HTMLPreElement>(null);
  useEffect(() => {
    if (!autoScroll || !logConsoleRef.current) return;
    logConsoleRef.current.scrollTop = logConsoleRef.current.scrollHeight;
  }, [
    autoScroll,
    executionId,
    logTab,
    logs.data,
    logsCleared,
    query.data?.updated_at,
  ]);
  if (query.isPending)
    return (
      <ModuleShell title="执行详情" description="查看执行输出和运行快照。">
        <LoadingState text="正在读取执行详情…" />
      </ModuleShell>
    );
  if (query.isError)
    return (
      <ModuleShell title="执行详情" description="查看执行输出和运行快照。">
        <PageError error={query.error} onRetry={() => void query.refetch()} />
      </ModuleShell>
    );
  const item = query.data;
  const fallbackLogs = [
    ...(item.stdout
      ? [{ type: "stdout", content: item.stdout, timestamp: item.updated_at }]
      : []),
    ...(item.stderr
      ? [{ type: "stderr", content: item.stderr, timestamp: item.updated_at }]
      : []),
  ];
  const logEvents = logs.data?.length ? logs.data : fallbackLogs;
  const outputEvents = logsCleared
    ? []
    : logEvents.filter((log) => logTab === "merged" || log.type === logTab);
  const output = outputEvents.length
    ? outputEvents.map((log) => `[${log.type}] ${log.content}`).join("\n")
    : "暂无输出";
  return (
    <ModuleShell
      title={item.name}
      description={`${item.entry_file || "自动入口"} · 创建于 ${formatTime(item.created_at)}`}
    >
      <div className="tn-python-module__status-line">
        <StatusBadge value={item.status} />
        <span className="tn-python-module__muted">
          退出码 {item.exit_code ?? "—"} · 耗时{" "}
          {formatDuration(item.duration_ms)}
        </span>
        <div className="tn-python-module__actions">
          <ActionLinkButton href={`${moduleBase}/executions`}>
            <ArrowLeft aria-hidden="true" />
            返回执行历史
          </ActionLinkButton>
          {item.status === "running" ? (
            <BusyButton pending={stop.isPending} onClick={() => stop.mutate()}>
              <Square aria-hidden="true" />
              停止
            </BusyButton>
          ) : (
            <BusyButton
              variant="outline"
              pending={rerun.isPending}
              onClick={() => rerun.mutate()}
            >
              <RotateCcw aria-hidden="true" />
              重跑
            </BusyButton>
          )}
          <Button variant="ghost" onClick={() => setConfirmDelete(true)}>
            <Trash2 aria-hidden="true" />
            删除
          </Button>
        </div>
      </div>
      <div className="tn-python-module__detail-grid">
        <Card>
          <CardHeader>
            <CardTitle>基本信息</CardTitle>
          </CardHeader>
          <CardContent>
            <DetailRows
              rows={[
                [
                  "任务类型",
                  item.task_mode === "scheduled"
                    ? "定时任务"
                    : item.task_mode === "persistent"
                      ? "常驻任务"
                      : "即时运行",
                ],
                ["触发来源", triggerText(item.trigger_type || item.task_mode)],
                ["触发 ID", item.trigger_id ?? "—"],
                ["退出码", item.exit_code ?? "—"],
              ]}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>运行时间</CardTitle>
          </CardHeader>
          <CardContent>
            <DetailRows
              rows={[
                ["开始时间", formatTime(item.started_at)],
                ["结束时间", formatTime(item.finished_at)],
                ["耗时", formatDuration(item.duration_ms)],
                [
                  "运行环境",
                  runtimeEnvironmentText(
                    typeof item.source_config?.runtime_environment === "string"
                      ? item.source_config.runtime_environment
                      : "auto",
                  ),
                ],
                ["工作目录", item.working_directory || "由模块运行时管理"],
              ]}
            />
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Python 代码快照</CardTitle>
            <CardDescription>
              本次执行提交给运行时的只读代码或项目入口信息。
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <PythonCodeEditor
            value={
              item.code_snapshot ||
              `${item.source_type === "archive" ? "项目入口" : "内联脚本"}：${item.entry_file || "自动入口"}`
            }
            readOnly
          />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <div>
            <CardTitle>执行输出</CardTitle>
            <CardDescription>
              {item.logs_truncated
                ? "输出超过后端上限，较早内容已截断。"
                : "实时执行时每 2 秒刷新一次。"}
            </CardDescription>
          </div>
          <CardAction>
            <div className="tn-python-module__actions">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setLogsCleared(false);
                  void logs.refetch();
                  void query.refetch();
                }}
              >
                <RefreshCw aria-hidden="true" />
                刷新
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setAutoScroll((value) => !value)}
              >
                {autoScroll ? (
                  <Pause aria-hidden="true" />
                ) : (
                  <Play aria-hidden="true" />
                )}
                {autoScroll ? "暂停滚动" : "继续滚动"}
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={!outputEvents.length}
                onClick={() => void copyText(output, "日志已复制。")}
              >
                <Copy aria-hidden="true" />
                复制日志
              </Button>
            </div>
          </CardAction>
        </CardHeader>
        <CardContent>
          {logs.isPending ? (
            <LoadingState text="正在读取日志…" />
          ) : logs.isError ? (
            <ErrorState error={logs.error} title="日志读取失败" />
          ) : (
            <div className="tn-python-module__form">
              <Tabs
                value={logTab}
                onValueChange={(value) => {
                  setLogsCleared(false);
                  setLogTab(value as "merged" | "stdout" | "stderr");
                }}
              >
                <TabsList>
                  <TabsTrigger value="merged">合并</TabsTrigger>
                  <TabsTrigger value="stdout">标准输出</TabsTrigger>
                  <TabsTrigger value="stderr">错误输出</TabsTrigger>
                </TabsList>
              </Tabs>
              <pre ref={logConsoleRef} className="tn-python-module__log">
                {output}
              </pre>
              <div className="tn-python-module__actions">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={!outputEvents.length}
                  onClick={() => setLogsCleared(true)}
                >
                  清空显示
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="删除执行记录"
        description="删除后无法恢复执行快照和日志。"
        confirmLabel="删除记录"
        destructive
        pending={remove.isPending}
        onConfirm={() => remove.mutate()}
      />
    </ModuleShell>
  );
}

function defaultNotificationConfig(): NotificationConfig {
  return {
    notify_on_failure: true,
    failure_threshold_enabled: true,
    failure_threshold: 3,
    notify_on_success: false,
    notify_on_recovered: false,
    forward_output_on_success: false,
    output_mode: "stdout",
    max_lines: 100,
    max_chars: 4000,
    notify_when_empty_output: false,
    channels: "default",
    custom_channels: [],
    email_recipients: [],
  };
}
function NotificationFields({
  value,
  onChange,
  persistent = false,
}: {
  value: NotificationConfig;
  onChange: (value: NotificationConfig) => void;
  persistent?: boolean;
}) {
  const patch = (next: Partial<NotificationConfig>) =>
    onChange({ ...value, ...next });
  const failureThresholdId = useId();
  return (
    <div className="tn-python-module__notification">
      <div>
        <h3 className="tn-python-module__panel-title">通知策略</h3>
        <p className="tn-python-module__panel-subtitle">
          失败默认通知，成功通知和输出转发需要显式开启。
        </p>
      </div>
      <FieldSet>
        <FieldLegend variant="label">通知事件</FieldLegend>
        <FieldGroup className="tn-python-module__form-grid">
          <CheckboxField
            checked={value.notify_on_failure}
            onCheckedChange={(checked) => patch({ notify_on_failure: checked })}
          >
            失败时通知
          </CheckboxField>
          <CheckboxField
            checked={value.notify_on_success}
            onCheckedChange={(checked) => patch({ notify_on_success: checked })}
          >
            成功时通知
          </CheckboxField>
          <CheckboxField
            checked={value.notify_on_recovered}
            onCheckedChange={(checked) =>
              patch({ notify_on_recovered: checked })
            }
          >
            恢复成功时通知
          </CheckboxField>
          <CheckboxField
            checked={value.forward_output_on_success}
            onCheckedChange={(checked) =>
              patch({ forward_output_on_success: checked })
            }
          >
            {persistent ? "运行输出转发" : "成功输出转发"}
          </CheckboxField>
        </FieldGroup>
      </FieldSet>
      <FieldGroup className="tn-python-module__form-grid">
        <Field label="失败阈值">
          <div className="tn-python-module__threshold-control">
            <ShadcnField
              orientation="horizontal"
              className="tn-python-module__threshold-toggle"
            >
              <Checkbox
                id={failureThresholdId}
                checked={value.failure_threshold_enabled}
                onCheckedChange={(checked) =>
                  patch({ failure_threshold_enabled: Boolean(checked) })
                }
              />
              <ShadcnFieldLabel htmlFor={failureThresholdId}>
                启用
              </ShadcnFieldLabel>
            </ShadcnField>
            <Input
              aria-label="连续失败次数"
              className="tn-python-module__threshold-input"
              type="number"
              min={1}
              max={100}
              disabled={!value.failure_threshold_enabled}
              value={value.failure_threshold}
              onChange={(event) =>
                patch({
                  failure_threshold: Math.min(
                    100,
                    Math.max(1, Number(event.target.value) || 1),
                  ),
                })
              }
            />
          </div>
        </Field>
        <SelectField
          label="输出内容"
          value={value.output_mode}
          onValueChange={(next) =>
            patch({ output_mode: next as NotificationConfig["output_mode"] })
          }
          disabled={!value.forward_output_on_success}
          options={[
            { value: "summary", label: "摘要" },
            { value: "stdout", label: "标准输出" },
            { value: "stderr", label: "错误输出" },
            { value: "both", label: "标准输出和错误输出" },
          ]}
        />
        <SelectField
          label="通知通道"
          value={value.channels}
          onValueChange={(next) =>
            patch({ channels: next as NotificationConfig["channels"] })
          }
          options={[
            { value: "default", label: "平台默认" },
            { value: "custom", label: "自定义" },
          ]}
        />
        <MultiSelectField
          label="自定义通道"
          value={value.custom_channels}
          onValueChange={(custom_channels) => patch({ custom_channels })}
          disabled={value.channels !== "custom"}
          help="可多选平台支持的通知通道。"
          options={[
            { value: "web_internal", label: "站内通知" },
            { value: "qqbot", label: "QQBot" },
            { value: "email", label: "Email" },
            { value: "webhook", label: "Webhook" },
          ]}
        />
        <Field label="Email 收件人" help="逗号分隔，平台默认通道可不填">
          <Input
            value={value.email_recipients.join(", ")}
            onChange={(event) =>
              patch({
                email_recipients: event.target.value
                  .split(",")
                  .map((item) => item.trim())
                  .filter(Boolean),
              })
            }
          />
        </Field>
      </FieldGroup>
      <CheckboxField
        checked={value.notify_when_empty_output}
        onCheckedChange={(checked) =>
          patch({ notify_when_empty_output: checked })
        }
      >
        输出为空时也发送成功通知
      </CheckboxField>
    </div>
  );
}

interface QuickScheduleState {
  name: string;
  description: string;
  args: string;
  timeout: number;
  scheduleType: "cron" | "once";
  cron: string;
  runAt: string;
  enabled: boolean;
  notificationConfig: NotificationConfig;
}

function createQuickScheduleState(project: ProjectUpload): QuickScheduleState {
  return {
    name: `${project.name} 定时任务`,
    description: "",
    args: "",
    timeout: 60,
    scheduleType: "cron",
    cron: "0 * * * *",
    runAt: "",
    enabled: true,
    notificationConfig: defaultNotificationConfig(),
  };
}

function QuickScheduleDialog({
  open,
  onOpenChange,
  project,
  entryFile,
  environment,
  environmentLoading,
  security,
  securityLoading,
  fullCreateHref,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project: ProjectUpload;
  entryFile: string;
  environment: ProjectEnvironment | null | undefined;
  environmentLoading: boolean;
  security: SecurityScan | null | undefined;
  securityLoading: boolean;
  fullCreateHref: string;
}) {
  const [form, setForm] = useState(() => createQuickScheduleState(project));
  const [error, setError] = useState("");
  const [riskConfirmed, setRiskConfirmed] = useState(false);
  const [created, setCreated] = useState<ScheduledTask | null>(null);
  const [notificationOptionsOpen, setNotificationOptionsOpen] = useState(false);
  const create = useMutation({
    mutationFn: () => {
      const requiresConfirmation = ["medium", "high"].includes(
        security?.risk_level ?? "",
      );
      return createSchedule({
        name: form.name.trim(),
        description: form.description.trim(),
        source: {
          type: "archive",
          project_id: project.id,
          upload_id: project.id,
          entry_file: entryFile,
        },
        args: argsFromText(form.args),
        timeout_seconds: form.timeout,
        runtime_environment: "project_venv",
        schedule_type: form.scheduleType,
        cron_expression: form.scheduleType === "cron" ? form.cron.trim() : null,
        run_at:
          form.scheduleType === "once"
            ? new Date(form.runAt).toISOString()
            : null,
        timezone: "Asia/Shanghai",
        enabled: form.enabled,
        notification_config: form.notificationConfig,
        ...(requiresConfirmation && security
          ? {
              security: {
                risk_confirmed: riskConfirmed,
                scan_id: security.scan_id,
              },
            }
          : {}),
      });
    },
    onSuccess: (task) => {
      setCreated(task);
      runtime?.notify({ type: "success", content: "定时任务已创建。" });
    },
    onError: (nextError) => setError(errorMessage(nextError)),
  });
  useEffect(() => {
    if (!open) return;
    setForm(createQuickScheduleState(project));
    setError("");
    setRiskConfirmed(false);
    setCreated(null);
    setNotificationOptionsOpen(false);
  }, [entryFile, open, project]);
  const requiresConfirmation = ["medium", "high"].includes(
    security?.risk_level ?? "",
  );
  const environmentReady =
    environment?.status === "ready" && Boolean(environment.python_executable);
  const canSubmit =
    !environmentLoading &&
    !securityLoading &&
    environmentReady &&
    Boolean(security) &&
    security?.risk_level !== "blocked" &&
    (!requiresConfirmation || riskConfirmed);
  const submit = () => {
    setError("");
    if (!entryFile.endsWith(".py")) {
      setError("请选择有效的 .py 入口文件后再创建定时任务。");
      return;
    }
    if (!environmentReady) {
      setError("创建定时任务前，请先创建并准备项目虚拟环境。");
      return;
    }
    if (!security) {
      setError("正在读取安全扫描结果，请稍后再试。");
      return;
    }
    if (security.risk_level === "blocked") {
      setError("当前项目已被安全策略阻断，不能创建定时任务。");
      return;
    }
    if (!form.name.trim()) {
      setError("请填写任务名称。");
      return;
    }
    if (form.scheduleType === "cron" && !form.cron.trim()) {
      setError("Cron 任务必须填写 Cron 表达式。");
      return;
    }
    if (form.scheduleType === "once") {
      if (!form.runAt) {
        setError("一次性任务必须填写执行时间。");
        return;
      }
      if (Number.isNaN(new Date(form.runAt).getTime())) {
        setError("执行时间格式无效。");
        return;
      }
    }
    if (requiresConfirmation && !riskConfirmed) {
      setError("请确认当前安全扫描结果后再创建任务。");
      return;
    }
    create.mutate();
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="tn-python-module__dialog tn-python-module__dialog--schedule max-h-[min(90dvh,38rem)] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>创建定时任务</DialogTitle>
          <DialogDescription>
            基于当前项目入口快速创建；需要更多调度规则时可前往完整创建页。
          </DialogDescription>
        </DialogHeader>
        <div className="tn-python-module__detail-list">
          <div className="tn-python-module__detail-row">
            <span>项目</span>
            <strong>{project.name}</strong>
          </div>
          <div className="tn-python-module__detail-row">
            <span>入口文件</span>
            <strong>{entryFile || "未选择"}</strong>
          </div>
        </div>
        {created ? (
          <Alert>
            <CheckCircle2 aria-hidden="true" />
            <div>
              <AlertTitle>定时任务已创建</AlertTitle>
              <AlertDescription>
                {created.name}{" "}
                已按当前入口保存，可以继续留在项目详情或查看任务。
              </AlertDescription>
            </div>
          </Alert>
        ) : (
          <div className="tn-python-module__form tn-python-module__quick-schedule-form">
            {environmentLoading || securityLoading ? (
              <LoadingState text="正在检查项目环境和安全状态…" />
            ) : null}
            {!environmentLoading && !environmentReady ? (
              <Alert variant="warning">
                <AlertTriangle aria-hidden="true" />
                <AlertDescription>
                  请先在项目详情中创建并准备项目虚拟环境。
                </AlertDescription>
              </Alert>
            ) : null}
            {!securityLoading && !security ? (
              <Alert variant="destructive">
                <AlertTriangle aria-hidden="true" />
                <AlertDescription>
                  当前没有可用的安全扫描结果，请先在安全扫描卡片中重新扫描项目。
                </AlertDescription>
              </Alert>
            ) : null}
            <FieldGroup className="tn-python-module__form-grid">
              <Field label="任务名称">
                <Input
                  value={form.name}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      name: event.target.value,
                    }))
                  }
                  placeholder="请输入任务名称"
                />
              </Field>
              <Field label="超时时间（秒）">
                <Input
                  type="number"
                  min={1}
                  max={600}
                  value={form.timeout}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      timeout: Math.min(
                        600,
                        Math.max(1, Number(event.target.value) || 1),
                      ),
                    }))
                  }
                />
              </Field>
            </FieldGroup>
            <FieldGroup className="tn-python-module__form-grid">
              <Field label="描述">
                <Textarea
                  className="tn-python-module__code--compact"
                  value={form.description}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      description: event.target.value,
                    }))
                  }
                  placeholder="可选"
                />
              </Field>
              <Field label="命令行参数" help="每行或按空格填写参数。">
                <Textarea
                  className="tn-python-module__code--compact"
                  value={form.args}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      args: event.target.value,
                    }))
                  }
                  placeholder="--date\n2026-08-31"
                />
              </Field>
            </FieldGroup>
            <FieldGroup className="tn-python-module__form-grid">
              <SelectField
                label="调度类型"
                value={form.scheduleType}
                onValueChange={(value) =>
                  setForm((current) => ({
                    ...current,
                    scheduleType: value as QuickScheduleState["scheduleType"],
                  }))
                }
                options={[
                  { value: "cron", label: "Cron" },
                  { value: "once", label: "一次性" },
                ]}
              />
              <Field
                label={
                  form.scheduleType === "cron" ? "Cron 表达式" : "执行时间"
                }
              >
                <Input
                  type={
                    form.scheduleType === "once" ? "datetime-local" : "text"
                  }
                  value={form.scheduleType === "cron" ? form.cron : form.runAt}
                  onChange={(event) =>
                    setForm((current) =>
                      current.scheduleType === "cron"
                        ? { ...current, cron: event.target.value }
                        : { ...current, runAt: event.target.value },
                    )
                  }
                  placeholder={
                    form.scheduleType === "cron" ? "0 * * * *" : undefined
                  }
                />
              </Field>
            </FieldGroup>
            <SwitchField
              checked={form.enabled}
              onCheckedChange={(enabled) =>
                setForm((current) => ({ ...current, enabled }))
              }
            >
              创建后立即启用
            </SwitchField>
            {security ? (
              <SecurityConfirmation
                scan={security}
                checked={riskConfirmed}
                onChange={setRiskConfirmed}
              />
            ) : null}
            <Collapsible
              open={notificationOptionsOpen}
              onOpenChange={setNotificationOptionsOpen}
            >
              <div className="tn-python-module__collapsible-summary">
                <div className="tn-python-module__collapsible-summary-copy">
                  <strong>通知策略</strong>
                  <span className="tn-python-module__muted">
                    默认仅在任务失败时通知；成功通知和输出转发可展开配置。
                  </span>
                </div>
                <CollapsibleTrigger
                  render={
                    <Button variant="outline" size="sm">
                      {notificationOptionsOpen ? "收起配置" : "展开配置"}
                    </Button>
                  }
                />
              </div>
              <CollapsibleContent>
                <NotificationFields
                  value={form.notificationConfig}
                  onChange={(notificationConfig) =>
                    setForm((current) => ({ ...current, notificationConfig }))
                  }
                />
              </CollapsibleContent>
            </Collapsible>
            {error ? (
              <Alert variant="destructive">
                <AlertTriangle aria-hidden="true" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}
          </div>
        )}
        <DialogFooter>
          {created ? (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                留在项目详情
              </Button>
              <ActionLinkButton href={`${moduleBase}/schedules/${created.id}`}>
                查看任务 <ArrowRight aria-hidden="true" />
              </ActionLinkButton>
            </>
          ) : (
            <>
              <ActionLinkButton href={fullCreateHref} variant="ghost">
                需要更多配置？
              </ActionLinkButton>
              <Button
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={create.isPending}
              >
                取消
              </Button>
              <BusyButton
                pending={create.isPending}
                disabled={!canSubmit}
                onClick={submit}
              >
                创建任务
              </BusyButton>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface ScheduleFormState {
  id?: string;
  name: string;
  description: string;
  sourceType: "inline" | "archive";
  code: string;
  projectId: string;
  entryFile: string;
  args: string;
  timeout: number;
  schedulePlan: SchedulePlan;
  scheduleType: "cron" | "once";
  cron: string;
  runAt: string;
  dailyTime: string;
  weeklyDays: number[];
  weeklyTime: string;
  monthlyDay: number;
  monthlyTime: string;
  intervalValue: number;
  intervalUnit: "minute" | "hour";
  advancedCron: string;
  timezone: string;
  enabled: boolean;
  riskConfirmed: boolean;
  securityScanId?: string;
  notificationConfig: NotificationConfig;
}

type SchedulePlan =
  "daily" | "weekly" | "monthly" | "interval" | "advanced" | "once";

const schedulePlanOptions = [
  { value: "daily", label: "每天" },
  { value: "weekly", label: "每周" },
  { value: "monthly", label: "每月" },
  { value: "interval", label: "间隔执行" },
  { value: "advanced", label: "高级 Cron" },
  { value: "once", label: "一次性" },
];
const weekDayOptions = [
  { value: 1, label: "周一" },
  { value: 2, label: "周二" },
  { value: 3, label: "周三" },
  { value: 4, label: "周四" },
  { value: 5, label: "周五" },
  { value: 6, label: "周六" },
  { value: 0, label: "周日" },
];
const intervalUnitOptions = [
  { value: "minute", label: "分钟" },
  { value: "hour", label: "小时" },
];

function parseClock(value: string) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

function clockValue(hour: string | number, minute: string | number) {
  return `${Number(hour).toString().padStart(2, "0")}:${Number(minute)
    .toString()
    .padStart(2, "0")}`;
}

function cronFromSchedulePlan(form: ScheduleFormState) {
  if (form.schedulePlan === "daily") {
    const time = parseClock(form.dailyTime);
    return time ? `${time.minute} ${time.hour} * * *` : "";
  }
  if (form.schedulePlan === "weekly") {
    const time = parseClock(form.weeklyTime);
    const days = [...form.weeklyDays].sort((a, b) => a - b).join(",");
    return time && days ? `${time.minute} ${time.hour} * * ${days}` : "";
  }
  if (form.schedulePlan === "monthly") {
    const time = parseClock(form.monthlyTime);
    return time
      ? `${time.minute} ${time.hour} ${Math.min(31, Math.max(1, form.monthlyDay))} * *`
      : "";
  }
  if (form.schedulePlan === "interval") {
    const value = Math.max(1, Math.floor(form.intervalValue || 1));
    return form.intervalUnit === "hour"
      ? `0 */${value} * * *`
      : `*/${value} * * * *`;
  }
  return form.advancedCron.trim();
}

function schedulePreviewText(form: ScheduleFormState) {
  if (form.schedulePlan === "daily")
    return `每天 ${form.dailyTime || "待填写"}`;
  if (form.schedulePlan === "weekly") {
    const days = [...form.weeklyDays]
      .sort((left, right) => left - right)
      .map(
        (value) =>
          weekDayOptions.find((option) => option.value === value)?.label ??
          `星期${value}`,
      )
      .join("、");
    return `每周 ${days || "待选择"} ${form.weeklyTime || "待填写"}`;
  }
  if (form.schedulePlan === "monthly") {
    return `每月 ${Math.min(31, Math.max(1, form.monthlyDay))} 日 ${form.monthlyTime || "待填写"}`;
  }
  if (form.schedulePlan === "interval") {
    const unit = form.intervalUnit === "hour" ? "小时" : "分钟";
    return `每 ${Math.max(1, Math.floor(form.intervalValue || 1))} ${unit}`;
  }
  if (form.schedulePlan === "advanced") {
    return `高级 Cron · ${form.advancedCron.trim() || "待填写"}`;
  }
  return `一次性 · ${form.runAt || "待填写"}`;
}

function localDateTimeValue(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (item: number) => String(item).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate(),
  )}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function inferSchedulePlan(
  scheduleType: string,
  cron: string | null,
  runAt: string | null,
): Pick<
  ScheduleFormState,
  | "schedulePlan"
  | "scheduleType"
  | "cron"
  | "runAt"
  | "dailyTime"
  | "weeklyDays"
  | "weeklyTime"
  | "monthlyDay"
  | "monthlyTime"
  | "intervalValue"
  | "intervalUnit"
  | "advancedCron"
> {
  const fallback = {
    schedulePlan: "advanced" as const,
    scheduleType:
      scheduleType === "once" ? ("once" as const) : ("cron" as const),
    cron: cron ?? "0 * * * *",
    runAt: localDateTimeValue(runAt),
    dailyTime: "09:00",
    weeklyDays: [1],
    weeklyTime: "09:00",
    monthlyDay: 1,
    monthlyTime: "09:00",
    intervalValue: 30,
    intervalUnit: "minute" as const,
    advancedCron: cron ?? "0 * * * *",
  };
  if (scheduleType === "once")
    return { ...fallback, schedulePlan: "once", scheduleType: "once" };
  const expression = cron?.trim() || "0 * * * *";
  const parts = expression.split(/\s+/);
  if (parts.length !== 5) return fallback;
  const minute = parts[0] ?? "";
  const hour = parts[1] ?? "";
  const dayOfMonth = parts[2] ?? "";
  const month = parts[3] ?? "";
  const dayOfWeek = parts[4] ?? "";
  if (
    /^\d+$/.test(minute) &&
    /^\d+$/.test(hour) &&
    dayOfMonth === "*" &&
    month === "*" &&
    dayOfWeek === "*"
  )
    return {
      ...fallback,
      schedulePlan: "daily",
      dailyTime: clockValue(hour, minute),
    };
  if (
    /^\d+$/.test(minute) &&
    /^\d+$/.test(hour) &&
    dayOfMonth === "*" &&
    month === "*" &&
    /^[\d,]+$/.test(dayOfWeek)
  )
    return {
      ...fallback,
      schedulePlan: "weekly",
      weeklyTime: clockValue(hour, minute),
      weeklyDays: dayOfWeek
        .split(",")
        .map(Number)
        .filter((value) => value >= 0 && value <= 6),
    };
  if (
    /^\d+$/.test(minute) &&
    /^\d+$/.test(hour) &&
    /^\d+$/.test(dayOfMonth) &&
    month === "*" &&
    dayOfWeek === "*"
  )
    return {
      ...fallback,
      schedulePlan: "monthly",
      monthlyDay: Math.min(31, Math.max(1, Number(dayOfMonth))),
      monthlyTime: clockValue(hour, minute),
    };
  if (
    /^\*\/\d+$/.test(minute) &&
    hour === "*" &&
    dayOfMonth === "*" &&
    month === "*" &&
    dayOfWeek === "*"
  )
    return {
      ...fallback,
      schedulePlan: "interval",
      intervalUnit: "minute",
      intervalValue: Number(minute.slice(2)),
    };
  if (
    minute === "0" &&
    /^\*\/\d+$/.test(hour) &&
    dayOfMonth === "*" &&
    month === "*" &&
    dayOfWeek === "*"
  )
    return {
      ...fallback,
      schedulePlan: "interval",
      intervalUnit: "hour",
      intervalValue: Number(hour.slice(2)),
    };
  return fallback;
}

const emptyScheduleForm = (): ScheduleFormState => ({
  name: "新定时任务",
  description: "",
  sourceType: "inline",
  code: 'print("scheduled")',
  projectId: "",
  entryFile: "",
  args: "",
  timeout: 30,
  schedulePlan: "daily",
  scheduleType: "cron",
  cron: "0 9 * * *",
  runAt: "",
  dailyTime: "09:00",
  weeklyDays: [1],
  weeklyTime: "09:00",
  monthlyDay: 1,
  monthlyTime: "09:00",
  intervalValue: 30,
  intervalUnit: "minute",
  advancedCron: "0 * * * *",
  timezone: "Asia/Shanghai",
  enabled: true,
  riskConfirmed: false,
  notificationConfig: defaultNotificationConfig(),
});
function schedulePayload(form: ScheduleFormState) {
  const source: ExecutionSource =
    form.sourceType === "inline"
      ? { type: "inline", code: form.code }
      : {
          type: "archive",
          project_id: form.projectId,
          upload_id: form.projectId,
          entry_file: form.entryFile,
        };
  const scheduleType = form.schedulePlan === "once" ? "once" : "cron";
  const cron = cronFromSchedulePlan(form);
  return {
    name: form.name,
    description: form.description,
    source,
    args: argsFromText(form.args),
    timeout_seconds: form.timeout,
    schedule_type: scheduleType,
    cron_expression: scheduleType === "cron" ? cron : null,
    run_at:
      scheduleType === "once" && form.runAt
        ? new Date(form.runAt).toISOString()
        : null,
    timezone: form.timezone,
    enabled: form.enabled,
    notification_config: form.notificationConfig,
    ...(form.riskConfirmed && form.securityScanId
      ? { security: { risk_confirmed: true, scan_id: form.securityScanId } }
      : {}),
  };
}

function validateScheduleForm(form: ScheduleFormState) {
  if (!form.name.trim()) return "请填写任务名称";
  if (form.sourceType === "inline" && !form.code.trim())
    return "请填写 Python 代码";
  if (form.sourceType === "archive") {
    if (!form.projectId) return "请选择已上传项目";
    if (!form.entryFile.endsWith(".py")) return "请选择 .py 入口文件";
  }
  if (form.schedulePlan === "weekly" && !form.weeklyDays.length)
    return "每周计划至少选择一天";
  if (form.schedulePlan === "once") {
    if (!form.runAt) return "一次性计划必须填写执行时间";
    if (Number.isNaN(new Date(form.runAt).getTime())) return "执行时间格式无效";
  } else if (!cronFromSchedulePlan(form)) {
    return form.schedulePlan === "advanced"
      ? "请填写有效的 Cron 表达式"
      : "请填写有效的执行时间或计划参数";
  }
  return "";
}

function ScheduleTable({
  items,
  onDetail,
  onEdit,
  onToggle,
  onRun,
  onDelete,
  pending,
}: {
  items: ScheduledTask[];
  onDetail: (task: ScheduledTask) => void;
  onEdit: (task: ScheduledTask) => void;
  onToggle: (task: ScheduledTask) => void;
  onRun: (task: ScheduledTask) => void;
  onDelete: (task: ScheduledTask) => void;
  pending: string | undefined;
}) {
  if (!items.length) return <EmptyState text="还没有定时任务。" />;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead style={{ width: "20%" }}>任务</TableHead>
          <TableHead style={{ width: "18%" }}>计划</TableHead>
          <TableHead style={{ width: "17%" }}>下次运行</TableHead>
          <TableHead style={{ width: "13%" }}>状态</TableHead>
          <TableHead style={{ width: "17%" }}>最近执行</TableHead>
          <TableHead
            className="tn-python-module__right"
            style={{ width: "15%" }}
          >
            操作
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((task) => (
          <TableRow key={task.id}>
            <TableCell>
              <InternalLink
                href={`${moduleBase}/schedules/${task.id}`}
                className="tn-python-module__list-title"
              >
                {task.name}
              </InternalLink>
              <div className="tn-python-module__table-subtitle">
                {task.source_type === "archive" ? "项目入口" : "内联代码"}
              </div>
            </TableCell>
            <TableCell>
              {task.schedule_type === "cron"
                ? task.cron_expression || "Cron 计划"
                : formatTime(task.run_at)}
              <div className="tn-python-module__table-subtitle">
                {task.timezone}
              </div>
            </TableCell>
            <TableCell className="tn-python-module__nowrap">
              {formatTime(task.next_run_at)}
            </TableCell>
            <TableCell>
              <StatusBadge
                value={
                  task.last_status ?? (task.enabled ? "enabled" : "disabled")
                }
              />
            </TableCell>
            <TableCell className="tn-python-module__center">
              {task.last_run_at
                ? formatShortTime(task.last_run_at)
                : "尚未执行"}
            </TableCell>
            <TableCell>
              <div className="tn-python-module__table-actions">
                <BusyButton
                  variant="outline"
                  size="sm"
                  pending={pending === `${task.id}:toggle`}
                  onClick={() => onToggle(task)}
                >
                  {task.enabled ? "停用" : "启用"}
                </BusyButton>
                <TableActionMenu
                  items={[
                    {
                      key: "run",
                      label: "立即运行",
                      disabled: Boolean(pending),
                    },
                    { key: "detail", label: "查看详情" },
                    { key: "edit", label: "编辑" },
                    { key: "delete", label: "删除任务", destructive: true },
                  ]}
                  onClick={(key) => {
                    if (key === "run") onRun(task);
                    if (key === "detail") onDetail(task);
                    if (key === "edit") onEdit(task);
                    if (key === "delete") onDelete(task);
                  }}
                />
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function ScheduleDetailPage({ scheduleId }: { scheduleId: string }) {
  const task = useQuery({
    queryKey: ["python-runner", "schedule-detail", scheduleId],
    queryFn: () => getSchedule(scheduleId),
  });
  const executions = useQuery({
    queryKey: ["python-runner", "schedule-detail-executions", scheduleId],
    queryFn: listExecutions,
    refetchInterval: (query) => query.state.data?.some((item) => item.status === "running") ? 5_000 : 60_000,
    refetchIntervalInBackground: false,
  });
  const projectId = sourceProjectId(
    task.data?.source.type === "archive" ? task.data.source : undefined,
  );
  const project = useQuery({
    queryKey: ["python-runner", "schedule-detail-project", projectId],
    queryFn: () => getUpload(projectId),
    enabled: Boolean(projectId),
  });
  const [recentPage, setRecentPage] = useState(1);
  const recentPageSize = 8;
  const recentExecutions = (executions.data ?? []).filter(
    (execution) => execution.trigger_id === scheduleId,
  );
  const recentPageCount = Math.max(
    1,
    Math.ceil(recentExecutions.length / recentPageSize),
  );
  const visibleRecentExecutions = recentExecutions.slice(
    (recentPage - 1) * recentPageSize,
    recentPage * recentPageSize,
  );
  useEffect(() => {
    setRecentPage((current) => Math.min(current, recentPageCount));
  }, [recentPageCount]);
  const toggle = useMutation({
    mutationFn: () => toggleSchedule(scheduleId, !task.data?.enabled),
    onSuccess: () => void task.refetch(),
    onError: (error) =>
      runtime?.notify({ type: "error", content: errorMessage(error) }),
  });
  const run = useMutation({
    mutationFn: () => runSchedule(scheduleId),
    onSuccess: () => {
      void task.refetch();
      void executions.refetch();
    },
    onError: (error) =>
      runtime?.notify({ type: "error", content: errorMessage(error) }),
  });
  if (task.isPending)
    return (
      <ModuleShell title="定时任务详情" description="查看任务配置和运行记录。">
        <LoadingState text="正在读取定时任务详情…" />
      </ModuleShell>
    );
  if (task.isError)
    return (
      <ModuleShell title="定时任务详情" description="查看任务配置和运行记录。">
        <PageError error={task.error} onRetry={() => void task.refetch()} />
      </ModuleShell>
    );
  const item = task.data;
  const source = item.source;
  const notification = item.notification_config ?? defaultNotificationConfig();
  return (
    <ModuleShell
      title={item.name}
      description={item.description || "查看任务配置和运行记录。"}
    >
      <div className="tn-python-module__page-toolbar">
        <ButtonGroup>
          <ActionLinkButton href={`${moduleBase}/schedules`}>
            <ArrowLeft aria-hidden="true" />
            返回定时任务
          </ActionLinkButton>
          <ActionLinkButton href={`${moduleBase}/schedules/${item.id}/edit`}>
            <Settings2 aria-hidden="true" />
            编辑
          </ActionLinkButton>
          <BusyButton
            variant="outline"
            pending={toggle.isPending}
            onClick={() => toggle.mutate()}
          >
            {item.enabled ? "停用" : "启用"}
          </BusyButton>
          <BusyButton pending={run.isPending} onClick={() => run.mutate()}>
            <Play aria-hidden="true" />
            立即运行
          </BusyButton>
        </ButtonGroup>
      </div>
      <div className="tn-python-module__detail-grid">
        <Card>
          <CardHeader>
            <CardTitle>基本信息</CardTitle>
          </CardHeader>
          <CardContent>
            <DetailRows
              rows={[
                ["状态", <StatusBadge value={item.status} key="status" />],
                [
                  "执行来源",
                  source.type === "archive" ? "已上传项目" : "内联代码",
                ],
                ["创建时间", formatTime(item.created_at)],
                ["更新时间", formatTime(item.updated_at)],
              ]}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>调度配置</CardTitle>
          </CardHeader>
          <CardContent>
            <DetailRows
              rows={[
                [
                  "调度类型",
                  item.schedule_type === "cron" ? "Cron 调度" : "一次性执行",
                ],
                ["Cron 表达式", item.cron_expression ?? "—"],
                ["执行时间", formatTime(item.run_at)],
                ["时区", item.timezone],
                ["下次运行", formatTime(item.next_run_at)],
              ]}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>执行统计</CardTitle>
          </CardHeader>
          <CardContent>
            <DetailRows
              rows={[
                ["总执行次数", item.total_runs],
                ["成功次数", item.success_runs],
                ["失败次数", item.failed_runs],
                [
                  "成功率",
                  `${item.total_runs ? Math.round((item.success_runs / item.total_runs) * 100) : 0}%`,
                ],
                [
                  "最近结果",
                  item.last_status ? statusText(item.last_status) : "尚未执行",
                ],
              ]}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>运行配置</CardTitle>
          </CardHeader>
          <CardContent>
            <DetailRows
              rows={[
                [
                  "入口文件",
                  source.type === "archive"
                    ? source.entry_file || "自动选择"
                    : "内联代码",
                ],
                ["命令行参数", item.args.length ? item.args.join(" ") : "无"],
                ["超时时间", `${item.timeout_seconds} 秒`],
                ["上次执行", formatTime(item.last_run_at)],
              ]}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>通知配置</CardTitle>
          </CardHeader>
          <CardContent>
            <DetailRows
              rows={[
                ["触发通知", notificationTriggersText(notification)],
                ["通知通道", notificationChannelsText(notification)],
                ["成功输出", notificationOutputText(notification)],
                [
                  "连续失败阈值",
                  notification.failure_threshold_enabled
                    ? `${notification.failure_threshold} 次`
                    : "未启用",
                ],
                [
                  "空输出通知",
                  notification.notify_when_empty_output ? "已开启" : "未开启",
                ],
              ]}
            />
          </CardContent>
        </Card>
      </div>
      {source.type === "inline" ? (
        <Card>
          <CardHeader>
            <CardTitle>Python 代码</CardTitle>
          </CardHeader>
          <CardContent>
            <PythonCodeEditor value={source.code || "暂无代码。"} readOnly />
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <div>
              <CardTitle>项目来源</CardTitle>
              <CardDescription>
                {project.data?.name ?? "项目包"} ·{" "}
                {source.entry_file || "自动选择"}
              </CardDescription>
            </div>
            <CardAction>
              {projectId ? (
                <ActionLinkButton
                  href={`${moduleBase}/projects/${encodeURIComponent(projectId)}`}
                >
                  查看项目
                  <ArrowRight aria-hidden="true" />
                </ActionLinkButton>
              ) : null}
            </CardAction>
          </CardHeader>
          <CardContent>
            {project.isPending ? (
              <LoadingState text="正在读取项目来源…" />
            ) : project.isError ? (
              <ErrorState error={project.error} title="项目来源读取失败" />
            ) : project.data ? (
              <>
                <DetailRows
                  rows={[
                    ["原始文件名", project.data.filename],
                    ["上传来源", uploadSourceText(project.data.upload_source)],
                    ["入口文件", source.entry_file || "自动选择"],
                    ["文件数量", project.data.file_count],
                    ["项目大小", formatBytes(project.data.total_size)],
                    [
                      "依赖文件",
                      project.data.dependency_files.length
                        ? project.data.dependency_files.map((file) => (
                            <Badge variant="outline" key={file}>
                              {file}
                            </Badge>
                          ))
                        : "无",
                    ],
                  ]}
                />
                <FileTree
                  nodes={project.data.file_tree}
                  selected={source.entry_file ?? ""}
                  onSelect={() => undefined}
                />
              </>
            ) : (
              <EmptyState text="关联项目不存在。" />
            )}
          </CardContent>
        </Card>
      )}
      <Card>
        <CardHeader>
          <div>
            <CardTitle>最近执行记录</CardTitle>
            <CardDescription>
              展示该定时任务最近触发的执行结果。
            </CardDescription>
          </div>
          <CardAction>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void executions.refetch()}
            >
              <RefreshCw aria-hidden="true" />
              刷新
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent>
          {recentExecutions.length ? (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead style={{ width: "28%" }}>执行</TableHead>
                    <TableHead
                      className="tn-python-module__center"
                      style={{ width: "20%" }}
                    >
                      结果
                    </TableHead>
                    <TableHead
                      className="tn-python-module__center"
                      style={{ width: "26%" }}
                    >
                      开始时间
                    </TableHead>
                    <TableHead
                      className="tn-python-module__center"
                      style={{ width: "14%" }}
                    >
                      耗时
                    </TableHead>
                    <TableHead
                      className="tn-python-module__right"
                      style={{ width: "12%" }}
                    >
                      操作
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleRecentExecutions.map((execution) => (
                    <TableRow key={execution.id}>
                      <TableCell>{execution.name}</TableCell>
                      <TableCell className="tn-python-module__center">
                        <StatusBadge value={execution.status} />
                      </TableCell>
                      <TableCell className="tn-python-module__center tn-python-module__nowrap">
                        {formatTime(
                          execution.started_at ?? execution.created_at,
                        )}
                      </TableCell>
                      <TableCell className="tn-python-module__center">
                        {formatDuration(execution.duration_ms)}
                      </TableCell>
                      <TableCell className="tn-python-module__right">
                        <ActionLinkButton
                          href={`${moduleBase}/executions/${execution.id}`}
                        >
                          查看
                        </ActionLinkButton>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <PaginationControls
                page={recentPage}
                pageCount={recentPageCount}
                summary={
                  <>
                    共 {recentExecutions.length} 条 · 第 {recentPage} 页
                  </>
                }
                onPageChange={setRecentPage}
              />
            </>
          ) : (
            <EmptyState text="暂无执行记录。" />
          )}
        </CardContent>
      </Card>
    </ModuleShell>
  );
}

function SchedulesPage({
  initialScheduleId,
  initialProjectId,
  initialEntryFile,
}: {
  initialScheduleId?: string | undefined;
  initialProjectId?: string | undefined;
  initialEntryFile?: string | undefined;
}) {
  const [page, setPage] = useState(1);
  const pageSize = 20;
  const [keyword, setKeyword] = useState("");
  const [status, setStatus] = useState("all");
  const query = useQuery({
    queryKey: ["python-runner", "schedules", keyword, status, page],
    queryFn: () =>
      listSchedules({
        keyword: keyword.trim() || undefined,
        status: status === "all" ? undefined : status,
        page,
        page_size: pageSize,
      }),
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    placeholderData: (previous) => previous,
  });
  const scheduleDetail = useQuery({
    queryKey: ["python-runner", "schedule", initialScheduleId],
    queryFn: () => getSchedule(initialScheduleId ?? ""),
    enabled: Boolean(initialScheduleId),
  });
  const projects = useQuery({
    queryKey: ["python-runner", "uploads"],
    queryFn: listUploads,
    staleTime: 10_000,
  });
  const [form, setForm] = useState<ScheduleFormState>(() => ({
    ...emptyScheduleForm(),
    ...(initialProjectId
      ? {
          sourceType: "archive" as const,
          projectId: initialProjectId,
          entryFile: initialEntryFile ?? "",
        }
      : {}),
  }));
  const [security, setSecurity] = useState<SecurityScan | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ScheduledTask | null>(null);
  const [pending, setPending] = useState<string>();
  const [validationError, setValidationError] = useState("");
  const changeSourceType = (sourceType: "inline" | "archive") => {
    setSecurity(null);
    setValidationError("");
    setForm((current) => ({
      ...current,
      sourceType,
      riskConfirmed: false,
      securityScanId: "",
    }));
  };
  const projectSecurity = useQuery({
    queryKey: ["python-runner", "schedule-security", form.projectId],
    queryFn: () => getSecurity(form.projectId),
    enabled: form.sourceType === "archive" && Boolean(form.projectId),
    staleTime: 5_000,
  });
  const projectEnvironment = useQuery({
    queryKey: ["python-runner", "schedule-environment", form.projectId],
    queryFn: () => getEnvironment(form.projectId),
    enabled: form.sourceType === "archive" && Boolean(form.projectId),
    staleTime: 5_000,
  });
  const activeSecurity = security ?? projectSecurity.data ?? null;
  const securityBlocked = activeSecurity?.risk_level === "blocked";
  const archiveEnvironmentReady =
    form.sourceType !== "archive" ||
    (projectEnvironment.data?.status === "ready" &&
      Boolean(projectEnvironment.data.python_executable));
  useEffect(() => {
    setPage(1);
  }, [keyword, status]);
  const save = useMutation({
    mutationFn: () =>
      form.id
        ? updateSchedule(form.id, schedulePayload(form))
        : createSchedule(schedulePayload(form)),
    onSuccess: (saved) => {
      setForm(emptyScheduleForm());
      setSecurity(null);
      setValidationError("");
      void query.refetch();
      runtime?.notify({ type: "success", content: "定时任务已保存。" });
      runtime?.router.push(`${moduleBase}/schedules/${saved.id}`);
    },
    onError: (error) => {
      const next = extractSecurity(error);
      if (next) {
        setSecurity(next);
        setForm((current) => ({
          ...current,
          riskConfirmed: false,
          securityScanId: next.scan_id,
        }));
      }
    },
  });
  const toggle = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      toggleSchedule(id, enabled),
    onSuccess: () => {
      setPending(undefined);
      void query.refetch();
    },
    onError: (error) => {
      setPending(undefined);
      runtime?.notify({ type: "error", content: errorMessage(error) });
    },
  });
  const run = useMutation({
    mutationFn: runSchedule,
    onSuccess: () => {
      setPending(undefined);
      void query.refetch();
    },
    onError: (error) => {
      setPending(undefined);
      runtime?.notify({ type: "error", content: errorMessage(error) });
    },
  });
  const remove = useMutation({
    mutationFn: deleteSchedule,
    onSuccess: () => {
      setDeleteTarget(null);
      void query.refetch();
    },
  });
  const edit = (task: ScheduledTask) => {
    const source = task.source;
    const scheduleDetails = inferSchedulePlan(
      task.schedule_type,
      task.cron_expression,
      task.run_at,
    );
    setForm({
      id: task.id,
      name: task.name,
      description: task.description,
      sourceType: source.type,
      code: source.type === "inline" ? (source.code ?? "") : "",
      projectId:
        source.type === "archive"
          ? (source.project_id ?? source.upload_id ?? "")
          : "",
      entryFile: source.type === "archive" ? (source.entry_file ?? "") : "",
      args: textFromArgs(task.args),
      timeout: task.timeout_seconds,
      ...scheduleDetails,
      timezone: task.timezone,
      enabled: task.enabled,
      riskConfirmed: false,
      notificationConfig:
        task.notification_config ?? defaultNotificationConfig(),
    });
    setSecurity(null);
  };
  const appliedScheduleId = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!initialScheduleId || appliedScheduleId.current === initialScheduleId)
      return;
    const task =
      scheduleDetail.data ??
      query.data?.items.find((item) => item.id === initialScheduleId);
    if (!task) return;
    appliedScheduleId.current = initialScheduleId;
    edit(task);
  }, [initialScheduleId, query.data?.items, scheduleDetail.data]);
  const items = query.data?.items ?? [];
  const total = query.data?.total ?? 0;
  const canGoPrevious = page > 1;
  const canGoNext = page * (query.data?.page_size ?? pageSize) < total;
  const selectedProject = projects.data?.find(
    (item) => item.id === form.projectId,
  );
  const currentPath =
    typeof window === "undefined" ? "" : window.location.pathname;
  const isEditor =
    Boolean(initialScheduleId) ||
    currentPath.endsWith(`${moduleBase}/schedules/create`) ||
    currentPath.endsWith("/edit");
  useEffect(() => {
    if (
      initialProjectId &&
      !form.id &&
      form.sourceType === "archive" &&
      form.projectId === initialProjectId &&
      !form.entryFile &&
      projectEntryFiles(selectedProject)[0]
    ) {
      setForm((current) => ({
        ...current,
        entryFile: projectEntryFiles(selectedProject)[0] ?? "",
      }));
    }
  }, [
    form.entryFile,
    form.id,
    form.projectId,
    form.sourceType,
    initialProjectId,
    selectedProject,
  ]);
  if (query.isPending)
    return (
      <ModuleShell
        title="定时任务"
        description="按 Cron 或一次性时间运行 Python。"
      >
        <LoadingState text="正在读取定时任务…" />
      </ModuleShell>
    );
  if (query.isError)
    return (
      <ModuleShell
        title="定时任务"
        description="按 Cron 或一次性时间运行 Python。"
      >
        <PageError error={query.error} onRetry={() => void query.refetch()} />
      </ModuleShell>
    );
  if (initialScheduleId && scheduleDetail.isError)
    return (
      <ModuleShell
        title="定时任务"
        description="按 Cron 或一次性时间运行 Python。"
      >
        <PageError
          error={scheduleDetail.error}
          title="定时任务详情读取失败"
          onRetry={() => void scheduleDetail.refetch()}
        />
      </ModuleShell>
    );
  return (
    <ModuleShell
      title="定时任务"
      description="按 Cron 或一次性时间运行 Python。"
    >
      {isEditor ? (
        <Card>
          <CardHeader>
            <div>
              <CardTitle>{form.id ? "编辑定时任务" : "创建定时任务"}</CardTitle>
              <CardDescription>
                配置代码来源、计划、运行参数和通知策略。
              </CardDescription>
            </div>
            <CardAction>
              <ActionLinkButton href={`${moduleBase}/schedules`}>
                <ArrowLeft aria-hidden="true" />
                返回任务列表
              </ActionLinkButton>
            </CardAction>
          </CardHeader>
          <CardContent className="tn-python-module__form">
            <FieldGroup className="tn-python-module__form-grid">
              <Field label="任务名称">
                <Input
                  value={form.name}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      name: event.target.value,
                    }))
                  }
                />
              </Field>
              <SwitchField
                checked={form.enabled}
                onCheckedChange={(enabled) =>
                  setForm((current) => ({ ...current, enabled }))
                }
              >
                创建后启用
              </SwitchField>
            </FieldGroup>
            <Field label="描述">
              <Textarea
                className="tn-python-module__code--compact"
                value={form.description}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    description: event.target.value,
                  }))
                }
                placeholder="可选"
              />
            </Field>
            <Field label="执行来源">
              <ButtonGroup aria-label="执行来源">
                <Button
                  type="button"
                  variant={
                    form.sourceType === "inline" ? "default" : "outline"
                  }
                  aria-pressed={form.sourceType === "inline"}
                  onClick={() => changeSourceType("inline")}
                >
                  内联代码
                </Button>
                <Button
                  type="button"
                  variant={
                    form.sourceType === "archive" ? "default" : "outline"
                  }
                  aria-pressed={form.sourceType === "archive"}
                  onClick={() => changeSourceType("archive")}
                >
                  已上传项目
                </Button>
              </ButtonGroup>
            </Field>
            {form.sourceType === "inline" ? (
              <>
                <Alert>
                  <Terminal aria-hidden="true" />
                  <div>
                    <AlertTitle>系统 Python</AlertTitle>
                    <AlertDescription>
                      在线代码不绑定项目依赖，定时运行时使用系统 Python。
                    </AlertDescription>
                  </div>
                </Alert>
                <Field label="Python 代码">
                  <PythonCodeEditor
                    value={form.code}
                    onChange={(value) =>
                      setForm((current) => ({
                        ...current,
                        code: value,
                      }))
                    }
                  />
                </Field>
              </>
            ) : (
              <FieldGroup className="tn-python-module__form-grid">
                <SelectField
                  label="项目"
                  value={form.projectId}
                  onValueChange={(value) => {
                    setSecurity(null);
                    setValidationError("");
                    setForm((current) => ({
                      ...current,
                      projectId: value,
                      entryFile: "",
                      riskConfirmed: false,
                      securityScanId: "",
                    }));
                  }}
                  options={(projects.data ?? []).map((item) => ({
                    value: item.id,
                    label: item.name,
                  }))}
                  placeholder="选择项目"
                />
                <SelectField
                  label="入口文件"
                  value={form.entryFile}
                  onValueChange={(entryFile) =>
                    setForm((current) => ({ ...current, entryFile }))
                  }
                  options={projectEntryFiles(selectedProject).map((entry) => ({
                    value: entry,
                    label: entry,
                  }))}
                  placeholder="自动选择"
                  disabled={!form.projectId}
                />
              </FieldGroup>
            )}
            {form.sourceType === "archive" && form.projectId ? (
              projectEnvironment.isPending ? (
                <LoadingState text="正在检查项目虚拟环境…" />
              ) : archiveEnvironmentReady ? (
                <Alert>
                  <CheckCircle2 aria-hidden="true" />
                  <div>
                    <AlertTitle>项目虚拟环境已就绪</AlertTitle>
                    <AlertDescription>
                      定时任务将使用该项目环境执行。
                    </AlertDescription>
                  </div>
                </Alert>
              ) : (
                <Alert variant="warning">
                  <AlertTriangle aria-hidden="true" />
                  <div>
                    <AlertTitle>项目虚拟环境尚未就绪</AlertTitle>
                    <AlertDescription>
                      创建定时任务前，请先在项目详情中创建并准备环境。{" "}
                      <ActionLinkButton
                        size="xs"
                        href={`${moduleBase}/projects/${encodeURIComponent(form.projectId)}`}
                      >
                        打开项目详情
                      </ActionLinkButton>
                    </AlertDescription>
                  </div>
                </Alert>
              )
            ) : null}
            {form.sourceType === "archive" ? (
              <Card size="sm">
                <CardHeader>
                  <div>
                    <CardTitle>项目入口</CardTitle>
                    <CardDescription>
                      可从文件树选择 Python 文件作为定时任务入口。
                    </CardDescription>
                  </div>
                  <CardAction>
                    <Badge variant="outline">
                      {form.entryFile || "尚未选择"}
                    </Badge>
                  </CardAction>
                </CardHeader>
                <CardContent>
                  {selectedProject ? (
                    <FileTree
                      nodes={selectedProject.file_tree}
                      selected={form.entryFile}
                      onSelect={(entryFile) =>
                        entryFile.toLowerCase().endsWith(".py")
                          ? setForm((current) => ({ ...current, entryFile }))
                          : undefined
                      }
                    />
                  ) : (
                    <EmptyState
                      text="暂无已上传项目，请先到项目仓库上传项目。"
                      action={
                        <ActionLinkButton href={`${moduleBase}/projects`}>
                          去项目仓库
                        </ActionLinkButton>
                      }
                    />
                  )}
                </CardContent>
              </Card>
            ) : null}
            <FieldGroup className="tn-python-module__form-grid">
              <SelectField
                label="计划类型"
                value={form.schedulePlan}
                onValueChange={(value) =>
                  setForm((current) => ({
                    ...current,
                    schedulePlan: value as SchedulePlan,
                    scheduleType: value === "once" ? "once" : "cron",
                  }))
                }
                options={schedulePlanOptions}
              />
              <Field label="时区">
                <Input
                  value={form.timezone}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      timezone: event.target.value,
                    }))
                  }
                />
              </Field>
            </FieldGroup>
            {form.schedulePlan === "daily" ? (
              <Field label="执行时间" help="每天在该时间执行。">
                <Input
                  type="time"
                  value={form.dailyTime}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      dailyTime: event.target.value,
                    }))
                  }
                />
              </Field>
            ) : form.schedulePlan === "weekly" ? (
              <FieldGroup className="tn-python-module__form-grid">
                <Field label="星期" help="至少选择一天。">
                  <div className="tn-python-module__weekday-grid">
                    {weekDayOptions.map((day) => (
                      <CheckboxField
                        key={day.value}
                        checked={form.weeklyDays.includes(day.value)}
                        onCheckedChange={(checked) =>
                          setForm((current) => ({
                            ...current,
                            weeklyDays: checked
                              ? [...new Set([...current.weeklyDays, day.value])]
                              : current.weeklyDays.filter(
                                  (value) => value !== day.value,
                                ),
                          }))
                        }
                      >
                        {day.label}
                      </CheckboxField>
                    ))}
                  </div>
                </Field>
                <Field label="执行时间">
                  <Input
                    type="time"
                    value={form.weeklyTime}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        weeklyTime: event.target.value,
                      }))
                    }
                  />
                </Field>
              </FieldGroup>
            ) : form.schedulePlan === "monthly" ? (
              <FieldGroup className="tn-python-module__form-grid">
                <Field label="日期" help="每月 1 到 31 日。">
                  <Input
                    type="number"
                    min={1}
                    max={31}
                    value={form.monthlyDay}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        monthlyDay: Math.min(
                          31,
                          Math.max(1, Number(event.target.value) || 1),
                        ),
                      }))
                    }
                  />
                </Field>
                <Field label="执行时间">
                  <Input
                    type="time"
                    value={form.monthlyTime}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        monthlyTime: event.target.value,
                      }))
                    }
                  />
                </Field>
              </FieldGroup>
            ) : form.schedulePlan === "interval" ? (
              <FieldGroup className="tn-python-module__form-grid">
                <Field label="间隔值">
                  <Input
                    type="number"
                    min={1}
                    max={59}
                    value={form.intervalValue}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        intervalValue: Math.min(
                          59,
                          Math.max(1, Number(event.target.value) || 1),
                        ),
                      }))
                    }
                  />
                </Field>
                <SelectField
                  label="间隔单位"
                  value={form.intervalUnit}
                  onValueChange={(value) =>
                    setForm((current) => ({
                      ...current,
                      intervalUnit: value as "minute" | "hour",
                    }))
                  }
                  options={intervalUnitOptions}
                />
              </FieldGroup>
            ) : form.schedulePlan === "advanced" ? (
              <Field
                label="Cron 表达式"
                help="使用 5 字段格式，按 IANA 时区计算。"
              >
                <Input
                  value={form.advancedCron}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      advancedCron: event.target.value,
                      cron: event.target.value,
                    }))
                  }
                  placeholder="0 * * * *"
                />
              </Field>
            ) : (
              <Field label="执行时间">
                <Input
                  type="datetime-local"
                  value={form.runAt}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      runAt: event.target.value,
                    }))
                  }
                />
              </Field>
            )}
            <Card size="sm">
              <CardContent className="tn-python-module__schedule-preview">
                <div>
                  <span className="tn-python-module__muted">计划预览</span>
                  <strong>{schedulePreviewText(form)}</strong>
                </div>
                <div>
                  <span className="tn-python-module__muted">Cron</span>
                  <code>{cronFromSchedulePlan(form) || "—"}</code>
                </div>
              </CardContent>
            </Card>
            <Field label="命令行参数">
              <Textarea
                className="tn-python-module__code--compact"
                value={form.args}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    args: event.target.value,
                  }))
                }
              />
            </Field>
            {activeSecurity ? (
              <SecurityConfirmation
                scan={activeSecurity}
                checked={form.riskConfirmed}
                onChange={(riskConfirmed) =>
                  setForm((current) => ({ ...current, riskConfirmed }))
                }
              />
            ) : null}
            <NotificationFields
              value={form.notificationConfig}
              onChange={(notificationConfig) =>
                setForm((current) => ({ ...current, notificationConfig }))
              }
            />
            {validationError ? (
              <Alert variant="warning">
                <AlertTriangle aria-hidden="true" />
                <AlertDescription>{validationError}</AlertDescription>
              </Alert>
            ) : null}
            <div className="tn-python-module__actions">
              <BusyButton
                pending={save.isPending}
                disabled={securityBlocked || !archiveEnvironmentReady}
                onClick={() => {
                  const error = validateScheduleForm(form);
                  if (error) {
                    setValidationError(error);
                    return;
                  }
                  if (!archiveEnvironmentReady) {
                    setValidationError(
                      "项目虚拟环境尚未就绪，请先创建项目虚拟环境。",
                    );
                    return;
                  }
                  setValidationError("");
                  save.mutate();
                }}
              >
                <CheckCircle2 aria-hidden="true" />
                {form.id ? "保存任务" : "创建任务"}
              </BusyButton>
              {form.id ? (
                <Button
                  variant="outline"
                  onClick={() => {
                    setForm(emptyScheduleForm());
                    setSecurity(null);
                    setValidationError("");
                  }}
                >
                  取消编辑
                </Button>
              ) : null}
            </div>
            {save.isError && !security ? (
              <ErrorState error={save.error} title="定时任务保存失败" />
            ) : null}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <div>
              <CardTitle>定时任务列表</CardTitle>
              <CardDescription>启停、立即运行和维护现有任务。</CardDescription>
            </div>
            <CardAction>
              <div className="tn-python-module__actions">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void query.refetch()}
                >
                  <RefreshCw aria-hidden="true" />
                  刷新
                </Button>
                <Button
                  size="sm"
                  onClick={() =>
                    runtime?.router.push(`${moduleBase}/schedules/create`)
                  }
                >
                  <CalendarClock aria-hidden="true" />
                  新建定时任务
                </Button>
              </div>
            </CardAction>
          </CardHeader>
          <CardContent className="tn-python-module__form">
            <div className="tn-python-module__filter">
              <Field label="搜索任务">
                <Input
                  value={keyword}
                  onChange={(event) => setKeyword(event.target.value)}
                  placeholder="搜索任务"
                />
              </Field>
              <SelectField
                label="状态"
                value={status}
                onValueChange={setStatus}
                options={[
                  { value: "all", label: "全部状态" },
                  { value: "enabled", label: "已启用" },
                  { value: "disabled", label: "已停用" },
                  { value: "completed", label: "已完成" },
                  { value: "invalid", label: "异常" },
                ]}
              />
            </div>
            <ScheduleTable
              items={items}
              onDetail={(task) =>
                runtime?.router.push(`${moduleBase}/schedules/${task.id}`)
              }
              onEdit={(task) =>
                runtime?.router.push(`${moduleBase}/schedules/${task.id}/edit`)
              }
              onToggle={(task) => {
                setPending(`${task.id}:toggle`);
                toggle.mutate({ id: task.id, enabled: !task.enabled });
              }}
              onRun={(task) => {
                setPending(`${task.id}:run`);
                run.mutate(task.id);
              }}
              onDelete={setDeleteTarget}
              pending={pending}
            />
            <PaginationControls
              page={page}
              pageCount={Math.max(1, Math.ceil(total / pageSize))}
              summary={
                <>
                  共 {total} 个任务 · 第 {page} 页
                </>
              }
              onPageChange={setPage}
            />
          </CardContent>
        </Card>
      )}
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title="删除定时任务"
        description={
          deleteTarget
            ? `确定删除“${deleteTarget.name}”吗？任务配置和调度记录都会被删除。`
            : ""
        }
        confirmLabel="删除任务"
        destructive
        pending={remove.isPending}
        onConfirm={() => {
          if (deleteTarget) remove.mutate(deleteTarget.id);
        }}
      />
    </ModuleShell>
  );
}

interface PersistentFormState {
  id: string;
  name: string;
  description: string;
  projectId: string;
  entryFile: string;
  workingDirectory: string;
  args: string;
  runtime: string;
  autoStart: boolean;
  restartPolicy: string;
  restartDelay: number;
  maxRestart: number;
  notificationConfig: NotificationConfig;
  riskConfirmed: boolean;
  securityScanId?: string;
}
const emptyPersistentForm = (): PersistentFormState => ({
  id: "",
  name: "新常驻任务",
  description: "",
  projectId: "",
  entryFile: "",
  workingDirectory: "",
  args: "",
  runtime: "project_venv",
  autoStart: false,
  restartPolicy: "never",
  restartDelay: 5,
  maxRestart: 3,
  notificationConfig: defaultNotificationConfig(),
  riskConfirmed: false,
});
function validatePersistentForm(form: PersistentFormState) {
  if (!form.name.trim()) return "请填写任务名称";
  if (!form.projectId) return "请选择已上传项目";
  if (!form.entryFile.endsWith(".py")) return "请选择 .py 入口文件";
  const workingDirectory = form.workingDirectory.trim();
  if (
    workingDirectory &&
    (workingDirectory.startsWith("/") ||
      /^[A-Za-z]:[\\/]/.test(workingDirectory) ||
      workingDirectory
        .split(/[\\/]/)
        .some((part) => !part || part === "." || part === ".."))
  )
    return "工作目录必须是项目内的相对目录";
  return "";
}

function PersistentTable({
  items,
  projects,
  onSelect,
  onEdit,
  onStart,
  onStop,
  onRestart,
  onDelete,
  pending,
}: {
  items: PersistentTask[];
  projects: ProjectUpload[];
  onSelect: (task: PersistentTask) => void;
  onEdit: (task: PersistentTask) => void;
  onStart: (task: PersistentTask) => void;
  onStop: (task: PersistentTask) => void;
  onRestart: (task: PersistentTask) => void;
  onDelete: (task: PersistentTask) => void;
  pending?: string | undefined;
}) {
  if (!items.length)
    return <EmptyState text="还没有常驻任务，请先从项目创建。" />;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead style={{ width: "23%" }}>任务</TableHead>
          <TableHead style={{ width: "17%" }}>项目</TableHead>
          <TableHead style={{ width: "13%" }}>状态</TableHead>
          <TableHead style={{ width: "14%" }}>运行时长</TableHead>
          <TableHead style={{ width: "18%" }}>最近事件</TableHead>
          <TableHead
            style={{ width: "15%" }}
            className="tn-python-module__right"
          >
            操作
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((task) => {
          const source =
            task.source.type === "archive" ? task.source : undefined;
          const project = projects.find(
            (item) => item.id === sourceProjectId(source),
          );
          const isActive = ["running", "starting", "restarting"].includes(
            task.status,
          );
          const isTransitioning = [
            "starting",
            "stopping",
            "restarting",
          ].includes(task.status);
          return (
            <TableRow key={task.id}>
              <TableCell>
                <Button
                  variant="link"
                  size="sm"
                  className="tn-python-module__table-primary"
                  onClick={() => onSelect(task)}
                >
                  {task.name}
                </Button>
                <div className="tn-python-module__table-subtitle">
                  {source?.entry_file ?? "内联任务"}
                  {task.args.length ? ` · ${task.args.join(" ")}` : ""}
                </div>
              </TableCell>
              <TableCell className="tn-python-module__center">
                {project?.name || "项目包"}
                <div className="tn-python-module__table-subtitle">
                  {project?.filename || "已上传项目"}
                </div>
              </TableCell>
              <TableCell className="tn-python-module__center">
                <StatusBadge value={task.status} />
              </TableCell>
              <TableCell className="tn-python-module__center">
                {isActive && task.started_at
                  ? formatElapsed(
                      Date.now() - new Date(task.started_at).getTime(),
                    )
                  : "未运行"}
              </TableCell>
              <TableCell>
                <strong>
                  {task.last_error ||
                    (isActive ? "运行中" : statusText(task.status))}
                </strong>
                <div className="tn-python-module__table-subtitle">
                  {task.last_exit_code === null ||
                  task.last_exit_code === undefined
                    ? ""
                    : `退出码 ${task.last_exit_code}`}
                </div>
              </TableCell>
              <TableCell>
                <div className="tn-python-module__table-actions">
                  {isActive ? (
                    <BusyButton
                      variant="outline"
                      size="sm"
                      pending={pending === `${task.id}:stop`}
                      disabled={isTransitioning}
                      onClick={() => onStop(task)}
                    >
                      停止
                    </BusyButton>
                  ) : (
                    <BusyButton
                      size="sm"
                      pending={pending === `${task.id}:start`}
                      disabled={isTransitioning}
                      onClick={() => onStart(task)}
                    >
                      启动
                    </BusyButton>
                  )}
                  <TableActionMenu
                    items={[
                      {
                        key: "restart",
                        label: "重启",
                        disabled: isTransitioning || Boolean(pending),
                      },
                      { key: "detail", label: "查看详情" },
                      {
                        key: "edit",
                        label: "编辑",
                        disabled: isActive || isTransitioning,
                      },
                      {
                        key: "delete",
                        label: "删除任务",
                        destructive: true,
                        disabled: isActive || isTransitioning,
                      },
                    ]}
                    onClick={(key) => {
                      if (key === "restart") onRestart(task);
                      if (key === "detail") onSelect(task);
                      if (key === "edit") onEdit(task);
                      if (key === "delete") onDelete(task);
                    }}
                  />
                </div>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

function PersistentDetailPage({ taskId }: { taskId: string }) {
  const task = useQuery({
    queryKey: ["python-runner", "persistent-detail", taskId],
    queryFn: () => getPersistentTask(taskId),
    refetchInterval: (query) => query.state.data?.status === "running" ? 2_000 : false,
  });
  const projectId = sourceProjectId(
    task.data?.source.type === "archive" ? task.data.source : undefined,
  );
  const project = useQuery({
    queryKey: ["python-runner", "persistent-detail-project", projectId],
    queryFn: () => getUpload(projectId),
    enabled: Boolean(projectId),
  });
  const logs = useQuery({
    queryKey: ["python-runner", "persistent-detail-logs", taskId],
    queryFn: () => getPersistentLogs(taskId),
    refetchInterval: task.data?.status === "running" ? 2_000 : false,
  });
  const events = useQuery({
    queryKey: ["python-runner", "persistent-detail-events", taskId],
    queryFn: () => getPersistentEvents(taskId),
    refetchInterval: task.data?.status === "running" ? 2_000 : false,
  });
  const [confirmDelete, setConfirmDelete] = useState(false);
  const start = useMutation({
    mutationFn: () => startPersistent(taskId),
    onSuccess: () => void task.refetch(),
  });
  const stop = useMutation({
    mutationFn: () => stopPersistent(taskId),
    onSuccess: () => void task.refetch(),
  });
  const restart = useMutation({
    mutationFn: () => restartPersistent(taskId),
    onSuccess: () => void task.refetch(),
  });
  const clearLogs = useMutation({
    mutationFn: () => clearPersistentLogs(taskId),
    onSuccess: () => void logs.refetch(),
  });
  const remove = useMutation({
    mutationFn: () => deletePersistent(taskId),
    onSuccess: () => runtime?.router.push(`${moduleBase}/services`),
  });
  if (task.isPending)
    return (
      <ModuleShell
        title="常驻任务详情"
        description="查看进程状态和生命周期记录。"
      >
        <LoadingState text="正在读取常驻任务详情…" />
      </ModuleShell>
    );
  if (task.isError)
    return (
      <ModuleShell
        title="常驻任务详情"
        description="查看进程状态和生命周期记录。"
      >
        <PageError error={task.error} onRetry={() => void task.refetch()} />
      </ModuleShell>
    );
  const item = task.data;
  const source = item.source.type === "archive" ? item.source : undefined;
  const active = ["running", "starting", "restarting"].includes(item.status);
  const operating =
    start.isPending || stop.isPending || restart.isPending || remove.isPending;
  const output =
    logs.data?.lines.join("\n") ||
    "暂无日志，启动常驻任务后将在这里显示最近输出。";
  return (
    <ModuleShell
      title={item.name}
      description={item.description || "查看进程状态和生命周期记录。"}
    >
      <div className="tn-python-module__page-toolbar">
        <ButtonGroup>
          <ActionLinkButton href={`${moduleBase}/services`}>
            <ArrowLeft aria-hidden="true" />
            返回常驻任务
          </ActionLinkButton>
          <ActionLinkButton href={`${moduleBase}/services/${item.id}/edit`}>
            <Settings2 aria-hidden="true" />
            编辑
          </ActionLinkButton>
          {active ? (
            <BusyButton
              variant="outline"
              pending={stop.isPending}
              onClick={() => stop.mutate()}
            >
              <Square aria-hidden="true" />
              停止
            </BusyButton>
          ) : (
            <BusyButton pending={start.isPending} onClick={() => start.mutate()}>
              <Play aria-hidden="true" />
              启动
            </BusyButton>
          )}
          <BusyButton
            variant="outline"
            pending={restart.isPending}
            disabled={operating}
            onClick={() => restart.mutate()}
          >
            <RotateCcw aria-hidden="true" />
            重启
          </BusyButton>
          <Button
            variant="ghost"
            disabled={active || operating}
            onClick={() => setConfirmDelete(true)}
          >
            <Trash2 aria-hidden="true" />
            删除
          </Button>
        </ButtonGroup>
      </div>
      <div className="tn-python-module__detail-grid">
        <Card>
          <CardHeader>
            <div>
              <CardTitle>运行状态</CardTitle>
              <CardDescription>
                {runtimeEnvironmentText(item.runtime_environment)}
              </CardDescription>
            </div>
            <CardAction>
              <StatusBadge value={item.status} />
            </CardAction>
          </CardHeader>
          <CardContent>
            <DetailRows
              rows={[
                ["PID", item.pid ?? "未运行"],
                ["启动时间", formatTime(item.started_at)],
                ["停止时间", formatTime(item.stopped_at)],
                ["退出码", item.last_exit_code ?? "无"],
                [
                  "运行时长",
                  active && item.started_at
                    ? formatElapsed(
                        Date.now() - new Date(item.started_at).getTime(),
                      )
                    : "未运行",
                ],
                ["重启次数", item.restart_count],
              ]}
            />
            {item.last_error ? (
              <Alert variant="destructive">
                <AlertTriangle aria-hidden="true" />
                <div>
                  <AlertTitle>最近一次异常</AlertTitle>
                  <AlertDescription>{item.last_error}</AlertDescription>
                </div>
              </Alert>
            ) : null}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>启动配置</CardTitle>
          </CardHeader>
          <CardContent>
            <DetailRows
              rows={[
                ["项目", project.data?.name ?? "项目包"],
                ["入口文件", source?.entry_file ?? "自动选择"],
                ["启动参数", item.args.length ? item.args.join(" ") : "无"],
                ["重启策略", restartPolicyText(item.restart_policy)],
                ["重启延迟", `${item.restart_delay_seconds} 秒`],
                ["最大重启次数", `${item.max_restart_count} 次`],
                ["自动启动", item.auto_start ? "已开启" : "未开启"],
              ]}
            />
            {projectId ? (
              <ActionLinkButton
                href={`${moduleBase}/projects/${encodeURIComponent(projectId)}`}
              >
                打开项目详情
                <ArrowRight aria-hidden="true" />
              </ActionLinkButton>
            ) : null}
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader>
          <div>
            <CardTitle>最近日志</CardTitle>
            <CardDescription>
              {logs.data
                ? `${logs.data.lines.length} 行 · ${formatBytes(logs.data.log_size)}`
                : "实时刷新中"}
            </CardDescription>
          </div>
          <CardAction>
            <div className="tn-python-module__actions">
              <Button
                variant="outline"
                size="sm"
                onClick={() => void logs.refetch()}
              >
                <RefreshCw aria-hidden="true" />
                刷新
              </Button>
              <BusyButton
                variant="outline"
                size="sm"
                pending={clearLogs.isPending}
                onClick={() => clearLogs.mutate()}
              >
                清理日志
              </BusyButton>
              <Button
                variant="outline"
                size="sm"
                disabled={!logs.data?.lines.length}
                onClick={() =>
                  void copyText(
                    logs.data?.lines.join("\n") ?? "",
                    "日志已复制。",
                  )
                }
              >
                <Copy aria-hidden="true" />
                复制日志
              </Button>
            </div>
          </CardAction>
        </CardHeader>
        <CardContent>
          {logs.isPending ? (
            <LoadingState text="正在读取常驻任务日志…" />
          ) : logs.isError ? (
            <ErrorState error={logs.error} title="日志读取失败" />
          ) : (
            <pre className="tn-python-module__log">{output}</pre>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <div>
            <CardTitle>事件时间线</CardTitle>
            <CardDescription>记录任务启动、停止和异常事件。</CardDescription>
          </div>
          <CardAction>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void events.refetch()}
            >
              <RefreshCw aria-hidden="true" />
              刷新
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent>
          <PersistentEventTimeline
            events={events.data ?? []}
            isPending={events.isPending}
            isError={events.isError}
            error={events.error}
            onRetry={() => void events.refetch()}
            resetKey={taskId}
          />
        </CardContent>
      </Card>
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="删除常驻任务"
        description="删除后任务配置和日志将无法恢复，项目代码不会被删除。"
        confirmLabel="删除任务"
        destructive
        pending={remove.isPending}
        onConfirm={() => remove.mutate()}
      />
    </ModuleShell>
  );
}

function PersistentPage({
  initialTaskId,
  initialProjectId,
  initialEntryFile,
}: {
  initialTaskId?: string | undefined;
  initialProjectId?: string | undefined;
  initialEntryFile?: string | undefined;
}) {
  const [page, setPage] = useState(1);
  const pageSize = 20;
  const [keyword, setKeyword] = useState("");
  const [status, setStatus] = useState("all");
  const query = useQuery({
    queryKey: ["python-runner", "persistent", keyword, status, page],
    queryFn: () =>
      listPersistentTasks({
        keyword: keyword.trim() || undefined,
        status: status === "all" ? undefined : status,
        page,
        page_size: pageSize,
      }),
    refetchInterval: (value) => value.state.data?.items.some((item) => item.status === "running") ? 5_000 : 60_000,
    refetchIntervalInBackground: false,
    placeholderData: (previous) => previous,
  });
  const [selected, setSelected] = useState<string | null>(
    initialTaskId ?? null,
  );
  const taskDetail = useQuery({
    queryKey: ["python-runner", "persistent-task", selected],
    queryFn: () => getPersistentTask(selected ?? ""),
    enabled: Boolean(selected),
    refetchInterval: (value) => selected && value.state.data?.status === "running" ? 3_000 : false,
  });
  const projects = useQuery({
    queryKey: ["python-runner", "uploads"],
    queryFn: listUploads,
    staleTime: 10_000,
  });
  const [form, setForm] = useState<PersistentFormState>(() => ({
    ...emptyPersistentForm(),
    ...(initialProjectId
      ? {
          projectId: initialProjectId,
          entryFile: initialEntryFile ?? "",
        }
      : {}),
  }));
  const projectEnvironment = useQuery({
    queryKey: ["python-runner", "persistent-environment", form.projectId],
    queryFn: () => getEnvironment(form.projectId),
    enabled: Boolean(form.projectId),
    staleTime: 5_000,
  });
  const projectSecurity = useQuery({
    queryKey: ["python-runner", "persistent-security", form.projectId],
    queryFn: () => getSecurity(form.projectId),
    enabled: Boolean(form.projectId),
    staleTime: 5_000,
  });
  const [deleteTarget, setDeleteTarget] = useState<PersistentTask | null>(null);
  const [pending, setPending] = useState<string>();
  const [security, setSecurity] = useState<SecurityScan | null>(null);
  const [validationError, setValidationError] = useState("");
  useEffect(() => {
    setPage(1);
  }, [keyword, status]);
  const save = useMutation({
    mutationFn: () => {
      const source: ExecutionSource = {
        type: "archive",
        project_id: form.projectId,
        upload_id: form.projectId,
        entry_file: form.entryFile,
      };
      const payload = {
        name: form.name,
        description: form.description,
        source,
        args: argsFromText(form.args),
        runtime_environment: form.runtime,
        working_directory: form.workingDirectory.trim() || null,
        auto_start: form.autoStart,
        restart_policy: form.restartPolicy,
        restart_delay_seconds: form.restartDelay,
        max_restart_count: form.maxRestart,
        notification_config: form.notificationConfig,
        ...(form.riskConfirmed && form.securityScanId
          ? {
              security: {
                risk_confirmed: true,
                scan_id: form.securityScanId,
              },
            }
          : {}),
      };
      return form.id
        ? updatePersistentTask(form.id, payload)
        : createPersistentTask(payload);
    },
    onSuccess: (saved) => {
      setForm(emptyPersistentForm());
      setSecurity(null);
      setValidationError("");
      setSelected(saved.id);
      void query.refetch();
      runtime?.notify({ type: "success", content: "常驻任务已保存。" });
      runtime?.router.push(`${moduleBase}/services/${saved.id}`);
    },
    onError: (error) => {
      const next = extractSecurity(error);
      if (!next) return;
      setSecurity(next);
      setForm((current) => ({
        ...current,
        riskConfirmed: false,
        securityScanId: next.scan_id,
      }));
    },
  });
  const start = useMutation({
    mutationFn: startPersistent,
    onSuccess: () => {
      setPending(undefined);
      void query.refetch();
      void taskDetail.refetch();
    },
    onError: () => setPending(undefined),
  });
  const stop = useMutation({
    mutationFn: stopPersistent,
    onSuccess: () => {
      setPending(undefined);
      void query.refetch();
      void taskDetail.refetch();
    },
    onError: () => setPending(undefined),
  });
  const restart = useMutation({
    mutationFn: restartPersistent,
    onSuccess: () => {
      setPending(undefined);
      void query.refetch();
      void taskDetail.refetch();
    },
    onError: () => setPending(undefined),
  });
  const remove = useMutation({
    mutationFn: deletePersistent,
    onSuccess: () => {
      setDeleteTarget(null);
      setSelected((current) => (current === deleteTarget?.id ? null : current));
      void query.refetch();
    },
  });
  const logs = useQuery({
    queryKey: ["python-runner", "persistent-logs", selected],
    queryFn: () => getPersistentLogs(selected ?? ""),
    enabled: Boolean(selected),
    refetchInterval: selected && taskDetail.data?.status === "running" ? 3_000 : false,
  });
  const events = useQuery({
    queryKey: ["python-runner", "persistent-events", selected],
    queryFn: () => getPersistentEvents(selected ?? ""),
    enabled: Boolean(selected),
    refetchInterval: selected && taskDetail.data?.status === "running" ? 3_000 : false,
  });
  const clearLogs = useMutation({
    mutationFn: () => clearPersistentLogs(selected ?? ""),
    onSuccess: () => void logs.refetch(),
  });
  const items = query.data?.items ?? [];
  const total = query.data?.total ?? 0;
  const canGoPrevious = page > 1;
  const canGoNext = page * (query.data?.page_size ?? pageSize) < total;
  const project = projects.data?.find((item) => item.id === form.projectId);
  useEffect(() => {
    if (
      initialProjectId &&
      !form.id &&
      form.projectId === initialProjectId &&
      !form.entryFile &&
      projectEntryFiles(project)[0]
    ) {
      setForm((current) => ({
        ...current,
        entryFile: projectEntryFiles(project)[0] ?? "",
      }));
    }
  }, [form.entryFile, form.id, form.projectId, initialProjectId, project]);
  const selectedTask =
    taskDetail.data ??
    (query.data?.items ?? []).find((task) => task.id === selected);
  const edit = (task: PersistentTask) => {
    const source = task.source.type === "archive" ? task.source : undefined;
    setForm({
      id: task.id,
      name: task.name,
      description: task.description,
      projectId: source?.project_id ?? source?.upload_id ?? "",
      entryFile: source?.entry_file ?? "",
      workingDirectory: task.working_directory ?? "",
      args: textFromArgs(task.args),
      runtime: task.runtime_environment,
      autoStart: task.auto_start,
      restartPolicy: task.restart_policy,
      restartDelay: task.restart_delay_seconds,
      maxRestart: task.max_restart_count,
      notificationConfig:
        task.notification_config ?? defaultNotificationConfig(),
      riskConfirmed: false,
    });
    setSecurity(null);
    setValidationError("");
    setSelected(task.id);
  };
  const activeSecurity = security ?? projectSecurity.data ?? null;
  const securityBlocked = activeSecurity?.risk_level === "blocked";
  const persistentEnvironmentReady =
    form.runtime !== "project_venv" ||
    (projectEnvironment.data?.status === "ready" &&
      Boolean(projectEnvironment.data.python_executable));
  const selectedSource =
    selectedTask?.source.type === "archive" ? selectedTask.source : undefined;
  const selectedTaskProject = projects.data?.find(
    (item) => item.id === sourceProjectId(selectedSource),
  );
  const currentPath =
    typeof window === "undefined" ? "" : window.location.pathname;
  const isEditor =
    Boolean(initialTaskId) ||
    currentPath.endsWith(`${moduleBase}/services/create`) ||
    currentPath.endsWith("/edit");
  const selectedTaskActive = Boolean(
    selectedTask &&
    ["running", "starting", "restarting"].includes(selectedTask.status),
  );
  const refreshSelectedTask = () => {
    void Promise.all([
      query.refetch(),
      taskDetail.refetch(),
      logs.refetch(),
      events.refetch(),
    ]);
  };
  const appliedTaskId = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!initialTaskId || appliedTaskId.current === initialTaskId) return;
    const task =
      taskDetail.data ??
      query.data?.items.find((item) => item.id === initialTaskId);
    if (!task) return;
    appliedTaskId.current = initialTaskId;
    edit(task);
  }, [initialTaskId, query.data?.items, taskDetail.data]);
  if (query.isPending)
    return (
      <ModuleShell
        title="常驻任务"
        description="管理长期运行的 Python 进程和重启策略。"
      >
        <LoadingState text="正在读取常驻任务…" />
      </ModuleShell>
    );
  if (query.isError)
    return (
      <ModuleShell
        title="常驻任务"
        description="管理长期运行的 Python 进程和重启策略。"
      >
        <PageError error={query.error} onRetry={() => void query.refetch()} />
      </ModuleShell>
    );
  if (initialTaskId && taskDetail.isError)
    return (
      <ModuleShell
        title="常驻任务"
        description="管理长期运行的 Python 进程和重启策略。"
      >
        <PageError
          error={taskDetail.error}
          title="常驻任务详情读取失败"
          onRetry={() => void taskDetail.refetch()}
        />
      </ModuleShell>
    );
  return (
    <ModuleShell
      title="常驻任务"
      description="管理长期运行的 Python 进程和重启策略。"
    >
      {isEditor ? (
        <Card>
          <CardHeader>
            <div>
              <CardTitle>{form.id ? "编辑常驻任务" : "创建常驻任务"}</CardTitle>
              <CardDescription>
                配置项目入口、运行环境和失败重启策略。
              </CardDescription>
            </div>
            <CardAction>
              <ActionLinkButton href={`${moduleBase}/persistent`}>
                <ArrowLeft aria-hidden="true" />
                返回任务列表
              </ActionLinkButton>
            </CardAction>
          </CardHeader>
          <CardContent className="tn-python-module__form">
            <Field label="任务名称">
              <Input
                value={form.name}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    name: event.target.value,
                  }))
                }
              />
            </Field>
            <Field label="描述">
              <Textarea
                className="tn-python-module__code--compact"
                value={form.description}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    description: event.target.value,
                  }))
                }
              />
            </Field>
            <FieldGroup className="tn-python-module__form-grid">
              <SelectField
                label="项目"
                value={form.projectId}
                onValueChange={(value) => {
                  setSecurity(null);
                  setValidationError("");
                  setForm((current) => ({
                    ...current,
                    projectId: value,
                    entryFile: "",
                    riskConfirmed: false,
                    securityScanId: "",
                  }));
                }}
                options={(projects.data ?? []).map((item) => ({
                  value: item.id,
                  label: item.name,
                }))}
                placeholder="选择项目"
              />
              <SelectField
                label="入口文件"
                value={form.entryFile}
                onValueChange={(entryFile) =>
                  setForm((current) => ({ ...current, entryFile }))
                }
                options={projectEntryFiles(project).map((entry) => ({
                  value: entry,
                  label: entry,
                }))}
                placeholder="自动选择"
                disabled={!form.projectId}
              />
            </FieldGroup>
            <Alert>
              <AlertDescription>
                项目虚拟环境用于隔离依赖，但不是安全沙箱。请确认项目来源可信。
              </AlertDescription>
            </Alert>
            <Field
              label="工作目录（可选）"
              help="相对于项目根目录，例如 scripts；留空时使用项目根目录。"
            >
              <Input
                value={form.workingDirectory}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    workingDirectory: event.target.value,
                  }))
                }
                placeholder="例如：scripts"
              />
            </Field>
            <Field label="命令行参数">
              <Textarea
                className="tn-python-module__code--compact"
                value={form.args}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    args: event.target.value,
                  }))
                }
              />
            </Field>
            <FieldGroup className="tn-python-module__form-grid">
              <SelectField
                label="运行环境"
                value={form.runtime}
                onValueChange={(runtime) =>
                  setForm((current) => ({ ...current, runtime }))
                }
                options={[
                  { value: "project_venv", label: "项目虚拟环境" },
                  { value: "auto", label: "自动选择" },
                  { value: "system", label: "系统 Python" },
                ]}
              />
              <SelectField
                label="重启策略"
                value={form.restartPolicy}
                onValueChange={(restartPolicy) =>
                  setForm((current) => ({ ...current, restartPolicy }))
                }
                options={[
                  { value: "never", label: "从不" },
                  { value: "on_failure", label: "失败时" },
                  { value: "always", label: "总是" },
                ]}
              />
            </FieldGroup>
            {form.projectId && form.runtime === "project_venv" ? (
              projectEnvironment.isPending ? (
                <LoadingState text="正在检查项目虚拟环境…" />
              ) : projectEnvironment.data?.status === "ready" ? (
                <Alert>
                  <CheckCircle2 aria-hidden="true" />
                  <div>
                    <AlertTitle>项目虚拟环境已就绪</AlertTitle>
                    <AlertDescription>
                      创建或启动任务时将使用该项目环境。
                    </AlertDescription>
                  </div>
                </Alert>
              ) : (
                <Alert variant="warning">
                  <AlertTriangle aria-hidden="true" />
                  <div>
                    <AlertTitle>项目虚拟环境尚未就绪</AlertTitle>
                    <AlertDescription>
                      创建任务前，请先在项目详情中创建并准备环境。{" "}
                        <ActionLinkButton
                          size="xs"
                          href={`${moduleBase}/projects/${encodeURIComponent(form.projectId)}`}
                        >
                          打开项目详情
                        </ActionLinkButton>
                    </AlertDescription>
                  </div>
                </Alert>
              )
            ) : null}
            {activeSecurity ? (
              <SecurityConfirmation
                scan={activeSecurity}
                checked={form.riskConfirmed}
                onChange={(riskConfirmed) =>
                  setForm((current) => ({ ...current, riskConfirmed }))
                }
              />
            ) : null}
            {validationError ? (
              <Alert variant="warning">
                <AlertTriangle aria-hidden="true" />
                <AlertDescription>{validationError}</AlertDescription>
              </Alert>
            ) : null}
            <FieldGroup className="tn-python-module__form-grid">
              <Field label="重启间隔（秒）">
                <Input
                  type="number"
                  min={0}
                  max={3600}
                  value={form.restartDelay}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      restartDelay: Number(event.target.value),
                    }))
                  }
                />
              </Field>
              <Field label="最大重启次数">
                <Input
                  type="number"
                  min={0}
                  max={100}
                  value={form.maxRestart}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      maxRestart: Number(event.target.value),
                    }))
                  }
                />
              </Field>
            </FieldGroup>
            <SwitchField
              checked={form.autoStart}
              onCheckedChange={(autoStart) =>
                setForm((current) => ({ ...current, autoStart }))
              }
            >
              模块进程启动后自动启动
            </SwitchField>
            <NotificationFields
              value={form.notificationConfig}
              onChange={(notificationConfig) =>
                setForm((current) => ({ ...current, notificationConfig }))
              }
              persistent
            />
            <div className="tn-python-module__actions">
              <BusyButton
                pending={save.isPending}
                disabled={
                  !form.projectId ||
                  securityBlocked ||
                  !persistentEnvironmentReady
                }
                onClick={() => {
                  const error = validatePersistentForm(form);
                  if (error) {
                    setValidationError(error);
                    return;
                  }
                  if (!persistentEnvironmentReady) {
                    setValidationError(
                      "项目虚拟环境尚未就绪，请先创建项目虚拟环境。",
                    );
                    return;
                  }
                  setValidationError("");
                  save.mutate();
                }}
              >
                <CheckCircle2 aria-hidden="true" />
                {form.id ? "保存任务" : "创建任务"}
              </BusyButton>
              {form.id ? (
                <Button
                  variant="outline"
                  onClick={() => {
                    setForm(emptyPersistentForm());
                    setSecurity(null);
                    setValidationError("");
                  }}
                >
                  取消编辑
                </Button>
              ) : null}
            </div>
            {save.isError ? (
              <ErrorState error={save.error} title="常驻任务保存失败" />
            ) : null}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <div>
              <CardTitle>常驻任务列表</CardTitle>
              <CardDescription>
                保持进程状态、启动/停止和查看任务详情。
              </CardDescription>
            </div>
            <CardAction>
              <div className="tn-python-module__actions">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void query.refetch()}
                >
                  <RefreshCw aria-hidden="true" />
                  刷新
                </Button>
                <Button
                  size="sm"
                  onClick={() =>
                    runtime?.router.push(`${moduleBase}/services/create`)
                  }
                >
                  <Server aria-hidden="true" />
                  新建常驻任务
                </Button>
              </div>
            </CardAction>
          </CardHeader>
          <CardContent className="tn-python-module__form">
            <div className="tn-python-module__filter">
              <Field label="搜索任务">
                <Input
                  value={keyword}
                  onChange={(event) => setKeyword(event.target.value)}
                  placeholder="搜索任务"
                />
              </Field>
              <SelectField
                label="状态"
                value={status}
                onValueChange={setStatus}
                options={[
                  { value: "all", label: "全部状态" },
                  { value: "running", label: "运行中" },
                  { value: "stopped", label: "已停止" },
                  { value: "failed", label: "异常" },
                  { value: "exited", label: "已退出" },
                  { value: "unknown", label: "未知" },
                ]}
              />
            </div>
            <PersistentTable
              items={items}
              projects={projects.data ?? []}
              onSelect={(task) =>
                runtime?.router.push(`${moduleBase}/services/${task.id}`)
              }
              onEdit={(task) =>
                runtime?.router.push(`${moduleBase}/services/${task.id}/edit`)
              }
              onStart={(task) => {
                setPending(`${task.id}:start`);
                start.mutate(task.id);
              }}
              onStop={(task) => {
                setPending(`${task.id}:stop`);
                stop.mutate(task.id);
              }}
              onRestart={(task) => {
                setPending(`${task.id}:restart`);
                restart.mutate(task.id);
              }}
              onDelete={setDeleteTarget}
              pending={pending}
            />
            <PaginationControls
              page={page}
              pageCount={Math.max(1, Math.ceil(total / pageSize))}
              summary={
                <>
                  共 {total} 个任务 · 第 {page} 页
                </>
              }
              onPageChange={setPage}
            />
          </CardContent>
        </Card>
      )}
      {!isEditor && selectedTask ? (
        <>
          <div className="tn-python-module__columns">
            <Card>
              <CardHeader>
                <div>
                  <CardTitle>运行状态</CardTitle>
                  <CardDescription>
                    {selectedTask.name} ·{" "}
                    {runtimeEnvironmentText(selectedTask.runtime_environment)}
                  </CardDescription>
                </div>
                <CardAction>
                  <div className="tn-python-module__actions">
                    <StatusBadge value={selectedTask.status} />
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={refreshSelectedTask}
                    >
                      <RefreshCw aria-hidden="true" />
                      刷新
                    </Button>
                    {selectedTaskActive ? (
                      <BusyButton
                        variant="outline"
                        size="sm"
                        pending={pending === `${selectedTask.id}:stop`}
                        onClick={() => {
                          setPending(`${selectedTask.id}:stop`);
                          stop.mutate(selectedTask.id);
                        }}
                      >
                        <Square aria-hidden="true" />
                        停止
                      </BusyButton>
                    ) : (
                      <BusyButton
                        size="sm"
                        pending={pending === `${selectedTask.id}:start`}
                        onClick={() => {
                          setPending(`${selectedTask.id}:start`);
                          start.mutate(selectedTask.id);
                        }}
                      >
                        <Play aria-hidden="true" />
                        启动
                      </BusyButton>
                    )}
                    <BusyButton
                      variant="outline"
                      size="sm"
                      pending={pending === `${selectedTask.id}:restart`}
                      disabled={Boolean(pending)}
                      onClick={() => {
                        setPending(`${selectedTask.id}:restart`);
                        restart.mutate(selectedTask.id);
                      }}
                    >
                      <RotateCcw aria-hidden="true" />
                      重启
                    </BusyButton>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => edit(selectedTask)}
                    >
                      编辑
                    </Button>
                  </div>
                </CardAction>
              </CardHeader>
              <CardContent>
                <DetailRows
                  rows={[
                    ["PID", selectedTask.pid ?? "未运行"],
                    ["启动时间", formatTime(selectedTask.started_at)],
                    ["停止时间", formatTime(selectedTask.stopped_at)],
                    ["退出码", selectedTask.last_exit_code ?? "无"],
                    ["重启次数", selectedTask.restart_count],
                  ]}
                />
                {selectedTask.last_error ? (
                  <Alert variant="destructive">
                    <AlertTriangle aria-hidden="true" />
                    <div>
                      <AlertTitle>最近一次异常</AlertTitle>
                      <AlertDescription>
                        {selectedTask.last_error}
                      </AlertDescription>
                    </div>
                  </Alert>
                ) : null}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <div>
                  <CardTitle>启动配置</CardTitle>
                  <CardDescription>
                    当前任务实际使用的项目入口和恢复策略。
                  </CardDescription>
                </div>
              </CardHeader>
              <CardContent>
                <DetailRows
                  rows={[
                    ["项目", selectedTaskProject?.name ?? "项目包"],
                    ["入口文件", selectedSource?.entry_file ?? "自动选择"],
                    [
                      "启动参数",
                      selectedTask.args.length
                        ? selectedTask.args.join(" ")
                        : "无",
                    ],
                    [
                      "重启策略",
                      restartPolicyText(selectedTask.restart_policy),
                    ],
                    ["重启延迟", `${selectedTask.restart_delay_seconds} 秒`],
                    ["最大重启次数", `${selectedTask.max_restart_count} 次`],
                  ]}
                />
              </CardContent>
            </Card>
          </div>
          <div className="tn-python-module__columns">
            <Card>
              <CardHeader>
                <div>
                  <CardTitle>{selectedTask.name} · 最近日志</CardTitle>
                  <CardDescription>
                    {logs.data
                      ? `${logs.data.lines.length} 行 · ${formatBytes(logs.data.log_size)}`
                      : "实时刷新中"}
                  </CardDescription>
                </div>
                <CardAction>
                  <div className="tn-python-module__actions">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void logs.refetch()}
                    >
                      <RefreshCw aria-hidden="true" />
                      刷新
                    </Button>
                    <BusyButton
                      variant="outline"
                      size="sm"
                      pending={clearLogs.isPending}
                      onClick={() => clearLogs.mutate()}
                    >
                      清理日志
                    </BusyButton>
                  </div>
                </CardAction>
              </CardHeader>
              <CardContent>
                {logs.isPending ? (
                  <LoadingState text="正在读取常驻任务日志…" />
                ) : logs.isError ? (
                  <ErrorState error={logs.error} title="日志读取失败" />
                ) : (
                  <pre className="tn-python-module__log">
                    {logs.data?.lines.join("\n") || "暂无输出。"}
                  </pre>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <div>
                  <CardTitle>事件时间线</CardTitle>
                  <CardDescription>
                    记录任务启动、停止和异常事件。
                  </CardDescription>
                </div>
              </CardHeader>
              <CardContent>
                <PersistentEventTimeline
                  events={events.data ?? []}
                  isPending={events.isPending}
                  isError={events.isError}
                  error={events.error}
                  onRetry={() => void events.refetch()}
                  resetKey={selectedTask.id}
                />
              </CardContent>
            </Card>
          </div>
        </>
      ) : null}
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title="删除常驻任务"
        description={
          deleteTarget
            ? `确定删除“${deleteTarget.name}”吗？任务配置会被删除，项目代码不会被删除。`
            : ""
        }
        confirmLabel="删除任务"
        destructive
        pending={remove.isPending}
        onConfirm={() => {
          if (deleteTarget) remove.mutate(deleteTarget.id);
        }}
      />
    </ModuleShell>
  );
}

export type PythonRunnerPage =
  | "overview"
  | "run"
  | "projects"
  | "project-run"
  | "project-detail"
  | "executions"
  | "execution-detail"
  | "schedules"
  | "schedule-detail"
  | "persistent"
  | "persistent-detail";

export function PythonRunnerApp({
  page,
  ...props
}: { page: PythonRunnerPage } & ToolNestModuleRouteRenderProps) {
  switch (page) {
    case "run":
      return (
        <RunPage
          initialProjectId={props.query.project}
          initialEntryFile={props.query.entry_file}
        />
      );
    case "projects":
      return <ProjectsPage />;
    case "project-run":
      return (
        <ProjectRunCompatPage
          uploadId={props.query.upload_id}
          entryFile={props.query.entry_file}
        />
      );
    case "project-detail":
      return <ProjectDetailPage projectId={props.params.projectId ?? ""} />;
    case "executions":
      return <ExecutionsPage initialStatus={props.query.status} />;
    case "execution-detail":
      return (
        <ExecutionDetailPage executionId={props.params.executionId ?? ""} />
      );
    case "schedules":
      return (
        <SchedulesPage
          initialScheduleId={props.params.scheduleId}
          initialProjectId={props.query.upload_id}
          initialEntryFile={props.query.entry_file}
        />
      );
    case "schedule-detail":
      return <ScheduleDetailPage scheduleId={props.params.scheduleId ?? ""} />;
    case "persistent":
      return (
        <PersistentPage
          initialTaskId={props.params.taskId}
          initialProjectId={props.query.upload_id}
          initialEntryFile={props.query.entry_file}
        />
      );
    case "persistent-detail":
      return <PersistentDetailPage taskId={props.params.taskId ?? ""} />;
    case "overview":
    default:
      return <OverviewPage />;
  }
}
