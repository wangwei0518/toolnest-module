import type { ToolNestReactFrontendModule } from "@toolnest/react-module-sdk";

import { clearModuleApiClient, setModuleApiClient } from "./api/client";
import { menu } from "./menu";
import { clearModuleNotifier, setModuleNotifier } from "./module-notifications";
import { permissions } from "./permissions";
import { routes } from "./routes";
import "./styles.css";

const module: ToolNestReactFrontendModule = {
  id: "workflow-tickets-react",
  version: "0.1.90",
  layout: { content: "padded" },
  install(context) {
    setModuleApiClient(context.apiClient);
    setModuleNotifier(context.notify);
    context.registerRoutes(routes);
    context.registerMenus([menu]);
    context.registerPermissions(permissions);
    context.onDispose(() => {
      clearModuleApiClient();
      clearModuleNotifier();
    });
  },
};

export default module;
