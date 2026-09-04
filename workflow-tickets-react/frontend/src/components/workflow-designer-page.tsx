import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { ToolNestModuleRouteRenderProps } from "@toolnest/react-module-sdk";
import { RiAddLine, RiArrowLeftLine, RiArrowRightLine, RiCheckLine, RiDeleteBinLine, RiEditLine, RiFileCopyLine, RiGitBranchLine, RiInformationLine, RiPlayLine, RiRefreshLine, RiSaveLine, RiSettings3Line } from "@remixicon/react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

import type { Workflow, WorkflowApi, WorkflowEdge, WorkflowNode } from "../api";

type Router = ToolNestModuleRouteRenderProps["router"];

type Props = {
  api: WorkflowApi;
  router: Router;
  params: Record<string, string>;
  query: Record<string, string>;
};

type SectionKey = "basic" | "form" | "conditions" | "flow" | "actions" | "version";
type Point = { x: number; y: number };

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

const sectionItems: Array<{ key: SectionKey; label: string; hint: string; icon: typeof RiInformationLine }> = [
  { key: "basic", label: "基础", hint: "节点信息", icon: RiInformationLine },
  { key: "form", label: "表单", hint: "表单内容与字段", icon: RiFileCopyLine },
  { key: "conditions", label: "条件", hint: "完成规则", icon: RiCheckLine },
  { key: "flow", label: "流转", hint: "后继与分支", icon: RiGitBranchLine },
  { key: "actions", label: "动作", hint: "节点生命周期动作", icon: RiPlayLine },
  { key: "version", label: "版本", hint: "工作流版本记录", icon: RiSettings3Line },
];

const nodeWidth = 210;
const nodeHeight = 152;

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
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

function edgePath(edge: WorkflowEdge, nodes: WorkflowNode[]): string {
  const source = nodes.find((node) => node.id === edge.source_node_id);
  const target = nodes.find((node) => node.id === edge.target_node_id);
  if (!source || !target) return "";
  const sourceCenter = nodeCenter(source);
  const targetCenter = nodeCenter(target);
  const sourceSide = (edge.source_side as "top" | "right" | "bottom" | "left" | undefined) ?? connectionSide(targetCenter.x - sourceCenter.x, targetCenter.y - sourceCenter.y);
  const targetSide = (edge.target_side as "top" | "right" | "bottom" | "left" | undefined) ?? connectionSide(sourceCenter.x - targetCenter.x, sourceCenter.y - targetCenter.y);
  const start = connectionPoint(source, sourceSide);
  const end = connectionPoint(target, targetSide);
  const horizontal = Math.abs(end.x - start.x) >= Math.abs(end.y - start.y);
  const bend = Math.max(34, Math.min(120, (horizontal ? Math.abs(end.x - start.x) : Math.abs(end.y - start.y)) * 0.42));
  const controlA = horizontal ? { x: start.x + (end.x >= start.x ? bend : -bend), y: start.y } : { x: start.x, y: start.y + (end.y >= start.y ? bend : -bend) };
  const controlB = horizontal ? { x: end.x - (end.x >= start.x ? bend : -bend), y: end.y } : { x: end.x, y: end.y - (end.y >= start.y ? bend : -bend) };
  return `M ${start.x} ${start.y} C ${controlA.x} ${controlA.y}, ${controlB.x} ${controlB.y}, ${end.x} ${end.y}`;
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
    <Tooltip>
      <TooltipTrigger render={<Button size="icon-sm" variant="ghost" aria-label={`查看${label}说明`} />}>
        <RiInformationLine />
      </TooltipTrigger>
      <TooltipContent>{hint}</TooltipContent>
    </Tooltip>
  );
}

