import type { ToolNestModuleRoute } from "@toolnest/react-module-sdk";

import { ModuleApp } from "./app";

export const routes: ToolNestModuleRoute[] = [
  {
    key: "xiaomi-rear-wallpaper:main",
    path: "*",
    render: (props) => <ModuleApp {...props} />,
  },
];
