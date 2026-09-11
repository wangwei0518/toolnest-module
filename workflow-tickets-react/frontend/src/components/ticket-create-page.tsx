import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import type { ToolNestModuleRouteRenderProps } from "@toolnest/react-module-sdk";
import {
  RiArrowLeftLine,
  RiCheckLine,
  RiClipboardLine,
  RiGitBranchLine,
  RiGitMergeLine,
  RiNodeTree,
  RiPlayLine,
  RiSearchLine,
  RiStackLine,
  RiCloseLine,
} from "@remixicon/react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

import type { Milestone, Project, Ticket, Workflow, WorkflowEdge, WorkflowNode, WorkflowVersion, WorkflowApi } from "../api";
import { useModulePageMeta } from "./module-layout";

type Props = ToolNestModuleRouteRenderProps & { api: WorkflowApi };
type TicketPriority = "none" | "low" | "medium" | "high" | "urgent";

type WorkflowTemplateGroup = { id: string; name: string; workflows: Workflow[] };

type IconComponent = typeof RiGitBranchLine;

type NodeKind = {
  label: string;
  icon: IconComponent;
  variant: "default" | "secondary" | "outline";
};

function publishedVersion(workflow: Workflow): WorkflowVersion | null {
  return [...workflow.versions]
    .filter((item) => item.status === "published")
    .sort((left, right) => right.version - left.version)[0] ?? null;
}

