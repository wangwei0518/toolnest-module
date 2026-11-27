import type { ToolNestModuleRoute } from "@toolnest/react-module-sdk";
import { ModuleApp } from "./app";
export const routes: ToolNestModuleRoute[] = [{ key: "ff14-subvoyage-income:overview", path: "", render: () => <ModuleApp /> }];
