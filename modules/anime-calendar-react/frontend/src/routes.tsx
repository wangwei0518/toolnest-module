import type { ToolNestModuleRoute, ToolNestModuleRouteRenderProps } from "@toolnest/react-module-sdk";
import { lazy, Suspense } from "react";

const ModuleApp = lazy(() => import("./app").then((module) => ({ default: module.ModuleApp })));

function renderModule(props: ToolNestModuleRouteRenderProps) {
  return <Suspense fallback={<div role="status">正在加载新番日历…</div>}><ModuleApp {...props} /></Suspense>;
}

export const routes: ToolNestModuleRoute[] = [
  {
    key: "anime-calendar-react:cour",
    path: "",
    render: renderModule,
  },
  { key: "anime-calendar-react:weekly", path: "weekly", render: renderModule },
  {
    key: "anime-calendar-react:settings",
    path: "settings",
    render: renderModule,
  },
];
