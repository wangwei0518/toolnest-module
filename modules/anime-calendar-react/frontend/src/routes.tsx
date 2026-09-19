import type { ToolNestModuleRoute } from "@toolnest/react-module-sdk";

import { ModuleApp } from "./app";

export const routes: ToolNestModuleRoute[] = [
  {
    key: "anime-calendar-react:cour",
    path: "",
    render: (props) => <ModuleApp {...props} />,
  },
  { key: "anime-calendar-react:weekly", path: "weekly", render: (props) => <ModuleApp {...props} /> },
  {
    key: "anime-calendar-react:settings",
    path: "settings",
    render: (props) => <ModuleApp {...props} />,
  },
];
