import type { ToolNestModuleMenuItem } from "@toolnest/react-module-sdk";

export const navigation = [
  { key: "overview", label: "总览", path: "" },
  { key: "schedule", label: "日程", path: "schedule" },
  { key: "projects", label: "项目", path: "projects" },
  { key: "tickets", label: "工单", path: "tickets" },
  { key: "workspace", label: "工作台", path: "create" },
  { key: "workflows", label: "工单模板", path: "workflows" },
  { key: "schedules", label: "定时任务", path: "schedules" },
  { key: "settings", label: "设置", path: "settings" },
] as const;

export const menu: ToolNestModuleMenuItem = {
  key: "workflow-tickets-react",
  label: "工单模板",
  path: "",
  icon: "box",
  order: 100,
  children: navigation.map((item) => ({
    key: `workflow-tickets-react-${item.key}`,
    label: item.label,
    path: item.path,
    icon: "box",
  })),
};
