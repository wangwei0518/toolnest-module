import { useEffect, type ReactNode } from "react";
import type { ToolNestModuleRouteRenderProps } from "@toolnest/react-module-sdk";
import { RiInboxLine } from "@remixicon/react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { navigation } from "../menu";

export function ModuleLayout({
  path,
  router,
  children,
}: ToolNestModuleRouteRenderProps & { children: ReactNode }) {
  const relativePath = path
    .replace(/^\/modules\/workflow-tickets-react\/?/, "")
    .replace(/^\/+|\/+$/g, "");
  const activeKey = [...navigation]
    .sort((left, right) => right.path.length - left.path.length)
    .find((item) => item.path && (relativePath === item.path || relativePath.startsWith(`${item.path}/`)))?.key ?? navigation[0].key;
  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if (event.altKey && event.key.toLowerCase() === "n") {
        event.preventDefault();
        void router.push("/modules/workflow-tickets-react/inbox?quick=1");
      }
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [router]);
  return (
    <main className="tn-workflow-tickets-react">
      <header className="tn-workflow-tickets-react__header">
        <div className="tn-workflow-tickets-react__identity">
          <span className="tn-workflow-tickets-react__mark"><RiInboxLine aria-hidden="true" /></span>
          <div className="grid min-w-0 gap-0.5">
            <strong className="tn-workflow-tickets-react__title">工单模板</strong>
            <span className="tn-workflow-tickets-react__description">工单、项目与流程执行中心</span>
          </div>
        </div>
        <nav aria-label="工单模块导航" className="tn-workflow-tickets-react__navigation">
          <Tabs
            value={activeKey}
            onValueChange={(value) => {
              if (value === null) return;
              const target = navigation.find((item) => item.key === value);
              if (!target) return;
              void router.push(`/modules/workflow-tickets-react${target.path ? `/${target.path}` : ""}`);
            }}
            className="max-w-full min-w-0"
          >
            <TabsList className="w-full max-w-full overflow-x-auto overflow-y-hidden sm:w-fit">
              {navigation.map((item) => (
                <TabsTrigger key={item.key} value={item.key}>
                  {item.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </nav>
      </header>
      {children}
    </main>
  );
}
