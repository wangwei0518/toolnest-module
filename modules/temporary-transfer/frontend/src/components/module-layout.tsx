import type { ReactNode } from "react";
import type { ToolNestModuleRouteRenderProps } from "@toolnest/react-module-sdk";
import { RiBox3Line } from "@remixicon/react";

import { Button } from "@/components/ui/button";

import { navigation } from "../menu";

export function ModuleLayout({
  path,
  router,
  children,
}: ToolNestModuleRouteRenderProps & { children: ReactNode }) {
  const relativePath = path.replace(/^\/modules\/temporary-transfer\/?/, "").replace(/\/$/, "");
  return (
    <main className="tn-temporary-transfer">
      <header className="tn-temporary-transfer__header">
        {!relativePath && <div className="tn-temporary-transfer__identity">
          <span className="tn-temporary-transfer__mark" aria-hidden="true">
            <RiBox3Line />
          </span>
          <div>
            <h1 className="tn-temporary-transfer__title">临时投递</h1>
            <p className="tn-temporary-transfer__description">
              跨设备临时文件与文字投递
            </p>
          </div>
        </div>}
        <nav aria-label="临时投递模块导航" className="tn-temporary-transfer__navigation">
          {navigation.map((item) => {
            const active = relativePath === item.path;
            return (
              <Button
                key={item.key}
                size="sm"
                variant={active ? "default" : "outline"}
                aria-current={active ? "page" : undefined}
                onClick={() => void router.push(`/modules/temporary-transfer${item.path ? `/${item.path}` : ""}`)}
              >
                {item.label}
              </Button>
            );
          })}
        </nav>
      </header>
      {children}
    </main>
  );
}
