import type { ToolNestModuleMenuItem } from "@toolnest/react-module-sdk";

export const navigation = [
  { key: "overview", label: "总览", path: "" },
  { key: "settings", label: "设置", path: "settings" },
] as const;

export const menu: ToolNestModuleMenuItem = {
  key: "temporary-transfer",
  label: "文件邮局",
  path: "",
  icon: "box",
  order: 100,
};
