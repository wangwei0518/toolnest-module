import { useEffect, useMemo, useState } from "react";
import type { ToolNestModuleRouteRenderProps } from "@toolnest/react-module-sdk";
import { RiArrowLeftLine, RiCheckLine, RiCloudLine, RiFileCopyLine, RiLockLine, RiTimeLine } from "@remixicon/react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

import type { Workflow, WorkflowVersion } from "../api";
import type { WorkflowApi } from "../api";
import { useModulePageMeta } from "./module-layout";

type Router = ToolNestModuleRouteRenderProps["router"];
type Props = { api: WorkflowApi; router: Router; params: Record<string, string>; query?: Record<string, string> };

function formatDate(value?: string | null) {
  if (!value) return "尚未发布";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
}
function statusLabel(status: string) { return ({ draft: "草稿", published: "当前发布", archived: "历史版本" } as Record<string, string>)[status] ?? status; }
function countRules(rule: Record<string, unknown> | undefined): number {
  if (!rule) return 0;
  const children = Array.isArray(rule.children) ? rule.children as Array<Record<string, unknown>> : [];
  return (rule.type === "rule" || rule.kind ? 1 : 0) + children.reduce((total, child) => total + countRules(child), 0);
}
function versionStats(version: WorkflowVersion) {
  const fields = version.nodes.reduce((total, node) => total + node.form_schema.fields.length, 0);
  const rules = version.nodes.reduce((total, node) => total + countRules(node.completion_rule), 0);
  const actions = version.nodes.reduce((total, node) => total + node.actions.length, 0);
  return { fields, rules, actions };
}

