import type { ToolNestModuleNotificationOptions } from "@toolnest/react-module-sdk";

type ModuleNotifier = (options: ToolNestModuleNotificationOptions) => void;

let moduleNotifier: ModuleNotifier | null = null;

export function setModuleNotifier(notifier: ModuleNotifier) {
  moduleNotifier = notifier;
}

export function clearModuleNotifier() {
  moduleNotifier = null;
}

export function notifyModule(options: ToolNestModuleNotificationOptions) {
  moduleNotifier?.(options);
}
