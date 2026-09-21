import type { ToolNestModuleContext, ToolNestModuleNotificationOptions } from "@toolnest/react-module-sdk";

let context: ToolNestModuleContext | null = null;

export function setModuleContext(value: ToolNestModuleContext) { context = value; }
export function clearModuleContext() { context = null; }
export function getModuleContext() { if (!context) throw new Error("新番日历模块尚未初始化"); return context; }
export function notify(type: NonNullable<ToolNestModuleNotificationOptions["type"]>, content: string, id?: string | number) {
  return getModuleContext().notify({ type, content, ...(id === undefined ? {} : { id }) });
}
export function timezone() { return getModuleContext().getTimezone(); }
