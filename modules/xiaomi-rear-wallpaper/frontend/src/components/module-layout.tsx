import type { ReactNode } from "react";
import { RiFolderImageLine, RiImageLine } from "@remixicon/react";

import { Button } from "@/components/ui/button";

export type ModuleView = "editor" | "gallery";

export function ModuleLayout({
  children,
  view,
  onViewChange,
}: {
  children: ReactNode;
  view: ModuleView;
  onViewChange: (view: ModuleView) => void;
}) {
  return (
    <main className="tn-xiaomi-rear-wallpaper">
      <header className="tn-xiaomi-rear-wallpaper__header">
        <div className="tn-xiaomi-rear-wallpaper__identity">
          <span className="tn-xiaomi-rear-wallpaper__mark" aria-hidden="true">
            <RiImageLine />
          </span>
          <div>
            <h1 className="tn-xiaomi-rear-wallpaper__title">背屏壁纸</h1>
            <p className="tn-xiaomi-rear-wallpaper__description">为小米手机背屏裁切、预览和管理壁纸。</p>
          </div>
        </div>
        <nav className="tn-xiaomi-rear-wallpaper__navigation" aria-label="背屏壁纸视图">
          <Button
            type="button"
            size="sm"
            variant={view === "editor" ? "default" : "outline"}
            aria-current={view === "editor" ? "page" : undefined}
            onClick={() => onViewChange("editor")}
          >
            <RiImageLine data-icon="inline-start" />制作
          </Button>
          <Button
            type="button"
            size="sm"
            variant={view === "gallery" ? "default" : "outline"}
            aria-current={view === "gallery" ? "page" : undefined}
            onClick={() => onViewChange("gallery")}
          >
            <RiFolderImageLine data-icon="inline-start" />我的作品
          </Button>
        </nav>
      </header>
      {children}
    </main>
  );
}
