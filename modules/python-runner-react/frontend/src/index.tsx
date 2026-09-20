import { lazy, Suspense } from "react";
import type {
  ToolNestModuleContext,
  ToolNestModuleRouteRenderProps,
  ToolNestReactFrontendModule,
} from "@toolnest/react-module-sdk";

import { setPythonRunnerApi } from "./api";
import { setPythonRunnerRuntime } from "./runtime-context";
import "./styles.css";

const moduleBase = "/modules/python-runner";
const navigation = [
  { label: "总览", path: "" },
  { label: "快速运行", path: "run" },
  { label: "项目仓库", path: "projects" },
  { label: "执行历史", path: "executions" },
  { label: "定时任务", path: "schedules" },
  { label: "常驻任务", path: "persistent" },
];

type PythonRunnerPage =
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
const LazyPythonRunnerApp = lazy(() =>
  import("./app").then(({ PythonRunnerApp }) => ({
    default: PythonRunnerApp,
  })),
);

function LazyRoute({
  page,
  ...props
}: { page: PythonRunnerPage } & ToolNestModuleRouteRenderProps) {
  return (
    <Suspense
      fallback={
        <div
          className="tn-python-module tn-python-module__loading"
          role="status"
        >
          正在加载 Python 工具…
        </div>
      }
    >
      <LazyPythonRunnerApp page={page} {...props} />
    </Suspense>
  );
}

function route(path: string, page: PythonRunnerPage) {
  return {
    key: `python-runner:${path || "index"}`,
    path,
    render: (props: ToolNestModuleRouteRenderProps) => (
      <LazyRoute page={page} {...props} />
    ),
  };
}

const module: ToolNestReactFrontendModule = {
  id: "python-runner",
  version: "2.0.5",
  layout: { content: "padded" },
  install(context: ToolNestModuleContext) {
    setPythonRunnerApi(context.apiClient);
    setPythonRunnerRuntime(context);
    context.registerMenus([
      {
        key: "python-runner",
        label: "Python 工具",
        path: "",
        icon: "code",
        order: 20,
        children: navigation.map((item) => ({
          key: `python-runner-${item.path || "overview"}`,
          label: item.label,
          path: item.path,
          icon: "code",
        })),
      },
    ]);
    context.registerRoutes([
      route("", "overview"),
      route("run", "run"),
      route("projects", "projects"),
      route("project-run", "project-run"),
      route("projects/:projectId", "project-detail"),
      route("executions", "executions"),
      route("executions/:executionId", "execution-detail"),
      route("schedules", "schedules"),
      route("schedules/create", "schedules"),
      route("schedules/:scheduleId/edit", "schedules"),
      route("schedules/:scheduleId", "schedule-detail"),
      route("persistent", "persistent"),
      route("services/create", "persistent"),
      route("services/:taskId/edit", "persistent"),
      route("services/:taskId", "persistent-detail"),
      route("persistent/:taskId", "persistent-detail"),
      route("services", "persistent"),
    ]);
    context.onDispose(() => {
      setPythonRunnerApi(null);
      setPythonRunnerRuntime(undefined);
    });
  },
};

export default module;
