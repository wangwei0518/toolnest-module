import type { ToolNestReactFrontendModule } from "@toolnest/react-module-sdk";

import { clearModuleApiClient, setModuleApiClient } from "./api/client";
import { menu } from "./menu";
import { permissions } from "./permissions";
import { routes } from "./routes";
import "./styles.css";

const module: ToolNestReactFrontendModule = {
  id: "workflow-tickets-react",
  version: "0.1.7",
  layout: { content: "padded" },
  install(context) {
    setModuleApiClient(context.apiClient);
    context.registerRoutes(routes);
    context.registerMenus([menu]);
    context.registerPermissions(permissions);
    context.onDispose(() => {
      clearModuleApiClient();
    });
  },
};

export default module;
