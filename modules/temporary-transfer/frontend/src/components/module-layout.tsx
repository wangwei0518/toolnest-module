import type { ReactNode } from "react";
import type { ToolNestModuleRouteRenderProps } from "@toolnest/react-module-sdk";
import { PageContainer } from "./page-container";
export function ModuleLayout({
  children,
}: ToolNestModuleRouteRenderProps & { children: ReactNode }) {
  return (
    <div className="tn-temporary-transfer min-w-0">
      <PageContainer>{children}</PageContainer>
    </div>
  );
}
