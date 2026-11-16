import type { ToolNestModuleRouteRenderProps } from "@toolnest/react-module-sdk";
import { ModuleLayout } from "./components/module-layout";
import { Inbox } from "./inbox";
import { SettingsPage } from "./settings-page";

export function ModuleApp(props: ToolNestModuleRouteRenderProps) {
  return <ModuleLayout {...props}>{props.path.endsWith("/settings") ? <SettingsPage /> : <Inbox />}</ModuleLayout>;
}
