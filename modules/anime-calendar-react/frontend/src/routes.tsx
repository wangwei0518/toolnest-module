import type { ToolNestModuleRoute, ToolNestModuleRouteRenderProps } from "@toolnest/react-module-sdk";
import { ModuleApp } from "./app";

function renderModule(props: ToolNestModuleRouteRenderProps) {
  return <ModuleApp {...props} />;
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
