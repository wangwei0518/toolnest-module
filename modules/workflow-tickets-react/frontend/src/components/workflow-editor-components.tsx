import { useMemo, useRef, useState, type DragEvent } from "react";
import { RiAddLine, RiArrowDownLine, RiArrowUpLine, RiDeleteBinLine, RiDraggable, RiEyeLine, RiFileTextLine, RiPencilLine } from "@remixicon/react";

import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

import type { FormField, WorkflowEdge, WorkflowNode } from "../api";

const fieldTypes = [
  { value: "text", label: "单行文本", group: "基础字段" }, { value: "textarea", label: "多行文本", group: "基础字段" },
  { value: "number", label: "数字", group: "基础字段" }, { value: "url", label: "链接", group: "基础字段" },
  { value: "select", label: "下拉选择", group: "选择字段" }, { value: "radio", label: "单选", group: "选择字段" },
  { value: "multiselect", label: "多选", group: "选择字段" }, { value: "switch", label: "开关", group: "选择字段" },
  { value: "checklist", label: "检查项", group: "选择字段" }, { value: "todo", label: "Todo List", group: "选择字段" },
  { value: "date", label: "日期", group: "高级字段" }, { value: "markdown", label: "Markdown", group: "高级字段" },
  { value: "json", label: "JSON", group: "高级字段" }, { value: "code", label: "代码", group: "高级字段" },
  { value: "script", label: "可执行脚本", group: "执行字段" }, { value: "file", label: "文件", group: "附件字段" },
  { value: "image", label: "图片", group: "附件字段" },
];
const languageOptions = ["plaintext", "javascript", "typescript", "json", "python", "toml", "markdown", "html", "css", "sql", "shell", "cmd", "powershell"];
const fieldTypeLabel = (type: string) => fieldTypes.find((item) => item.value === type)?.label ?? type;
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
type Choice = { id?: string; label: string; value?: string | number };
type FieldDraft = Omit<FormField, "options" | "items"> & { options?: Choice[]; items?: Array<{ id: string; label: string }> };
export type FormVariable = { label: string; value: string; group: string; source_type?: string; field_id?: string };

function createField(type: string, id: string): FieldDraft {
  const config: Record<string, unknown> = { rows: ["textarea", "markdown"].includes(type) ? 4 : ["code", "json"].includes(type) ? 10 : undefined, language: type === "json" ? "json" : type === "markdown" ? "markdown" : type === "script" ? "shell" : "plaintext", markdown_mode: "split", max_files: 1, max_size_mb: 100 };
  if (type === "image") config.accept = "image/*";
  if (type === "script") { config.filename = "run.sh"; config.execution_template = ""; }
  return { id, type, label: fieldTypeLabel(type), description: "", placeholder: "", required: false, readonly: false, hidden: false, config, ...(["select", "radio", "multiselect"].includes(type) ? { options: [] } : {}), ...(["checklist", "todo"].includes(type) ? { items: [] } : {}) };
}
function templateSummary(value: string, emptyLabel: string) {
  if (!value.trim()) return emptyLabel;
  const variables = value.match(/\{\{\s*[\w.-]+\s*\}\}/g)?.length ?? 0;
  return `${value.split(/\r?\n/).length} 行 · ${value.length} 个字符 · ${variables} 个动态字段`;
}
function templatePreview(value: string, emptyHint: string) {
  return value.trim() ? value.split(/\r?\n/).slice(0, 2).join("\n") : emptyHint;
}

