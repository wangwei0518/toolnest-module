import type { ReactNode } from "react";
import type { ToolNestModuleRouteRenderProps } from "@toolnest/react-module-sdk";
import { RiCalendarEventLine, RiCalendarScheduleLine, RiSettings3Line } from "@remixicon/react";

import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { navigation } from "@/menu";

const pageMeta = {
  cour: ["档期新番", "按季度浏览新番、续播与今日更新。"],
  weekly: ["周历", "按星期查看当前档期的放送安排。"],
  settings: ["设置", "管理数据源、展示偏好与通知规则。"],
} as const;

export function ModuleLayout({ path, router, children }: ToolNestModuleRouteRenderProps & { children: ReactNode }) {
  const relative = path.replace(/^\/modules\/anime-calendar-react\/?/, "").replace(/^\/+|\/+$/g, "");
  const active = relative === "weekly" ? "weekly" : relative === "settings" ? "settings" : "cour";
  const meta = pageMeta[active];
  return <main className="tn-anime-calendar-react">
    <header className="tn-anime-calendar-react__header">
      <div className="tn-anime-calendar-react__identity">
        <span className="tn-anime-calendar-react__mark" aria-hidden="true"><RiCalendarScheduleLine /></span>
        <div className="grid min-w-0 gap-0.5"><strong className="tn-anime-calendar-react__title">{meta[0]}</strong><span className="tn-anime-calendar-react__description">{meta[1]}</span></div>
      </div>
      <div className="w-full lg:hidden"><Select value={active} onValueChange={(value) => { const target = navigation.find((item) => item.key === value); if (target) void router.push(`/modules/anime-calendar-react${target.path ? `/${target.path}` : ""}`); }}><SelectTrigger className="w-full" aria-label="新番页面"><span className="text-sm text-muted-foreground">当前页面</span><SelectValue>{navigation.find((item) => item.key === active)?.label}</SelectValue></SelectTrigger><SelectContent><SelectGroup><SelectLabel>新番页面</SelectLabel>{navigation.map((item) => <SelectItem key={item.key} value={item.key}>{item.label}</SelectItem>)}</SelectGroup></SelectContent></Select></div>
      <Tabs className="hidden lg:flex" value={active} onValueChange={(value) => { if (!value) return; const target = navigation.find((item) => item.key === value); if (target) void router.push(`/modules/anime-calendar-react${target.path ? `/${target.path}` : ""}`); }}>
        <TabsList>{navigation.map((item) => <TabsTrigger key={item.key} value={item.key}>{item.key === "settings" ? <RiSettings3Line data-icon="inline-start" /> : item.key === "weekly" ? <RiCalendarScheduleLine data-icon="inline-start" /> : <RiCalendarEventLine data-icon="inline-start" />}{item.label}</TabsTrigger>)}</TabsList>
      </Tabs>
    </header>
    {children}
  </main>;
}
