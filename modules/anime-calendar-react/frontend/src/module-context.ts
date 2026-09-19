import type { ToolNestModuleContext } from "@toolnest/react-module-sdk";

let context: ToolNestModuleContext | null = null;

export function setModuleContext(value: ToolNestModuleContext) { context = value; }
export function clearModuleContext() { context = null; }
export function getModuleContext() { if (!context) throw new Error("新番日历模块尚未初始化"); return context; }
export function notify(type: "success" | "info" | "warning" | "error", content: string) { getModuleContext().notify({ type, content }); }
export function timezone() { return getModuleContext().getTimezone(); }