export function WorkflowFormDesignerDialog({ open, onOpenChange, node, initialFieldId, variables = [], onApply }: {
  open: boolean; onOpenChange: (open: boolean) => void; node: WorkflowNode; initialFieldId?: string;
  variables?: FormVariable[];
  onApply: (fields: FormField[], idChanges: Record<string, string>) => void;
}) {
  const initialFields = useMemo(() => (node.form_schema?.fields ?? []).map((field) => ({ ...clone(field), config: { rows: ["textarea", "markdown"].includes(field.type) ? 4 : ["code", "json"].includes(field.type) ? 10 : undefined, language: field.type === "json" ? "json" : field.type === "markdown" ? "markdown" : "plaintext", markdown_mode: "split", max_files: 1, max_size_mb: 100, ...field.config } })) as FieldDraft[], [node.id, node.form_schema]);
  const [fields, setFields] = useState<FieldDraft[]>(initialFields);
  const [pendingFieldDelete, setPendingFieldDelete] = useState<FieldDraft>();
  const [activeId, setActiveId] = useState(initialFieldId && initialFields.some((field) => field.id === initialFieldId) ? initialFieldId : initialFields[0]?.id ?? "");
  const [originIds, setOriginIds] = useState<Record<string, string>>(() => Object.fromEntries(initialFields.map((field) => [field.id, field.id])));
  const [selectedType, setSelectedType] = useState("text");
  const [preview, setPreview] = useState(false);
  const [previewValues, setPreviewValues] = useState<Record<string, unknown>>({});
  const [fieldIdDraft, setFieldIdDraft] = useState<{ fieldId: string; value: string }>();
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [advancedKind, setAdvancedKind] = useState<"default" | "execution">("default");
  const [advancedFieldId, setAdvancedFieldId] = useState("");
  const [advancedDraft, setAdvancedDraft] = useState("");
  const [advancedQuery, setAdvancedQuery] = useState("");
  const advancedTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [draggingId, setDraggingId] = useState("");
  const [dropId, setDropId] = useState("");
  const [error, setError] = useState("");
  const active = fields.find((field) => field.id === activeId);
  const templateVariables = useMemo(() => [...variables, ...fields.filter((field) => field.type !== "script").map((field) => ({ label: `${node.name} / ${field.label}`, value: `current.values.${field.id}`, group: `${node.name}（当前节点）`, source_type: field.type }))], [variables, fields, node.name]);
  const referenceVariables = useMemo(() => {
    const type = active?.type;
    if (!type) return [];
    return variables.filter((item) => {
      if (type === "script") return item.source_type === "script" && item.value.includes(".resources.");
      if (!item.source_type || item.source_type === "output" || item.source_type === type) return true;
      if (["text", "textarea", "markdown", "code", "url"].includes(type) && item.source_type === "text") return true;
      return ["file", "image"].includes(item.source_type) && ["file", "image"].includes(type);
    });
  }, [variables, active?.type]);
  const setField = (id: string, patch: Partial<FieldDraft>) => setFields((current) => current.map((field) => field.id === id ? { ...field, ...patch } : field));
  const setConfig = (patch: Record<string, unknown>) => { if (active) setField(active.id, { config: { ...active.config, ...patch } }); };
  const updateReference = (id: string, path: string) => setFields((current) => current.map((field) => {
    if (field.id !== id) return field;
    const next = { ...field };
    if (path && path !== "__none") next.reference = { path, mode: "snapshot" };
    else delete next.reference;
    return next;
  }));
  const renameField = (oldId: string, nextId: string) => {
    setField(oldId, { id: nextId });
    setOriginIds((current) => { const copy = { ...current }; copy[nextId] = copy[oldId] ?? oldId; delete copy[oldId]; return copy; });
    setActiveId(nextId);
  };
  const openAdvancedEditor = (kind: "default" | "execution") => {
    if (!active) return;
    setAdvancedKind(kind); setAdvancedFieldId(active.id); setAdvancedQuery("");
    setAdvancedDraft(kind === "execution" ? String(active.config?.execution_template ?? "") : active.default_template ?? "");
    setAdvancedOpen(true);
  };
  const applyAdvancedEditor = () => {
    const field = fields.find((item) => item.id === advancedFieldId);
    if (!field) { setAdvancedOpen(false); return; }
    if (advancedKind === "execution") setField(field.id, { config: { ...field.config, execution_template: advancedDraft } });
    else setField(field.id, { default_template: advancedDraft });
    setAdvancedOpen(false);
  };
  const insertVariable = (variable: FormVariable) => {
    const textarea = advancedTextareaRef.current;
    const start = textarea?.selectionStart ?? advancedDraft.length;
    const end = textarea?.selectionEnd ?? start;
    const token = `{{ ${variable.value} }}`;
    const next = `${advancedDraft.slice(0, start)}${token}${advancedDraft.slice(end)}`;
    setAdvancedDraft(next);
    window.requestAnimationFrame(() => { textarea?.focus(); textarea?.setSelectionRange(start + token.length, start + token.length); });
  };
  const addField = () => {
    let number = fields.length + 1;
    let id = `${selectedType}_${number}`;
    while (fields.some((field) => field.id === id)) id = `${selectedType}_${++number}`;
    setFields((current) => [...current, createField(selectedType, id)]);
    setOriginIds((current) => ({ ...current, [id]: id }));
    setActiveId(id);
  };
  const removeField = (id: string) => {
    const index = fields.findIndex((field) => field.id === id);
    if (index < 0) return;
    const next = fields.filter((field) => field.id !== id);
    setOriginIds((current) => { const copy = { ...current }; delete copy[id]; return copy; });
    setFields(next);
    if (activeId === id) setActiveId(next[Math.min(index, next.length - 1)]?.id ?? "");
    setPreviewValues((current) => { if (!(id in current)) return current; const copy = { ...current }; delete copy[id]; return copy; });
    setFieldIdDraft((current) => current?.fieldId === id ? undefined : current);
  };
  const requestFieldDelete = (id: string) => {
    const field = fields.find((item) => item.id === id);
    if (field) setPendingFieldDelete(field);
  };
  const changeType = (type: string) => {
    if (!active || active.type === type) return;
    const replacement = createField(type, active.id);
    setField(active.id, { ...replacement, label: active.label, description: active.description ?? "", placeholder: active.placeholder ?? "", required: Boolean(active.required), readonly: Boolean(active.readonly), hidden: Boolean(active.hidden), ...(active.default !== undefined ? { default: active.default } : {}), ...(active.default_template !== undefined ? { default_template: active.default_template } : {}) });
  };
  const choiceList = (field: FieldDraft) => field.type === "checklist" || field.type === "todo" ? (field.items ?? []) : (field.options ?? []);
  const addChoice = () => {
    if (!active) return;
    const current = choiceList(active);
    const id = `${active.id}_${active.type === "todo" || active.type === "checklist" ? "item" : "option"}_${current.length + 1}`;
    if (active.type === "todo" || active.type === "checklist") setField(active.id, { items: [...(active.items ?? []), { id, label: "" }] });
    else setField(active.id, { options: [...(active.options ?? []), { id, label: "", value: `option_${current.length + 1}` }] });
  };
  const setChoiceLabel = (index: number, label: string) => {
    if (!active) return;
    if (active.type === "todo" || active.type === "checklist") setField(active.id, { items: (active.items ?? []).map((item, itemIndex) => itemIndex === index ? { ...item, label } : item) });
    else setField(active.id, { options: (active.options ?? []).map((item, itemIndex) => itemIndex === index ? { ...item, label } : item) });
  };
  const removeChoice = (index: number) => {
    if (!active) return;
    if (active.type === "todo" || active.type === "checklist") setField(active.id, { items: (active.items ?? []).filter((_, itemIndex) => itemIndex !== index) });
    else setField(active.id, { options: (active.options ?? []).filter((_, itemIndex) => itemIndex !== index) });
  };
  const dropField = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const source = fields.findIndex((field) => field.id === draggingId);
    const target = fields.findIndex((field) => field.id === dropId);
    if (source < 0 || target < 0 || source === target) return;
    const next = [...fields]; const item = next.splice(source, 1)[0]; if (!item) return; next.splice(target, 0, item);
    setFields(next); setDraggingId(""); setDropId("");
  };
  const apply = () => {
    const ids = fields.map((field) => field.id.trim());
    if (ids.some((id) => !id) || new Set(ids).size !== ids.length) { setError("字段 ID 不能为空且不能重复"); return; }
    const cleaned = fields.map((field) => {
      const next = clone(field); next.id = next.id.trim();
      if (["checklist", "todo"].includes(next.type)) next.items = (next.items ?? []).filter((item) => item.label.trim()).map((item) => ({ ...item, label: item.label.trim() }));
      if (["select", "radio", "multiselect"].includes(next.type)) next.options = (next.options ?? []).filter((item) => item.label.trim()).map((item) => ({ ...item, label: item.label.trim() }));
      return next;
    });
    const originalIds = new Set((node.form_schema?.fields ?? []).map((field) => field.id));
    const changes: Record<string, string> = {};
    for (const field of cleaned) {
      const originalId = originIds[field.id] ?? Object.entries(originIds).find(([draftId]) => draftId.trim() === field.id)?.[1] ?? field.id;
      if (originalIds.has(originalId) && originalId !== field.id) changes[originalId] = field.id;
    }
    const appliedFields: FormField[] = cleaned.map((field) => {
      const { options, ...rest } = field;
      return options ? { ...rest, options: options.map((option) => ({ label: option.label, value: option.value ?? option.label })) } : rest;
    });
    onApply(appliedFields, changes); onOpenChange(false); setError("");
  };

  return <>
  <Dialog open={open} onOpenChange={(next) => { if (!next) { setFields(initialFields); setActiveId(initialFieldId && initialFields.some((field) => field.id === initialFieldId) ? initialFieldId : initialFields[0]?.id ?? ""); setOriginIds(Object.fromEntries(initialFields.map((field) => [field.id, field.id]))); setFieldIdDraft(undefined); setPendingFieldDelete(undefined); setError(""); } onOpenChange(next); }}>
    <DialogContent className="flex h-[min(54rem,calc(100dvh-2rem))] max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-[min(90rem,calc(100vw-2rem))] flex-col gap-0 overflow-hidden p-0">
      <DialogHeader className="flex-row items-center justify-between border-b px-5 py-4 pr-12">
        <div><p className="text-xs text-muted-foreground">节点表单</p><DialogTitle className="mt-1">{node.name}</DialogTitle><DialogDescription className="mt-1">{fields.length} 个字段 · 修改会在应用后写入当前节点</DialogDescription></div>
        <Button variant="secondary" onClick={() => setPreview((value) => !value)}>{preview ? <RiPencilLine data-icon="inline-start" /> : <RiEyeLine data-icon="inline-start" />}{preview ? "继续设计" : "预览表单"}</Button>
      </DialogHeader>
      <div className="tn-workflow-tickets-form-dialog-grid grid min-h-0 flex-1 overflow-hidden">
        <aside className="tn-workflow-tickets-form-dialog-fields flex min-h-0 flex-col border-b p-4">
          <div className="mb-3 flex items-center justify-between"><div><h3 className="text-sm font-semibold">字段结构</h3><p className="text-xs text-muted-foreground">拖动调整顺序</p></div><Badge variant="secondary">{fields.length}</Badge></div>
          <div className="mb-3 flex gap-2"><Select value={selectedType} onValueChange={(value) => value && setSelectedType(value)}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{["基础字段", "选择字段", "高级字段", "执行字段", "附件字段"].map((group) => <SelectGroup key={group}><SelectLabel>{group}</SelectLabel>{fieldTypes.filter((field) => field.group === group).map((field) => <SelectItem key={field.value} value={field.value}>{field.label}</SelectItem>)}</SelectGroup>)}</SelectContent></Select><Button size="icon" aria-label="新增字段" onClick={addField}><RiAddLine /></Button></div>
          <div className="min-h-0 flex-1 space-y-1 overflow-y-auto" onDragOver={(event) => event.preventDefault()} onDrop={dropField}>
            {fields.map((field) => <div key={field.id} onDragOver={(event) => { event.preventDefault(); setDropId(field.id); }} className={`flex w-full items-center gap-2 rounded-md border px-2.5 py-2 transition-colors ${field.id === activeId ? "border-primary bg-primary/5" : "border-transparent hover:bg-muted/60"} ${dropId === field.id ? "border-primary" : ""}`}>
              <button type="button" draggable onDragStart={() => { setDraggingId(field.id); setActiveId(field.id); }} onDragEnd={() => { setDraggingId(""); setDropId(""); }} onClick={() => setActiveId(field.id)} className="flex min-w-0 flex-1 items-center gap-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
                <RiDraggable className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" /><span className="min-w-0 flex-1"><strong className="block truncate text-sm font-medium">{field.label || "未命名字段"}</strong><small className="block truncate text-xs text-muted-foreground">{fieldTypeLabel(field.type)}</small></span>
              </button>
              <Button type="button" variant="destructiveSolid" size="icon-sm" aria-label={`删除字段 ${field.label || "未命名字段"}`} onClick={() => requestFieldDelete(field.id)}><RiDeleteBinLine /></Button>
            </div>)}
            {!fields.length ? <p className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">选择字段类型并新增。</p> : null}
          </div>
        </aside>
        <main className="tn-workflow-tickets-form-dialog-preview flex min-h-0 flex-col overflow-hidden border-b p-4">
          <div className="mb-3"><h3 className="text-sm font-semibold">{preview ? "填写预览" : "表单画布"}</h3><p className="text-xs text-muted-foreground">{preview ? "检查实际填写体验" : "点击字段即可配置"}</p></div>
          <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border bg-muted/20 p-5">
            <div className="mx-auto grid max-w-2xl gap-5">{fields.map((field) => <Field key={field.id} className={field.hidden ? "opacity-50" : ""}><FieldLabel>{field.label || "未命名字段"}{field.required ? <span className="text-destructive"> *</span> : null}</FieldLabel>{field.description ? <FieldDescription>{field.description}</FieldDescription> : null}
              {field.type === "textarea" || ["markdown", "json", "code", "script"].includes(field.type) ? <Textarea rows={Number(field.config?.rows ?? 4)} value={String(previewValues[field.id] ?? field.default ?? "")} placeholder={field.placeholder || ""} disabled={!preview || field.readonly} onChange={(event) => setPreviewValues((current) => ({ ...current, [field.id]: event.target.value }))} /> : field.type === "switch" ? <Switch checked={Boolean(previewValues[field.id])} disabled={!preview} onCheckedChange={(checked) => setPreviewValues((current) => ({ ...current, [field.id]: checked }))} /> : ["select", "radio", "multiselect"].includes(field.type) ? <Select value={String(previewValues[field.id] ?? "")} onValueChange={(value) => setPreviewValues((current) => ({ ...current, [field.id]: value ?? "" }))} disabled={!preview}><SelectTrigger className="w-full"><SelectValue placeholder={field.placeholder || "请选择"} /></SelectTrigger><SelectContent>{(field.options ?? []).map((option, index) => <SelectItem key={option.id ?? String(index)} value={String(option.value ?? option.label)}>{option.label}</SelectItem>)}</SelectContent></Select> : field.type === "checklist" || field.type === "todo" ? <div className="grid gap-2">{(field.items ?? []).map((item) => <label key={item.id} className="flex items-center gap-2 text-sm"><Checkbox disabled={!preview} /><span>{item.label}</span></label>)}</div> : field.type === "file" || field.type === "image" ? <Input type="file" accept={String(field.config?.accept ?? (field.type === "image" ? "image/*" : ""))} disabled={!preview} /> : <Input type={field.type === "number" ? "number" : field.type === "date" ? "date" : field.type === "url" ? "url" : "text"} value={String(previewValues[field.id] ?? field.default ?? "")} placeholder={field.placeholder || ""} disabled={!preview || field.readonly} onChange={(event) => setPreviewValues((current) => ({ ...current, [field.id]: event.target.value }))} />}
            </Field>)}</div>
          </div>
        </main>
        <aside className="flex min-h-0 flex-col overflow-hidden p-4">
          {active ? <><div className="mb-3 flex items-center justify-between"><div><h3 className="text-sm font-semibold">字段配置</h3><p className="text-xs text-muted-foreground">{fieldTypeLabel(active.type)}</p></div><Button type="button" variant="destructiveSolid" size="icon-sm" aria-label={`删除字段 ${active.label || "未命名字段"}`} onClick={() => requestFieldDelete(active.id)}><RiDeleteBinLine /></Button></div>
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1"><FieldGroup>
              <Field><FieldLabel>字段类型</FieldLabel><Select value={active.type} onValueChange={(value) => value && changeType(value)}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{fieldTypes.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent></Select></Field>
              <Field><FieldLabel>字段名称</FieldLabel><Input value={active.label} onChange={(event) => setField(active.id, { label: event.target.value })} placeholder="输入字段名称" /></Field>
              <Field><FieldLabel>字段 ID</FieldLabel><Input value={fieldIdDraft?.fieldId === active.id ? fieldIdDraft.value : active.id} onChange={(event) => setFieldIdDraft({ fieldId: active.id, value: event.target.value })} onBlur={() => { if (fieldIdDraft?.fieldId === active.id && fieldIdDraft.value !== active.id) renameField(active.id, fieldIdDraft.value); setFieldIdDraft(undefined); }} placeholder="例如 customer_name" /></Field>
              <Field><FieldLabel>帮助说明</FieldLabel><Textarea rows={2} value={active.description ?? ""} onChange={(event) => setField(active.id, { description: event.target.value })} placeholder="解释填写要求" /></Field>
              {["text", "textarea", "url", "select", "multiselect", "markdown", "json", "code"].includes(active.type) ? <Field><FieldLabel>占位提示</FieldLabel><Input value={active.placeholder ?? ""} onChange={(event) => setField(active.id, { placeholder: event.target.value })} /></Field> : null}
              {["select", "radio", "multiselect", "checklist", "todo"].includes(active.type) ? <Field><FieldLabel>{active.type === "todo" ? "Todo 项目" : "选项"}</FieldLabel><div className="grid gap-2">{choiceList(active).map((item, index) => <div className="flex gap-2" key={item.id ?? index}><Input value={item.label} placeholder={active.type === "todo" ? "输入待办内容" : "输入选项内容"} onChange={(event) => setChoiceLabel(index, event.target.value)} /><Button size="icon" variant="ghost" aria-label={`删除选项 ${index + 1}`} onClick={() => removeChoice(index)}><RiDeleteBinLine /></Button></div>)}<Button variant="outline" size="sm" onClick={addChoice}><RiAddLine data-icon="inline-start" />添加{active.type === "todo" ? " Todo" : "选项"}</Button></div></Field> : null}
              {active.type === "number" ? <div className="grid grid-cols-3 gap-2">{(["min", "max", "step"] as const).map((key) => <Field key={key}><FieldLabel>{{ min: "最小值", max: "最大值", step: "步长" }[key]}</FieldLabel><Input type="number" value={String(active.config?.[key] ?? "")} onChange={(event) => setConfig({ [key]: event.target.value === "" ? undefined : Number(event.target.value) })} /></Field>)}</div> : null}
              {["textarea", "markdown", "code", "json"].includes(active.type) ? <Field><FieldLabel>编辑器行数</FieldLabel><Input type="number" min={2} max={30} value={String(active.config?.rows ?? 4)} onChange={(event) => setConfig({ rows: Number(event.target.value) })} /></Field> : null}
              {active.type === "code" ? <Field><FieldLabel>代码语言</FieldLabel><Select value={String(active.config?.language ?? "plaintext")} onValueChange={(value) => setConfig({ language: value })}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{languageOptions.map((language) => <SelectItem key={language} value={language}>{language}</SelectItem>)}</SelectContent></Select></Field> : null}
              {active.type === "markdown" ? <Field><FieldLabel>展示模式</FieldLabel><Select value={String(active.config?.markdown_mode ?? "split")} onValueChange={(value) => setConfig({ markdown_mode: value })}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="split">编辑与预览</SelectItem><SelectItem value="edit">仅编辑</SelectItem><SelectItem value="preview">仅预览</SelectItem></SelectContent></Select></Field> : null}
              {active.type === "script" ? <><Field><FieldLabel>脚本语言</FieldLabel><Select value={String(active.config?.language ?? "shell")} onValueChange={(value) => setConfig({ language: value, filename: value === "python" ? "run.py" : value === "javascript" ? "run.js" : value === "typescript" ? "run.ts" : value === "powershell" ? "run.ps1" : value === "cmd" ? "run.cmd" : "run.sh" })}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{["shell", "cmd", "powershell", "python", "javascript", "typescript"].map((language) => <SelectItem key={language} value={language}>{language}</SelectItem>)}</SelectContent></Select></Field><Field><FieldLabel>脚本文件名</FieldLabel><Input value={String(active.config?.filename ?? "run.sh")} onChange={(event) => setConfig({ filename: event.target.value })} /></Field><Field><FieldLabel>执行脚本模板</FieldLabel><div className="tn-workflow-tickets-form-variable-editor"><div className="tn-workflow-tickets-form-template-summary"><div><strong>{String(active.config?.execution_template ?? "").trim() ? "已配置脚本模板" : "未设置脚本模板"}</strong><small>{templateSummary(String(active.config?.execution_template ?? ""), "尚未设置脚本模板")}</small></div><Button size="sm" variant="secondary" onClick={() => openAdvancedEditor("execution")}><RiPencilLine data-icon="inline-start" />高级编辑</Button></div><p className="tn-workflow-tickets-form-template-preview">{templatePreview(String(active.config?.execution_template ?? ""), "节点进入后会根据当前数据生成可复制的 curl 执行命令。")}</p></div></Field><div className="grid grid-cols-2 gap-2">{(["expires_in_days", "max_access_count"] as const).map((key) => <Field key={key}><FieldLabel>{key === "expires_in_days" ? "链接有效期（天）" : "最多访问次数"}</FieldLabel><Input type="number" min={1} value={String(active.config?.[key] ?? "")} onChange={(event) => setConfig({ [key]: Number(event.target.value) })} /></Field>)}</div></> : null}
              {["file", "image"].includes(active.type) ? <><Field><FieldLabel>允许格式</FieldLabel><Input value={String(active.config?.accept ?? (active.type === "image" ? "image/*" : ""))} onChange={(event) => setConfig({ accept: event.target.value })} placeholder=".pdf,.docx" /></Field><div className="grid grid-cols-2 gap-2">{(["max_files", "max_size_mb"] as const).map((key) => <Field key={key}><FieldLabel>{key === "max_files" ? "最多文件" : "单文件 MB"}</FieldLabel><Input type="number" min={1} value={String(active.config?.[key] ?? (key === "max_files" ? 1 : 100))} onChange={(event) => setConfig({ [key]: Number(event.target.value) })} /></Field>)}</div></> : null}
              {referenceVariables.length > 0 || active.reference ? <><div className="tn-workflow-tickets-form-config-divider" aria-hidden="true" /><Field><FieldLabel>字段引用</FieldLabel><Select value={active.reference?.path ?? "__none"} onValueChange={(path) => updateReference(active.id, path ?? "__none")}><SelectTrigger className="w-full"><SelectValue placeholder="选择前序节点字段或输出" /></SelectTrigger><SelectContent><SelectItem value="__none">不引用字段</SelectItem>{referenceVariables.map((item) => <SelectItem key={item.value} value={item.value}>{item.label} · {item.field_id ? `字段 ID：${item.field_id}` : item.value} · {fieldTypeLabel(item.source_type ?? "output")}</SelectItem>)}</SelectContent></Select><FieldDescription>引用后会在节点进入时保存一份当前值，并自动以只读方式展示。</FieldDescription></Field></> : null}
              {!["date", "switch", "file", "image", "script"].includes(active.type) && !active.reference ? <><div className="tn-workflow-tickets-form-config-divider" aria-hidden="true" /><Field><FieldLabel>动态默认值</FieldLabel><div className="tn-workflow-tickets-form-variable-editor"><div className="tn-workflow-tickets-form-template-summary"><div><strong>{active.default_template?.trim() ? "已配置模板" : "未设置模板"}</strong><small>{templateSummary(active.default_template ?? "", "尚未设置动态默认值")}</small></div><Button size="sm" variant="secondary" onClick={() => openAdvancedEditor("default")}><RiPencilLine data-icon="inline-start" />高级编辑</Button></div><p className="tn-workflow-tickets-form-template-preview">{templatePreview(active.default_template ?? "", "可在模板中插入前序节点字段，运行工单时会自动解析。")}</p></div></Field></> : null}
            </FieldGroup></div>
            <div className="mt-4 grid gap-3 border-t pt-4">{([["required", "必填", "提交前必须填写"], ["readonly", "只读", "展示但不可修改"], ["hidden", "隐藏", "运行时不展示"]] as const).filter(([key]) => key !== "required" || !["switch", "script"].includes(active.type)).filter(([key]) => key !== "readonly" || active.type !== "script").map(([key, label, description]) => <label key={key} className="flex items-center justify-between gap-3"><span><strong className="block text-sm font-medium">{label}</strong><small className="text-xs text-muted-foreground">{description}</small></span><Switch checked={Boolean(active[key])} onCheckedChange={(checked) => setField(active.id, { [key]: checked })} /></label>)}</div>
          </> : <p className="m-auto text-center text-sm text-muted-foreground">新增或选择一个字段后，在这里配置。</p>}
        </aside>
      </div>
      <DialogFooter className="items-center justify-between border-t px-5 py-3"><div className="mr-auto text-xs text-muted-foreground">按 Esc 可取消并关闭</div>{error ? <span role="alert" className="text-sm text-destructive">{error}</span> : null}<Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button><Button onClick={apply}>应用到节点</Button></DialogFooter>
    </DialogContent>
  </Dialog>
  <Dialog open={advancedOpen} onOpenChange={setAdvancedOpen}>
    <DialogContent className="flex h-[min(48rem,calc(100dvh-2rem))] max-h-[calc(100dvh-2rem)] max-w-5xl flex-col overflow-hidden">
      <DialogHeader className="shrink-0"><DialogTitle>{advancedKind === "execution" ? "执行脚本模板" : "动态默认值"} · {fields.find((field) => field.id === advancedFieldId)?.label ?? "字段模板"}</DialogTitle><DialogDescription>支持 <code>{"{{ 字段路径 }}"}</code>，也可以从右侧插入工单或前序节点变量。</DialogDescription></DialogHeader>
      <div className="grid min-h-0 min-w-0 flex-1 grid-rows-[auto_auto] content-start gap-4 overflow-y-auto md:grid-rows-1 md:content-normal md:grid-cols-[minmax(0,1fr)_minmax(14rem,0.45fr)] md:overflow-hidden">
        <Field className="min-w-0 md:min-h-0 md:flex-1"><FieldLabel>{advancedKind === "execution" ? "脚本内容" : "模板内容"}</FieldLabel><Textarea ref={advancedTextareaRef} className="tn-workflow-tickets-template-editor-textarea min-w-0 overflow-y-auto font-mono" rows={14} value={advancedDraft} onChange={(event) => setAdvancedDraft(event.target.value)} placeholder="输入模板内容，或从右侧插入动态字段" />{advancedKind === "execution" ? <FieldDescription className="grid gap-1.5 leading-5"><span>Ubuntu 执行：保存节点后，在工单详情中复制临时脚本链接。请先下载并检查脚本，再执行：</span><code className="block break-all rounded-md border bg-muted/40 px-2 py-1.5 font-mono text-[0.7rem]">curl -fL '脚本链接' -o run.sh && sed -i 's/\r$//' run.sh && chmod 700 run.sh && bash ./run.sh</code><span>Python 脚本使用 <code>python3 run.py</code>；链接有效期和访问次数受下方配置限制。</span></FieldDescription> : null}</Field>
        <div className="grid min-h-0 min-w-0 content-start gap-2 overflow-y-auto"><Input value={advancedQuery} onChange={(event) => setAdvancedQuery(event.target.value)} placeholder="搜索可用变量" aria-label="搜索可用变量" /><div className="max-h-72 space-y-3 overflow-y-auto">{[...new Set(templateVariables.map((item) => item.group))].map((group) => { const items = templateVariables.filter((item) => item.group === group && `${item.label} ${item.value} ${item.group}`.toLowerCase().includes(advancedQuery.trim().toLowerCase())); return items.length ? <section key={group}><h3 className="mb-1 text-xs font-semibold text-muted-foreground">{group}</h3><div className="grid gap-1">{items.map((item) => <Button key={item.value} className="h-auto justify-start whitespace-normal px-2 py-1.5 text-left" size="sm" variant="ghost" onClick={() => insertVariable(item)}><span><strong className="block text-xs">{item.label}</strong><code className="text-[0.65rem] text-muted-foreground">{item.value}</code></span></Button>)}</div></section> : null; })}</div></div>
      </div>
      <DialogFooter className="shrink-0"><Button variant="outline" onClick={() => setAdvancedOpen(false)}>取消</Button><Button onClick={applyAdvancedEditor}>应用修改</Button></DialogFooter>
    </DialogContent>
  </Dialog>
  <AlertDialog open={Boolean(pendingFieldDelete)} onOpenChange={(next) => { if (!next) setPendingFieldDelete(undefined); }}>
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>删除字段？</AlertDialogTitle>
        <AlertDialogDescription>确认从当前表单草稿中删除“{pendingFieldDelete?.label || "未命名字段"}”？点击“应用到节点”后才会写入当前节点。</AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>取消</AlertDialogCancel>
        <AlertDialogAction variant="destructive" onClick={(event) => { event.preventDefault(); if (!pendingFieldDelete) return; removeField(pendingFieldDelete.id); setPendingFieldDelete(undefined); }}>确认删除</AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
  </>;
}

export type RuleRecord = Record<string, unknown> & { type?: string; operator?: string; children?: RuleRecord[]; kind?: string; field_id?: string; label?: string; message?: string; value?: unknown; operator_value?: string };
const ruleKinds = [{ label: "字段已填写", value: "field_filled" }, { label: "字段值比较", value: "value_compare" }, { label: "Checklist 完成", value: "checklist_complete" }, { label: "附件数量", value: "attachment_count" }, { label: "人工确认", value: "manual_confirm" }, { label: "节点状态", value: "node_status" }];
const completionStatuses = [{ label: "未开始", value: "pending" }, { label: "可进入", value: "ready" }, { label: "处理中", value: "in_progress" }, { label: "等待中", value: "waiting" }, { label: "已阻塞", value: "blocked" }, { label: "已完成", value: "completed" }, { label: "已跳过", value: "skipped" }, { label: "失败", value: "failed" }, { label: "已取消", value: "cancelled" }];

export function CompletionRuleEditor({ value, fieldOptions, nodeOptions, onChange, depth = 0, onRemove }: {
  value: RuleRecord; fieldOptions: Array<{ value: string; label: string }>; nodeOptions: Array<{ value: string; label: string }>;
  onChange: (value: RuleRecord) => void; depth?: number; onRemove?: () => void;
}) {
  const children = value.children ?? [];
  const updateChildren = (next: RuleRecord[]) => onChange({ ...value, children: next });
  const updateChild = (index: number, rule: RuleRecord) => updateChildren(children.map((child, itemIndex) => itemIndex === index ? rule : child));
  const addRule = () => updateChildren([...children, { type: "rule", kind: "field_filled", field_id: "", label: "字段已填写" }]);
  const addGroup = () => updateChildren([...children, { type: "group", operator: "AND", children: [] }]);
  const operator = String(value.operator ?? "AND");
  const isGroup = value.type !== "rule";
  if (!isGroup) {
    const kind = String(value.kind ?? "field_filled");
    const options = kind === "node_status" ? nodeOptions : fieldOptions;
    return <div className="grid gap-2 rounded-md border bg-background p-3" data-rule-row>
      <div className="flex items-center justify-between gap-2"><span className="text-xs font-medium text-muted-foreground">完成规则</span><Button size="icon-sm" variant="ghost" aria-label="删除规则" onClick={onRemove}><RiDeleteBinLine /></Button></div>
      <Select value={kind} onValueChange={(nextKind) => { if (!nextKind) return; const next: RuleRecord = { type: "rule", kind: nextKind, field_id: "", label: ruleKinds.find((item) => item.value === nextKind)?.label ?? "" }; if (nextKind === "value_compare") { next.operator_value = "="; next.value = ""; } if (nextKind === "attachment_count") next.value = 1; if (nextKind === "node_status") next.value = "completed"; onChange(next); }}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{ruleKinds.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent></Select>
      <Select value={String(value.field_id ?? "")} onValueChange={(fieldId) => onChange({ ...value, field_id: fieldId ?? "" })}><SelectTrigger className="w-full"><SelectValue placeholder={kind === "node_status" ? "选择节点" : "选择字段"} /></SelectTrigger><SelectContent>{options.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent></Select>
      {kind === "value_compare" ? <div className="grid grid-cols-[minmax(5rem,0.45fr)_minmax(0,1fr)] gap-2"><Select value={String(value.operator_value ?? value.operator ?? "=")} onValueChange={(next) => { if (next) onChange({ ...value, operator_value: next }); }}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{([["=", "等于（=）"], ["!=", "不等于（≠）"], [">", "大于（>）"], ["<", "小于（<）"]] as const).map(([v, label]) => <SelectItem key={v} value={v}>{label}</SelectItem>)}</SelectContent></Select><Input aria-label="比较值" value={String(value.value ?? "")} placeholder="比较值" onChange={(event) => onChange({ ...value, value: event.target.value })} /></div> : null}
      {kind === "attachment_count" ? <Field><FieldLabel>最少附件数</FieldLabel><Input type="number" min={0} value={String(value.value ?? 1)} onChange={(event) => onChange({ ...value, value: Number(event.target.value) })} /></Field> : null}
      {kind === "node_status" ? <Select value={String(value.value ?? "completed")} onValueChange={(next) => onChange({ ...value, value: next })}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{completionStatuses.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent></Select> : null}
      {kind === "manual_confirm" ? <Field><FieldLabel>确认说明</FieldLabel><Input value={String(value.label ?? "")} onChange={(event) => onChange({ ...value, label: event.target.value })} placeholder="例如：已完成复核" /></Field> : null}
      <Field><FieldLabel>未满足时提示（可选）</FieldLabel><Input value={String(value.message ?? "")} onChange={(event) => onChange({ ...value, message: event.target.value })} placeholder="显示给工单处理人的原因" /></Field>
    </div>;
  }
  return <div className={`grid gap-3 rounded-lg border p-3 ${depth ? "bg-muted/30" : "bg-muted/15"}`} data-rule-group>
    <div className="flex items-center justify-between gap-2"><div><strong className="text-sm">{operator === "OR" ? "任意条件（OR）" : "全部条件（AND）"}</strong><p className="text-xs text-muted-foreground">{operator === "OR" ? "任一条件满足即可" : "所有条件都需要满足"}</p></div><div className="flex items-center gap-2"><Select value={operator} onValueChange={(next) => { if (next) onChange({ ...value, operator: next }); }}><SelectTrigger aria-label="条件组合方式" className="w-44"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="AND">全部条件（AND）</SelectItem><SelectItem value="OR">任意条件（OR）</SelectItem></SelectContent></Select>{onRemove ? <Button size="icon-sm" variant="ghost" aria-label="删除规则组" onClick={onRemove}><RiDeleteBinLine /></Button> : null}</div></div>
    <div className="grid gap-2">{children.map((child, index) => <CompletionRuleEditor key={index} value={child} fieldOptions={fieldOptions} nodeOptions={nodeOptions} depth={depth + 1} onChange={(next) => updateChild(index, next)} onRemove={() => updateChildren(children.filter((_, itemIndex) => itemIndex !== index))} />)}</div>
    {!children.length ? <p className="rounded-md border border-dashed p-3 text-center text-xs text-muted-foreground">暂无规则。空规则组默认视为满足。</p> : null}
    <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={addRule}><RiAddLine data-icon="inline-start" />新增规则</Button><Button size="sm" variant="outline" onClick={addGroup}>新增规则组</Button></div>
  </div>;
}

export function WorkflowEdgeEditor({ edge, index, nodes, onChange, onRemove }: { edge: WorkflowEdge; index: number; nodes: WorkflowNode[]; onChange: (edge: WorkflowEdge) => void; onRemove: () => void }) {
  const source = nodes.find((node) => node.id === edge.source_node_id);
  const condition = (edge.condition ?? null) as RuleRecord | null;
  const mode = !condition ? "unconditional" : condition.negate ? "unless" : "conditional";
  const fields = source?.form_schema.fields.map((field) => ({ value: field.id, label: `${field.label} · ${field.id}` })) ?? [];
  const nodeOptions = nodes.map((node) => ({ value: node.id, label: `${node.name} · ${node.key}` }));
  const setConditionMode = (next: string) => {
    if (next === "unconditional") onChange({ ...edge, condition: null, condition_mode: next });
    else onChange({ ...edge, condition: { ...(condition ?? { type: "group", operator: "AND", children: [] }), negate: next === "unless" }, condition_mode: next });
  };
  return <section className="grid gap-3 rounded-lg border bg-background p-3" data-edge-id={edge.id}>
    <header className="flex items-center justify-between"><strong className="text-sm">分支 {index + 1}</strong><Button size="icon-sm" variant="ghost" aria-label="删除分支" onClick={onRemove}><RiDeleteBinLine /></Button></header>
    <Field><FieldLabel>后继节点</FieldLabel><Select value={edge.target_node_id} onValueChange={(value) => value && onChange({ ...edge, target_node_id: value })}><SelectTrigger className="w-full"><SelectValue placeholder="选择下一个节点" /></SelectTrigger><SelectContent>{nodes.filter((node) => node.id !== edge.source_node_id).map((node) => <SelectItem key={node.id} value={node.id}>{node.name} · {node.key}</SelectItem>)}</SelectContent></Select></Field>
    <Field><FieldLabel>执行顺序</FieldLabel><Input type="number" min={0} max={999} value={String(edge.priority ?? 0)} onChange={(event) => onChange({ ...edge, priority: Number(event.target.value) || 0 })} /></Field>
    <Field><FieldLabel>进入条件</FieldLabel><Select value={mode} onValueChange={(value) => value && setConditionMode(value)}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="unconditional">无条件进入</SelectItem><SelectItem value="conditional">满足条件后进入</SelectItem><SelectItem value="unless">不满足条件后进入</SelectItem></SelectContent></Select></Field>
    {condition ? <CompletionRuleEditor value={condition} fieldOptions={fields} nodeOptions={nodeOptions} onChange={(next) => onChange({ ...edge, condition: next, condition_mode: next.negate ? "unless" : "conditional" })} /> : null}
  </section>;
}

export function PredecessorRuleEditor({ node, incomingNodes, onChange }: { node: WorkflowNode; incomingNodes: WorkflowNode[]; onChange: (value: Record<string, unknown>) => void }) {
  const rule = (node.predecessor_rule ?? {}) as { operator?: string; conditions?: Array<{ node_id: string; negate?: boolean }> };
  const conditions = incomingNodes.map((item) => ({ node_id: item.id, negate: Boolean(rule.conditions?.find((condition) => condition.node_id === item.id)?.negate) }));
  return <div className="grid gap-3 rounded-lg border p-3">
    <Field><FieldLabel>组合方式</FieldLabel><Select value={rule.operator ?? "OR"} onValueChange={(operator) => onChange({ operator, conditions })}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="AND">全部满足（AND）</SelectItem><SelectItem value="OR">任一满足（OR）</SelectItem></SelectContent></Select></Field>
    <div className="grid gap-2">{incomingNodes.map((item) => <div key={item.id} className="grid grid-cols-[minmax(0,1fr)_minmax(8rem,0.7fr)] items-center gap-2 rounded-md bg-muted/40 p-2"><span className="min-w-0"><strong className="block truncate text-sm">{item.name}</strong><small className="text-xs text-muted-foreground">{item.key}</small></span><Select value={conditions.find((condition) => condition.node_id === item.id)?.negate ? "not_completed" : "completed"} onValueChange={(state) => onChange({ operator: rule.operator ?? "OR", conditions: conditions.map((condition) => condition.node_id === item.id ? { ...condition, negate: state === "not_completed" } : condition) })}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="completed">已完成</SelectItem><SelectItem value="not_completed">未完成（NOT）</SelectItem></SelectContent></Select></div>)}</div>
    <p className="text-xs text-muted-foreground">{rule.operator === "AND" ? "所有条件都满足后，当前节点进入待处理。" : "任一条件满足后，当前节点进入待处理。"}</p>
  </div>;
}

const actionEvents: Record<string, string> = { on_enter: "进入节点时", on_complete: "完成节点后", on_fail: "执行失败时", on_block: "节点阻塞时" };
export type ActionChannelOption = { key: string; label: string; channels?: string[]; configured?: boolean };
export type ActionProvider = { key: string; label: string; description?: string; events: string[]; notification_channels?: ActionChannelOption[] };
type WorkflowAction = Record<string, unknown> & { key: string; event: string; label?: string };
export function WorkflowActionEditor({ actions, providers, onChange }: { actions: WorkflowAction[]; providers: ActionProvider[]; onChange: (actions: WorkflowAction[]) => void }) {
  const providerByKey = useMemo(() => new Map(providers.map((provider) => [provider.key, provider])), [providers]);
  const update = (index: number, patch: Partial<WorkflowAction>) => onChange(actions.map((action, itemIndex) => itemIndex === index ? { ...action, ...patch } : { ...action }));
  const add = () => { const provider = providers[0]; if (provider) onChange([...actions, { key: provider.key, event: provider.events[0] ?? "on_complete", label: "", ...(provider.key === "notification" ? { notification_channel_mode: "default", notification_channels: [] } : {}) }]); };
  const move = (index: number, offset: -1 | 1) => { const target = index + offset; if (target < 0 || target >= actions.length) return; const next = [...actions]; const current = next[index]; const other = next[target]; if (!current || !other) return; next[index] = other; next[target] = current; onChange(next); };
  return <div className="grid gap-3">
    <div className="flex items-center justify-between"><div><strong className="text-sm">节点动作</strong><p className="text-xs text-muted-foreground">按顺序执行，同一触发时机可配置多个动作。</p></div><Button size="sm" variant="secondary" onClick={add} disabled={!providers.length}><RiAddLine data-icon="inline-start" />新增动作</Button></div>
    {actions.map((action, index) => { const provider = providerByKey.get(action.key); return <section className="grid gap-3 rounded-lg border p-3" key={`${action.key}-${index}`}>
      <header className="flex items-center justify-between"><div className="flex items-center gap-2"><strong className="text-sm">动作 {index + 1}</strong><Badge variant="outline">{actionEvents[action.event] ?? action.event}</Badge></div><div className="flex"><Button variant="ghost" size="icon-sm" aria-label={`上移动作 ${index + 1}`} disabled={index === 0} onClick={() => move(index, -1)}><RiArrowUpLine /></Button><Button variant="ghost" size="icon-sm" aria-label={`下移动作 ${index + 1}`} disabled={index === actions.length - 1} onClick={() => move(index, 1)}><RiArrowDownLine /></Button><Button variant="ghost" size="icon-sm" aria-label={`删除动作 ${index + 1}`} onClick={() => onChange(actions.filter((_, itemIndex) => itemIndex !== index))}><RiDeleteBinLine /></Button></div></header>
      <Field><FieldLabel>动作类型</FieldLabel><Select value={action.key} onValueChange={(key) => { const next = providers.find((item) => item.key === key); if (key) update(index, { key, event: next?.events[0] ?? "on_complete", ...(key === "notification" ? { notification_channel_mode: "default", notification_channels: [] } : { notification_channel_mode: undefined, notification_channels: undefined }) }); }}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{providers.map((item) => <SelectItem key={item.key} value={item.key}>{item.label}</SelectItem>)}</SelectContent></Select></Field>
      {(provider?.key === "notification" ? "通过 ToolNest 通知中心投递，不在模块内直接保存或发送渠道凭据。" : provider?.description) ? <p className="text-xs text-muted-foreground">{provider?.key === "notification" ? "通过 ToolNest 通知中心投递，不在模块内直接保存或发送渠道凭据。" : provider?.description}</p> : null}
      <Field><FieldLabel>触发时机</FieldLabel><Select value={action.event} onValueChange={(event) => event && update(index, { event })}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{(provider?.events ?? []).map((event) => <SelectItem key={event} value={event}>{actionEvents[event] ?? event}</SelectItem>)}</SelectContent></Select></Field>
      <Field><FieldLabel>动作名称</FieldLabel><Input aria-label="动作名称" value={action.label ?? ""} onChange={(event) => update(index, { label: event.target.value })} placeholder="可选，例如：通知负责人" /></Field>
      {provider?.key === "notification" ? (() => {
        const rawOptions = provider.notification_channels?.length ? provider.notification_channels : [{ key: "default", label: "平台默认通知" }];
        const defaultChannels = new Set(rawOptions.find((option) => option.key === "default")?.channels ?? []);
        const options = rawOptions.filter((option) => option.key === "default" || !defaultChannels.has(option.key)).map((option) => option.key === "default" ? { ...option, label: "平台默认通知" } : option);
        const selectedChannels = Array.isArray(action.notification_channels) ? action.notification_channels.map(String) : [];
        const useDefault = action.notification_channel_mode !== "custom" || selectedChannels.length === 0;
        const updateCustomChannels = (channel: string, checked: boolean) => {
          const next = checked ? [...new Set([...selectedChannels, channel])] : selectedChannels.filter((item) => item !== channel);
          update(index, next.length ? { notification_channel_mode: "custom", notification_channels: next } : { notification_channel_mode: "default", notification_channels: [] });
        };
        return <Field><FieldLabel>通知渠道</FieldLabel><div className="grid gap-2 rounded-md border bg-muted/20 p-3">
          {options.map((option) => option.key === "default" ? <label key={option.key} className="flex items-start gap-2 text-xs/relaxed"><Checkbox checked={useDefault} onCheckedChange={(checked) => { if (checked === true) update(index, { notification_channel_mode: "default", notification_channels: [] }); }} /><span>{option.label}</span></label> : <label key={option.key} className="flex items-start gap-2 text-xs/relaxed"><Checkbox checked={!useDefault && selectedChannels.includes(option.key)} onCheckedChange={(checked) => updateCustomChannels(option.key, checked === true)} /><span>{option.label}</span></label>)}
        </div></Field>;
      })() : null}
    </section>; })}
    {!actions.length ? <p className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">{providers.length ? "尚未配置节点动作。添加后可选择动作类型和触发时机。" : "暂时无法加载动作类型，请稍后重试。"}</p> : null}
  </div>;
}
