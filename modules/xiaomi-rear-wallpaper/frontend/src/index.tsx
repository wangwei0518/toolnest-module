import type { ToolNestReactFrontendModule } from "@toolnest/react-module-sdk";

import { clearModuleApiClient, setModuleApiClient } from "./api/client";
import { clearModuleConfirm, setModuleConfirm } from "./lib/module-actions";
import { menu } from "./menu";
import { permissions } from "./permissions";
import { routes } from "./routes";
import "./styles.css";

const module: ToolNestReactFrontendModule = {
  id: "xiaomi-rear-wallpaper",
  version: "0.1.5",
  layout: { content: "padded" },
  install(context) {
    setModuleApiClient(context.apiClient);
    setModuleConfirm(context.confirm);
    context.registerRoutes(routes);
    context.registerMenus([menu]);
    context.registerPermissions(permissions);
    context.onDispose(() => {
      clearModuleApiClient();
      clearModuleConfirm();
    });
  },
};

export default module;
