import type { ToolNestModuleRoute } from "@toolnest/react-module-sdk";
import { lazy, Suspense } from "react";

import { ModuleLayout } from "./components/module-layout";

const ModuleApp = lazy(() => import("./app").then((module) => ({ default: module.ModuleApp })));

export const routes: ToolNestModuleRoute[] = [
  {
    key: "workflow-tickets-react:overview",
    path: "*",
    render: (props) => (
      <ModuleLayout {...props}>
        <Suspense fallback={<div role="status">正在加载工单模块…</div>}>
          <ModuleApp {...props} />
        </Suspense>
      </ModuleLayout>
    ),
  },
];