export function WorkflowDesignerPage({ api, router, params, query }: Props) {
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
  const [dryRunInput, setDryRunInput] = useState("{}");
  const [dryRunResult, setDryRunResult] = useState<{ version: number; nodes: Array<{ name: string; status: string }>; explanation: string }>();
  const [metaDraft, setMetaDraft] = useState({ name: "", description: "", group_name: "" });
  const [publishNote, setPublishNote] = useState("");
  const canvasRef = useRef<HTMLElement | null>(null);
  const dragRef = useRef<{ pointerId: number; start: Point; origin: Point } | undefined>(undefined);
  const nodeDragRef = useRef<{ pointerId: number; nodeId: string; start: Point; origin: Point; nodes: WorkflowNode[] } | undefined>(undefined);
  const pendingNodesRef = useRef<WorkflowNode[] | undefined>(undefined);

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
    if (!loading) window.requestAnimationFrame(fitCanvas);
  }, [loading, versionId, nodes.length]);

  const updateWorkflow = async (nextNodes: WorkflowNode[], nextEdges = edges, extra: Record<string, unknown> = {}) => {
    if (!workflow || !version || readOnly) return;
    try {
      setSaving(true);
      setError("");
      const updated = await api.updateWorkflow(workflow.id, { version_id: version.id, nodes: nextNodes, edges: nextEdges, ...extra });
      setWorkflow(updated);
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

  const addNode = async () => {
    if (!workflow || !version || readOnly) return;
    const index = nodes.length + 1;
    const next: WorkflowNode = { id: crypto.randomUUID(), name: `新节点 ${index}`, key: `node-${index}`, description: "", node_type: "general", position: { x: Math.max(80, nodes.length * 260), y: 120 }, form_schema: { fields: [] }, completion_rule: { type: "group", operator: "AND", children: [] }, actions: [], inputs: [], outputs: [] };
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

  const removeEdge = async (edgeId: string) => {
    if (readOnly) return;
    await updateWorkflow(nodes, edges.filter((edge) => edge.id !== edgeId));
    setSelectedEdgeId((current) => current === edgeId ? "" : current);
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
      await load();
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
    dragRef.current = { pointerId: event.pointerId, start: { x: event.clientX, y: event.clientY }, origin: pan };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const movePan = (event: React.PointerEvent<HTMLElement>) => {
    if (!dragRef.current || dragRef.current.pointerId !== event.pointerId) return;
    setPan({ x: dragRef.current.origin.x + event.clientX - dragRef.current.start.x, y: dragRef.current.origin.y + event.clientY - dragRef.current.start.y });
  };

  const endPan = () => { dragRef.current = undefined; };

  const startNodeDrag = (event: React.PointerEvent<HTMLElement>, node: WorkflowNode) => {
    if (readOnly || event.button !== 0 || (event.target as HTMLElement).closest("button, input, textarea, [role=button]") !== event.currentTarget) return;
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
    const nextNodes = drag.nodes.map((node) => node.id === drag.nodeId ? { ...node, position: { x: Math.max(0, Math.round(drag.origin.x + offset.x)), y: Math.max(0, Math.round(drag.origin.y + offset.y)) } } : node);
    drag.nodes = nextNodes;
    setWorkflow((current) => current ? { ...current, versions: current.versions.map((item) => item.id === version?.id ? { ...item, nodes: nextNodes } : item) } : current);
  };

  const endNodeDrag = (event: React.PointerEvent<HTMLElement>) => {
    const drag = nodeDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.stopPropagation();
    nodeDragRef.current = undefined;
    if (drag.nodes.some((node, index) => node.position.x !== nodes[index]?.position.x || node.position.y !== nodes[index]?.position.y)) void updateWorkflow(drag.nodes, edges);
  };

  const zoomAt = (next: number) => setZoom(Math.min(1.6, Math.max(0.35, Math.round(next * 100) / 100)));

  const innerStyle: CSSProperties = { transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoom})`, transformOrigin: "0 0" };

  if (loading) {
    return <section className="tn-workflow-tickets-page tn-workflow-tickets-workflow-designer-page"><div className="tn-workflow-tickets-designer-loading" aria-label="正在加载工作流编辑器" aria-busy="true"><span /><span /><span /></div></section>;
  }
  if (!workflow || !version) {
    return <section className="tn-workflow-tickets-page tn-workflow-tickets-workflow-designer-page"><Alert variant="destructive"><AlertDescription>{error || "工作流版本不存在。"}<Button className="ml-3" size="sm" variant="outline" onClick={() => void load()}>重试</Button></AlertDescription></Alert></section>;
  }
  if (!selected || !sectionMeta) {
    return <section className="tn-workflow-tickets-page tn-workflow-tickets-workflow-designer-page"><Alert><AlertDescription>当前工作流没有可配置的节点。</AlertDescription></Alert></section>;
  }

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
            <Badge variant="outline">{nodes.length}</Badge>
          </div>
          <Input value={nodeSearch} onChange={(event) => setNodeSearch(event.target.value)} placeholder="搜索节点" aria-label="搜索节点" />
          <div className="tn-workflow-tickets-designer-list">
            {filteredNodes.map((node) => <button key={node.id} type="button" className={`tn-workflow-tickets-designer-list-item${node.id === selected.id ? " is-active" : ""}`} onClick={() => { setSelectedId(node.id); setSelectedEdgeId(""); }}>
              <RiGitBranchLine className="tn-workflow-tickets-designer-list-handle" aria-hidden="true" />
              <span className="tn-workflow-tickets-designer-list-copy"><strong>{node.name}</strong><small>{node.key}</small></span>
            </button>)}
          </div>
          {!filteredNodes.length ? <p className="tn-workflow-tickets-muted">没有匹配的节点。</p> : null}
          <Button className="tn-workflow-tickets-designer-add-node" variant="outline" disabled={readOnly} onClick={() => void addNode()}><RiAddLine data-icon="inline-start" />新增节点</Button>
        </aside>

        <section ref={canvasRef} className="tn-workflow-tickets-designer-canvas" aria-label="工作流画布" onPointerDown={startPan} onPointerMove={movePan} onPointerUp={endPan} onPointerCancel={endPan}>
          <div className="tn-workflow-tickets-canvas-inner" style={innerStyle}>
            <svg className="tn-workflow-tickets-canvas-edges" viewBox="0 0 1400 1000" preserveAspectRatio="none" aria-label="工作流连线">
              <defs><marker id="tn-workflow-edge-arrow-default" markerWidth="10" markerHeight="10" refX="9" refY="0" orient="auto" markerUnits="userSpaceOnUse" viewBox="-1 -6 12 12"><path d="M 0 -5 L 10 0 L 0 5 Z" fill="var(--border)" /></marker><marker id="tn-workflow-edge-arrow-active" markerWidth="10" markerHeight="10" refX="9" refY="0" orient="auto" markerUnits="userSpaceOnUse" viewBox="-1 -6 12 12"><path d="M 0 -5 L 10 0 L 0 5 Z" fill="var(--primary)" /></marker></defs>
              {edges.map((edge) => <g key={edge.id}><path className="tn-workflow-tickets-canvas-edge-hit-area" d={edgePath(edge, nodes)} role="button" tabIndex={0} aria-label="选择工作流连线" onClick={(event) => { event.stopPropagation(); setSelectedEdgeId(edge.id); }} /><path className={`tn-workflow-tickets-canvas-edge-path${selectedEdgeId === edge.id || selected?.id === edge.source_node_id ? " is-selected" : ""}`} d={edgePath(edge, nodes)} markerEnd={`url(#${selectedEdgeId === edge.id || selected?.id === edge.source_node_id ? "tn-workflow-edge-arrow-active" : "tn-workflow-edge-arrow-default"})`} /></g>)}
            </svg>
            {nodes.map((node) => <article key={node.id} className={`tn-workflow-tickets-node-card${node.id === selected.id ? " is-selected" : ""}`} style={{ left: `${node.position.x}px`, top: `${node.position.y}px` }} role="button" tabIndex={0} aria-label={`选择节点：${node.name}`} onPointerDown={(event) => startNodeDrag(event, node)} onPointerMove={moveNodeDrag} onPointerUp={endNodeDrag} onPointerCancel={endNodeDrag} onClick={() => { setSelectedId(node.id); setSelectedEdgeId(""); }} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setSelectedId(node.id); setSelectedEdgeId(""); } }}>
              <div className="tn-workflow-tickets-node-title"><span className="tn-workflow-tickets-node-dot" />{node.name}</div>
              <div className="tn-workflow-tickets-node-summary"><span>{node.form_schema.fields.length} 个字段 · {Array.isArray(node.completion_rule?.children) ? node.completion_rule.children.length : 0} 条完成条件</span><span>{node.actions.length} 个动作</span></div>
              <div className="tn-workflow-tickets-card-footer"><Badge variant="secondary">{node.node_type === "summary" ? "总结节点" : "通用节点"}</Badge><span className="tn-workflow-tickets-muted">{node.key}</span></div>
            </article>)}
          </div>
          <div className="tn-workflow-tickets-canvas-tools" role="toolbar" aria-label="画布工具">
            <Button size="icon-sm" variant="ghost" disabled aria-label="撤回" title="撤回"><RiArrowLeftLine /></Button><Button size="icon-sm" variant="ghost" disabled aria-label="前进" title="前进"><RiArrowRightLine /></Button><Separator orientation="vertical" /><Button size="icon-sm" variant="ghost" aria-label="缩小画布" title="缩小" onClick={() => zoomAt(zoom - 0.1)}>−</Button><Button className="tn-workflow-tickets-canvas-zoom-value" variant="ghost" aria-label="重置缩放" title="重置缩放" onClick={() => { setZoom(1); window.requestAnimationFrame(fitCanvas); }}>{Math.round(zoom * 100)}%</Button><Button size="icon-sm" variant="ghost" aria-label="放大画布" title="放大" onClick={() => zoomAt(zoom + 0.1)}>+</Button><Separator orientation="vertical" /><Button className="tn-workflow-tickets-canvas-auto-layout" variant="ghost" disabled={readOnly} onClick={() => void autoLayout()}>自动布局</Button>
          </div>
        </section>

        <aside className="tn-workflow-tickets-designer-panel tn-workflow-tickets-designer-inspector">
          <div className="tn-workflow-tickets-inspector-card">
            <header className="tn-workflow-tickets-inspector-header"><div className="tn-workflow-tickets-inspector-header-title"><h2>{sectionMeta.label === "基础" ? "基础信息" : sectionMeta.label}</h2><InspectorHelp label={sectionMeta.label} hint={sectionMeta.hint} /></div>{activeSection !== "version" ? <Button size="sm" variant="destructive" disabled={readOnly} onClick={() => void removeNode()}>删除节点</Button> : null}</header>
            <div className="tn-workflow-tickets-inspector-body"><div className="tn-workflow-tickets-inspector-scroll">
              {activeSection === "basic" ? <section className="tn-workflow-tickets-inspector-section"><FieldGroup><Field><FieldLabel>节点名称</FieldLabel><Input value={selected.name} disabled={readOnly} placeholder="输入节点名称" onChange={(event) => changeNode({ name: event.target.value })} onBlur={saveNodeChanges} /></Field><Field><FieldLabel>节点类型</FieldLabel><Select value={selected.node_type} onValueChange={(value) => { changeNode({ node_type: (value ?? "general") as WorkflowNode["node_type"] }); window.setTimeout(saveNodeChanges, 0); }} disabled={readOnly}><SelectTrigger aria-label="节点类型"><SelectValue /></SelectTrigger><SelectContent><SelectGroup><SelectLabel>节点类型</SelectLabel><SelectItem value="general">通用节点</SelectItem><SelectItem value="summary">总结节点</SelectItem></SelectGroup></SelectContent></Select></Field><Field><FieldLabel>节点描述</FieldLabel><Textarea value={selected.description} disabled={readOnly} placeholder="说明节点目标和处理要求" onChange={(event) => changeNode({ description: event.target.value })} onBlur={saveNodeChanges} /></Field></FieldGroup></section> : null}
              {activeSection === "form" ? <section className="tn-workflow-tickets-inspector-section"><div className="tn-workflow-tickets-inspector-summary"><span><strong>{selected.form_schema.fields.length}</strong> 个字段</span><span><strong>{selected.inputs.length}</strong> 个输入</span><span><strong>{selected.outputs.length}</strong> 个输出</span></div>{selected.form_schema.fields.length ? <div className="tn-workflow-tickets-inspector-field-list">{selected.form_schema.fields.map((field) => <button key={field.id} type="button" className="tn-workflow-tickets-inspector-field-item" disabled={readOnly} onClick={() => void router.push(`/modules/workflow-tickets-react/workflows/${workflow.id}/designer/form/${selected.id}?versionId=${version.id}`)}><span><strong>{field.label}</strong><small>{fieldTypeLabels[field.type] ?? "字段"} · {field.id}</small></span>{field.required ? <Badge variant="outline">必填</Badge> : null}</button>)}</div> : <p className="tn-workflow-tickets-inspector-empty">还没有字段，打开表单设计后即可添加。</p>}<Button className="w-full" variant="secondary" disabled={readOnly} onClick={() => void router.push(`/modules/workflow-tickets-react/workflows/${workflow.id}/designer/form/${selected.id}?versionId=${version.id}`)}>编辑节点表单</Button></section> : null}
              {activeSection === "conditions" ? <section className="tn-workflow-tickets-inspector-section"><div className="tn-workflow-tickets-condition-editor-toolbar"><span className="tn-workflow-tickets-muted">复杂规则可在大窗口中编辑</span><Button size="sm" variant="secondary" disabled={readOnly} onClick={() => void router.push(`/modules/workflow-tickets-react/workflows/${workflow.id}/designer/rules/${selected.id}?versionId=${version.id}`)}><RiEditLine data-icon="inline-start" />弹窗编辑</Button></div><div className="tn-workflow-tickets-inspector-empty">{Array.isArray(selected.completion_rule?.children) && selected.completion_rule.children.length ? `已配置 ${selected.completion_rule.children.length} 条完成规则。` : "暂无完成规则，未配置规则时节点可直接完成。"}</div></section> : null}
              {activeSection === "flow" ? <><section className="tn-workflow-tickets-inspector-section"><div className="tn-workflow-tickets-inspector-section-heading"><div><h3>前序节点</h3><p>组合多个前序节点的状态，决定当前节点何时进入待处理。</p></div><Badge variant="outline">{incomingNodes.length} 个</Badge></div>{incomingNodes.length ? <div className="tn-workflow-tickets-predecessor-list">{incomingNodes.map((node) => <div className="tn-workflow-tickets-predecessor-item" key={node.id}><span className="tn-workflow-tickets-predecessor-icon"><RiGitBranchLine /></span><span className="tn-workflow-tickets-predecessor-copy"><strong>{node.name}</strong><small>{node.key}</small></span></div>)}</div> : <p className="tn-workflow-tickets-inspector-empty">当前节点没有前序节点，将作为起始节点进入流程。</p>}</section><section className="tn-workflow-tickets-inspector-section"><div className="tn-workflow-tickets-inspector-section-heading"><div><h3>后继节点与分支</h3><p>设置完成当前节点后进入的节点和判断条件。</p></div><Button size="sm" variant="secondary" disabled={readOnly} onClick={() => void addBranch()}>新增分支</Button></div>{outgoingEdges.length ? <div className="tn-workflow-tickets-edge-config">{outgoingEdges.map((edge) => <div className={`tn-workflow-tickets-edge-editor${selectedEdge?.id === edge.id ? " is-selected" : ""}`} key={edge.id} onClick={() => setSelectedEdgeId(edge.id)}><div className="tn-workflow-tickets-edge-editor-header"><strong>{nodes.find((node) => node.id === edge.target_node_id)?.name ?? "未知节点"}</strong>{!readOnly ? <Button size="icon-sm" variant="ghost" aria-label="删除分支" onClick={(event) => { event.stopPropagation(); void removeEdge(edge.id); }}><RiDeleteBinLine /></Button> : null}</div><span className="tn-workflow-tickets-muted">优先级 {edge.priority ?? 0} · {edge.condition_mode === "unconditional" || !edge.condition ? "无条件分支" : "已配置条件"}</span></div>)}</div> : <p className="tn-workflow-tickets-inspector-empty">当前节点还没有后继节点，添加分支后可配置流向。</p>}</section></> : null}
              {activeSection === "actions" ? <section className="tn-workflow-tickets-inspector-section">{selected.actions.length ? <div className="tn-workflow-tickets-action-list">{selected.actions.map((action, index) => <div className="tn-workflow-tickets-action-item" key={`${String(action.event)}-${String(action.key)}-${index}`}><div className="tn-workflow-tickets-action-item-header"><strong>{String(action.label || action.key || `动作 ${index + 1}`)}</strong><Badge variant="secondary">{String(action.event || "节点事件")}</Badge></div><span className="tn-workflow-tickets-muted">{String(action.type || "模块动作")}</span></div>)}</div> : <p className="tn-workflow-tickets-inspector-empty">此版本没有配置节点动作。</p>}</section> : null}
              {activeSection === "version" ? <section className="tn-workflow-tickets-inspector-section"><div className="tn-workflow-tickets-version-overview"><div className="tn-workflow-tickets-version-overview-header"><div><span className="tn-workflow-tickets-version-overview-eyebrow">工作流快照</span><strong>v{version.version}</strong></div><WorkflowStatus value={version.status} /></div><div className="tn-workflow-tickets-inspector-version-stats"><div><strong>{version.nodes.length}</strong><span>个节点</span></div><div><strong>{version.edges.length}</strong><span>条连线</span></div><div><strong>{version.ticket_count}</strong><span>个工单</span></div></div><div className="tn-workflow-tickets-version-overview-meta"><span>{version.status === "published" ? "发布于" : "创建于"} {formatDate(version.status === "published" ? version.published_at : version.created_at)}</span>{version.source_version_id ? <span>基于历史版本创建</span> : null}</div><div className="tn-workflow-tickets-version-overview-note"><div className="tn-workflow-tickets-version-overview-note-header"><span>版本说明</span>{!readOnly ? <Button size="sm" variant="link" onClick={() => setPublishOpen(true)}>填写说明</Button> : null}</div><p>{version.change_note || "未填写版本说明"}</p></div><p className="tn-workflow-tickets-version-overview-tip">{version.status === "published" ? "当前是已发布版本。点击“编辑为草稿”后，系统会基于此版本创建新的草稿。" : "已创建的工单会继续绑定创建时的版本，新工单使用当前发布版本。"}</p><Button className="w-full" variant="secondary" onClick={() => void router.push(`/modules/workflow-tickets-react/workflows/${workflow.id}/versions`)}>查看版本记录</Button></div></section> : null}
              {error ? <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert> : null}
            </div></div>
            <nav className="tn-workflow-tickets-inspector-nav" aria-label="节点配置分区">{sectionItems.map((item) => { const Icon = item.icon; return <Tooltip key={item.key}><TooltipTrigger render={<button type="button" className={`tn-workflow-tickets-inspector-nav-item${activeSection === item.key ? " is-active" : ""}`} aria-label={`${item.label}：${item.hint}`} aria-current={activeSection === item.key ? "page" : undefined} onClick={() => setActiveSection(item.key)} />}><Icon aria-hidden="true" /></TooltipTrigger><TooltipContent side="left">{item.label}</TooltipContent></Tooltip>; })}</nav>
          </div>
        </aside>
      </div>

      <Dialog open={metaOpen} onOpenChange={setMetaOpen}><DialogContent><DialogHeader><DialogTitle>模板信息</DialogTitle><DialogDescription>修改模板名称、描述和分组。</DialogDescription></DialogHeader><FieldGroup><Field><FieldLabel>模板名称</FieldLabel><Input value={metaDraft.name} onChange={(event) => setMetaDraft({ ...metaDraft, name: event.target.value })} /></Field><Field><FieldLabel>模板描述</FieldLabel><Textarea value={metaDraft.description} onChange={(event) => setMetaDraft({ ...metaDraft, description: event.target.value })} /></Field><Field><FieldLabel>模板分组</FieldLabel><Input value={metaDraft.group_name} onChange={(event) => setMetaDraft({ ...metaDraft, group_name: event.target.value })} /></Field></FieldGroup><DialogFooter><Button variant="outline" onClick={() => setMetaOpen(false)}>取消</Button><Button disabled={saving} onClick={() => void saveMeta()}>保存修改</Button></DialogFooter></DialogContent></Dialog>
      <Dialog open={publishOpen} onOpenChange={setPublishOpen}><DialogContent><DialogHeader><DialogTitle>发布工作流</DialogTitle><DialogDescription>发布后会生成不可修改的版本快照，新建工单将使用当前发布版本。</DialogDescription></DialogHeader><Field><FieldLabel>版本说明</FieldLabel><Textarea value={publishNote} onChange={(event) => setPublishNote(event.target.value)} placeholder="例如：增加结果复核节点，调整附件要求" /></Field><DialogFooter><Button variant="outline" onClick={() => setPublishOpen(false)}>取消</Button><Button disabled={saving} onClick={() => void publish()}>确认发布</Button></DialogFooter></DialogContent></Dialog>
      <Dialog open={dryRunOpen} onOpenChange={setDryRunOpen}><DialogContent><DialogHeader><DialogTitle>流程预演</DialogTitle><DialogDescription>按当前版本计算节点和连线，不创建工单，也不会执行节点动作。</DialogDescription></DialogHeader><Field><FieldLabel>根节点初始值（JSON）</FieldLabel><Textarea value={dryRunInput} onChange={(event) => setDryRunInput(event.target.value)} /></Field>{dryRunResult ? <div className="tn-workflow-tickets-dry-run-result"><strong>v{dryRunResult.version} 预演结果</strong>{dryRunResult.nodes.map((node) => <div key={node.name}><RiCheckLine />{node.name}<span>{node.status}</span></div>)}<p>{dryRunResult.explanation}</p></div> : null}<DialogFooter><Button variant="outline" onClick={() => setDryRunOpen(false)}>关闭</Button><Button onClick={() => void runDryRun()}>开始预演</Button></DialogFooter></DialogContent></Dialog>
    </section>
  );
}
