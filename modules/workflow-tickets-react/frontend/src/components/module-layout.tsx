import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { ToolNestModuleRouteRenderProps } from "@toolnest/react-module-sdk";
import { RiArrowLeftSLine, RiBarChartLine, RiCalendarLine, RiCalendarScheduleLine, RiFileTextLine, RiFlagLine, RiFolderLine, RiGitBranchLine, RiLayoutGridLine, RiLinkM, RiSettings3Line, RiTimeLine } from "@remixicon/react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { navigation } from "../menu";

export type ModulePageMeta = {
  title: string;
  description?: string;
  badge?: ReactNode;
};

type ModulePageMetaContextValue = {
  setPageMeta: (meta: ModulePageMeta) => void;
};

const ModulePageMetaContext = createContext<ModulePageMetaContextValue | null>(null);

export function useModulePageMeta() {
  const context = useContext(ModulePageMetaContext);
  if (!context) throw new Error("useModulePageMeta 必须在 ModuleLayout 内使用。");
  return context;
}

function resolvePageMeta(relativePath: string): ModulePageMeta {
  if (!relativePath || relativePath === "overview") return { title: "总览", description: "从待办、项目和动态开始推进工作。" };
  if (relativePath === "schedule") return { title: "日程", description: "按日期查看和安排事项。" };
  if (relativePath === "projects") return { title: "项目", description: "围绕目标组织工单、里程碑和复盘数据。" };
  if (relativePath === "projects/new") return { title: "新建项目", description: "为一组关联工单建立协作上下文。" };
  if (/^projects\/[^/]+\/milestones\/[^/]+$/.test(relativePath)) return { title: "里程碑详情", description: "查看阶段目标、工单进度与风险复盘。" };
  if (/^projects\/[^/]+$/.test(relativePath)) return { title: "项目详情", description: "查看项目进展、工单、里程碑和复盘。" };
  if (relativePath === "create" || relativePath === "tickets/new") return { title: "新建工单", description: "基于已发布模板创建一个新的运行实例。" };
  if (relativePath === "tickets") return { title: "工单", description: "查询、筛选并推进所有运行中的工单。" };
  if (/^tickets\/[^/]+$/.test(relativePath)) return { title: "工单详情", description: "查看工单节点、表单与流程执行状态。" };
  if (relativePath === "workflows") return { title: "工单模板", description: "定义可复用的节点、表单、规则和分支。" };
  if (relativePath === "workflows/new") return { title: "新建工单模板", description: "先定义基本信息，再配置节点和连接关系。" };
  if (relativePath.endsWith("/versions")) return { title: "版本记录", description: "每个工单绑定创建时的不可变版本快照。" };
  if (relativePath.includes("/designer/form/")) return { title: "表单设计器", description: "配置字段类型、默认值和前序引用；发布版本只读。" };
  if (relativePath.includes("/designer/rules/")) return { title: "完成规则", description: "使用 AND/OR 组合规则；最终判定由后端运行时执行。" };
  if (relativePath.includes("/designer")) return { title: "模板设计器", description: "配置模板节点、字段和流程分支。" };
  if (relativePath === "schedules" || relativePath === "schedules/new" || /^schedules\/[^/]+$/.test(relativePath)) return { title: "定时任务", description: "按计划从已发布模板自动创建工单。" };
  if (relativePath === "settings") return { title: "设置", description: "调整附件和临时执行资源策略。" };
  return { title: "工单模板", description: "工单、项目与流程执行中心" };
}

function ModuleNavigationIcon({ itemKey }: { itemKey: string }) {
  if (itemKey === "overview") return <RiFlagLine data-icon="inline-start" aria-hidden="true" />;
  if (itemKey === "schedule") return <RiCalendarScheduleLine data-icon="inline-start" aria-hidden="true" />;
  if (itemKey === "projects") return <RiFolderLine data-icon="inline-start" aria-hidden="true" />;
  if (itemKey === "tickets") return <RiFileTextLine data-icon="inline-start" aria-hidden="true" />;
  if (itemKey === "workspace") return <RiLayoutGridLine data-icon="inline-start" aria-hidden="true" />;
  if (itemKey === "workflows") return <RiGitBranchLine data-icon="inline-start" aria-hidden="true" />;
  if (itemKey === "schedules") return <RiCalendarScheduleLine data-icon="inline-start" aria-hidden="true" />;
  return <RiSettings3Line data-icon="inline-start" aria-hidden="true" />;
}

