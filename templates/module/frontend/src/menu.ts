import type { ToolNestModuleMenuItem } from "@toolnest/react-module-sdk";

export const navigation = [
  { key: "overview", label: "总览", path: "" },
  { key: "settings", label: "设置", path: "settings" },
] as const;

export const menu: ToolNestModuleMenuItem = {
  key: "{{MODULE_ID}}",
  label: "{{MODULE_NAME}}",
  path: "",
  icon: "box",
  order: 100,
  children: navigation.map((item) => ({
    key: `{{MODULE_ID}}-${item.key}`,
    label: item.label,
    path: item.path,
    icon: "box",
  })),
};