export function WorkflowVersionsParityPage({ api, router, params }: Props) {
  const { setPageMeta } = useModulePageMeta();
  const workflowId = params.id || params.workflowId || "";
  const [workflow, setWorkflow] = useState<Workflow>();
  const [selectedId, setSelectedId] = useState("");
  const [sourceId, setSourceId] = useState("");
  const [changeNote, setChangeNote] = useState("");
  const [publishNote, setPublishNote] = useState("");
  const [compareBaseId, setCompareBaseId] = useState("");
  const [compareTargetId, setCompareTargetId] = useState("");
  const [comparison, setComparison] = useState<Record<string, unknown>>();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [compareBusy, setCompareBusy] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [error, setError] = useState("");
  const versions = useMemo(() => [...(workflow?.versions ?? [])].sort((a, b) => b.version - a.version), [workflow]);
  const currentPublished = versions.find((item) => item.status === "published");
  const currentDraft = versions.find((item) => item.id === workflow?.current_version_id && item.status === "draft");
  const selected = versions.find((item) => item.id === selectedId) ?? versions[0];
  const source = versions.find((item) => item.id === sourceId) ?? currentDraft ?? currentPublished ?? versions[0];

  useEffect(() => { setPageMeta({ title: workflow?.name ? `${workflow.name} · 版本` : "版本记录", description: "查看快照、比较差异并管理草稿发布。" }); }, [setPageMeta, workflow?.name]);
  const load = async (preferredId = "") => {
    setLoading(true); setError("");
    try {
      const next = await api.getWorkflow(workflowId);
      setWorkflow(next);
      const ordered = [...next.versions].sort((a, b) => b.version - a.version);
      setSelectedId(preferredId || next.current_version_id || ordered[0]?.id || "");
      setCompareTargetId((current) => current || ordered[0]?.id || "");
      setCompareBaseId((current) => current || ordered[1]?.id || ordered[0]?.id || "");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "版本加载失败"); }
    finally { setLoading(false); }
  };
  useEffect(() => { if (workflowId) void load(); }, [workflowId]);

  const openCreate = (version?: WorkflowVersion) => { setSourceId(version?.id ?? source?.id ?? ""); setChangeNote(""); setCreateOpen(true); };
  const createDraft = async () => {
    if (!workflow || !sourceId) return;
    setBusy(true); setError("");
    try {
      const created = await api.createVersion(workflow.id, { source_version_id: sourceId, change_note: changeNote.trim() });
      setCreateOpen(false); await load(created.id);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "创建草稿失败"); }
    finally { setBusy(false); }
  };
  const publish = async () => {
    if (!workflow || !selected || selected.status !== "draft") return;
    setBusy(true); setError("");
    try { await api.publishWorkflow(workflow.id, { version_id: selected.id, publish_note: publishNote.trim() }); setPublishOpen(false); await load(selected.id); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "发布版本失败"); }
    finally { setBusy(false); }
  };
  const compare = async () => {
    if (!workflow || !compareBaseId || !compareTargetId) return;
    setCompareBusy(true); setError("");
    try { setComparison(await api.compareVersions(workflow.id, compareBaseId, compareTargetId)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "版本对比失败"); }
    finally { setCompareBusy(false); }
  };
  const openDesign = (version: WorkflowVersion) => void router.push(`/modules/workflow-tickets-react/workflows/${workflowId}/designer?versionId=${encodeURIComponent(version.id)}`);
  const comparisonNodes = comparison?.nodes as { added?: unknown[]; removed?: unknown[]; changed?: unknown[] } | undefined;
  const diffNodeNames = (items: unknown) => Array.isArray(items) ? items.map((item) => {
    if (typeof item === "string") return item;
    if (item && typeof item === "object") {
      const record = item as Record<string, unknown>;
      return String(record.name ?? record.key ?? record.id ?? "未命名节点");
    }
    return String(item);
  }) : [];
  const addedNodes = diffNodeNames(comparison?.added_nodes ?? comparisonNodes?.added);
  const removedNodes = diffNodeNames(comparison?.removed_nodes ?? comparisonNodes?.removed);
  const changedNodes = diffNodeNames(comparison?.changed_nodes ?? comparisonNodes?.changed);
  const comparisonEdges = comparison?.edges as { added?: number; removed?: number } | undefined;
  const addedEdgeCount = Array.isArray(comparison?.added_edges) ? comparison.added_edges.length : comparisonEdges?.added ?? 0;
  const removedEdgeCount = Array.isArray(comparison?.removed_edges) ? comparison.removed_edges.length : comparisonEdges?.removed ?? 0;

  return <section className="tn-workflow-tickets-page tn-workflow-tickets-version-page">
    <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
      <Button variant="ghost" onClick={() => void router.push(`/modules/workflow-tickets-react/workflows/${workflowId}/designer`)}><RiArrowLeftLine data-icon="inline-start" />返回设计器</Button>
      <Button onClick={() => openCreate()} disabled={!workflow}><RiFileCopyLine data-icon="inline-start" />创建下一版草稿</Button>
    </header>
    {error ? <Alert variant="destructive" className="mb-4"><AlertDescription>{error}</AlertDescription></Alert> : null}
    {loading ? <p className="text-sm text-muted-foreground">正在加载版本历史…</p> : workflow && versions.length ? <div className="grid gap-4 xl:grid-cols-[minmax(18rem,0.75fr)_minmax(0,1.5fr)]">
      <Card className="min-h-0">
        <CardHeader><div className="flex items-start justify-between gap-3"><div><CardTitle>{workflow.name} · 版本</CardTitle><CardDescription>{versions.length} 个快照 · {currentDraft ? "有草稿正在编辑" : "当前没有未发布草稿"}</CardDescription></div>{currentPublished ? <Badge variant="default">当前 v{currentPublished.version}</Badge> : null}</div></CardHeader>
        <CardContent className="max-h-[min(72dvh,56rem)] space-y-2 overflow-y-auto">
          {versions.map((version) => <button key={version.id} type="button" className={`w-full rounded-lg border p-3 text-left transition-colors ${selected?.id === version.id ? "border-primary bg-primary/5" : "hover:bg-muted/50"}`} onClick={() => setSelectedId(version.id)}>
            <div className="flex flex-wrap items-center gap-2"><strong className="text-base">v{version.version}</strong><Badge variant={version.status === "published" ? "default" : version.status === "draft" ? "outline" : "secondary"}>{statusLabel(version.status)}</Badge>{version.id === currentPublished?.id ? <Badge variant="secondary">对外使用</Badge> : null}</div>
            <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground"><RiTimeLine />{formatDate(version.published_at || version.created_at)}</p>
            <p className="mt-2 line-clamp-2 text-sm">{version.change_note || "未填写版本说明"}</p>
            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground"><span>{version.nodes.length} 个节点</span><span>{version.edges.length} 条连线</span><span>{version.ticket_count} 个工单</span></div>
          </button>)}
        </CardContent>
      </Card>
      {selected ? <Card className="min-w-0">
        <CardHeader><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex flex-wrap items-center gap-2"><CardTitle>v{selected.version}</CardTitle><Badge variant={selected.status === "published" ? "default" : selected.status === "draft" ? "outline" : "secondary"}>{statusLabel(selected.status)}</Badge>{selected.id === currentPublished?.id ? <Badge variant="secondary">当前发布</Badge> : null}</div><CardDescription>{selected.status === "draft" ? `创建于 ${formatDate(selected.created_at)}` : `发布于 ${formatDate(selected.published_at)}`}</CardDescription></div><div className="flex flex-wrap gap-2">{selected.status === "draft" ? <Button variant="outline" onClick={() => openDesign(selected)}>继续编辑</Button> : <Button variant="outline" onClick={() => openDesign(selected)}>查看设计</Button>}{selected.status === "draft" ? <Button onClick={() => { setPublishNote(selected.publish_note || selected.change_note || ""); setPublishOpen(true); }}><RiCloudLine data-icon="inline-start" />发布此版本</Button> : <Button onClick={() => openCreate(selected)}><RiFileCopyLine data-icon="inline-start" />基于此版本创建草稿</Button>}</div></div></CardHeader>
        <CardContent className="grid gap-5">
          <section className="grid gap-3"><div><h3 className="text-sm font-semibold">版本对比</h3><p className="text-xs text-muted-foreground">忽略画布坐标，只比较流程含义。</p></div><div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto] sm:items-center"><Select value={compareBaseId} onValueChange={(value) => value && setCompareBaseId(value)}><SelectTrigger className="w-full"><SelectValue placeholder="基准版本" /></SelectTrigger><SelectContent>{versions.map((version) => <SelectItem key={version.id} value={version.id}>v{version.version} · {statusLabel(version.status)}</SelectItem>)}</SelectContent></Select><span className="text-center text-xs text-muted-foreground">对比</span><Select value={compareTargetId} onValueChange={(value) => value && setCompareTargetId(value)}><SelectTrigger className="w-full"><SelectValue placeholder="目标版本" /></SelectTrigger><SelectContent>{versions.map((version) => <SelectItem key={version.id} value={version.id}>v{version.version} · {statusLabel(version.status)}</SelectItem>)}</SelectContent></Select><Button variant="outline" disabled={compareBusy} onClick={() => void compare()}>{compareBusy ? "对比中…" : "生成差异"}</Button></div>
            {comparison ? <div className="grid gap-2 rounded-lg border p-3 text-sm sm:grid-cols-2"><div><strong>新增节点</strong><p className="text-muted-foreground">{addedNodes.join("、") || "无"}</p></div><div><strong>移除节点</strong><p className="text-muted-foreground">{removedNodes.join("、") || "无"}</p></div><div><strong>修改节点</strong><p className="text-muted-foreground">{changedNodes.join("、") || "无"}</p></div><div><strong>连线变化</strong><p className="text-muted-foreground">新增 {addedEdgeCount} 条，移除 {removedEdgeCount} 条</p></div></div> : null}
          </section>
          <section className="grid gap-2 border-t pt-4"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-semibold">版本说明</h3>{selected.source_version_id ? <span className="text-xs text-muted-foreground">基于 v{versions.find((version) => version.id === selected.source_version_id)?.version ?? "—"} 创建</span> : null}</div><p className="rounded-md bg-muted/40 p-3 text-sm">{selected.change_note || "这个版本没有填写变更说明。"}</p></section>
          <section className="grid gap-3 border-t pt-4"><h3 className="text-sm font-semibold">快照内容</h3><div className="grid grid-cols-2 gap-2 sm:grid-cols-5">{[[selected.nodes.length, "节点"], [selected.edges.length, "连线"], [versionStats(selected).fields, "表单字段"], [versionStats(selected).rules, "完成条件"], [versionStats(selected).actions, "节点动作"]].map(([value, label]) => <div className="rounded-md bg-muted/40 p-3 text-center" key={String(label)}><strong className="block text-lg">{value}</strong><span className="text-xs text-muted-foreground">{label}</span></div>)}</div></section>
          <section className="grid gap-2 border-t pt-4"><h3 className="text-sm font-semibold">运行影响</h3><Alert><AlertDescription>{selected.ticket_count ? `当前有 ${selected.ticket_count} 个工单绑定此版本。修改模板不会影响这些工单。` : "当前还没有工单绑定此版本，发布后新建工单即可使用。"}</AlertDescription></Alert></section>
          <div className="flex gap-3 rounded-lg border p-3"><RiLockLine className="mt-0.5 shrink-0 text-muted-foreground" /><div><strong className="text-sm">发布后不可直接修改</strong><p className="mt-1 text-xs text-muted-foreground">如果需要调整，请基于此版本创建新的草稿，完成修改后再发布。</p></div></div>
        </CardContent>
      </Card> : null}
    </div> : !loading ? <Card><CardContent className="p-8 text-center text-sm text-muted-foreground">还没有可用版本</CardContent></Card> : null}

    <Dialog open={createOpen} onOpenChange={setCreateOpen}><DialogContent><DialogHeader><DialogTitle>创建版本草稿</DialogTitle><DialogDescription>复制一个已有版本作为新的编辑起点。草稿不会用于创建正式工单，直到你发布它。</DialogDescription></DialogHeader><Field><FieldLabel>来源版本</FieldLabel><Select value={sourceId} onValueChange={(value) => value && setSourceId(value)}><SelectTrigger className="w-full"><SelectValue placeholder="选择来源版本" /></SelectTrigger><SelectContent>{versions.map((version) => <SelectItem key={version.id} value={version.id}>v{version.version} · {statusLabel(version.status)}</SelectItem>)}</SelectContent></Select></Field><Field><FieldLabel>版本说明</FieldLabel><Textarea rows={4} value={changeNote} onChange={(event) => setChangeNote(event.target.value)} placeholder="例如：增加结果复核节点，调整附件要求" /></Field><DialogFooter><Button variant="outline" onClick={() => setCreateOpen(false)}>取消</Button><Button disabled={busy || !sourceId} onClick={() => void createDraft()}>创建草稿</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={publishOpen} onOpenChange={setPublishOpen}><DialogContent><DialogHeader><DialogTitle>发布工作流版本</DialogTitle><DialogDescription>发布后新建工单将使用此版本；已经创建的工单仍继续使用原版本。</DialogDescription></DialogHeader><Field><FieldLabel>发布说明</FieldLabel><Textarea rows={4} value={publishNote} onChange={(event) => setPublishNote(event.target.value)} placeholder="说明这次发布解决了什么问题" /></Field><DialogFooter><Button variant="outline" onClick={() => setPublishOpen(false)}>取消</Button><Button disabled={busy} onClick={() => void publish()}><RiCheckLine data-icon="inline-start" />确认发布</Button></DialogFooter></DialogContent></Dialog>
  </section>;
}