const projectNavigation = [
  { key: "overview", label: "概览" },
  { key: "tickets", label: "工单" },
  { key: "milestones", label: "里程碑" },
  { key: "analysis", label: "分析" },
  { key: "activity", label: "动态" },
  { key: "resources", label: "资源" },
  { key: "notes", label: "注意事项" },
  { key: "settings", label: "设置" },
] as const;

function ProjectNavigationIcon({ itemKey }: { itemKey: string }) {
  if (itemKey === "overview") return <RiFlagLine data-icon="inline-start" aria-hidden="true" />;
  if (itemKey === "tickets") return <RiFileTextLine data-icon="inline-start" aria-hidden="true" />;
  if (itemKey === "milestones") return <RiCalendarLine data-icon="inline-start" aria-hidden="true" />;
  if (itemKey === "analysis") return <RiBarChartLine data-icon="inline-start" aria-hidden="true" />;
  if (itemKey === "activity") return <RiTimeLine data-icon="inline-start" aria-hidden="true" />;
  if (itemKey === "resources") return <RiLinkM data-icon="inline-start" aria-hidden="true" />;
  if (itemKey === "notes") return <RiFileTextLine data-icon="inline-start" aria-hidden="true" />;
  return <RiSettings3Line data-icon="inline-start" aria-hidden="true" />;
}

type ProjectContext = { projectId: string; activeKey: string; backPath: string; backLabel: string };

function resolveProjectContext(relativePath: string, query: Record<string, string>): ProjectContext | null {
  const parts = relativePath.split("/").filter(Boolean);
  if (parts[0] !== "projects" || !parts[1] || parts[1] === "new") return null;
  const isMilestoneDetail = parts.length === 4 && parts[2] === "milestones" && Boolean(parts[3]);
  if (parts.length !== 2 && !isMilestoneDetail) return null;
  const requestedTab = query.tab === "review" ? "notes" : query.tab || "overview";
  const activeKey = isMilestoneDetail || !projectNavigation.some((item) => item.key === requestedTab) ? (isMilestoneDetail ? "milestones" : "overview") : requestedTab;
  return {
    projectId: parts[1],
    activeKey,
    backPath: isMilestoneDetail ? `/modules/workflow-tickets-react/projects/${parts[1]}?tab=milestones` : "/modules/workflow-tickets-react/projects",
    backLabel: isMilestoneDetail ? "返回项目里程碑" : "返回项目列表",
  };
}

type TicketContext = { backPath: string; backLabel: string };

function resolveTicketContext(relativePath: string, query: Record<string, string>): TicketContext | null {
  if (!/^tickets\/[^/]+$/.test(relativePath) || relativePath === "tickets/new") return null;
  if (query.from !== "project" || !query.project_id) {
    return { backPath: "/modules/workflow-tickets-react/tickets", backLabel: "返回工单列表" };
  }
  const tab = query.project_tab && query.project_tab !== "overview" ? `?tab=${encodeURIComponent(query.project_tab)}` : "";
  return {
    backPath: `/modules/workflow-tickets-react/projects/${encodeURIComponent(query.project_id)}${tab}`,
    backLabel: "返回项目工单",
  };
}

function ProjectNavigation({ projectId, activeKey, router }: { projectId: string; activeKey: string; router: ToolNestModuleRouteRenderProps["router"] }) {
  return <Tabs value={activeKey} onValueChange={(value) => { if (value === null) return; void router.push(`/modules/workflow-tickets-react/projects/${projectId}${value === "overview" ? "" : `?tab=${value}`}`); }} className="max-w-full min-w-0"><TabsList className="w-full max-w-full overflow-x-auto overflow-y-hidden sm:w-fit">{projectNavigation.map((item) => <TabsTrigger key={item.key} value={item.key}><ProjectNavigationIcon itemKey={item.key} />{item.label}</TabsTrigger>)}</TabsList></Tabs>;
}

