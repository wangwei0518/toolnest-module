import type { ToolNestModuleContext } from "@toolnest/react-module-sdk";

export let pythonRunnerRuntime: ToolNestModuleContext | undefined;

export function setPythonRunnerRuntime(context: ToolNestModuleContext | undefined) {
  pythonRunnerRuntime = context;
}
