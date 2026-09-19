import type { ToolNestModuleRouteRenderProps } from "@toolnest/react-module-sdk";
import { useEffect } from "react";
import { ModuleLayout } from "./components/module-layout";
import { CourPage } from "./pages/cour-page";
import { SettingsPage } from "./pages/settings-page";
import { WeeklyPage } from "./pages/weekly-page";
import { AnimeQueryProvider } from "./query";
import { useSettings } from "./hooks/use-calendar";

export function ModuleApp(props: ToolNestModuleRouteRenderProps) {
  const relative = props.path.replace(/^\/modules\/anime-calendar-react\/?/, "").replace(/^\/+|\/+$/g, "");
  const page = relative === "weekly" ? <WeeklyPage /> : relative === "settings" ? <SettingsPage /> : <DefaultPage {...props} />;
  return <AnimeQueryProvider><ModuleLayout {...props}>{page}</ModuleLayout></AnimeQueryProvider>;
}

function DefaultPage(props: ToolNestModuleRouteRenderProps) {
  const settings = useSettings();
  useEffect(() => { if (settings.data?.defaultPage === "weekly") void props.router.push("/modules/anime-calendar-react/weekly"); }, [props.router, settings.data?.defaultPage]);
  return <CourPage />;
}
