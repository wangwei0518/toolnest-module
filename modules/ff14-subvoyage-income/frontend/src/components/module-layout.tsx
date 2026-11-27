import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";

export function ModuleLayout({ children, actions }: {
  children: ReactNode; actions: [string, ReactNode, () => void, boolean][];
}) {
  return <section className="tn-ff14-subvoyage-income subv-layout" aria-label="潜航控制台">
    <nav className="subv-nav" aria-label="潜航控制台导航">
      {actions.map(([label, icon, action, disabled], index) => <Button key={label} variant={index === 0 ? "secondary" : "ghost"}
        size="sm" onClick={action} disabled={disabled}>{icon}{label}</Button>)}
    </nav>
    {children}
  </section>;
}
