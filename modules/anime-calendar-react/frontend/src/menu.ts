import type { ToolNestModuleMenuItem } from "@toolnest/react-module-sdk";

export const navigation = [
  { key: "cour", label: "档期新番", path: "" },
  { key: "weekly", label: "周历", path: "weekly" },
  { key: "settings", label: "设置", path: "settings" },
] as const;

export const menu: ToolNestModuleMenuItem = {
  key: "anime-calendar-react",
  label: "新番日历",
  path: "",
  icon: "calendar",
  order: 100,
  children: navigation.map((item) => ({
    key: `anime-calendar-react-${item.key}`,
    label: item.label,
    path: item.path,
    icon: item.key === "settings" ? "settings" : "calendar",
  })),
};
