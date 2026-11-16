import type { ToolNestModuleRoute } from "@toolnest/react-module-sdk";

import { ModuleApp } from "./app";

export const routes: ToolNestModuleRoute[] = [
  {
    key: "temporary-transfer:overview",
    path: "",
    render: (props) => <ModuleApp {...props} />,
  },
  {
    key: "temporary-transfer:settings",
    path: "settings",
    render: (props) => <ModuleApp {...props} />,
  },
];
