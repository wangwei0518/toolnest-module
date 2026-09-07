import { useMemo, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import { RiCheckLine, RiClipboardLine, RiCodeLine, RiDeleteBinLine, RiDownloadLine, RiFileLine, RiImageLine, RiLockLine, RiPlayLine, RiTimeLine, RiUploadCloud2Line } from "@remixicon/react";
import ReactMarkdown from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

import type { FormField, RelatedResource, Ticket, TicketAttachment, TicketNode, WorkflowEdge, WorkflowNode } from "../api";
import type { WorkflowApi } from "../api";

type Values = Record<string, unknown>;
type RuntimeContext = { ticket: Ticket; current: { values: Values; node: TicketNode }; nodes: Record<string, { values: Values; status: string; outputs?: unknown[]; resources?: Record<string, unknown> }> };

const fieldLabels: Record<string, string> = { text: "单行文本", textarea: "多行文本", number: "数字", select: "下拉选择", radio: "单选", multiselect: "多选", switch: "开关", date: "日期", checklist: "清单", todo: "待办", markdown: "Markdown", json: "JSON", code: "代码", file: "文件", image: "图片", url: "链接", script: "脚本" };
const statusLabels: Record<string, string> = { pending: "待处理", ready: "待执行", in_progress: "进行中", waiting: "等待中", blocked: "阻塞", completed: "已完成", skipped: "已跳过", failed: "失败", cancelled: "已终止" };

function text(value: unknown): string { return value == null ? "" : String(value); }
function hasValue(value: unknown): boolean { return value === false || value === 0 || (Array.isArray(value) ? value.length > 0 : value != null && text(value).trim() !== ""); }
function asObject(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function asArray(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
function formatBytes(value: number): string { if (value < 1024) return `${value} B`; if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`; return `${(value / 1024 / 1024).toFixed(1)} MB`; }
function dateTime(value?: string | null): string { return value ? new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "未设置"; }
function resolvePath(root: unknown, path: string): unknown { return path.split(".").filter(Boolean).reduce<unknown>((current, key) => current && typeof current === "object" ? (current as Record<string, unknown>)[key] : undefined, root); }
function templateValue(template: string, context: RuntimeContext): string { return template.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_match, path: string) => text(resolvePath(context, path.trim()))); }

export function buildRuntimeNodes(ticket: Ticket, workflowNodes: WorkflowNode[] = []): RuntimeContext["nodes"] {
  const definitions = new Map(workflowNodes.map((item) => [item.id, item]));
  return Object.fromEntries(ticket.node_instances.flatMap((item) => {
    const definition = definitions.get(item.node_id);
    const value = { values: item.values, status: item.status, outputs: item.outputs, resources: item.resources };
    return [[item.node_id, value], ...(definition ? [[definition.key, value] as const] : [])];
  }));
}

export function hydrateFormValues(definition: WorkflowNode, existing: Values, context: RuntimeContext): Values {
  const next = { ...existing };
  for (const field of definition.form_schema.fields) {
    if (next[field.id] !== undefined) continue;
    const referenced = field.reference?.path ? resolvePath(context, field.reference.path) : undefined;
    if (referenced !== undefined) next[field.id] = referenced;
    else if (field.default_template) next[field.id] = templateValue(field.default_template, context);
    else if (field.default !== undefined) next[field.id] = field.default;
    else if (field.type === "switch") next[field.id] = false;
    else if (["multiselect", "checklist", "todo"].includes(field.type)) next[field.id] = [];
  }
  return next;
}

function compare(left: unknown, operator: string, right: unknown): boolean {
  if (operator === "not_equals") return left !== right;
  if (operator === "contains") return Array.isArray(left) ? left.includes(right) : text(left).includes(text(right));
  if (operator === "not_contains") return !compare(left, "contains", right);
  if (operator === "greater_than") return Number(left) > Number(right);
  if (operator === "less_than") return Number(left) < Number(right);
  if (operator === "greater_or_equal") return Number(left) >= Number(right);
  if (operator === "less_or_equal") return Number(left) <= Number(right);
  return left === right;
}

export function evaluateCompletionRule(rule: Record<string, unknown> | undefined, values: Values, nodes: Record<string, { values: Values; status: string }>): { passed: boolean; reasons: string[] } {
  if (!rule || Object.keys(rule).length === 0) return { passed: true, reasons: [] };
  const kind = text(rule.kind || rule.type);
  let passed = true;
  let reason = text(rule.label);
  if (kind === "group") {
    const children = [...asArray(rule.children), ...asArray(rule.rules)].filter((item): item is Record<string, unknown> => !!item && typeof item === "object" && !Array.isArray(item));
    const results = children.map((child) => evaluateCompletionRule(child, values, nodes));
    passed = text(rule.operator).toUpperCase() === "OR" ? results.some((item) => item.passed) : results.every((item) => item.passed);
    if (!passed) reason = reason || (text(rule.operator).toUpperCase() === "OR" ? "至少满足一个完成条件" : "所有完成条件都必须满足");
  } else if (kind === "field_filled") { passed = hasValue(values[text(rule.field_id)]); reason = reason || `填写“${text(rule.field_id)}”`; }
  else if (kind === "value_compare") { passed = compare(values[text(rule.field_id)], text(rule.operator) || "equals", rule.value ?? rule.operator_value); reason = reason || `“${text(rule.field_id)}”满足比较条件`; }
  else if (kind === "checklist_complete") { const list = asArray(values[text(rule.field_id)]); passed = list.length > 0 && list.every((item) => typeof item === "string" || Boolean(asObject(item).checked)); reason = reason || `完成“${text(rule.field_id)}”清单`; }
  else if (kind === "attachment_count") { passed = asArray(values[text(rule.field_id)]).length >= (Number(rule.count) || 1); reason = reason || `上传至少 ${Number(rule.count) || 1} 个附件`; }
  else if (kind === "manual_confirm") { passed = values[text(rule.field_id)] === true; reason = reason || "确认完成节点"; }
  else if (kind === "node_status") { passed = nodes[text(rule.node_id)]?.status === (text(rule.status) || "completed"); reason = reason || `节点“${text(rule.node_id)}”已完成`; }
  if (rule.negate === true) passed = !passed;
  return { passed, reasons: passed ? [] : [reason || "完成条件尚未满足"] };
}

function FieldShell({ field, children, error }: { field: FormField; children: ReactNode; error?: string | undefined }) {
  return <Field data-field-type={field.type}><FieldLabel htmlFor={`ticket-field-${field.id}`}>{field.label}{field.required ? <span className="text-destructive"> *</span> : null}</FieldLabel>{field.description ? <FieldDescription>{field.description}</FieldDescription> : null}{children}{error ? <p className="text-xs text-destructive">{error}</p> : null}</Field>;
}

function OptionButtons({ field, value, onChange, readonly, multiple = false }: { field: FormField; value: unknown; onChange: (value: unknown) => void; readonly: boolean; multiple?: boolean }) {
  const selected = multiple ? asArray(value).map(String) : [text(value)];
  return <div className="grid gap-2" role={multiple ? "group" : "radiogroup"} aria-label={field.label}>{(field.options ?? []).map((option) => { const optionValue = String(option.value); const active = selected.includes(optionValue); return <Button key={optionValue} type="button" size="sm" variant={active ? "default" : "outline"} className="justify-start" role={multiple ? "checkbox" : "radio"} aria-checked={active} disabled={readonly} onClick={() => onChange(multiple ? selected.includes(optionValue) ? selected.filter((item) => item !== optionValue) : [...selected, optionValue] : option.value)}>{active ? <RiCheckLine data-icon="inline-start" /> : null}{option.label}</Button>; })}</div>;
}

function SelectField({ field, value, onChange, readonly }: { field: FormField; value: unknown; onChange: (value: unknown) => void; readonly: boolean }) {
  const options = field.options ?? [];
  const selected = value == null || value === "" ? null : String(value);
  return <Select value={selected} onValueChange={(next) => onChange(options.find((option) => String(option.value) === next)?.value ?? next)} disabled={readonly}><SelectTrigger className="w-full"><SelectValue placeholder={field.placeholder || "请选择"} /></SelectTrigger><SelectContent><SelectGroup>{options.map((option) => <SelectItem key={String(option.value)} value={String(option.value)}>{option.label}</SelectItem>)}</SelectGroup></SelectContent></Select>;
}

function ChecklistField({ field, value, onChange, readonly }: { field: FormField; value: unknown; onChange: (value: unknown) => void; readonly: boolean }) {
  const checked = new Set(asArray(value).map((item) => typeof item === "string" ? item : text(asObject(item).id)));
  const options = field.items?.map((item) => ({ label: item.label, value: item.id })) ?? field.options ?? asArray(field.config?.items).map((item) => ({ label: text(asObject(item).label), value: text(asObject(item).id) }));
  return <div className="grid gap-2">{options.map((option) => <label key={String(option.value)} className="flex items-center gap-2 text-sm"><Checkbox checked={checked.has(String(option.value))} disabled={readonly} onCheckedChange={(next) => { const id = String(option.value); const updated = next ? [...checked, id] : [...checked].filter((item) => item !== id); onChange(updated); }} /><span className={checked.has(String(option.value)) ? "text-muted-foreground line-through" : undefined}>{option.label}</span></label>)}</div>;
}

function MarkdownField({ value, onChange, readonly }: { value: unknown; onChange: (value: string) => void; readonly: boolean }) {
  const [preview, setPreview] = useState(false);
  const content = text(value);
  return <div className="grid gap-2"><div className="flex flex-wrap gap-2"><Button type="button" size="sm" variant={!preview ? "default" : "outline"} onClick={() => setPreview(false)} disabled={readonly}>编辑</Button><Button type="button" size="sm" variant={preview ? "default" : "outline"} onClick={() => setPreview(true)}>预览</Button></div>{preview ? <div className="prose prose-sm dark:prose-invert min-h-24 max-w-none rounded-md border bg-muted/30 p-3"><ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]}>{content || "暂无内容"}</ReactMarkdown></div> : <Textarea id="ticket-field-markdown" value={content} onChange={(event) => onChange(event.target.value)} disabled={readonly} className="min-h-32" placeholder="支持 Markdown 文本" />}</div>;
}

function AttachmentField({ api, ticket, node, field, value, onChange, readonly }: { api: WorkflowApi; ticket: Ticket; node: TicketNode; field: FormField; value: unknown; onChange: (value: unknown) => void; readonly: boolean }) {
  const [uploading, setUploading] = useState(false); const maxFiles = Math.max(1, Number(field.config?.max_files) || 1); const maxSizeMb = Number(field.config?.max_size_mb) || undefined; const accept = text(field.config?.accept) || (field.type === "image" ? "image/*" : undefined);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const attachments = asArray(value).filter((item): item is TicketAttachment => !!item && typeof item === "object").map((item) => item as TicketAttachment);
  const upload = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = [...(event.target.files ?? [])]; if (!files.length) return; if (attachments.length + files.length > maxFiles) { setError(`最多上传 ${maxFiles} 个文件。`); event.target.value = ""; return; } setUploading(true); setError("");
    try { const next = [...attachments]; for (const file of files) { if (maxSizeMb && file.size > maxSizeMb * 1024 * 1024) throw new Error(`单个文件不能超过 ${maxSizeMb} MB。`); const content = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(",")[1] ?? ""); reader.onerror = () => reject(reader.error ?? new Error("文件读取失败")); reader.readAsDataURL(file); }); const uploaded = await api.uploadAttachment(ticket.id, node.id, { field_id: field.id, filename: file.name, mime_type: file.type, content_base64: content }); next.push(uploaded); } onChange(next); if (inputRef.current) inputRef.current.value = ""; } catch (err) { setError(err instanceof Error ? err.message : "上传附件失败"); } finally { setUploading(false); }
  };
  const remove = async (attachment: TicketAttachment) => { try { await api.deleteAttachment(attachment.id); onChange(attachments.filter((item) => item.id !== attachment.id)); } catch (err) { setError(err instanceof Error ? err.message : "删除附件失败"); } };
  return <div className="grid gap-3"><input ref={inputRef} className="sr-only" type="file" multiple={maxFiles > 1} accept={accept} onChange={(event) => void upload(event)} disabled={readonly || uploading} /><Button type="button" variant="outline" size="sm" className="w-fit" onClick={() => inputRef.current?.click()} disabled={readonly || uploading}><RiUploadCloud2Line data-icon="inline-start" />{uploading ? "上传中…" : field.type === "image" ? "上传图片" : "上传文件"}</Button>{error ? <p className="text-xs text-destructive">{error}</p> : null}{attachments.length ? <div className="grid gap-2">{attachments.map((attachment) => <div key={attachment.id} className="flex items-center gap-3 rounded-md border p-2">{field.type === "image" ? <img className="size-12 shrink-0 rounded-md border object-cover" src={attachment.url} alt={attachment.filename} /> : <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted"><RiFileLine /></span>}<a className="min-w-0 flex-1 truncate text-sm text-primary hover:underline" href={attachment.url} target="_blank" rel="noreferrer">{attachment.filename}</a><span className="text-xs text-muted-foreground">{formatBytes(attachment.size)}</span>{!readonly ? <Button type="button" size="icon-sm" variant="ghost" aria-label={`删除附件 ${attachment.filename}`} onClick={() => void remove(attachment)}><RiDeleteBinLine /></Button> : null}</div>)}</div> : <p className="text-xs text-muted-foreground">暂无附件。</p>}</div>;
}

function ExecutableResourceField({ field, resource }: { field: FormField; resource?: Record<string, unknown> | undefined }) {
  const [copied, setCopied] = useState(""); const content = text(resource?.content); const url = text(resource?.url); const filename = text(resource?.filename) || "run.txt"; const language = text(field.config?.language) || "shell";
  const copy = async (value: string, label: string) => { if (!value) return; try { await navigator.clipboard.writeText(value); setCopied(label); window.setTimeout(() => setCopied(""), 1600); } catch { setCopied("复制失败"); } };
  if (!resource) return <Alert><RiTimeLine /><AlertDescription>保存节点后生成临时执行资源。</AlertDescription></Alert>;
  return <div className="grid gap-3 rounded-md border bg-muted/20 p-3"><div className="flex flex-wrap items-center justify-between gap-2"><div className="flex min-w-0 items-center gap-2"><RiCodeLine /><span className="truncate font-mono text-xs">{filename}</span><Badge variant="outline">{language}</Badge></div><span className="text-xs text-muted-foreground">访问次数受限</span></div><pre className="max-h-48 overflow-auto rounded-md border bg-background p-3 text-xs leading-5">{content || "暂无脚本内容"}</pre><div className="flex flex-wrap gap-2"><Button type="button" size="sm" variant="outline" onClick={() => void copy(content, "内容已复制")}><RiClipboardLine data-icon="inline-start" />复制脚本</Button>{url ? <Button type="button" size="sm" variant="outline" onClick={() => void copy(url, "链接已复制")}><RiDownloadLine data-icon="inline-start" />复制链接</Button> : null}{copied ? <span className="self-center text-xs text-muted-foreground">{copied}</span> : null}</div></div>;
}

export function TicketFormRenderer({ api, ticket, node, definition, workflowNodes = [], values, onChange, resources, readonly, errors }: { api: WorkflowApi; ticket: Ticket; node: TicketNode; definition: WorkflowNode; workflowNodes?: WorkflowNode[]; values: Values; onChange: (values: Values) => void; resources: RelatedResource[]; readonly: boolean; errors?: Record<string, string> }) {
  const context = useMemo<RuntimeContext>(() => {
    return { ticket, current: { values, node }, nodes: buildRuntimeNodes(ticket, workflowNodes) };
  }, [ticket, node, values, workflowNodes]);
  const setValue = (field: FormField, next: unknown) => onChange({ ...values, [field.id]: next });
  return <FieldGroup>{definition.form_schema.fields.filter((field) => field.type !== "hidden" && !field.hidden && !field.config?.hidden).map((field) => { const value = values[field.id] ?? (field.reference?.path ? resolvePath(context, field.reference.path) : undefined); const fieldReadonly = readonly || Boolean(field.readonly || field.reference?.path); const placeholder = field.placeholder ? templateValue(field.placeholder, context) : undefined; const common = { field, value, readonly: fieldReadonly, onChange: (next: unknown) => setValue(field, next) }; if (field.type === "textarea") return <FieldShell key={field.id} field={field} error={errors?.[field.id]}><Textarea id={`ticket-field-${field.id}`} rows={Number(field.config?.rows) || 4} value={text(value)} onChange={(event) => setValue(field, event.target.value)} placeholder={placeholder} disabled={fieldReadonly} /></FieldShell>; if (field.type === "markdown") return <FieldShell key={field.id} field={field} error={errors?.[field.id]}><MarkdownField value={value} onChange={(next) => setValue(field, next)} readonly={fieldReadonly} /></FieldShell>; if (field.type === "code" || field.type === "json") return <FieldShell key={field.id} field={field} error={errors?.[field.id]}><div className="relative"><Badge className="absolute right-2 top-2" variant="outline">{field.type === "json" ? "JSON" : text(field.config?.language) || "text"}</Badge><Textarea id={`ticket-field-${field.id}`} value={typeof value === "string" ? value : value == null ? "" : JSON.stringify(value, null, 2)} onChange={(event) => setValue(field, event.target.value)} disabled={fieldReadonly} className="min-h-40 font-mono text-xs" /></div></FieldShell>; if (field.type === "script") return <FieldShell key={field.id} field={field} error={errors?.[field.id]}><ExecutableResourceField field={field} resource={node.resources[field.id]} /></FieldShell>; if (field.type === "number") return <FieldShell key={field.id} field={field} error={errors?.[field.id]}><Input id={`ticket-field-${field.id}`} type="number" value={value == null ? "" : text(value)} min={text(field.config?.min)} max={text(field.config?.max)} step={text(field.config?.step) || "any"} onChange={(event) => setValue(field, event.target.value === "" ? "" : Number(event.target.value))} placeholder={placeholder} disabled={fieldReadonly} /></FieldShell>; if (field.type === "switch") return <FieldShell key={field.id} field={field} error={errors?.[field.id]}><label className="flex items-center gap-2 text-sm"><Checkbox checked={value === true} onCheckedChange={(next) => setValue(field, next === true)} disabled={fieldReadonly} />{value === true ? "已开启" : "未开启"}</label></FieldShell>; if (field.type === "select") return <FieldShell key={field.id} field={field} error={errors?.[field.id]}><SelectField {...common} /></FieldShell>; if (field.type === "radio") return <FieldShell key={field.id} field={field} error={errors?.[field.id]}><OptionButtons {...common} /></FieldShell>; if (field.type === "multiselect") return <FieldShell key={field.id} field={field} error={errors?.[field.id]}><OptionButtons {...common} multiple /></FieldShell>; if (field.type === "checklist" || field.type === "todo") return <FieldShell key={field.id} field={field} error={errors?.[field.id]}><ChecklistField field={field} value={value} onChange={(next) => setValue(field, next)} readonly={fieldReadonly} /></FieldShell>; if (field.type === "file" || field.type === "image") return <FieldShell key={field.id} field={field} error={errors?.[field.id]}><AttachmentField api={api} ticket={ticket} node={node} field={field} value={value} onChange={(next) => setValue(field, next)} readonly={fieldReadonly} /></FieldShell>; if (field.type === "date") return <FieldShell key={field.id} field={field} error={errors?.[field.id]}><Input id={`ticket-field-${field.id}`} type="date" value={text(value).slice(0, 10)} onChange={(event) => setValue(field, event.target.value)} disabled={fieldReadonly} /></FieldShell>; return <FieldShell key={field.id} field={field} error={errors?.[field.id]}><Input id={`ticket-field-${field.id}`} type={field.type === "url" ? "url" : "text"} value={text(value)} onChange={(event) => setValue(field, event.target.value)} placeholder={placeholder} disabled={fieldReadonly} /></FieldShell>; })}</FieldGroup>;
}

function nodeKind(node: WorkflowNode, incoming: number, outgoing: number): "start" | "merge" | "parallel" | "end" | "node" { if (incoming === 0) return "start"; if (outgoing === 0) return "end"; if (incoming > 1) return "merge"; if (outgoing > 1) return "parallel"; return "node"; }

export function BranchTimeline({ nodes, edges, selectedNodeId, onSelect }: { nodes: TicketNode[]; edges: WorkflowEdge[]; selectedNodeId?: string; onSelect: (nodeId: string) => void }) {
  const levels = useMemo(() => { const incoming = new Map(nodes.map((node) => [node.node_id, 0])); const outgoing = new Map(nodes.map((node) => [node.node_id, 0])); for (const edge of edges) { incoming.set(edge.target_node_id, (incoming.get(edge.target_node_id) ?? 0) + 1); outgoing.set(edge.source_node_id, (outgoing.get(edge.source_node_id) ?? 0) + 1); } const level = new Map<string, number>(); const queue = nodes.filter((node) => (incoming.get(node.node_id) ?? 0) === 0).map((node) => node.node_id); queue.forEach((id) => level.set(id, 0)); while (queue.length) { const source = queue.shift()!; for (const edge of edges.filter((item) => item.source_node_id === source)) { const next = Math.max(level.get(edge.target_node_id) ?? 0, (level.get(source) ?? 0) + 1); level.set(edge.target_node_id, next); queue.push(edge.target_node_id); } } const groups = new Map<number, TicketNode[]>(); for (const node of nodes) { const index = level.get(node.node_id) ?? 0; groups.set(index, [...(groups.get(index) ?? []), node]); } return [...groups.entries()].sort(([left], [right]) => left - right).map(([, items]) => items); }, [nodes, edges]);
  const counts = useMemo(() => { const incoming = new Map<string, number>(); const outgoing = new Map<string, number>(); for (const edge of edges) { incoming.set(edge.target_node_id, (incoming.get(edge.target_node_id) ?? 0) + 1); outgoing.set(edge.source_node_id, (outgoing.get(edge.source_node_id) ?? 0) + 1); } return { incoming, outgoing }; }, [edges]);
  return <div className="tn-workflow-tickets-branch-timeline grid gap-4" aria-label="流程时间轴">{levels.map((level, index) => <div key={index} className="tn-workflow-tickets-branch-level grid gap-3"><div className="tn-workflow-tickets-branch-level-heading flex min-h-6 items-center gap-2 text-xs text-muted-foreground"><span className="tn-workflow-tickets-branch-level-label font-mono tabular-nums">阶段 {String(index + 1).padStart(2, "0")}</span><Separator className="flex-1" />{level.length > 1 ? <span>{level.length} 条并行分支</span> : null}</div><div className="tn-workflow-tickets-branch-level-items grid gap-2">{level.map((node) => { const selectable = ["completed", "ready", "in_progress", "blocked", "waiting"].includes(node.status); const kind = nodeKind({ id: node.node_id, name: node.name, key: node.key, description: "", position: { x: 0, y: 0 }, node_type: "general", form_schema: { fields: [] }, completion_rule: {}, actions: [], inputs: [], outputs: [] }, counts.incoming.get(node.node_id) ?? 0, counts.outgoing.get(node.node_id) ?? 0); return <button key={node.id} type="button" disabled={!selectable} onClick={() => onSelect(node.id)} className={cn("tn-workflow-tickets-branch-node grid min-w-0 gap-2 rounded-md border p-3 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring", node.id === selectedNodeId ? "is-selected border-primary bg-accent" : "border-border bg-card", `is-${node.status}`, selectable ? "hover:border-primary/60 hover:bg-accent/50" : "cursor-not-allowed opacity-60")} aria-current={node.id === selectedNodeId ? "step" : undefined}><span className="flex items-center justify-between gap-2"><span className="flex min-w-0 items-center gap-2"><span className="tn-workflow-tickets-branch-node-icon flex size-7 shrink-0 items-center justify-center rounded-md border border-border bg-muted text-[10px] font-semibold text-primary">{kind === "start" ? "起" : kind === "end" ? "终" : kind === "merge" ? "合" : kind === "parallel" ? "分" : index + 1}</span><span className="truncate text-sm font-semibold">{node.name}</span></span><Badge variant={node.id === selectedNodeId ? "default" : ["completed", "ready", "in_progress", "blocked"].includes(node.status) ? "secondary" : "outline"}>{node.id === selectedNodeId ? "当前节点" : statusLabels[node.status] ?? node.status}</Badge></span><span className="text-xs leading-5 text-muted-foreground">{node.key || "按节点配置处理当前任务。"}</span><span className="flex items-center justify-between gap-2 text-xs text-muted-foreground"><span>{node.values && Object.keys(node.values).length ? `${Object.keys(node.values).length} 个字段` : "暂无字段"}</span><span>{counts.outgoing.get(node.node_id) ?? 0} 条后继</span></span>{node.blocked_reason ? <span className="truncate text-xs text-destructive">{node.blocked_reason}</span> : null}</button>; })}</div></div>)}</div>;
}

export function NodeRuleSummary({ definition, values, ticket }: { definition: WorkflowNode; values: Values; ticket: Ticket }) { const nodes = Object.fromEntries(ticket.node_instances.map((node) => [node.node_id, { values: node.values, status: node.status }])); const evaluation = evaluateCompletionRule(definition.completion_rule, values, nodes); if (evaluation.passed) return <Alert><RiCheckLine /><AlertDescription>完成条件已满足，可以完成此节点。</AlertDescription></Alert>; return <Alert variant="destructive"><RiLockLine /><div><AlertTitle>完成条件未满足</AlertTitle><AlertDescription><ul className="mt-1 list-disc pl-4">{evaluation.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul></AlertDescription></div></Alert>; }
