import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { ToolNestModuleRouteRenderProps } from "@toolnest/react-module-sdk";
import { RiAddLine, RiClipboardLine, RiDeleteBinLine, RiEditLine, RiFilterLine, RiGitBranchLine, RiMore2Line, RiSearchLine, RiStackLine, RiTimeLine } from "@remixicon/react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";

import type { Ticket, Workflow, WorkflowApi, WorkflowVersion } from "../api";
import { TemplateGroupLocator } from "./ticket-create-page";
import { useModulePageMeta } from "./module-layout";

type Router = ToolNestModuleRouteRenderProps["router"];
type WorkflowListPageProps = { api: WorkflowApi; router: Router };
type WorkflowTemplateGroup = { id: string; name: string; workflows: Workflow[] };
type WorkflowFilter = "all" | "published" | "draft";

const statusLabels: Record<string, string> = { draft: "草稿", published: "已发布", archived: "已归档" };

function StatusBadge({ value }: { value: string }) {
  return <span className={`tn-workflow-tickets-workflow-status is-${value}`}><i aria-hidden="true" />{statusLabels[value] ?? value}</span>;
}

function currentVersion(workflow: Workflow): WorkflowVersion | undefined {
  return workflow.versions.find((version) => version.id === workflow.current_version_id)
    ?? [...workflow.versions].sort((left, right) => right.version - left.version)[0];
}

function updatedLabel(workflow: Workflow) {
  const updatedAt = new Date(workflow.updated_at);
  if (Number.isNaN(updatedAt.getTime())) return "最近更新";
  return `${updatedAt.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" })} 更新`;
}

function groupWorkflows(workflows: Workflow[]): WorkflowTemplateGroup[] {
  const groups = new Map<string, WorkflowTemplateGroup>();
  const ungrouped: Workflow[] = [];
  workflows.forEach((workflow) => {
    const name = workflow.group_name?.trim();
    if (!name) {
      ungrouped.push(workflow);
      return;
    }
    const key = name.toLocaleLowerCase();
    const group = groups.get(key) ?? { id: `group:${key}`, name, workflows: [] };
    group.workflows.push(workflow);
    groups.set(key, group);
  });
  const result = [...groups.values()].filter((group) => group.workflows.length);
  if (ungrouped.length) result.push({ id: "ungrouped", name: "未分组", workflows: ungrouped });
  return result;
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

function WorkflowTemplateCard({ workflow, ticketCount, router, onArchive }: { workflow: Workflow; ticketCount: number; router: Router; onArchive: (workflow: Workflow) => void }) {
  const version = currentVersion(workflow);
  const openDesigner = () => void router.push(`/modules/workflow-tickets-react/workflows/${workflow.id}/designer`);
  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.target !== event.currentTarget) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openDesigner();
    }
  };
  return (
    <article
      className="tn-workflow-tickets-workflow-list-card"
      role="button"
      tabIndex={0}
      aria-label={`打开工单模板：${workflow.name}`}
      onClick={openDesigner}
      onKeyDown={handleKeyDown}
    >
      <header className="tn-workflow-tickets-workflow-list-card-head">
        <div className="tn-workflow-tickets-workflow-list-card-leading">
          <span className={`tn-workflow-tickets-workflow-list-card-icon is-${workflow.status}`} aria-hidden="true"><RiGitBranchLine /></span>
          <div className="tn-workflow-tickets-workflow-list-card-copy">
            <h2>{workflow.name}</h2>
            <p>{workflow.description || "暂未填写工单模板描述"}</p>
          </div>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button type="button" size="icon-sm" variant="ghost" aria-label={`更多${workflow.name}操作`} onClick={(event) => event.stopPropagation()} />}>
            <RiMore2Line />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={openDesigner}><RiEditLine />编辑模板</DropdownMenuItem>
            <DropdownMenuItem onClick={() => void router.push(`/modules/workflow-tickets-react/workflows/${workflow.id}/versions`)}>版本管理</DropdownMenuItem>
            <DropdownMenuItem onClick={() => void router.push(`/modules/workflow-tickets-react/schedules/new?workflow_id=${encodeURIComponent(workflow.id)}`)}>定时创建</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={() => onArchive(workflow)}><RiDeleteBinLine />删除模板</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>

      <div className="tn-workflow-tickets-workflow-list-card-meta">
        <span className="is-version"><RiStackLine aria-hidden="true" />v{version?.version ?? 1}</span>
        <i className="tn-workflow-tickets-workflow-list-card-meta-divider" aria-hidden="true" />
        <span className="is-nodes"><RiGitBranchLine aria-hidden="true" />{version?.nodes.length ?? 0} 个节点</span>
        <i className="tn-workflow-tickets-workflow-list-card-meta-divider" aria-hidden="true" />
        <span className="is-tickets"><RiClipboardLine aria-hidden="true" />{ticketCount} 个工单</span>
      </div>

      <Separator className="tn-workflow-tickets-workflow-list-card-divider" />
      <footer className="tn-workflow-tickets-workflow-list-card-footer">
        <span className="tn-workflow-tickets-workflow-list-card-updated"><RiTimeLine aria-hidden="true" />{updatedLabel(workflow)}</span>
        <StatusBadge value={workflow.status} />
      </footer>
    </article>
  );
}

