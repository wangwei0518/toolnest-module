import type { ToolNestModuleRoute } from "@toolnest/react-module-sdk";

import { ModuleApp } from "./app";
import { ModuleLayout } from "./components/module-layout";

export const routes: ToolNestModuleRoute[] = [
  {
    key: "workflow-tickets-react:overview",
    path: "*",
    render: (props) => (
      <ModuleLayout {...props}>
        <ModuleApp {...props} />
      </ModuleLayout>
    ),
  },
];
