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
  return (
    <main className="tn-{{MODULE_ID}}">
      <header className="tn-{{MODULE_ID}}__header">
        <div className="tn-{{MODULE_ID}}__identity">
          <span className="tn-{{MODULE_ID}}__mark" aria-hidden="true">
            <RiBox3Line />
          </span>
          <div>
            <h1 className="tn-{{MODULE_ID}}__title">{{MODULE_NAME}}</h1>
            <p className="tn-{{MODULE_ID}}__description">
              {{MODULE_DESCRIPTION}}
            </p>
          </div>
        </div>
        <nav aria-label="{{MODULE_NAME}}模块导航" className="tn-{{MODULE_ID}}__navigation">
          {navigation.map((item) => {
            const active = path === item.path;
            return (
              <Button
                key={item.key}
                size="sm"
                variant={active ? "default" : "outline"}
                aria-current={active ? "page" : undefined}
                onClick={() => void router.push(`/modules/{{MODULE_ID}}${item.path ? `/${item.path}` : ""}`)}
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
