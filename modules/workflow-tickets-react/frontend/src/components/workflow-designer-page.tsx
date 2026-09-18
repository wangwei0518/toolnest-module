import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { ToolNestModuleRouteRenderProps } from "@toolnest/react-module-sdk";
import { RiAddLine, RiArrowLeftLine, RiArrowRightLine, RiCheckboxCircleLine, RiCheckLine, RiCloseLine, RiDeleteBinLine, RiDraggable, RiEditLine, RiFileTextLine, RiFlashlightLine, RiGitBranchLine, RiInformationLine, RiPlayLine, RiQuestionLine, RiRefreshLine, RiSaveLine, RiStackLine } from "@remixicon/react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

import type { FormField, Workflow, WorkflowApi, WorkflowEdge, WorkflowNode } from "../api";
import { useModulePageMeta } from "./module-layout";
import { CompletionRuleEditor, PredecessorRuleEditor, WorkflowActionEditor, WorkflowEdgeEditor, WorkflowFormDesignerDialog, type ActionProvider, type FormVariable, type RuleRecord } from "./workflow-editor-components";

type Router = ToolNestModuleRouteRenderProps["router"];

type Props = {
  api: WorkflowApi;
  router: Router;
  params: Record<string, string>;
  query: Record<string, string>;
};

type SectionKey = "basic" | "form" | "conditions" | "flow" | "actions" | "version";
type Point = { x: number; y: number };
type NodePreviewPlacement = "top" | "right" | "bottom" | "left";
type ConnectionPointSide = "top" | "right" | "bottom" | "left";
type ConnectionDrag = {
  pointerId: number;
  sourceNodeId: string;
  sourceSide: ConnectionPointSide;
  start: Point;
  current: Point;
  targetNodeId?: string;
  targetSide?: ConnectionPointSide;
};

const connectionPointSides: Array<{ side: ConnectionPointSide; label: string }> = [
  { side: "top", label: "上方连接点" },
  { side: "right", label: "右侧连接点" },
  { side: "bottom", label: "下方连接点" },
  { side: "left", label: "左侧连接点" },
];

const statusLabels: Record<string, string> = {
  draft: "草稿",
  published: "已发布",
  archived: "已归档",
};

const fieldTypeLabels: Record<string, string> = {
  text: "单行文本",
  textarea: "多行文本",
  number: "数字",
  select: "下拉选择",
  radio: "单选",
  multiselect: "多选",
  switch: "开关",
  date: "日期",
  checklist: "清单",
  todo: "待办",
  markdown: "Markdown",
  json: "JSON",
  code: "代码",
  file: "文件",
  image: "图片",
  url: "链接",
  script: "脚本",
};

const sectionItems: Array<{ key: SectionKey; label: string; title: string; hint: string; help: string; icon: typeof RiInformationLine }> = [
  { key: "basic", label: "基础", title: "基础信息", hint: "节点信息", help: "节点标识由系统自动维护，名称修改不会影响已有引用。", icon: RiInformationLine },
  { key: "form", label: "表单", title: "表单内容", hint: "表单内容与字段", help: "定义处理当前节点时需要填写的信息。", icon: RiFileTextLine },
  { key: "conditions", label: "条件", title: "完成条件", hint: "完成规则", help: "直接配置节点达到什么条件后可以完成。", icon: RiCheckboxCircleLine },
  { key: "flow", label: "流转", title: "节点流转", hint: "后继与分支", help: "设置当前节点的前序、后继和分支规则。", icon: RiGitBranchLine },
  { key: "actions", label: "动作", title: "动作", hint: "节点生命周期动作", help: "配置当前节点的生命周期动作。", icon: RiFlashlightLine },
  { key: "version", label: "版本", title: "版本", hint: "工作流版本记录", help: "查看工作流版本记录和发布状态。", icon: RiStackLine },
];

const completionRuleKindLabels: Record<string, string> = {
  field_filled: "字段已填写",
  value_compare: "字段值比较",
  checklist_complete: "Checklist 完成",
  attachment_count: "附件数量",
  manual_confirm: "人工确认",
  node_status: "节点状态",
};

const completionRuleStatusLabels: Record<string, string> = {
  pending: "未开始",
  ready: "可进入",
  in_progress: "处理中",
  waiting: "等待中",
  blocked: "已阻塞",
  completed: "已完成",
  skipped: "已跳过",
  failed: "失败",
  cancelled: "已取消",
};

const completionRuleOperatorLabels: Record<string, string> = {
  "=": "等于",
  equals: "等于",
  "!=": "不等于",
  not_equals: "不等于",
  ">": "大于",
  greater_than: "大于",
  "<": "小于",
  less_than: "小于",
  contains: "包含",
  not_contains: "不包含",
};

function completionRuleKind(rule: RuleRecord): string {
  if (typeof rule.kind === "string" && rule.kind) return rule.kind;
  if (rule.type === "rule") return "field_filled";
  return rule.type === "group" ? "" : String(rule.type ?? "");
}

function completionRuleChildren(rule: RuleRecord): RuleRecord[] {
  const children = Array.isArray(rule.children) ? rule.children : Array.isArray(rule.rules) ? rule.rules : [];
  return children.filter((child): child is RuleRecord => Boolean(child) && typeof child === "object" && !Array.isArray(child));
}

function countCompletionRules(rule: RuleRecord): number {
  const kind = completionRuleKind(rule);
  if (kind && kind !== "group") return 1;
  return completionRuleChildren(rule).reduce((total, child) => total + countCompletionRules(child), 0);
}

function displayCompletionRuleValue(value: unknown): string {
  if (value == null || value === "") return "未设置";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value) ?? "已配置";
  } catch {
    return "已配置";
  }
}

function CompletionRuleSummary({ rule, fields, nodes, depth = 0 }: {
  rule: RuleRecord;
  fields: FormField[];
  nodes: WorkflowNode[];
  depth?: number;
}) {
  const kind = completionRuleKind(rule);
  const children = completionRuleChildren(rule);
  if (!kind || kind === "group") {
    const isAny = String(rule.operator ?? "AND").toUpperCase() === "OR";
    return (
      <div className={`grid min-w-0 gap-2 rounded-md border border-border p-3 ${depth ? "bg-background" : "bg-muted/20"}`} role="group" aria-label={isAny ? "任意条件组" : "全部条件组"}>
        <div className="flex min-w-0 items-center justify-between gap-2">
          <strong className="min-w-0 text-xs font-medium">{isAny ? "任一条件满足" : "全部条件满足"}</strong>
          <span className="shrink-0 text-xs text-muted-foreground">{children.length} 条</span>
        </div>
        {children.length ? (
          <div className="grid min-w-0 gap-2 border-l border-border pl-2">
            {children.map((child, index) => <CompletionRuleSummary key={`${index}-${completionRuleKind(child)}`} rule={child} fields={fields} nodes={nodes} depth={depth + 1} />)}
          </div>
        ) : <p className="m-0 text-xs leading-relaxed text-muted-foreground">暂无规则，空规则组默认视为满足。</p>}
        {rule.negate === true ? <span className="w-fit rounded-sm border border-border px-2 py-0.5 text-xs text-muted-foreground">结果取反</span> : null}
      </div>
    );
  }

  const fieldId = String(rule.field_id ?? "");
  const fieldLabel = fields.find((field) => field.id === fieldId)?.label || fieldId || "未指定字段";
  const nodeId = String(rule.node_id ?? rule.field_id ?? "");
  const nodeLabel = nodes.find((node) => node.id === nodeId || node.key === nodeId)?.name || nodeId || "未指定节点";
  const operator = String(rule.operator_value ?? rule.operator ?? "=");
  const kindLabel = completionRuleKindLabels[kind] ?? String(rule.label || kind || "完成规则");
  const detail = kind === "field_filled" ? `字段「${fieldLabel}」已填写`
    : kind === "value_compare" ? `字段「${fieldLabel}」${completionRuleOperatorLabels[operator] ?? operator} ${displayCompletionRuleValue(rule.value)}`
      : kind === "checklist_complete" ? `字段「${fieldLabel}」中的清单已完成`
        : kind === "attachment_count" ? `字段「${fieldLabel}」至少有 ${displayCompletionRuleValue(rule.count ?? rule.value ?? 1)} 个附件`
          : kind === "manual_confirm" ? String(rule.label || (fieldId ? `确认字段「${fieldLabel}」` : "需要人工确认"))
            : kind === "node_status" ? `节点「${nodeLabel}」状态为${completionRuleStatusLabels[String(rule.status ?? rule.value ?? "completed")] ?? String(rule.status ?? rule.value ?? "已完成")}`
              : fieldId ? `字段「${fieldLabel}」` : String(rule.message || "已配置");

  return (
    <div className="grid min-w-0 gap-1 rounded-md border border-border bg-background px-3 py-2" data-rule-preview>
      <div className="flex min-w-0 items-start justify-between gap-2">
        <strong className="min-w-0 break-words text-xs font-medium">{kindLabel}</strong>
        {rule.negate === true ? <span className="shrink-0 rounded-sm border border-border px-2 py-0.5 text-xs text-muted-foreground">取反</span> : null}
      </div>
      <p className="m-0 break-words text-xs leading-relaxed text-muted-foreground">{detail}</p>
      {typeof rule.message === "string" && rule.message.trim() ? <p className="m-0 break-words text-xs leading-relaxed text-muted-foreground">未满足提示：{rule.message}</p> : null}
    </div>
  );
}

const nodeWidth = 210;
const nodeHeight = 152;

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function rewriteFieldRule(rule: RuleRecord, idChanges: Record<string, string>, validIds: Set<string>): RuleRecord | null {
  if (rule.type === "rule") {
    if (rule.kind === "node_status") return clone(rule);
    const fieldId = String(rule.field_id ?? "");
    const nextId = idChanges[fieldId] ?? fieldId;
    return validIds.has(nextId) ? { ...rule, field_id: nextId } : null;
  }
  return { ...rule, children: (rule.children ?? []).map((child) => rewriteFieldRule(child, idChanges, validIds)).filter((child): child is RuleRecord => Boolean(child)) };
}

