import type { ToolNestReactFrontendModule } from "@toolnest/react-module-sdk";

import { clearModuleApiClient, setModuleApiClient } from "./api/client";
import { clearModuleContext, setModuleContext } from "./module-context";
import { AnimeQueryProvider } from "./query";
import { TodayAnimeWidget } from "./widgets/today-anime-widget";
import { menu } from "./menu";
import { permissions } from "./permissions";
import { routes } from "./routes";
import "./styles.css";

const module: ToolNestReactFrontendModule = {
  id: "anime-calendar-react",
  version: "0.1.14",
  layout: { content: "padded" },
  install(context) {
    setModuleApiClient(context.apiClient);
    setModuleContext(context);
    context.registerRoutes(routes);
    context.registerMenus([menu]);
    context.registerPermissions(permissions);
    context.registerDashboardWidgets([{ id: "today-anime", title: "今日新番", description: "今天放送的新番摘要", defaultVisible: true, render: (props) => <AnimeQueryProvider><TodayAnimeWidget {...props} /></AnimeQueryProvider> }]);
    context.onDispose(() => {
      clearModuleApiClient();
      clearModuleContext();
    });
  },
};

export default module;
