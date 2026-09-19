import type { ToolNestModuleApiClient } from "@toolnest/react-module-sdk";

let client: ToolNestModuleApiClient | null = null;

export function setModuleApiClient(nextClient: ToolNestModuleApiClient) {
  client = nextClient;
}

export function clearModuleApiClient() {
  client = null;
}

export function getModuleApiClient() {
  if (!client) throw new Error("模块 API 尚未初始化");
  return client;
}