function rewriteFieldPaths<T>(value: T, idChanges: Record<string, string>): T {
  if (typeof value === "string") {
    let next: string = value;
    for (const [oldId, newId] of Object.entries(idChanges)) {
      const escaped = oldId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      next = next.replace(new RegExp(`((?:values|resources)\\.)${escaped}(?![\\w-])`, "g"), `$1${newId}`);
    }
    return next as T;
  }
  if (Array.isArray(value)) return value.map((item) => rewriteFieldPaths(item, idChanges)) as T;
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, rewriteFieldPaths(item, idChanges)])) as T;
  return value;
}

function formatDate(value?: string | null): string {
  return value ? new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value)) : "未设置";
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function nodeCenter(node: WorkflowNode): Point {
  return { x: node.position.x + nodeWidth / 2, y: node.position.y + nodeHeight / 2 };
}

function connectionPoint(node: WorkflowNode, side: "top" | "right" | "bottom" | "left"): Point {
  if (side === "top") return { x: node.position.x + nodeWidth / 2, y: node.position.y };
  if (side === "right") return { x: node.position.x + nodeWidth, y: node.position.y + nodeHeight / 2 };
  if (side === "bottom") return { x: node.position.x + nodeWidth / 2, y: node.position.y + nodeHeight };
  return { x: node.position.x, y: node.position.y + nodeHeight / 2 };
}

function connectionSide(dx: number, dy: number): "top" | "right" | "bottom" | "left" {
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? "right" : "left";
  return dy >= 0 ? "bottom" : "top";
}

function nearestConnectionSides(source: WorkflowNode, target: WorkflowNode): { source: "top" | "right" | "bottom" | "left"; target: "top" | "right" | "bottom" | "left" } {
  const sourceCenter = nodeCenter(source);
  const targetCenter = nodeCenter(target);
  return {
    source: connectionSide(targetCenter.x - sourceCenter.x, targetCenter.y - sourceCenter.y),
    target: connectionSide(sourceCenter.x - targetCenter.x, sourceCenter.y - targetCenter.y),
  };
}

function resolveConnectionSides(edge: WorkflowEdge, source: WorkflowNode, target: WorkflowNode): { source: ConnectionPointSide; target: ConnectionPointSide } {
  const nearest = nearestConnectionSides(source, target);
  const sourceSide = edge.source_side as ConnectionPointSide | undefined;
  const targetSide = edge.target_side as ConnectionPointSide | undefined;
  const isExplicitSameTopOrBottomSide = sourceSide === targetSide && (sourceSide === "top" || sourceSide === "bottom");
  if (sourceSide && targetSide && (isExplicitSameTopOrBottomSide || (sourceSide === nearest.source && targetSide === nearest.target))) {
    return { source: sourceSide, target: targetSide };
  }
  return nearest;
}

function connectionCurve(start: Point, end: Point, sourceSide?: ConnectionPointSide, targetSide?: ConnectionPointSide): string {
  const isSameTopOrBottomSide = sourceSide === targetSide && (sourceSide === "top" || sourceSide === "bottom") && Math.abs(end.x - start.x) > 8;
  if (isSameTopOrBottomSide) {
    const bend = Math.max(28, Math.min(96, Math.abs(end.x - start.x) * 0.28));
    const direction = sourceSide === "top" ? -1 : 1;
    const controlA = { x: start.x + (end.x - start.x) * 0.28, y: start.y + direction * bend };
    const controlB = { x: end.x - (end.x - start.x) * 0.28, y: end.y + direction * bend };
    return `M ${start.x} ${start.y} C ${controlA.x} ${controlA.y}, ${controlB.x} ${controlB.y}, ${end.x} ${end.y}`;
  }
  const horizontal = Math.abs(end.x - start.x) >= Math.abs(end.y - start.y);
  const bend = Math.max(34, Math.min(120, (horizontal ? Math.abs(end.x - start.x) : Math.abs(end.y - start.y)) * 0.42));
  const controlA = horizontal ? { x: start.x + (end.x >= start.x ? bend : -bend), y: start.y } : { x: start.x, y: start.y + (end.y >= start.y ? bend : -bend) };
  const controlB = horizontal ? { x: end.x - (end.x >= start.x ? bend : -bend), y: end.y } : { x: end.x, y: end.y - (end.y >= start.y ? bend : -bend) };
  return `M ${start.x} ${start.y} C ${controlA.x} ${controlA.y}, ${controlB.x} ${controlB.y}, ${end.x} ${end.y}`;
}

function edgePath(edge: WorkflowEdge, nodes: WorkflowNode[]): string {
  const source = nodes.find((node) => node.id === edge.source_node_id);
  const target = nodes.find((node) => node.id === edge.target_node_id);
  if (!source || !target) return "";
  const { source: sourceSide, target: targetSide } = resolveConnectionSides(edge, source, target);
  const start = connectionPoint(source, sourceSide);
  const end = connectionPoint(target, targetSide);
  return connectionCurve(start, end, sourceSide, targetSide);
}

