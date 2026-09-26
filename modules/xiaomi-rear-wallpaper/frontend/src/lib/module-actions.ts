import type { ToolNestModuleConfirmOptions } from "@toolnest/react-module-sdk";

let confirmAction: ((options: ToolNestModuleConfirmOptions) => Promise<boolean>) | null = null;

export function setModuleConfirm(action: (options: ToolNestModuleConfirmOptions) => Promise<boolean>): void {
  confirmAction = action;
}

export function clearModuleConfirm(): void {
  confirmAction = null;
}

export function confirmInHost(options: ToolNestModuleConfirmOptions): Promise<boolean> {
  if (confirmAction) return confirmAction(options);
  return Promise.resolve(window.confirm(`${options.title ?? "确认操作"}\n\n${options.content}`));
}
