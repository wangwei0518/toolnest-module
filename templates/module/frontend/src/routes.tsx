import type { ToolNestModuleRoute } from "@toolnest/react-module-sdk";

import { ModuleApp } from "./app";

export const routes: ToolNestModuleRoute[] = [
  {
    key: "{{MODULE_ID}}:overview",
    path: "",
    render: (props) => <ModuleApp {...props} />,
  },
  {
    key: "{{MODULE_ID}}:settings",
    path: "settings",
    render: (props) => <ModuleApp {...props} />,
  },
];