function edgeAnchor(edge: WorkflowEdge, nodes: WorkflowNode[]): Point | undefined {
  const source = nodes.find((node) => node.id === edge.source_node_id);
  const target = nodes.find((node) => node.id === edge.target_node_id);
  if (!source || !target) return undefined;
  const { source: sourceSide, target: targetSide } = resolveConnectionSides(edge, source, target);
  const start = connectionPoint(source, sourceSide);
  const end = connectionPoint(target, targetSide);
  if (sourceSide === targetSide && (sourceSide === "top" || sourceSide === "bottom") && Math.abs(end.x - start.x) > 8) {
    const bend = Math.max(28, Math.min(96, Math.abs(end.x - start.x) * 0.28));
    const direction = sourceSide === "top" ? -1 : 1;
    return { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 + direction * bend * 0.75 };
  }
  return { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
}

function edgeDeletePosition(edge: WorkflowEdge, nodes: WorkflowNode[]): Point | undefined {
  const anchor = edgeAnchor(edge, nodes);
  if (!anchor) return undefined;
  const offset = 28;
  const buttonHalfSize = 16;
  const canvasSafeTop = 24;
  const canvasSafeBottom = 1000 - 24;
  const canPlaceAbove = anchor.y - offset - buttonHalfSize >= canvasSafeTop;
  const canPlaceBelow = anchor.y + offset + buttonHalfSize <= canvasSafeBottom;
  const placeAbove = canPlaceAbove || !canPlaceBelow;
  return { x: anchor.x, y: anchor.y + (placeAbove ? -offset : offset) };
}

function statusVariant(value: string): "default" | "secondary" | "outline" | "destructive" {
  if (value === "published") return "default";
  if (value === "draft") return "outline";
  if (value === "archived") return "secondary";
  return "secondary";
}

function WorkflowStatus({ value }: { value: string }) {
  return <Badge variant={statusVariant(value)}>{statusLabels[value] ?? value}</Badge>;
}

function InspectorHelp({ label, hint }: { label: string; hint: string }) {
  return (
    <TooltipProvider delay={200}>
      <Tooltip>
        <TooltipTrigger render={<Button size="icon-sm" variant="ghost" aria-label={`查看${label}说明`} />}>
          <RiQuestionLine />
        </TooltipTrigger>
        <TooltipContent>{hint}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export function WorkflowDesignerPage({ api, router, params, query }: Props) {
  const { setPageMeta } = useModulePageMeta();
  const workflowId = params.id || params.workflowId;
  const [workflow, setWorkflow] = useState<Workflow>();
  const [versionId, setVersionId] = useState(query.versionId || "");
  const [selectedId, setSelectedId] = useState("");
  const [selectedEdgeId, setSelectedEdgeId] = useState("");
  const [activeSection, setActiveSection] = useState<SectionKey>("basic");
  const [nodeSearch, setNodeSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<Point>({ x: 0, y: 0 });
  const [metaOpen, setMetaOpen] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [dryRunOpen, setDryRunOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [formInitialFieldId, setFormInitialFieldId] = useState("");
  const [nodeDeleteOpen, setNodeDeleteOpen] = useState(false);
  const [completionOpen, setCompletionOpen] = useState(false);
  const [flowOpen, setFlowOpen] = useState(false);
  const [actionProviders, setActionProviders] = useState<ActionProvider[]>([]);
  const [hoveredNodeId, setHoveredNodeId] = useState("");
  const [nodePreviewPlacement, setNodePreviewPlacement] = useState<NodePreviewPlacement>("right");
  const [nodePreviewStyle, setNodePreviewStyle] = useState<CSSProperties>({});
  const [connectionDrag, setConnectionDrag] = useState<ConnectionDrag>();
  const [dryRunInput, setDryRunInput] = useState("{}");
  const [dryRunResult, setDryRunResult] = useState<{ version: number; nodes: Array<{ name: string; status: string }>; explanation: string }>();
  const [metaDraft, setMetaDraft] = useState({ name: "", description: "", group_name: "" });
  const [publishNote, setPublishNote] = useState("");
  const canvasRef = useRef<HTMLElement | null>(null);
  const hoverOpenTimerRef = useRef<number | undefined>(undefined);
  const hoverCloseTimerRef = useRef<number | undefined>(undefined);
  const nodePreviewRef = useRef<HTMLElement | null>(null);
  const dragRef = useRef<{ pointerId: number; start: Point; origin: Point } | undefined>(undefined);
  const nodeDragRef = useRef<{ pointerId: number; nodeId: string; start: Point; origin: Point; nodes: WorkflowNode[] } | undefined>(undefined);
  const connectionDragRef = useRef<ConnectionDrag | undefined>(undefined);
  const pendingNodesRef = useRef<WorkflowNode[] | undefined>(undefined);

  useEffect(() => {
    setPageMeta({ title: workflow?.name || "模板设计器", description: workflow?.description || "配置模板节点、字段和流程分支。" });
  }, [setPageMeta, workflow]);

  const version = workflow?.versions.find((item) => item.id === versionId) ?? workflow?.versions.at(-1);
  const nodes = version?.nodes ?? [];
  const edges = version?.edges ?? [];
  const selected = nodes.find((node) => node.id === selectedId) ?? nodes[0];
  const selectedEdge = edges.find((edge) => edge.id === selectedEdgeId);
  const readOnly = version?.status !== "draft";
  const filteredNodes = useMemo(() => {
    const keyword = nodeSearch.trim().toLowerCase();
    return keyword ? nodes.filter((node) => node.name.toLowerCase().includes(keyword) || node.key.toLowerCase().includes(keyword)) : nodes;
  }, [nodeSearch, nodes]);
  const incomingNodes = selected ? edges.filter((edge) => edge.target_node_id === selected.id).map((edge) => nodes.find((node) => node.id === edge.source_node_id)).filter((node): node is WorkflowNode => Boolean(node)) : [];
  const outgoingEdges = selected ? edges.filter((edge) => edge.source_node_id === selected.id) : [];
  const formAncestors = useMemo(() => {
    if (!selected) return [];
    const found = new Set<string>();
    const visit = (nodeId: string) => edges.filter((edge) => edge.target_node_id === nodeId).forEach((edge) => { if (!found.has(edge.source_node_id)) { found.add(edge.source_node_id); visit(edge.source_node_id); } });
    visit(selected.id);
    return nodes.filter((node) => found.has(node.id));
  }, [selected?.id, nodes, edges]);
  const formVariables = useMemo<FormVariable[]>(() => [
    { label: "工单标题", value: "ticket.title", group: "工单", source_type: "text" },
    { label: "工单编号", value: "ticket.number", group: "工单", source_type: "text" },
    ...formAncestors.flatMap((node) => node.form_schema.fields.map((field) => ({ label: `${node.name} / ${field.label}`, value: `nodes.${node.key}.${field.type === "script" ? "resources" : "values"}.${field.id}`, group: node.name, source_type: field.type, field_id: field.id }))),
    ...formAncestors.flatMap((node) => node.outputs.map((output) => ({ label: `${node.name} / 输出 / ${String(output.key ?? "")}`, value: `nodes.${node.key}.outputs.${String(output.key ?? "")}`, group: `${node.name}输出`, source_type: "output" }))),
  ], [formAncestors]);
  const sectionMeta = sectionItems.find((item) => item.key === activeSection);

  const fitCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas || !nodes.length) return;
    const minX = Math.min(...nodes.map((node) => node.position.x));
    const minY = Math.min(...nodes.map((node) => node.position.y));
    const maxX = Math.max(...nodes.map((node) => node.position.x + nodeWidth));
    const maxY = Math.max(...nodes.map((node) => node.position.y + nodeHeight));
    const availableWidth = Math.max(260, canvas.clientWidth - 520);
    const availableHeight = Math.max(260, canvas.clientHeight - 150);
    const nextZoom = Math.min(1, Math.max(0.35, Math.min(availableWidth / Math.max(1, maxX - minX), availableHeight / Math.max(1, maxY - minY))));
    setZoom(Math.round(nextZoom * 100) / 100);
    setPan({ x: 260 + (availableWidth - (maxX - minX) * nextZoom) / 2 - minX * nextZoom, y: 120 + (availableHeight - (maxY - minY) * nextZoom) / 2 - minY * nextZoom });
  };

  const load = async () => {
    if (!workflowId) {
      setError("工作流参数缺失。");
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      setError("");
      const next = await api.getWorkflow(workflowId);
      setWorkflow(next);
      const requestedVersionId = query.versionId || next.current_version_id;
      const activeVersion = next.versions.find((item) => item.id === requestedVersionId) ?? next.versions.at(-1);
      setVersionId(activeVersion?.id ?? "");
      setSelectedId((current) => current && activeVersion?.nodes.some((node) => node.id === current) ? current : activeVersion?.nodes[0]?.id ?? "");
    } catch (err) {
      setError(errorMessage(err, "设计器加载失败"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [workflowId, query.versionId]);
  useEffect(() => {
    let active = true;
    void api.listActionProviders().then((providers) => { if (active) setActionProviders(providers as ActionProvider[]); }).catch(() => { if (active) setActionProviders([]); });
    return () => { active = false; };
  }, [api]);
  useEffect(() => {
    if (!loading) window.requestAnimationFrame(fitCanvas);
  }, [loading, versionId, nodes.length]);

  const updateWorkflow = async (nextNodes: WorkflowNode[], nextEdges = edges, extra: Record<string, unknown> = {}) => {
    if (!workflow || !version || readOnly) return undefined;
    try {
      setSaving(true);
      setError("");
      const updated = await api.updateWorkflow(workflow.id, { version_id: version.id, nodes: nextNodes, edges: nextEdges, ...extra });
      setWorkflow(updated);
      return updated;
    } catch (err) {
      setError(errorMessage(err, "保存设计失败"));
    } finally {
      setSaving(false);
    }
  };

  const changeNode = (patch: Partial<WorkflowNode>) => {
    if (!selected || readOnly) return;
    const next = nodes.map((node) => node.id === selected.id ? { ...node, ...patch } : node);
    pendingNodesRef.current = next;
    setWorkflow((current) => current ? { ...current, versions: current.versions.map((item) => item.id === version?.id ? { ...item, nodes: next } : item) } : current);
  };

  const saveNodeChanges = () => {
    if (!selected || readOnly) return;
    const nextNodes = pendingNodesRef.current ?? nodes;
    pendingNodesRef.current = undefined;
    void updateWorkflow(nextNodes, edges);
  };

  const saveNodePatch = (patch: Partial<WorkflowNode>) => {
    changeNode(patch);
    saveNodeChanges();
  };

  const addNode = async (nodeType: WorkflowNode["node_type"] = "general") => {
    if (!workflow || !version || readOnly) return;
    if (nodeType === "summary" && nodes.some((node) => node.node_type === "summary")) return;
    const index = nodes.length + 1;
    const next: WorkflowNode = { id: crypto.randomUUID(), name: `新节点 ${index}`, key: `node-${index}`, description: "", node_type: nodeType, position: { x: Math.max(80, nodes.length * 260), y: 120 }, form_schema: { fields: [] }, completion_rule: { type: "group", operator: "AND", children: [] }, actions: [], inputs: [], outputs: [] };
    await updateWorkflow([...nodes, next], edges);
    setSelectedId(next.id);
  };

  const removeNode = async () => {
    if (!selected || readOnly) return;
    if (nodes.length <= 1) {
      setError("工作流至少需要保留一个节点。");
      return;
    }
    const nextNodes = nodes.filter((node) => node.id !== selected.id);
    const nextEdges = edges.filter((edge) => edge.source_node_id !== selected.id && edge.target_node_id !== selected.id);
    await updateWorkflow(nextNodes, nextEdges);
    setSelectedId(nextNodes[0]?.id ?? "");
    setSelectedEdgeId("");
  };

  const addBranch = async () => {
    if (!selected || readOnly) return;
    const reaches = (fromId: string, targetId: string, visited = new Set<string>()): boolean => {
      if (fromId === targetId) return true;
      if (visited.has(fromId)) return false;
      visited.add(fromId);
      return edges.filter((edge) => edge.source_node_id === fromId).some((edge) => reaches(edge.target_node_id, targetId, visited));
    };
    const target = [...nodes].reverse().find((node) => node.id !== selected.id && !outgoingEdges.some((edge) => edge.target_node_id === node.id) && !reaches(node.id, selected.id));
    if (!target) {
      setError("没有可连接的新节点，请先新增节点。");
      return;
    }
    const edge: WorkflowEdge = { id: crypto.randomUUID(), source_node_id: selected.id, target_node_id: target.id, source_side: "right", target_side: "left", priority: outgoingEdges.length, condition: null, condition_mode: "unconditional" };
    await updateWorkflow(nodes, [...edges, edge]);
    setSelectedEdgeId(edge.id);
  };

  const updateEdge = (nextEdge: WorkflowEdge) => {
    if (readOnly) return;
    const nextEdges = edges.map((edge) => edge.id === nextEdge.id ? nextEdge : edge);
    void updateWorkflow(nodes, nextEdges);
  };

  const applyFormFields = (fields: FormField[], idChanges: Record<string, string>) => {
    if (!selected || readOnly) return;
    const validIds = new Set(fields.map((field) => field.id));
    const rewrittenNodes = nodes.map((node) => {
      const rewritten = rewriteFieldPaths(node, idChanges);
      if (node.id !== selected.id) return rewritten;
      const completionRule = rewriteFieldRule(node.completion_rule as RuleRecord, idChanges, validIds) ?? { type: "group", operator: "AND", children: [] };
      return { ...rewritten, form_schema: { ...node.form_schema, fields: rewriteFieldPaths(fields, idChanges) }, completion_rule: completionRule };
    });
    const rewrittenEdges = edges.map((edge) => {
      if (edge.source_node_id !== selected.id || !edge.condition) return rewriteFieldPaths(edge, idChanges);
      const condition = rewriteFieldRule(edge.condition as RuleRecord, idChanges, validIds);
      return { ...rewriteFieldPaths(edge, idChanges), condition: condition?.children?.length || condition?.type === "rule" ? condition : null, condition_mode: condition ? (condition.negate ? "unless" : "conditional") : "unconditional" };
    });
    void updateWorkflow(rewrittenNodes, rewrittenEdges);
  };

  const updateCompletionRule = (rule: RuleRecord) => saveNodePatch({ completion_rule: rule });
  const updatePredecessorRule = (rule: Record<string, unknown>) => saveNodePatch({ predecessor_rule: rule });
  const updateActions = (actions: Array<Record<string, unknown>>) => saveNodePatch({ actions });

  const removeEdge = async (edgeId: string) => {
    if (readOnly) return;
    await updateWorkflow(nodes, edges.filter((edge) => edge.id !== edgeId));
    setSelectedEdgeId((current) => current === edgeId ? "" : current);
  };

  const scheduleNodePreview = (node: WorkflowNode, event: React.PointerEvent<HTMLElement> | React.FocusEvent<HTMLElement>) => {
    if ("pointerType" in event && event.pointerType === "touch") return;
    if (nodeDragRef.current || connectionDragRef.current) return;
    if (hoverCloseTimerRef.current) window.clearTimeout(hoverCloseTimerRef.current);
    if (hoverOpenTimerRef.current) window.clearTimeout(hoverOpenTimerRef.current);
    if (hoveredNodeId === node.id) return;
    hoverOpenTimerRef.current = window.setTimeout(() => setHoveredNodeId(node.id), 180);
  };
  const hideNodePreview = () => {
    if (hoverOpenTimerRef.current) window.clearTimeout(hoverOpenTimerRef.current);
    if (hoverCloseTimerRef.current) window.clearTimeout(hoverCloseTimerRef.current);
    hoverOpenTimerRef.current = undefined;
    hoverCloseTimerRef.current = undefined;
    setHoveredNodeId("");
  };
  const scheduleNodePreviewClose = () => {
    if (hoverOpenTimerRef.current) window.clearTimeout(hoverOpenTimerRef.current);
    if (hoverCloseTimerRef.current) window.clearTimeout(hoverCloseTimerRef.current);
    hoverCloseTimerRef.current = window.setTimeout(hideNodePreview, 120);
  };
  const keepNodePreviewOpen = () => {
    if (hoverCloseTimerRef.current) window.clearTimeout(hoverCloseTimerRef.current);
  };

  const autoLayout = async () => {
    if (readOnly) return;
    const nextNodes = nodes.map((node, index) => ({ ...node, position: { x: 80 + index * 260, y: 120 } }));
    await updateWorkflow(nextNodes, edges);
    window.requestAnimationFrame(fitCanvas);
  };

  const publish = async () => {
    if (!workflow || !version) return;
    try {
      setSaving(true);
      await api.publishWorkflow(workflow.id, { version_id: version.id, publish_note: publishNote.trim() || "通过 React 设计器发布" });
      setPublishOpen(false);
      setPublishNote("");
      await router.push("/modules/workflow-tickets-react/workflows");
    } catch (err) {
      setError(errorMessage(err, "发布失败"));
    } finally {
      setSaving(false);
    }
  };

  const openMeta = () => {
    if (!workflow) return;
    setMetaDraft({ name: workflow.name, description: workflow.description, group_name: workflow.group_name ?? "" });
    setMetaOpen(true);
  };

  const saveMeta = async () => {
    if (!workflow || readOnly || !metaDraft.name.trim()) return;
    try {
      setSaving(true);
      const next = await api.updateWorkflow(workflow.id, { name: metaDraft.name.trim(), description: metaDraft.description, group_name: metaDraft.group_name.trim() || null });
      setWorkflow(next);
      setMetaOpen(false);
    } catch (err) {
      setError(errorMessage(err, "模板信息保存失败"));
    } finally {
      setSaving(false);
    }
  };

  const runDryRun = async () => {
    if (!workflow) return;
    try {
      const input = JSON.parse(dryRunInput) as Record<string, unknown>;
      setDryRunResult(await api.dryRunWorkflow(workflow.id, input));
    } catch (err) {
      setError(errorMessage(err, "预演失败，请检查输入 JSON。"));
    }
  };

  const createDraft = async () => {
    if (!workflow || !version || !readOnly) return;
    try {
      setSaving(true);
      setError("");
      const draft = await api.createVersion(workflow.id, { source_version_id: version.id, change_note: "基于已发布版本继续编辑" });
      const updated = await api.getWorkflow(workflow.id);
      setWorkflow(updated);
      setVersionId(draft.id);
      setSelectedId(draft.nodes[0]?.id ?? "");
      await router.push(`/modules/workflow-tickets-react/workflows/${workflow.id}/designer?versionId=${draft.id}`);
    } catch (err) {
      setError(errorMessage(err, "创建草稿失败"));
    } finally {
      setSaving(false);
    }
  };

  const startPan = (event: React.PointerEvent<HTMLElement>) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest("button, input, textarea, [role=button]")) return;
    hideNodePreview();
    dragRef.current = { pointerId: event.pointerId, start: { x: event.clientX, y: event.clientY }, origin: pan };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const movePan = (event: React.PointerEvent<HTMLElement>) => {
    if (!dragRef.current || dragRef.current.pointerId !== event.pointerId) return;
    setPan({ x: dragRef.current.origin.x + event.clientX - dragRef.current.start.x, y: dragRef.current.origin.y + event.clientY - dragRef.current.start.y });
  };

  const endPan = () => { dragRef.current = undefined; };

  const connectionSideAtClient = (nodeId: string, clientX: number, clientY: number): ConnectionPointSide | undefined => {
    const card = [...document.querySelectorAll<HTMLElement>('[data-node-id]')].find((element) => element.dataset.nodeId === nodeId);
    if (!card) return undefined;
    const handleSide = connectionPointSides.find(({ side }) => {
      const handle = card.querySelector<HTMLElement>(`.tn-workflow-tickets-node-connection-point.is-${side}`);
      if (!handle) return false;
      const rect = handle.getBoundingClientRect();
      const hitSlop = 12;
      return clientX >= rect.left - hitSlop && clientX <= rect.right + hitSlop && clientY >= rect.top - hitSlop && clientY <= rect.bottom + hitSlop;
    })?.side;
    if (handleSide) return handleSide;
    const cardRect = card.getBoundingClientRect();
    const hitSlop = 32;
    const withinCardHeight = clientY >= cardRect.top - hitSlop && clientY <= cardRect.bottom + hitSlop;
    const withinCardWidth = clientX >= cardRect.left - hitSlop && clientX <= cardRect.right + hitSlop;
    if (withinCardHeight && clientX >= cardRect.right - hitSlop && clientX <= cardRect.right + hitSlop) return "right";
    if (withinCardHeight && clientX >= cardRect.left - hitSlop && clientX <= cardRect.left + hitSlop) return "left";
    if (withinCardWidth && clientY >= cardRect.top - hitSlop && clientY <= cardRect.top + hitSlop) return "top";
    if (withinCardWidth && clientY >= cardRect.bottom - hitSlop && clientY <= cardRect.bottom + hitSlop) return "bottom";
    return undefined;
  };

  const startNodeDrag = (event: React.PointerEvent<HTMLElement>, node: WorkflowNode) => {
    if (connectionDragRef.current?.pointerId === event.pointerId) return;
    const target = event.target as HTMLElement;
    const connectionSide = connectionPointSides.find(({ side }) => target.closest(`.tn-workflow-tickets-node-connection-point.is-${side}`))?.side ?? connectionSideAtClient(node.id, event.clientX, event.clientY);
    if (connectionSide) {
      startConnectionDrag(event as React.PointerEvent<HTMLSpanElement>, node, connectionSide);
      return;
    }
    if (readOnly || event.button !== 0 || target !== event.currentTarget) return;
    hideNodePreview();
    event.stopPropagation();
    setSelectedId(node.id);
    setSelectedEdgeId("");
    nodeDragRef.current = { pointerId: event.pointerId, nodeId: node.id, start: { x: event.clientX, y: event.clientY }, origin: node.position, nodes };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const moveNodeDrag = (event: React.PointerEvent<HTMLElement>) => {
    const drag = nodeDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.stopPropagation();
    const offset = { x: (event.clientX - drag.start.x) / zoom, y: (event.clientY - drag.start.y) / zoom };
    const nextNodes = drag.nodes.map((node) => node.id === drag.nodeId ? { ...node, position: { x: Math.round(drag.origin.x + offset.x), y: Math.round(drag.origin.y + offset.y) } } : node);
    drag.nodes = nextNodes;
    setWorkflow((current) => current ? { ...current, versions: current.versions.map((item) => item.id === version?.id ? { ...item, nodes: nextNodes } : item) } : current);
  };

  const endNodeDrag = (event: React.PointerEvent<HTMLElement>) => {
    const drag = nodeDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.stopPropagation();
    nodeDragRef.current = undefined;
    const movedNode = drag.nodes.find((node) => node.id === drag.nodeId);
    if (movedNode && (movedNode.position.x !== drag.origin.x || movedNode.position.y !== drag.origin.y)) void updateWorkflow(drag.nodes, edges);
  };

  const connectionPointFromClient = (clientX: number, clientY: number): Point | undefined => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const rect = canvas.getBoundingClientRect();
    return { x: (clientX - rect.left - pan.x) / zoom, y: (clientY - rect.top - pan.y) / zoom };
  };

  const connectionTargetFromClient = (clientX: number, clientY: number, sourceNodeId: string): Pick<ConnectionDrag, "targetNodeId" | "targetSide"> | undefined => {
    const element = document.elementFromPoint(clientX, clientY);
    const handle = element?.closest<HTMLElement>('.tn-workflow-tickets-node-connection-point');
    const node = handle?.closest<HTMLElement>('[data-node-id]') ?? element?.closest<HTMLElement>('[data-node-id]') ?? [...document.querySelectorAll<HTMLElement>('[data-node-id]')].find((candidate) => {
      const rect = candidate.getBoundingClientRect();
      return clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
    });
    const targetNodeId = node?.dataset.nodeId;
    if (!targetNodeId || targetNodeId === sourceNodeId || !node) return undefined;
    const handleSide = connectionPointSides.find(({ side }) => handle?.classList.contains(`is-${side}`))?.side;
    const rect = node.getBoundingClientRect();
    const targetSide = handleSide ?? (Object.entries({
      top: Math.abs(clientY - rect.top),
      right: Math.abs(clientX - rect.right),
      bottom: Math.abs(clientY - rect.bottom),
      left: Math.abs(clientX - rect.left),
    }).sort(([, first], [, second]) => first - second)[0]?.[0] as ConnectionPointSide | undefined);
    if (!targetNodeId || targetNodeId === sourceNodeId || !targetSide) return undefined;
    return { targetNodeId, targetSide };
  };

  const startConnectionDrag = (event: React.PointerEvent<HTMLSpanElement>, node: WorkflowNode, side: ConnectionPointSide) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    if (readOnly) return;
    const start = connectionPoint(node, side);
    const next: ConnectionDrag = { pointerId: event.pointerId, sourceNodeId: node.id, sourceSide: side, start, current: start };
    connectionDragRef.current = next;
    setConnectionDrag(next);
    setSelectedId(node.id);
    setSelectedEdgeId("");
    hideNodePreview();
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const moveConnectionDrag = (event: React.PointerEvent<HTMLSpanElement>) => {
    const drag = connectionDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const current = connectionPointFromClient(event.clientX, event.clientY);
    if (!current) return;
    const target = connectionTargetFromClient(event.clientX, event.clientY, drag.sourceNodeId);
    const next = { ...drag, current, ...target };
    connectionDragRef.current = next;
    setConnectionDrag(next);
    event.preventDefault();
    event.stopPropagation();
  };

  const finishConnectionDrag = async (event: React.PointerEvent<HTMLSpanElement>) => {
    const drag = connectionDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    connectionDragRef.current = undefined;
    setConnectionDrag(undefined);
    if (!drag.targetNodeId || !drag.targetSide) return;
    const existing = edges.find((edge) => edge.source_node_id === drag.sourceNodeId && edge.target_node_id === drag.targetNodeId);
    if (existing) {
      setSelectedEdgeId(existing.id);
      return;
    }
    const edge: WorkflowEdge = { id: crypto.randomUUID(), source_node_id: drag.sourceNodeId, target_node_id: drag.targetNodeId, source_side: drag.sourceSide, target_side: drag.targetSide, priority: edges.filter((item) => item.source_node_id === drag.sourceNodeId).length, condition: null, condition_mode: "unconditional" };
    const updated = await updateWorkflow(nodes, [...edges, edge]);
    if (updated) setSelectedEdgeId(edge.id);
  };

  const cancelConnectionDrag = (event: React.PointerEvent<HTMLSpanElement>) => {
    if (connectionDragRef.current?.pointerId !== event.pointerId) return;
    connectionDragRef.current = undefined;
    setConnectionDrag(undefined);
    event.preventDefault();
    event.stopPropagation();
  };

  const moveCanvasPointer = (event: React.PointerEvent<HTMLElement>) => {
    if (connectionDragRef.current?.pointerId === event.pointerId) {
      moveConnectionDrag(event as React.PointerEvent<HTMLSpanElement>);
      return;
    }
    if (nodeDragRef.current?.pointerId === event.pointerId) {
      moveNodeDrag(event);
      return;
    }
    movePan(event);
  };

  const endCanvasPointer = (event: React.PointerEvent<HTMLElement>) => {
    if (connectionDragRef.current?.pointerId === event.pointerId) {
      void finishConnectionDrag(event as React.PointerEvent<HTMLSpanElement>);
      return;
    }
    if (nodeDragRef.current?.pointerId === event.pointerId) {
      endNodeDrag(event);
      return;
    }
    endPan();
  };

  const zoomAt = (next: number) => {
    hideNodePreview();
    setZoom(Math.min(1.6, Math.max(0.35, Math.round(next * 100) / 100)));
  };
  const resetZoom = () => {
    hideNodePreview();
    setZoom(1);
    window.requestAnimationFrame(fitCanvas);
  };

  const handleCanvasWheel = (event: React.WheelEvent<HTMLElement>) => {
    if ((event.target as HTMLElement).closest(".tn-workflow-tickets-canvas-tools")) return;
    event.preventDefault();
    hideNodePreview();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const nextZoom = Math.min(1.6, Math.max(0.35, Math.round((zoom * Math.pow(1.1, event.deltaY > 0 ? -1 : 1)) * 100) / 100));
    if (nextZoom === zoom) return;
    const rect = canvas.getBoundingClientRect();
    const cursor = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    const contentPoint = { x: (cursor.x - pan.x) / zoom, y: (cursor.y - pan.y) / zoom };
    setPan({ x: cursor.x - contentPoint.x * nextZoom, y: cursor.y - contentPoint.y * nextZoom });
    setZoom(nextZoom);
  };

  const innerStyle: CSSProperties = { transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoom})`, transformOrigin: "0 0" };
  const canvasStyle: CSSProperties = {
    backgroundPosition: `${pan.x}px ${pan.y}px, ${pan.x}px ${pan.y}px, ${pan.x}px ${pan.y}px`,
  };

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    const preview = nodePreviewRef.current;
    if (!canvas || !preview || !hoveredNodeId) return;
    const anchor = canvas.querySelector<HTMLElement>(`[data-node-id="${hoveredNodeId}"]`);
    if (!anchor) return;
    const canvasRect = canvas.getBoundingClientRect();
    const anchorRect = anchor.getBoundingClientRect();
    const previewWidth = preview.offsetWidth;
    const previewHeight = preview.offsetHeight;
    const spacingToken = getComputedStyle(canvas).getPropertyValue("--spacing").trim();
    const spacingValue = Number.parseFloat(spacingToken);
    const rootFontSize = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    const spacing = Number.isFinite(spacingValue)
      ? spacingValue * (spacingToken.endsWith("rem") ? rootFontSize : spacingToken.endsWith("px") ? 1 : rootFontSize)
      : 4;
    const margin = spacing * 3;
    const gap = spacing * 5;
    const designer = canvas.closest(".tn-workflow-tickets-designer");
    const leftPanelBounds = designer?.querySelector(".tn-workflow-tickets-designer-left")?.getBoundingClientRect();
    const inspectorBounds = designer?.querySelector(".tn-workflow-tickets-designer-inspector")?.getBoundingClientRect();
    const commandbarBounds = canvas.closest(".tn-workflow-tickets-workflow-designer-page")
      ?.querySelector(".tn-workflow-tickets-designer-commandbar")?.getBoundingClientRect();
    const overlapsVertically = (bounds?: DOMRect) => Boolean(bounds && bounds.bottom > canvasRect.top && bounds.top < canvasRect.bottom);
    const overlapsHorizontally = (bounds?: DOMRect) => Boolean(bounds && bounds.right > canvasRect.left && bounds.left < canvasRect.right);
    const viewport = {
      left: overlapsVertically(leftPanelBounds) ? Math.max(canvasRect.left, leftPanelBounds?.right ?? canvasRect.left) : canvasRect.left,
      right: overlapsVertically(inspectorBounds) ? Math.min(canvasRect.right, inspectorBounds?.left ?? canvasRect.right) : canvasRect.right,
      top: overlapsHorizontally(commandbarBounds) ? Math.max(canvasRect.top, commandbarBounds?.bottom ?? canvasRect.top) : canvasRect.top,
      bottom: canvasRect.bottom,
    };
    const available = {
      right: viewport.right - anchorRect.right - gap - margin,
      left: anchorRect.left - viewport.left - gap - margin,
      bottom: viewport.bottom - anchorRect.bottom - gap - margin,
      top: anchorRect.top - viewport.top - gap - margin,
    };
    const candidates: NodePreviewPlacement[] = ["right", "left", "bottom", "top"];
    const placement = candidates.find((side) => (side === "right" || side === "left" ? available[side] >= previewWidth : available[side] >= previewHeight))
      ?? candidates.reduce((best, side) => available[side] > available[best] ? side : best, "right");
    let left = anchorRect.right - canvasRect.left + gap;
    let top = anchorRect.top - canvasRect.top + (anchorRect.height - previewHeight) / 2;
    if (placement === "left") left = anchorRect.left - canvasRect.left - gap - previewWidth;
    if (placement === "bottom") {
      left = anchorRect.left - canvasRect.left + (anchorRect.width - previewWidth) / 2;
      top = anchorRect.bottom - canvasRect.top + gap;
    }
    if (placement === "top") {
      left = anchorRect.left - canvasRect.left + (anchorRect.width - previewWidth) / 2;
      top = anchorRect.top - canvasRect.top - gap - previewHeight;
    }
    const clamp = (value: number, minimum: number, maximum: number) => Math.min(Math.max(value, minimum), Math.max(minimum, maximum));
    setNodePreviewPlacement(placement);
    setNodePreviewStyle({
      left: clamp(left, viewport.left - canvasRect.left + margin, viewport.right - canvasRect.left - previewWidth - margin),
      top: clamp(top, viewport.top - canvasRect.top + margin, viewport.bottom - canvasRect.top - previewHeight - margin),
    });
  }, [hoveredNodeId, pan.x, pan.y, zoom]);

  useEffect(() => () => {
    if (hoverOpenTimerRef.current) window.clearTimeout(hoverOpenTimerRef.current);
    if (hoverCloseTimerRef.current) window.clearTimeout(hoverCloseTimerRef.current);
  }, []);

  if (loading) {
    return <section className="tn-workflow-tickets-page tn-workflow-tickets-workflow-designer-page"><div className="tn-workflow-tickets-designer-loading" aria-label="正在加载工作流编辑器" aria-busy="true"><span /><span /><span /></div></section>;
  }
  if (!workflow || !version) {
    return <section className="tn-workflow-tickets-page tn-workflow-tickets-workflow-designer-page"><Alert variant="destructive"><AlertDescription>{error || "工作流版本不存在。"}<Button className="ml-3" size="sm" variant="outline" onClick={() => void load()}>重试</Button></AlertDescription></Alert></section>;
  }
  if (!selected || !sectionMeta) {
    return <section className="tn-workflow-tickets-page tn-workflow-tickets-workflow-designer-page"><Alert><AlertDescription>当前工作流没有可配置的节点。</AlertDescription></Alert></section>;
  }

  const completionRule = (selected.completion_rule ?? { type: "group", operator: "AND", children: [] }) as RuleRecord;
  const configuredCompletionRuleCount = countCompletionRules(completionRule);

  return (
    <section className="tn-workflow-tickets-page tn-workflow-tickets-workflow-designer-page">
      <header className="tn-workflow-tickets-designer-commandbar">
        <div className="tn-workflow-tickets-designer-commandbar-main">
          <Button className="tn-workflow-tickets-designer-back" variant="ghost" aria-label="返回模板列表" title="返回模板列表" onClick={() => void router.push("/modules/workflow-tickets-react/workflows")}><RiArrowLeftLine data-icon="inline-start" /><span className="tn-workflow-tickets-designer-button-label">模板列表</span></Button>
          <span className="tn-workflow-tickets-designer-commandbar-divider" aria-hidden="true" />
          <div className="tn-workflow-tickets-designer-heading">
            <h1 className="tn-workflow-tickets-page-title">{workflow.name}</h1>
            <WorkflowStatus value={version.status} />
            {version.status !== "draft" ? <Badge variant="secondary">历史快照 · 只读</Badge> : null}
            <div className="tn-workflow-tickets-designer-meta" aria-label="工作流概况"><Badge variant="outline">v{version.version}</Badge></div>
          </div>
        </div>
        <div className="tn-workflow-tickets-designer-commandbar-actions">
          <Button variant="secondary" aria-label="预演流程" title="预演流程" onClick={() => setDryRunOpen(true)}><RiPlayLine data-icon="inline-start" /><span className="tn-workflow-tickets-designer-button-label">预演</span></Button>
          {!readOnly ? <Button variant="secondary" aria-label="编辑模板信息" title="编辑模板信息" onClick={openMeta}><RiEditLine data-icon="inline-start" /><span className="tn-workflow-tickets-designer-button-label">模板信息</span></Button> : null}
          {readOnly ? <Button disabled={saving} onClick={() => void createDraft()}><RiEditLine data-icon="inline-start" /><span className="tn-workflow-tickets-designer-button-label">编辑为草稿</span></Button> : <Button variant="secondary" disabled={saving} onClick={saveNodeChanges}><RiSaveLine data-icon="inline-start" /><span className="tn-workflow-tickets-designer-button-label">保存草稿</span></Button>}
          {!readOnly ? <Button onClick={() => setPublishOpen(true)} disabled={saving}><RiPlayLine data-icon="inline-start" /><span className="tn-workflow-tickets-designer-button-label">发布工作流</span></Button> : null}
        </div>
      </header>

      <div className="tn-workflow-tickets-designer">
        <aside className="tn-workflow-tickets-designer-panel tn-workflow-tickets-designer-left" onDragOver={(event) => event.preventDefault()}>
          <div className="tn-workflow-tickets-section-header">
            <div className="tn-workflow-tickets-section-heading-main"><h2>节点结构</h2><InspectorHelp label="节点结构" hint="拖动节点调整顺序" /></div>
            <Badge className="tn-workflow-tickets-designer-count" variant="secondary">{nodes.length}</Badge>
          </div>
          <div className="tn-workflow-tickets-designer-search">
            <Input className="pr-8" value={nodeSearch} onChange={(event) => setNodeSearch(event.target.value)} placeholder="搜索节点" aria-label="搜索节点" />
            {nodeSearch ? <Button className="tn-workflow-tickets-designer-search-clear" size="icon-sm" variant="ghost" aria-label="清空节点搜索" onClick={() => setNodeSearch("")}><RiCloseLine /></Button> : null}
          </div>
          <div className="tn-workflow-tickets-designer-list">
            {filteredNodes.map((node) => <button key={node.id} type="button" className={`tn-workflow-tickets-designer-list-item${node.id === selected.id ? " is-active" : ""}`} onClick={() => { setSelectedId(node.id); setSelectedEdgeId(""); }}>
              <RiDraggable className="tn-workflow-tickets-designer-list-handle" aria-hidden="true" />
              <span className="tn-workflow-tickets-designer-list-copy"><strong>{node.name}</strong><small>{node.key}</small></span>
            </button>)}
          </div>
          {!filteredNodes.length ? <p className="tn-workflow-tickets-muted">没有匹配的节点。</p> : null}
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button className="tn-workflow-tickets-designer-add-node" variant="outline" disabled={readOnly} />}><RiAddLine data-icon="inline-start" />新增节点</DropdownMenuTrigger>
            <DropdownMenuContent align="start" side="top">
              <DropdownMenuItem onClick={() => void addNode("general")}>通用节点</DropdownMenuItem>
              <DropdownMenuItem disabled={nodes.some((node) => node.node_type === "summary")} onClick={() => void addNode("summary")}>总结节点</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </aside>

        <section ref={canvasRef} className="tn-workflow-tickets-designer-canvas" style={canvasStyle} aria-label="工作流画布" onPointerDown={startPan} onPointerMove={moveCanvasPointer} onPointerUp={endCanvasPointer} onPointerCancel={endCanvasPointer} onWheel={handleCanvasWheel}>
          <div className="tn-workflow-tickets-canvas-inner" style={innerStyle}>
            <svg className="tn-workflow-tickets-canvas-edges" viewBox="0 0 1400 1000" preserveAspectRatio="none" aria-label="工作流连线">
              <defs><marker id="tn-workflow-edge-arrow-default" markerWidth="10" markerHeight="10" refX="9" refY="0" orient="auto" markerUnits="userSpaceOnUse" viewBox="-1 -6 12 12"><path d="M 0 -5 L 10 0 L 0 5 Z" fill="var(--border)" /></marker><marker id="tn-workflow-edge-arrow-active" markerWidth="10" markerHeight="10" refX="9" refY="0" orient="auto" markerUnits="userSpaceOnUse" viewBox="-1 -6 12 12"><path d="M 0 -5 L 10 0 L 0 5 Z" fill="var(--primary)" /></marker></defs>
              {edges.map((edge) => <g key={edge.id}><path className="tn-workflow-tickets-canvas-edge-hit-area" d={edgePath(edge, nodes)} role="button" tabIndex={0} aria-label="选择工作流连线" onClick={(event) => { event.stopPropagation(); setSelectedEdgeId(edge.id); }} /><path className={`tn-workflow-tickets-canvas-edge-path${selectedEdgeId === edge.id || selected?.id === edge.source_node_id ? " is-selected" : ""}`} d={edgePath(edge, nodes)} markerEnd={`url(#${selectedEdgeId === edge.id || selected?.id === edge.source_node_id ? "tn-workflow-edge-arrow-active" : "tn-workflow-edge-arrow-default"})`} /></g>)}
              {connectionDrag ? <path className={`tn-workflow-tickets-canvas-edge-preview${connectionDrag.targetNodeId ? " is-valid" : ""}`} d={connectionCurve(connectionDrag.start, connectionDrag.current, connectionDrag.sourceSide, connectionDrag.targetSide)} /> : null}
            </svg>
            {selectedEdge ? (() => {
              const position = edgeDeletePosition(selectedEdge, nodes);
              if (!position) return null;
              return <Button className="tn-workflow-tickets-canvas-edge-delete" size="icon-sm" variant="destructiveSolid" disabled={readOnly || saving} aria-label="删除工作流连线" title="删除连线" style={{ left: `${position.x}px`, top: `${position.y}px` }} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); void removeEdge(selectedEdge.id); }}><RiDeleteBinLine aria-hidden="true" /></Button>;
            })() : null}
            {nodes.map((node) => <article key={node.id} data-node-id={node.id} className={`tn-workflow-tickets-node-card${node.id === selected.id ? " is-selected" : ""}${connectionDrag ? " is-connection-mode" : ""}${connectionDrag?.sourceNodeId === node.id ? " is-connection-source" : ""}${connectionDrag?.targetNodeId === node.id ? " is-connection-target" : ""}`} style={{ left: `${node.position.x}px`, top: `${node.position.y}px` }} role="button" tabIndex={0} aria-label={`选择节点：${node.name}`} aria-describedby={hoveredNodeId === node.id ? "tn-workflow-tickets-node-field-preview" : undefined} onPointerEnter={(event) => scheduleNodePreview(node, event)} onPointerLeave={scheduleNodePreviewClose} onFocus={(event) => scheduleNodePreview(node, event)} onBlur={scheduleNodePreviewClose} onPointerDownCapture={(event) => { if (connectionDragRef.current?.pointerId === event.pointerId) return; const side = connectionSideAtClient(node.id, event.clientX, event.clientY); if (side) startConnectionDrag(event as React.PointerEvent<HTMLSpanElement>, node, side); }} onPointerDown={(event) => { if (connectionDragRef.current?.pointerId === event.pointerId) return; const side = connectionSideAtClient(node.id, event.clientX, event.clientY); if (side) startConnectionDrag(event as React.PointerEvent<HTMLSpanElement>, node, side); else startNodeDrag(event, node); }} onPointerMove={(event) => { if (connectionDragRef.current?.pointerId === event.pointerId) moveConnectionDrag(event as React.PointerEvent<HTMLSpanElement>); else if (nodeDragRef.current?.pointerId === event.pointerId) moveNodeDrag(event); }} onPointerUp={(event) => { if (connectionDragRef.current?.pointerId === event.pointerId) void finishConnectionDrag(event as React.PointerEvent<HTMLSpanElement>); else if (nodeDragRef.current?.pointerId === event.pointerId) endNodeDrag(event); }} onPointerCancel={(event) => { if (connectionDragRef.current?.pointerId === event.pointerId) cancelConnectionDrag(event as React.PointerEvent<HTMLSpanElement>); else if (nodeDragRef.current?.pointerId === event.pointerId) endNodeDrag(event); }} onClick={() => { setSelectedId(node.id); setSelectedEdgeId(""); }} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setSelectedId(node.id); setSelectedEdgeId(""); } }}>
              {connectionPointSides.map(({ side, label }) => <span key={side} className={`tn-workflow-tickets-node-connection-point is-${side}`} data-connection-side={side} aria-label={label} onPointerDown={(event) => startConnectionDrag(event, node, side)} onPointerMove={moveConnectionDrag} onPointerUp={finishConnectionDrag} onPointerCancel={cancelConnectionDrag} />)}
              <div className="tn-workflow-tickets-node-title"><span className="tn-workflow-tickets-node-dot" />{node.name}</div>
              <div className="tn-workflow-tickets-node-summary"><span>{node.form_schema.fields.length} 个字段 · {Array.isArray(node.completion_rule?.children) ? node.completion_rule.children.length : 0} 条完成条件</span><span>{node.actions.length} 个动作</span></div>
              <div className="tn-workflow-tickets-card-footer"><Badge variant="secondary">{node.node_type === "summary" ? "总结节点" : "通用节点"}</Badge><span className="tn-workflow-tickets-muted">{node.key}</span></div>
            </article>)}
          </div>
          {hoveredNodeId ? (() => {
            const previewNode = nodes.find((node) => node.id === hoveredNodeId);
            if (!previewNode) return null;
            return <aside id="tn-workflow-tickets-node-field-preview" ref={nodePreviewRef} role="tooltip" className={"tn-workflow-tickets-node-preview is-" + nodePreviewPlacement} style={nodePreviewStyle} onPointerEnter={keepNodePreviewOpen} onPointerLeave={scheduleNodePreviewClose} onPointerDown={(event) => event.stopPropagation()} onWheel={(event) => event.stopPropagation()}>
              <header className="tn-workflow-tickets-node-preview-header"><span className="tn-workflow-tickets-node-preview-icon"><RiFileTextLine /></span><span className="tn-workflow-tickets-node-preview-heading"><strong>{previewNode.name}</strong><small>{previewNode.key} · 字段预览</small></span><span className="tn-workflow-tickets-node-preview-count">{previewNode.form_schema.fields.length} 个</span></header>
              {previewNode.form_schema.fields.length ? <div className="tn-workflow-tickets-node-preview-list">{previewNode.form_schema.fields.map((field) => <div className="tn-workflow-tickets-node-preview-field" key={field.id}><span className="tn-workflow-tickets-node-preview-field-copy"><strong title={field.label}>{field.label}</strong><small title={field.id}>{field.id}</small></span><span className="tn-workflow-tickets-node-preview-field-meta"><span>{fieldTypeLabels[field.type] ?? field.type}</span>{field.required ? <em>必填</em> : null}{field.readonly ? <em>只读</em> : null}{field.hidden ? <em>隐藏</em> : null}</span></div>)}</div> : <div className="tn-workflow-tickets-node-preview-empty"><RiFileTextLine /><span>该节点暂未配置字段</span></div>}
            </aside>;
          })() : null}
          <div className="tn-workflow-tickets-canvas-tools" role="toolbar" aria-label="画布工具">
            <Button size="icon-sm" variant="ghost" disabled aria-label="撤回" title="撤回"><RiArrowLeftLine /></Button><Button size="icon-sm" variant="ghost" disabled aria-label="前进" title="前进"><RiArrowRightLine /></Button><Separator orientation="vertical" /><Button size="icon-sm" variant="ghost" aria-label="缩小画布" title="缩小" onClick={() => zoomAt(zoom - 0.1)}>−</Button><Button className="tn-workflow-tickets-canvas-zoom-value" variant="ghost" aria-label="重置缩放" title="重置缩放" onClick={resetZoom}>{Math.round(zoom * 100)}%</Button><Button size="icon-sm" variant="ghost" aria-label="放大画布" title="放大" onClick={() => zoomAt(zoom + 0.1)}>+</Button><Separator orientation="vertical" /><Button className="tn-workflow-tickets-canvas-auto-layout" variant="ghost" disabled={readOnly} onClick={() => void autoLayout()}>自动布局</Button>
          </div>
        </section>

        <aside className="tn-workflow-tickets-designer-panel tn-workflow-tickets-designer-inspector">
          <div className="tn-workflow-tickets-inspector-card">
            <header className="tn-workflow-tickets-inspector-header">
              <div className="tn-workflow-tickets-inspector-header-title">
                <h2>{sectionMeta.title}</h2>
                <InspectorHelp label={sectionMeta.title} hint={sectionMeta.help} />
              </div>
              {activeSection !== "version" ? <Button type="button" className="h-7 px-2" size="sm" variant="destructiveSolid" disabled={readOnly || saving} onClick={() => setNodeDeleteOpen(true)}><RiDeleteBinLine data-icon="inline-start" aria-hidden="true" />删除节点</Button> : null}
            </header>
            <div className="tn-workflow-tickets-inspector-body"><div className="tn-workflow-tickets-inspector-scroll">
              {activeSection === "basic" ? <section className="tn-workflow-tickets-inspector-section"><FieldGroup><Field><FieldLabel>节点名称</FieldLabel><Input value={selected.name} disabled={readOnly} placeholder="输入节点名称" onChange={(event) => changeNode({ name: event.target.value })} onBlur={saveNodeChanges} /></Field><Field><FieldLabel>节点类型</FieldLabel><Select value={selected.node_type} onValueChange={(value) => { changeNode({ node_type: (value ?? "general") as WorkflowNode["node_type"] }); window.setTimeout(saveNodeChanges, 0); }} disabled={readOnly}><SelectTrigger aria-label="节点类型"><SelectValue /></SelectTrigger><SelectContent><SelectGroup><SelectLabel>节点类型</SelectLabel><SelectItem value="general">通用节点</SelectItem><SelectItem value="summary">总结节点</SelectItem></SelectGroup></SelectContent></Select></Field><Field><FieldLabel>节点描述</FieldLabel><Textarea value={selected.description} rows={3} disabled={readOnly} placeholder="说明节点目标和处理要求" onChange={(event) => changeNode({ description: event.target.value })} onBlur={saveNodeChanges} /></Field></FieldGroup></section> : null}
              {activeSection === "form" ? <section className="tn-workflow-tickets-inspector-section"><div className="tn-workflow-tickets-inspector-summary"><span><strong>{selected.form_schema.fields.length}</strong> 个字段</span><span><strong>{selected.inputs.length}</strong> 个输入</span><span><strong>{selected.outputs.length}</strong> 个输出</span></div>{selected.form_schema.fields.length ? <div className="tn-workflow-tickets-inspector-field-list">{selected.form_schema.fields.map((field) => <button key={field.id} type="button" className="tn-workflow-tickets-inspector-field-item" disabled={readOnly} onClick={() => { setFormInitialFieldId(field.id); setFormOpen(true); }}><span><strong>{field.label}</strong><small>{fieldTypeLabels[field.type] ?? "字段"} · {field.id}</small></span>{field.required ? <Badge variant="outline">必填</Badge> : null}</button>)}</div> : <p className="tn-workflow-tickets-inspector-empty">还没有字段，打开表单设计后即可添加。</p>}<Button className="w-full" variant="secondary" disabled={readOnly} onClick={() => { setFormInitialFieldId(""); setFormOpen(true); }}>编辑节点表单</Button></section> : null}
              {activeSection === "conditions" ? <section className="tn-workflow-tickets-inspector-section">
                <div className="flex min-w-0 items-center justify-between gap-2">
                  <span className="tn-workflow-tickets-muted">{configuredCompletionRuleCount ? `已配置 ${configuredCompletionRuleCount} 条规则` : "未配置完成规则"}</span>
                  <Button size="sm" variant="secondary" disabled={readOnly} onClick={() => setCompletionOpen(true)}><RiEditLine data-icon="inline-start" />弹窗编辑</Button>
                </div>
                {configuredCompletionRuleCount ? <CompletionRuleSummary rule={completionRule} fields={selected.form_schema.fields} nodes={nodes} /> : <p className="m-0 text-xs leading-relaxed text-muted-foreground">未配置规则时，节点可直接完成。</p>}
              </section> : null}
              {activeSection === "flow" ? <section className="tn-workflow-tickets-inspector-section">
                <div className="tn-workflow-tickets-inspector-section-heading"><div><h3>节点流转</h3><p>配置前序节点、后继节点和分支进入条件。</p></div><Button size="sm" variant="secondary" disabled={readOnly} onClick={() => setFlowOpen(true)}><RiEditLine data-icon="inline-start" />弹窗编辑</Button></div>
                <div className="tn-workflow-tickets-inspector-summary"><span><strong>{incomingNodes.length}</strong> 个前序</span><span><strong>{outgoingEdges.length}</strong> 个后继</span><span><strong>{outgoingEdges.filter((edge) => Boolean(edge.condition)).length}</strong> 个条件分支</span></div>
                {incomingNodes.length ? <p className="m-0 text-xs leading-relaxed text-muted-foreground">前序节点：{incomingNodes.map((node) => node.name).join("、")}{incomingNodes.length > 1 ? ` · ${String(selected.predecessor_rule?.operator ?? "OR")} 组合` : ""}</p> : <p className="m-0 text-xs leading-relaxed text-muted-foreground">当前没有前序节点，将作为起始节点进入流程。</p>}
                {outgoingEdges.length ? <p className="m-0 text-xs leading-relaxed text-muted-foreground">后继节点：{outgoingEdges.map((edge) => nodes.find((node) => node.id === edge.target_node_id)?.name ?? "未知节点").join("、")}</p> : <p className="m-0 text-xs leading-relaxed text-muted-foreground">当前没有后继节点，可在弹窗中新增分支。</p>}
              </section> : null}
              {activeSection === "actions" ? <section className="tn-workflow-tickets-inspector-section">{readOnly ? <div className="tn-workflow-tickets-inspector-readonly-list">{selected.actions.map((action, index) => <div className="tn-workflow-tickets-inspector-readonly-item" key={`${String(action.event)}-${String(action.key)}-${index}`}>{String(action.label || action.key || `动作 ${index + 1}`)} · {String(action.event ?? "")}</div>)}{!selected.actions.length ? <p className="tn-workflow-tickets-inspector-empty">此版本没有配置节点动作。</p> : null}</div> : <WorkflowActionEditor actions={selected.actions as Array<Record<string, unknown> & { key: string; event: string; label?: string }>} providers={actionProviders} onChange={updateActions} />}</section> : null}
              {activeSection === "version" ? <section className="tn-workflow-tickets-inspector-section"><div className="tn-workflow-tickets-version-overview"><div className="tn-workflow-tickets-version-overview-header"><div><span className="tn-workflow-tickets-version-overview-eyebrow">工作流快照</span><strong>v{version.version}</strong></div><WorkflowStatus value={version.status} /></div><div className="tn-workflow-tickets-inspector-version-stats"><div><strong>{version.nodes.length}</strong><span>个节点</span></div><div><strong>{version.edges.length}</strong><span>条连线</span></div><div><strong>{version.ticket_count}</strong><span>个工单</span></div></div><div className="tn-workflow-tickets-version-overview-meta"><span>{version.status === "published" ? "发布于" : "创建于"} {formatDate(version.status === "published" ? version.published_at : version.created_at)}</span>{version.source_version_id ? <span>基于历史版本创建</span> : null}</div><div className="tn-workflow-tickets-version-overview-note"><div className="tn-workflow-tickets-version-overview-note-header"><span>版本说明</span>{!readOnly ? <Button size="sm" variant="link" onClick={() => setPublishOpen(true)}>填写说明</Button> : null}</div><p>{version.change_note || "未填写版本说明"}</p></div><p className="tn-workflow-tickets-version-overview-tip">{version.status === "published" ? "当前是已发布版本。点击“编辑为草稿”后，系统会基于此版本创建新的草稿。" : "已创建的工单会继续绑定创建时的版本，新工单使用当前发布版本。"}</p><Button className="w-full" variant="secondary" onClick={() => void router.push(`/modules/workflow-tickets-react/workflows/${workflow.id}/versions`)}>查看版本记录</Button></div></section> : null}
              {error ? <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert> : null}
            </div></div>
            <nav className="tn-workflow-tickets-inspector-nav" aria-label="节点配置分区">
              {sectionItems.map((item) => { const Icon = item.icon; return <TooltipProvider key={item.key} delay={200}><Tooltip><TooltipTrigger render={<button type="button" className={`tn-workflow-tickets-inspector-nav-item${activeSection === item.key ? " is-active" : ""}`} aria-label={`${item.label}：${item.hint}`} aria-current={activeSection === item.key ? "page" : undefined} onClick={() => setActiveSection(item.key)} />}><Icon aria-hidden="true" /></TooltipTrigger><TooltipContent side="left">{item.label}</TooltipContent></Tooltip></TooltipProvider>; })}
            </nav>
          </div>
        </aside>
      </div>

      <WorkflowFormDesignerDialog key={`${selected.id}-${formInitialFieldId}`} open={formOpen} onOpenChange={setFormOpen} node={selected} initialFieldId={formInitialFieldId} variables={formVariables} onApply={applyFormFields} />
      <Dialog open={completionOpen} onOpenChange={setCompletionOpen}><DialogContent className="max-h-[min(48rem,calc(100dvh-2rem))] max-w-3xl overflow-y-auto"><DialogHeader><DialogTitle>{selected.name} · 完成条件</DialogTitle><DialogDescription>所有条件、任意条件和嵌套规则组都可以组合配置。空规则组默认满足。</DialogDescription></DialogHeader><CompletionRuleEditor value={completionRule} fieldOptions={selected.form_schema.fields.map((field) => ({ value: field.id, label: `${field.label} · ${field.id}` }))} nodeOptions={nodes.map((node) => ({ value: node.id, label: `${node.name} · ${node.key}` }))} onChange={updateCompletionRule} /><DialogFooter><Button variant="outline" onClick={() => setCompletionOpen(false)}>完成</Button></DialogFooter></DialogContent></Dialog>
      <Dialog open={flowOpen} onOpenChange={setFlowOpen}><DialogContent className="flex max-h-[min(48rem,calc(100dvh-2rem))] w-[calc(100vw-2rem)] max-w-3xl flex-col gap-0 overflow-hidden p-0"><DialogHeader className="shrink-0 border-b px-5 py-4 pr-12"><DialogTitle>{selected.name} · 节点流转</DialogTitle><DialogDescription>配置前序节点、后继节点和分支进入条件，修改会即时写入当前草稿。</DialogDescription></DialogHeader><div className="min-h-0 flex-1 overflow-y-auto px-5 py-4"><div className="grid gap-6"><section className="grid gap-3"><div><h3 className="text-sm font-semibold">前序节点</h3><p className="mt-1 text-xs leading-relaxed text-muted-foreground">组合多个前序节点的状态，决定当前节点何时进入待处理。</p></div>{incomingNodes.length > 1 ? readOnly ? <div className="grid gap-2">{incomingNodes.map((node) => <div className="rounded-md border p-3 text-sm" key={node.id}>{node.name} · {String(selected.predecessor_rule?.operator ?? "OR")}</div>)}</div> : <PredecessorRuleEditor node={selected} incomingNodes={incomingNodes} onChange={updatePredecessorRule} /> : <p className="m-0 rounded-md border border-dashed p-4 text-center text-xs text-muted-foreground">{incomingNodes.length ? "当前只有一个前序节点，无需配置组合条件。" : "当前节点没有前序节点，将作为起始节点进入流程。"}</p>}</section><section className="grid gap-3 border-t pt-5"><div className="flex min-w-0 items-start justify-between gap-3"><div className="min-w-0"><h3 className="text-sm font-semibold">后继节点与分支</h3><p className="mt-1 text-xs leading-relaxed text-muted-foreground">设置完成当前节点后进入的节点和判断条件。</p></div><Button className="shrink-0" size="sm" variant="secondary" disabled={readOnly} onClick={() => void addBranch()}><RiAddLine data-icon="inline-start" />新增分支</Button></div>{outgoingEdges.length ? <div className="tn-workflow-tickets-edge-config">{outgoingEdges.map((edge, index) => readOnly ? <div className="rounded-md border p-3 text-sm" key={edge.id}>{nodes.find((node) => node.id === edge.target_node_id)?.name ?? "未知节点"} · 优先级 {edge.priority ?? 0} · {edge.condition ? "已配置条件" : "无条件进入"}</div> : <WorkflowEdgeEditor key={edge.id} edge={edge} index={index} nodes={nodes} onChange={updateEdge} onRemove={() => void removeEdge(edge.id)} />)}</div> : <p className="m-0 rounded-md border border-dashed p-4 text-center text-xs text-muted-foreground">当前节点还没有后继节点，点击“新增分支”添加流向。</p>}</section></div></div><DialogFooter className="shrink-0 border-t px-5 py-3"><Button variant="outline" onClick={() => setFlowOpen(false)}>完成</Button></DialogFooter></DialogContent></Dialog>
      <Dialog open={metaOpen} onOpenChange={setMetaOpen}><DialogContent><DialogHeader><DialogTitle>模板信息</DialogTitle><DialogDescription>修改模板名称、描述和分组。</DialogDescription></DialogHeader><FieldGroup><Field><FieldLabel>模板名称</FieldLabel><Input value={metaDraft.name} onChange={(event) => setMetaDraft({ ...metaDraft, name: event.target.value })} /></Field><Field><FieldLabel>模板描述</FieldLabel><Textarea value={metaDraft.description} onChange={(event) => setMetaDraft({ ...metaDraft, description: event.target.value })} /></Field><Field><FieldLabel>模板分组</FieldLabel><Input value={metaDraft.group_name} onChange={(event) => setMetaDraft({ ...metaDraft, group_name: event.target.value })} /></Field></FieldGroup><DialogFooter><Button variant="outline" onClick={() => setMetaOpen(false)}>取消</Button><Button disabled={saving} onClick={() => void saveMeta()}>保存修改</Button></DialogFooter></DialogContent></Dialog>
      <Dialog open={publishOpen} onOpenChange={setPublishOpen}><DialogContent><DialogHeader><DialogTitle>发布工作流</DialogTitle><DialogDescription>发布后会生成不可修改的版本快照，新建工单将使用当前发布版本。</DialogDescription></DialogHeader><Field><FieldLabel>版本说明</FieldLabel><Textarea value={publishNote} onChange={(event) => setPublishNote(event.target.value)} placeholder="例如：增加结果复核节点，调整附件要求" /></Field><DialogFooter><Button variant="outline" onClick={() => setPublishOpen(false)}>取消</Button><Button disabled={saving} onClick={() => void publish()}>确认发布</Button></DialogFooter></DialogContent></Dialog>
      <Dialog open={dryRunOpen} onOpenChange={setDryRunOpen}><DialogContent><DialogHeader><DialogTitle>流程预演</DialogTitle><DialogDescription>按当前版本计算节点和连线，不创建工单，也不会执行节点动作。</DialogDescription></DialogHeader><Field><FieldLabel>根节点初始值（JSON）</FieldLabel><Textarea value={dryRunInput} onChange={(event) => setDryRunInput(event.target.value)} /></Field>{dryRunResult ? <div className="tn-workflow-tickets-dry-run-result"><strong>v{dryRunResult.version} 预演结果</strong>{dryRunResult.nodes.map((node) => <div key={node.name}><RiCheckLine />{node.name}<span>{node.status}</span></div>)}<p>{dryRunResult.explanation}</p></div> : null}<DialogFooter><Button variant="outline" onClick={() => setDryRunOpen(false)}>关闭</Button><Button onClick={() => void runDryRun()}>开始预演</Button></DialogFooter></DialogContent></Dialog>
      <AlertDialog open={nodeDeleteOpen} onOpenChange={setNodeDeleteOpen}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>删除节点？</AlertDialogTitle><AlertDialogDescription>确定删除“{selected.name}”吗？与该节点相连的流转关系也会一并删除。</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>取消</AlertDialogCancel><AlertDialogAction variant="destructive" onClick={(event) => { event.preventDefault(); setNodeDeleteOpen(false); void removeNode(); }}>确认删除</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
    </section>
  );
}