function ModulePageContent({ relativePath, query, activeKey, router, children }: { relativePath: string; query: Record<string, string>; activeKey: string; router: ToolNestModuleRouteRenderProps["router"]; children: ReactNode }) {
  const [pageMeta, setPageMeta] = useState<ModulePageMeta>(() => resolvePageMeta(relativePath));
  const projectContext = resolveProjectContext(relativePath, query);
  const headerBackContext = projectContext ?? resolveTicketContext(relativePath, query);
  const isWorkflowDesigner = /^workflows\/[^/]+\/designer(?:\/|$)/.test(relativePath);
  return (
    <ModulePageMetaContext.Provider value={{ setPageMeta }}>
      {!isWorkflowDesigner ? (
        <header className={`tn-workflow-tickets-react__header${relativePath === "create" || relativePath === "tickets/new" ? " tn-workflow-tickets-react__header--create" : ""}${headerBackContext ? " tn-workflow-tickets-react__header--with-back" : ""}`}>
          <div className="tn-workflow-tickets-react__identity">
            {headerBackContext ? <Button type="button" size="icon-lg" variant="ghost" aria-label={headerBackContext.backLabel} onClick={() => void router.push(headerBackContext.backPath)}><RiArrowLeftSLine /></Button> : null}
            <span className="tn-workflow-tickets-react__mark"><RiCalendarScheduleLine aria-hidden="true" /></span>
            <div className="grid min-w-0 gap-0.5">
              <div className="flex min-w-0 items-center gap-2">
                <strong className="tn-workflow-tickets-react__title">{pageMeta.title}</strong>
                {pageMeta.badge}
              </div>
              {pageMeta.description ? <span className="tn-workflow-tickets-react__description">{pageMeta.description}</span> : null}
            </div>
          </div>
          <nav aria-label={projectContext ? "项目导航" : "工单模块导航"} className="tn-workflow-tickets-react__navigation">
            {projectContext ? <ProjectNavigation projectId={projectContext.projectId} activeKey={projectContext.activeKey} router={router} /> : <Tabs value={activeKey} onValueChange={(value) => { if (value === null) return; const target = navigation.find((item) => item.key === value); if (!target) return; void router.push(`/modules/workflow-tickets-react${target.path ? `/${target.path}` : ""}`); }} className="max-w-full min-w-0"><TabsList className="w-full max-w-full overflow-x-auto overflow-y-hidden sm:w-fit">{navigation.map((item) => <TabsTrigger key={item.key} value={item.key}><ModuleNavigationIcon itemKey={item.key} />{item.label}</TabsTrigger>)}</TabsList></Tabs>}
          </nav>
        </header>
      ) : null}
      {children}
    </ModulePageMetaContext.Provider>
  );
}

export function ModuleLayout({
  path,
  query,
  router,
  children,
}: ToolNestModuleRouteRenderProps & { children: ReactNode }) {
  const relativePath = path
    .replace(/^\/modules\/workflow-tickets-react\/?/, "")
    .replace(/^\/+|\/+$/g, "");
  const activeKey = [...navigation]
    .sort((left, right) => right.path.length - left.path.length)
    .find((item) => item.path && (relativePath === item.path || relativePath.startsWith(`${item.path}/`)))?.key ?? navigation[0].key;
  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if (event.altKey && event.key.toLowerCase() === "n") {
        event.preventDefault();
        void router.push("/modules/workflow-tickets-react/schedule?quick=1");
      }
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [router]);
  return (
    <main className="tn-workflow-tickets-react">
      <ModulePageContent key={relativePath} relativePath={relativePath} query={query} activeKey={activeKey} router={router}>
        {children}
      </ModulePageContent>
    </main>
  );
}