export function WorkflowListPage({ api, router }: WorkflowListPageProps) {
  const { setPageMeta } = useModulePageMeta();
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [ticketCounts, setTicketCounts] = useState<Record<string, number>>({});
  const [keyword, setKeyword] = useState("");
  const [filter, setFilter] = useState<WorkflowFilter>("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState<Workflow>();
  const [activeGroupId, setActiveGroupId] = useState("");
  const groupElements = useRef(new Map<string, HTMLElement>());

  useEffect(() => {
    setPageMeta({ title: "工单模板", description: "定义可复用的节点、表单、规则和分支。" });
  }, [setPageMeta]);

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const [nextWorkflows, ticketResult] = await Promise.all([api.listWorkflows(), api.listTickets()]);
      const nextCounts = ticketResult.items.reduce<Record<string, number>>((counts, ticket: Ticket) => {
        counts[ticket.workflow_id] = (counts[ticket.workflow_id] ?? 0) + 1;
        return counts;
      }, {});
      setWorkflows(nextWorkflows);
      setTicketCounts(nextCounts);
    } catch (err) {
      setError(err instanceof Error ? err.message : "工单模板加载失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const visibleWorkflows = useMemo(() => {
    const query = keyword.trim().toLocaleLowerCase();
    return workflows.filter((workflow) => {
      const values = [workflow.name, workflow.description, workflow.group_name ?? ""].join(" ").toLocaleLowerCase();
      return (!query || values.includes(query)) && (filter === "all" || workflow.status === filter);
    });
  }, [filter, keyword, workflows]);
  const workflowGroups = useMemo(() => groupWorkflows(visibleWorkflows), [visibleWorkflows]);

  useEffect(() => {
    if (!workflowGroups.length) return undefined;
    setActiveGroupId((current) => current && workflowGroups.some((group) => group.id === current) ? current : workflowGroups[0].id);
    if (typeof IntersectionObserver === "undefined") return undefined;
    const observer = new IntersectionObserver((entries) => {
      const visible = entries.filter((entry) => entry.isIntersecting).sort((left, right) => Math.abs(left.boundingClientRect.top) - Math.abs(right.boundingClientRect.top));
      if (visible[0]) setActiveGroupId(visible[0].target.getAttribute("data-template-group-id") ?? "");
    }, { root: null, rootMargin: "-12% 0px -68% 0px", threshold: [0, 0.1, 0.5] });
    groupElements.current.forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, [workflowGroups]);

  const selectGroup = (groupId: string) => {
    const element = groupElements.current.get(groupId);
    if (!element) return;
    setActiveGroupId(groupId);
    element.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const cycleFilter = () => setFilter((current) => current === "all" ? "published" : current === "published" ? "draft" : "all");
  const filterLabel = filter === "published" ? "已发布" : filter === "draft" ? "草稿" : "";

  return (
    <section className="tn-workflow-tickets-page tn-workflow-tickets-create-page tn-workflow-tickets-workflow-list-page grid min-w-0">
      <div className="tn-workflow-tickets-create-selection">
        <div className="tn-workflow-tickets-create-selection-toolbar">
          <InputGroup className="tn-workflow-tickets-create-search w-80">
            <InputGroupAddon><RiSearchLine aria-hidden="true" /></InputGroupAddon>
            <InputGroupInput type="search" value={keyword} onChange={(event) => setKeyword(event.target.value)} aria-label="搜索工单模板" placeholder="搜索工单模板..." />
          </InputGroup>
          <Button type="button" variant={filterLabel ? "default" : "outline"} aria-label={filterLabel ? `当前筛选：${filterLabel}，点击切换` : "筛选工单模板"} aria-pressed={filter !== "all"} onClick={cycleFilter}>
            <RiFilterLine data-icon="inline-start" />筛选{filterLabel ? ` · ${filterLabel}` : ""}
          </Button>
          <Button type="button" onClick={() => void router.push("/modules/workflow-tickets-react/workflows/new")}>
            <RiAddLine data-icon="inline-start" />新建模板
          </Button>
        </div>

        {loading ? <LoadingTemplates /> : null}
        {!loading && error ? <Alert variant="destructive"><AlertDescription className="flex flex-wrap items-center gap-3"><span>{error}</span><Button size="sm" variant="outline" onClick={() => void load()}>重新加载</Button></AlertDescription></Alert> : null}
        {!loading && !error && !workflowGroups.length ? (
          <Empty className="tn-workflow-tickets-workflow-state">
            <EmptyHeader>
              <EmptyTitle>{keyword || filter !== "all" ? "没有匹配的工单模板" : "还没有工单模板"}</EmptyTitle>
              <EmptyDescription>{keyword || filter !== "all" ? "请调整搜索词或筛选条件。" : "创建一个工单模板后，它会出现在这里。"}</EmptyDescription>
            </EmptyHeader>
            <Button onClick={() => void router.push("/modules/workflow-tickets-react/workflows/new")}><RiAddLine data-icon="inline-start" />新建模板</Button>
          </Empty>
        ) : null}
        {!loading && !error && workflowGroups.length ? (
          <div className="tn-workflow-tickets-template-board">
            <div className="tn-workflow-tickets-template-board-layout">
              <div className="tn-workflow-tickets-template-groups">
                {workflowGroups.map((group) => (
                  <section
                    key={group.id}
                    ref={(element) => { if (element) groupElements.current.set(group.id, element); else groupElements.current.delete(group.id); }}
                    className="tn-workflow-tickets-template-group"
                    data-template-group-id={group.id}
                    aria-labelledby={`template-group-title-${group.id}`}
                  >
                    <header className="tn-workflow-tickets-template-group-heading">
                      <h2 id={`template-group-title-${group.id}`}>{group.name}</h2>
                      <span className="tn-workflow-tickets-template-group-count" aria-label={`${group.name}内有${group.workflows.length}个模板`}>{group.workflows.length}</span>
                    </header>
                    <div className="tn-workflow-tickets-workflow-grid">
                      {group.workflows.map((workflow) => <WorkflowTemplateCard key={workflow.id} workflow={workflow} ticketCount={ticketCounts[workflow.id] ?? 0} router={router} onArchive={setDeleting} />)}
                    </div>
                  </section>
                ))}
              </div>
              <TemplateGroupLocator groups={workflowGroups.map(({ id, name }) => ({ id, name }))} activeGroupId={activeGroupId} onSelect={selectGroup} />
            </div>
          </div>
        ) : null}
      </div>

      <AlertDialog open={Boolean(deleting)} onOpenChange={(open) => { if (!open) setDeleting(undefined); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除这个工单模板？</AlertDialogTitle>
            <AlertDialogDescription>删除后模板将不再出现在列表和新建工单入口中，历史工单仍会保留。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={async (event) => { event.preventDefault(); if (!deleting) return; await api.archiveWorkflow(deleting.id); setDeleting(undefined); await load(); }}>确认删除</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
