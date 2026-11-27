import type { ReactNode } from "react";
import { RiAnchorLine, RiBarChartGroupedLine, RiFileList2Line, RiSettings3Line, RiShipLine, RiStackLine } from "@remixicon/react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

const pages = {
  overview: { title: "总览", description: "查看最近一日打捞收入、部队概况与潜水艇返航。", Icon: RiAnchorLine },
  fleet: { title: "潜水艇", description: "查看预计返航与剩余时间。", Icon: RiShipLine },
  income: { title: "收益", description: "按月或日期区间查看打捞收益。", Icon: RiBarChartGroupedLine },
  items: { title: "物品", description: "查看本月道具数量、NPC 估价与收入占比。", Icon: RiStackLine },
  reports: { title: "上报记录", description: "按日查阅插件上报的收益和道具明细。", Icon: RiFileList2Line },
  settings: { title: "设置", description: "获取插件上报 URL 和令牌。", Icon: RiSettings3Line },
} as const;

export type ModuleTab = keyof typeof pages;
const tabs = Object.keys(pages) as ModuleTab[];

export function ModuleLayout({ children, activeTab, onTabChange }: {
  children: ReactNode; activeTab: ModuleTab; onTabChange: (tab: ModuleTab) => void;
}) {
  const { Icon, title, description } = pages[activeTab];
  return <section className="tn-ff14-subvoyage-income subv-layout" aria-label="潜航控制台">
    <Tabs value={activeTab} className="subv-module-tabs" onValueChange={value => {
      const next = tabs.find(tab => tab === value);
      if (next) onTabChange(next);
    }}>
      <header className="subv-page-header">
        <div className="subv-page-heading">
          <span className="subv-page-icon"><Icon aria-hidden/></span>
          <div className="subv-page-copy"><h2>{title}</h2><p>{description}</p></div>
        </div>
        <TabsList className="subv-tab-list" aria-label="潜航控制台页面">
          {tabs.map(tab => {
            const ItemIcon = pages[tab].Icon;
            return <TabsTrigger key={tab} value={tab}>
              <ItemIcon aria-hidden data-icon="inline-start"/>{pages[tab].title}
            </TabsTrigger>;
          })}
        </TabsList>
      </header>
      {children}
    </Tabs>
  </section>;
}