function textError(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function dateTimeLocalValue(value: unknown): string {
  if (typeof value !== "number" && typeof value !== "string") return "";
  const date = typeof value === "number" || /^\d+$/.test(value) ? new Date(Number(value)) : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function nodeKind(node: WorkflowNode, level: WorkflowNode[], incoming: number, outgoing: number): NodeKind {
  if (node.node_type === "summary") return { label: "总结", icon: RiClipboardLine, variant: "default" };
  if (incoming === 0) return { label: "起始", icon: RiPlayLine, variant: "secondary" };
  if (incoming > 1) return { label: "汇聚", icon: RiGitMergeLine, variant: "secondary" };
  if (level.length > 1) return { label: "并行", icon: RiGitBranchLine, variant: "default" };
  if (outgoing === 0) return { label: "结束", icon: RiCheckLine, variant: "outline" };
  return { label: "流转", icon: RiNodeTree, variant: "outline" };
}

function templateLevels(nodes: WorkflowNode[], edges: WorkflowEdge[]): WorkflowNode[][] {
  const order = new Map(nodes.map((node, index) => [node.id, index]));
  const incoming = new Map(nodes.map((node) => [node.id, 0]));
  const remaining = new Set(nodes.map((node) => node.id));
  const result: WorkflowNode[][] = [];

  for (const edge of edges) incoming.set(edge.target_node_id, (incoming.get(edge.target_node_id) ?? 0) + 1);
  while (remaining.size) {
    const ready = nodes
      .filter((node) => remaining.has(node.id) && (incoming.get(node.id) ?? 0) === 0)
      .sort((left, right) => (order.get(left.id) ?? 0) - (order.get(right.id) ?? 0));
    const level = ready.length ? ready : nodes.filter((node) => remaining.has(node.id)).slice(0, 1);
    result.push(level);
    for (const node of level) {
      remaining.delete(node.id);
      for (const edge of edges.filter((item) => item.source_node_id === node.id)) {
        incoming.set(edge.target_node_id, Math.max(0, (incoming.get(edge.target_node_id) ?? 0) - 1));
      }
    }
  }
  return result;
}

export function TemplateGroupLocator({ groups, activeGroupId, onSelect }: { groups: Array<{ id: string; name: string }>; activeGroupId: string; onSelect: (id: string) => void }) {
  return (
    <aside className="tn-workflow-tickets-workflow-group-locator" aria-label="模板分组定位">
      <span className="tn-workflow-tickets-workflow-group-locator-line" aria-hidden="true" />
      {groups.map((group) => (
        <button
          key={group.id}
          type="button"
          className={cn(activeGroupId === group.id && "is-active")}
          aria-label={`定位到${group.name}`}
          aria-current={activeGroupId === group.id ? "location" : undefined}
          title={group.name}
          onClick={() => onSelect(group.id)}
        >
          <span className="tn-workflow-tickets-workflow-group-locator-tick" aria-hidden="true" />
          <span className="tn-workflow-tickets-workflow-group-locator-label">{group.name}</span>
        </button>
      ))}
    </aside>
  );
}

function TemplateTimeline({ version }: { version: WorkflowVersion }) {
  const levels = useMemo(() => templateLevels(version.nodes, version.edges), [version.nodes, version.edges]);
  const counts = useMemo(() => {
    const incoming = new Map<string, number>();
    const outgoing = new Map<string, number>();
    for (const edge of version.edges) {
      incoming.set(edge.target_node_id, (incoming.get(edge.target_node_id) ?? 0) + 1);
      outgoing.set(edge.source_node_id, (outgoing.get(edge.source_node_id) ?? 0) + 1);
    }
    return { incoming, outgoing };
  }, [version.edges]);

  return (
    <div className="tn-workflow-tickets-template-branch-timeline" aria-label="流程时间轴">
      {levels.map((level, levelIndex) => (
        <section key={level.map((node) => node.id).join("-")} className={cn("tn-workflow-tickets-template-branch-level", level.length > 1 && "is-branch")}>
          <div className="tn-workflow-tickets-template-branch-level-label">
            <span>阶段 {levelIndex + 1}</span>
            {level.length > 1 ? <small>{level.length} 条并行分支</small> : null}
          </div>
          <div className="tn-workflow-tickets-template-branch-level-items" style={{ "--tn-workflow-branch-count": level.length } as CSSProperties}>
            {level.map((node) => {
              const kind = nodeKind(node, level, counts.incoming.get(node.id) ?? 0, counts.outgoing.get(node.id) ?? 0);
              const Icon = kind.icon;
              return (
                <article key={node.id} className="tn-workflow-tickets-template-branch-node">
                  <div className="tn-workflow-tickets-template-branch-node-heading">
                    <span className="tn-workflow-tickets-template-branch-node-icon" aria-hidden="true"><Icon /></span>
                    <strong>{node.name}</strong>
                    <Badge variant={node.node_type === "summary" ? "default" : kind.variant}>{node.node_type === "summary" ? "总结节点" : kind.label}</Badge>
                  </div>
                  <p>{node.description || "按节点配置处理当前任务。"}</p>
                  <div className="tn-workflow-tickets-template-branch-node-meta">
                    <span>{node.form_schema.fields.length} 个字段</span>
                    <span>{counts.outgoing.get(node.id) ?? 0} 条后继</span>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

function TemplateCard({ workflow, onChoose }: { workflow: Workflow; onChoose: (workflow: Workflow) => void }) {
  const version = publishedVersion(workflow);
  return (
    <button type="button" className="tn-workflow-tickets-workflow-tile tn-workflow-tickets-workflow-list-card" aria-label={`选择工单模板：${workflow.name}`} onClick={() => onChoose(workflow)}>
      <header className="tn-workflow-tickets-workflow-list-card-head">
        <div className="tn-workflow-tickets-workflow-list-card-leading">
          <span className="tn-workflow-tickets-workflow-list-card-icon is-published" aria-hidden="true"><RiNodeTree /></span>
          <div className="tn-workflow-tickets-workflow-list-card-copy">
            <h2>{workflow.name}</h2>
            <p>{workflow.description || "暂未填写工单模板描述"}</p>
          </div>
        </div>
      </header>
      <div className="tn-workflow-tickets-workflow-list-card-meta">
        <span className="is-version"><RiStackLine aria-hidden="true" />v{version?.version ?? 1}</span>
        <span className="is-nodes"><RiGitBranchLine aria-hidden="true" />{version?.nodes.length ?? 0} 个节点</span>
        <span className="is-tickets"><RiClipboardLine aria-hidden="true" />可创建工单</span>
      </div>
    </button>
  );
}

function LoadingTemplates() {
  return (
    <div className="tn-workflow-tickets-workflow-grid tn-workflow-tickets-loading-grid" aria-label="正在加载工单模板" aria-busy="true">
      {Array.from({ length: 4 }, (_, index) => (
        <div key={index} className="tn-workflow-tickets-workflow-skeleton">
          <Skeleton className="h-5 w-1/2" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-3/4" />
          <Skeleton className="mt-auto h-3 w-2/5" />
        </div>
      ))}
    </div>
  );
}

function TagInput({ tags, value, onChange, onAdd, onRemove }: { tags: string[]; value: string; onChange: (value: string) => void; onAdd: (value: string) => void; onRemove: (value: string) => void }) {
  const add = () => {
    const next = value.trim();
    if (!next) return;
    onAdd(next);
    onChange("");
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      add();
    }
  };
  return (
    <div className="tn-workflow-tickets-create-tags">
      {tags.length ? <div className="flex flex-wrap gap-2">{tags.map((tag) => <Badge key={tag} variant="secondary">{tag}<button type="button" className="tn-workflow-tickets-create-tag-remove" aria-label={`移除标签 ${tag}`} onClick={() => onRemove(tag)}><RiCloseLine /></button></Badge>)}</div> : null}
      <Input value={value} onChange={(event) => onChange(event.target.value)} onKeyDown={handleKeyDown} onBlur={add} placeholder="输入后回车添加标签" />
    </div>
  );
}

function CreateForm({ selected, currentVersion, projects, milestones, projectId, onProjectChange, milestoneId, setMilestoneId, title, setTitle, note, setNote, priority, setPriority, weight, setWeight, tags, setTags, dueAt, setDueAt, reminderAt, setReminderAt, draftSavedAt, saving, error, onSubmit, onReturn }: {
  selected: Workflow;
  currentVersion: WorkflowVersion;
  projects: Project[];
  milestones: Milestone[];
  projectId: string;
  onProjectChange: (value: string) => void;
  milestoneId: string;
  setMilestoneId: (value: string) => void;
  title: string;
  setTitle: (value: string) => void;
  note: string;
  setNote: (value: string) => void;
  priority: TicketPriority;
  setPriority: (value: TicketPriority) => void;
  weight: number;
  setWeight: (value: number) => void;
  tags: string[];
  setTags: (value: string[]) => void;
  dueAt: string;
  setDueAt: (value: string) => void;
  reminderAt: string;
  setReminderAt: (value: string) => void;
  draftSavedAt: string;
  saving: boolean;
  error: string;
  onSubmit: () => void;
  onReturn: () => void;
}) {
  const [tagInput, setTagInput] = useState("");
  return (
    <Card className="tn-workflow-tickets-create-form-card gap-0">
      <CardHeader className="tn-workflow-tickets-create-card-heading">
        <div className="flex min-w-0 items-center gap-2">
          <span className="tn-workflow-tickets-create-card-icon" aria-hidden="true"><RiClipboardLine /></span>
          <div className="min-w-0">
            <CardTitle>工单信息</CardTitle>
            <CardDescription>填写本次工单的名称和备注。</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-4">
        <form className="tn-workflow-tickets-create-form" onSubmit={(event) => { event.preventDefault(); onSubmit(); }}>
          <div className="tn-workflow-tickets-create-template-summary">
            <div>
              <strong>{selected.name}</strong>
              <p>{selected.description || "暂未填写工单模板描述"}</p>
            </div>
            <span><RiStackLine aria-hidden="true" />v{currentVersion.version}</span>
            <span><RiGitBranchLine aria-hidden="true" />{currentVersion.nodes.length} 个节点</span>
            <Button type="button" variant="link" size="sm" onClick={onReturn}>更换模板</Button>
          </div>

          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="ticket-create-title">工单名称</FieldLabel>
              <Input id="ticket-create-title" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="例如：搜索功能 v3 重构方案" required />
            </Field>
            <Field>
              <FieldLabel htmlFor="ticket-create-note">备注</FieldLabel>
              <Textarea id="ticket-create-note" value={note} onChange={(event) => setNote(event.target.value)} maxLength={1000} rows={5} placeholder="补充本次工单的背景、目标或注意事项（可选）" />
            </Field>
            <div className="tn-workflow-tickets-create-time-grid">
              <Field>
                <FieldLabel>所属项目</FieldLabel>
                <Select value={projectId || "__none__"} onValueChange={(value) => onProjectChange(value ?? "__none__")}>
                  <SelectTrigger aria-label="所属项目"><SelectValue placeholder="不关联项目" /></SelectTrigger>
                  <SelectContent><SelectGroup><SelectLabel>所属项目</SelectLabel><SelectItem value="__none__">不关联项目</SelectItem>{projects.map((project) => <SelectItem key={project.id} value={project.id}>{project.key} · {project.name}</SelectItem>)}</SelectGroup></SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel>里程碑</FieldLabel>
                <Select value={milestoneId || "__none__"} onValueChange={(value) => setMilestoneId(value === "__none__" ? "" : value ?? "")} disabled={!projectId}>
                  <SelectTrigger aria-label="里程碑"><SelectValue placeholder={projectId ? "不关联里程碑" : "请先选择项目"} /></SelectTrigger>
                  <SelectContent><SelectGroup><SelectLabel>里程碑</SelectLabel><SelectItem value="__none__">不关联里程碑</SelectItem>{milestones.map((milestone) => <SelectItem key={milestone.id} value={milestone.id}>{milestone.name}</SelectItem>)}</SelectGroup></SelectContent>
                </Select>
              </Field>
            </div>
            <div className="tn-workflow-tickets-create-time-grid">
              <Field>
                <FieldLabel>优先级</FieldLabel>
                <Select value={priority} onValueChange={(value) => setPriority((value ?? "none") as TicketPriority)}>
                  <SelectTrigger aria-label="优先级"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectGroup><SelectLabel>优先级</SelectLabel><SelectItem value="none">无优先级</SelectItem><SelectItem value="low">低</SelectItem><SelectItem value="medium">中</SelectItem><SelectItem value="high">高</SelectItem><SelectItem value="urgent">紧急</SelectItem></SelectGroup></SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel htmlFor="ticket-create-weight">工作量权重</FieldLabel>
                <Input id="ticket-create-weight" type="number" min={1} max={100} value={weight} onChange={(event) => setWeight(Math.max(1, Math.min(100, Number(event.target.value) || 1)))} />
              </Field>
            </div>
            <Field>
              <FieldLabel>标签</FieldLabel>
              <TagInput tags={tags} value={tagInput} onChange={setTagInput} onAdd={(tag) => setTags([...new Set([...tags, tag])])} onRemove={(tag) => setTags(tags.filter((item) => item !== tag))} />
            </Field>
            <div className="tn-workflow-tickets-create-time-grid">
              <Field>
                <FieldLabel htmlFor="ticket-create-due">目标时间</FieldLabel>
                <Input id="ticket-create-due" type="datetime-local" value={dueAt} onChange={(event) => setDueAt(event.target.value)} />
              </Field>
              <Field>
                <FieldLabel htmlFor="ticket-create-reminder">提醒时间</FieldLabel>
                <Input id="ticket-create-reminder" type="datetime-local" value={reminderAt} onChange={(event) => setReminderAt(event.target.value)} />
                <FieldDescription>到达该时间后通过已启用的工单通知规则提醒。</FieldDescription>
              </Field>
            </div>
          </FieldGroup>
          <div className="tn-workflow-tickets-create-owner-note">负责人和当前节点处理人默认设为当前用户。{draftSavedAt ? ` 草稿已于 ${draftSavedAt} 自动保存。` : ""}</div>
          {error ? <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert> : null}
          <CardFooter className="tn-workflow-tickets-create-actions px-0">
            <Button type="button" variant="outline" onClick={onReturn}>上一步</Button>
            <Button type="submit" disabled={saving}><RiCheckLine data-icon="inline-start" />{saving ? "创建中…" : "确认创建"}</Button>
          </CardFooter>
        </form>
      </CardContent>
    </Card>
  );
}

export function TicketCreatePage({ api, router, query }: Props) {
  const { setPageMeta } = useModulePageMeta();
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [keyword, setKeyword] = useState("");
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [reminderAt, setReminderAt] = useState("");
  const [projectId, setProjectId] = useState(query.project_id || "");
  const [milestoneId, setMilestoneId] = useState("");
  const [priority, setPriority] = useState<TicketPriority>("none");
  const [weight, setWeight] = useState(1);
  const [tags, setTags] = useState<string[]>([]);
  const [draftSavedAt, setDraftSavedAt] = useState("");
  const [loading, setLoading] = useState(true);
  const [showLoading, setShowLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [activeGroupId, setActiveGroupId] = useState("");
  const [retryCount, setRetryCount] = useState(0);
  const groupElements = useRef(new Map<string, HTMLElement>());
  const draftKey = "workflow-tickets:create-draft:v2";

  const selected = useMemo(() => workflows.find((workflow) => workflow.id === selectedId) ?? null, [selectedId, workflows]);
  const currentVersion = selected ? publishedVersion(selected) : null;
  const visibleWorkflows = useMemo(() => {
    const text = keyword.trim().toLocaleLowerCase();
    return workflows.filter((workflow) => !text || workflow.name.toLocaleLowerCase().includes(text) || workflow.description.toLocaleLowerCase().includes(text));
  }, [keyword, workflows]);
  const workflowGroups = useMemo<WorkflowTemplateGroup[]>(() => {
    const groupMap = new Map<string, WorkflowTemplateGroup>();
    const ungrouped: Workflow[] = [];
    for (const workflow of visibleWorkflows) {
      const name = workflow.group_name?.trim();
      if (!name) {
        ungrouped.push(workflow);
        continue;
      }
      const key = name.toLocaleLowerCase();
      const group = groupMap.get(key) ?? { id: `group:${key}`, name, workflows: [] };
      group.workflows.push(workflow);
      groupMap.set(key, group);
    }
    const result = [...groupMap.values()].filter((group) => group.workflows.length);
    if (ungrouped.length) result.push({ id: "ungrouped", name: "未分组", workflows: ungrouped });
    return result;
  }, [visibleWorkflows]);

  useEffect(() => {
    setPageMeta({ title: "新建工单", description: "基于已发布模板创建一个新的运行实例。" });
  }, [setPageMeta]);

  useEffect(() => {
    try {
      const draft = JSON.parse(localStorage.getItem(draftKey) || "null") as Record<string, unknown> | null;
      if (!draft) return;
      setTitle(String(draft.title ?? ""));
      setNote(String(draft.note ?? ""));
      setDueAt(dateTimeLocalValue(draft.dueAt));
      setReminderAt(dateTimeLocalValue(draft.reminderAt));
      setPriority((draft.priority as TicketPriority) ?? "none");
      setWeight(typeof draft.weight === "number" ? draft.weight : 1);
      setTags(Array.isArray(draft.tags) ? draft.tags.map(String) : []);
      if (!query.project_id) setProjectId(String(draft.projectId ?? ""));
      setMilestoneId(String(draft.milestoneId ?? ""));
    } catch {
      localStorage.removeItem(draftKey);
    }
  }, []);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError("");
      timer = setTimeout(() => { if (!cancelled) setShowLoading(true); }, 180);
      try {
        const [workflowList, projectList] = await Promise.all([api.listWorkflows(), api.listProjects()]);
        if (cancelled) return;
        const published = workflowList.filter((workflow) => Boolean(publishedVersion(workflow)));
        setWorkflows(published);
        setProjects(projectList);
        const matched = published.find((workflow) => workflow.id === query.workflow_id);
        setSelectedId(matched?.id ?? "");
      } catch (err) {
        if (!cancelled) setError(textError(err, "工单模板加载失败"));
      } finally {
        if (timer) clearTimeout(timer);
        if (!cancelled) {
          setShowLoading(false);
          setLoading(false);
        }
      }
    };
    void load();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [api, query.project_id, retryCount]);

  useEffect(() => {
    if (loading) return;
    if (!query.workflow_id) {
      setSelectedId("");
      return;
    }
    const matched = workflows.find((workflow) => workflow.id === query.workflow_id);
    if (matched && matched.id !== selectedId) setSelectedId(matched.id);
  }, [loading, query.workflow_id, selectedId, workflows]);

  useEffect(() => {
    let cancelled = false;
    if (!projectId) {
      setMilestones([]);
      return () => { cancelled = true; };
    }
    void api.listMilestones(projectId).then((nextMilestones) => {
      if (!cancelled) setMilestones(nextMilestones);
    }).catch((err) => {
      if (!cancelled) setError(textError(err, "里程碑加载失败"));
    });
    return () => { cancelled = true; };
  }, [api, projectId]);

  useEffect(() => {
    const elements = [...groupElements.current.values()];
    if (!elements.length || typeof IntersectionObserver === "undefined") return;
    setActiveGroupId((current) => current && workflowGroups.some((group) => group.id === current) ? current : workflowGroups[0]?.id ?? "");
    const observer = new IntersectionObserver((entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((left, right) => Math.abs(left.boundingClientRect.top) - Math.abs(right.boundingClientRect.top));
      if (visible[0]) setActiveGroupId(visible[0].target.getAttribute("data-template-group-id") ?? "");
    }, { root: null, rootMargin: "-12% 0px -68% 0px", threshold: [0, 0.1, 0.5] });
    elements.forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, [workflowGroups]);

  useEffect(() => {
    localStorage.setItem(draftKey, JSON.stringify({ title, note, dueAt, reminderAt, projectId, milestoneId, priority, weight, tags }));
    if (title || note || projectId || milestoneId || tags.length) setDraftSavedAt(new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }));
  }, [draftKey, dueAt, milestoneId, note, priority, projectId, reminderAt, tags, title, weight]);

  const choose = (workflow: Workflow, updateUrl = true) => {
    setSelectedId(workflow.id);
    if (updateUrl) {
      const params = new URLSearchParams({ workflow_id: workflow.id });
      if (projectId) params.set("project_id", projectId);
      void router.push(`/modules/workflow-tickets-react/create?${params.toString()}`);
    }
  };

  const returnToTemplates = () => {
    setSelectedId("");
    const path = projectId ? `/modules/workflow-tickets-react/create?project_id=${encodeURIComponent(projectId)}` : "/modules/workflow-tickets-react/create";
    void router.push(path);
  };

  const changeProject = (value: string) => {
    const nextProjectId = value === "__none__" ? "" : value;
    setProjectId(nextProjectId);
    setMilestoneId("");
    setError("");
  };

  const create = async () => {
    if (!selected || !currentVersion || !title.trim()) {
      setError("请填写工单名称。");
      return;
    }
    if (dueAt && reminderAt && new Date(reminderAt).getTime() > new Date(dueAt).getTime()) {
      setError("提醒时间不能晚于目标时间。");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const ticket: Ticket = await api.createTicket({
        workflow_id: selected.id,
        title: title.trim(),
        note: note.trim(),
        due_at: dueAt ? new Date(dueAt).toISOString() : null,
        reminder_at: reminderAt ? new Date(reminderAt).toISOString() : null,
        project_id: projectId || null,
        milestone_id: milestoneId || null,
        priority,
        weight,
        tags,
      });
      localStorage.removeItem(draftKey);
      await router.push(`/modules/workflow-tickets-react/tickets/${ticket.id}`);
    } catch (err) {
      setError(textError(err, "工单创建失败"));
    } finally {
      setSaving(false);
    }
  };

  const scrollToGroup = (groupId: string) => {
    const element = groupElements.current.get(groupId);
    if (!element) return;
    setActiveGroupId(groupId);
    element.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const root = "tn-workflow-tickets-page tn-workflow-tickets-create-page grid min-w-0";
  if (!selected || !currentVersion) {
    return (
      <section className={root}>
        <div className="tn-workflow-tickets-create-selection">
          <div className="tn-workflow-tickets-create-selection-toolbar">
            <InputGroup className="tn-workflow-tickets-create-search w-80">
              <InputGroupAddon><RiSearchLine aria-hidden="true" /></InputGroupAddon>
              <InputGroupInput type="search" value={keyword} onChange={(event) => setKeyword(event.target.value)} aria-label="搜索工单模板" placeholder="搜索工单模板..." />
            </InputGroup>
          </div>
          {loading && showLoading ? <LoadingTemplates /> : null}
          {loading && !showLoading ? <div className="tn-workflow-tickets-loading-placeholder" aria-label="正在加载工单模板" aria-busy="true" /> : null}
          {!loading && error ? <Alert variant="destructive"><AlertDescription className="flex flex-wrap items-center gap-3"><span>{error}</span><Button size="sm" variant="outline" onClick={() => setRetryCount((count) => count + 1)}>重新加载</Button></AlertDescription></Alert> : null}
          {!loading && !error && !workflowGroups.length ? <Empty className="tn-workflow-tickets-workflow-state"><EmptyHeader><EmptyTitle>{keyword ? "没有匹配的工单模板" : "暂无已发布工单模板"}</EmptyTitle><EmptyDescription>{keyword ? "请调整搜索词后重试。" : "请先发布一个工单模板，再来创建工单。"}</EmptyDescription></EmptyHeader></Empty> : null}
          {!loading && !error && workflowGroups.length ? (
            <div className="tn-workflow-tickets-template-board">
              <div className="tn-workflow-tickets-template-board-layout">
                <div className="tn-workflow-tickets-template-groups">
                  {workflowGroups.map((group) => (
                    <section key={group.id} ref={(element) => { if (element) groupElements.current.set(group.id, element); else groupElements.current.delete(group.id); }} className="tn-workflow-tickets-template-group" data-template-group-id={group.id} aria-labelledby={`template-group-title-${group.id}`}>
                      <header className="tn-workflow-tickets-template-group-heading">
                        <h2 id={`template-group-title-${group.id}`}>{group.name}</h2>
                        <span className="tn-workflow-tickets-template-group-count" aria-label={`${group.name}内有${group.workflows.length}个模板`}>{group.workflows.length}</span>
                      </header>
                      <div className="tn-workflow-tickets-workflow-grid">{group.workflows.map((workflow) => <TemplateCard key={workflow.id} workflow={workflow} onChoose={choose} />)}</div>
                    </section>
                  ))}
                </div>
                <TemplateGroupLocator groups={workflowGroups.map(({ id, name }) => ({ id, name }))} activeGroupId={activeGroupId} onSelect={scrollToGroup} />
              </div>
            </div>
          ) : null}
        </div>
      </section>
    );
  }

  return (
    <section className={root}>
      <header className="tn-workflow-tickets-create-header tn-workflow-tickets-create-header--form">
        <Button type="button" variant="ghost" onClick={returnToTemplates}><RiArrowLeftLine data-icon="inline-start" />返回模板选择</Button>
        <Badge variant="outline">创建中</Badge>
      </header>
      <div className="tn-workflow-tickets-create-progress" aria-label="创建进度">
        {["选择模板", "填写信息", "确认创建"].map((item, index) => {
          const step = index + 1;
          const creationStep = title.trim() ? 3 : 2;
          return <div key={item} className={cn(creationStep === step && "is-current", creationStep > step && "is-completed")}><i className="tn-workflow-tickets-create-progress-line is-before" aria-hidden="true" /><span className="tn-workflow-tickets-create-progress-marker">{creationStep > step ? <RiCheckLine /> : step}</span><strong>{item}</strong><i className="tn-workflow-tickets-create-progress-line is-after" aria-hidden="true" /></div>;
        })}
      </div>
      <div className="tn-workflow-tickets-create-workspace">
        <CreateForm selected={selected} currentVersion={currentVersion} projects={projects} milestones={milestones} projectId={projectId} onProjectChange={(value) => void changeProject(value)} milestoneId={milestoneId} setMilestoneId={setMilestoneId} title={title} setTitle={setTitle} note={note} setNote={setNote} priority={priority} setPriority={setPriority} weight={weight} setWeight={setWeight} tags={tags} setTags={setTags} dueAt={dueAt} setDueAt={setDueAt} reminderAt={reminderAt} setReminderAt={setReminderAt} draftSavedAt={draftSavedAt} saving={saving} error={error} onSubmit={() => void create()} onReturn={returnToTemplates} />
        <Card className="tn-workflow-tickets-create-flow-card gap-0">
          <CardHeader className="tn-workflow-tickets-create-card-heading">
            <div className="flex min-w-0 items-center gap-2">
              <span className="tn-workflow-tickets-create-card-icon" aria-hidden="true"><RiGitBranchLine /></span>
              <div className="min-w-0"><CardTitle>流程时间轴</CardTitle><CardDescription>按流转关系展示串行、并行分支和汇聚节点。</CardDescription></div>
            </div>
          </CardHeader>
          <CardContent className="pt-4"><TemplateTimeline version={currentVersion} /></CardContent>
        </Card>
      </div>
    </section>
  );
}
