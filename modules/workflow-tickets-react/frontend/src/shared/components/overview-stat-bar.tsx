import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type OverviewStatItem = {
  id: string;
  label: string;
  value: ReactNode;
  railClassName?: string;
  ariaLabel?: string;
  onClick?: () => void;
};

const statClassName = "relative min-w-20 justify-between gap-3 px-3 pl-4";

function OverviewStat({ item }: { item: OverviewStatItem }) {
  const rail = <span aria-hidden="true" className={cn("absolute inset-y-1 left-1 w-1 rounded-sm bg-primary", item.railClassName)} />;
  const content = <>
    {rail}
    <span className="min-w-0 truncate text-muted-foreground">{item.label}</span>
    <span className="min-w-0 truncate font-semibold tabular-nums text-foreground" title={typeof item.value === "string" ? item.value : undefined}>{item.value}</span>
  </>;

  if (item.onClick) {
    return <Button type="button" size="default" variant="outline" className={statClassName} aria-label={item.ariaLabel ?? item.label} onClick={item.onClick}>{content}</Button>;
  }

  return <div className={cn("flex h-7 shrink-0 items-center rounded-md border border-border bg-clip-padding bg-card text-xs/relaxed font-medium whitespace-nowrap", statClassName)} aria-label={item.ariaLabel ?? item.label}>{content}</div>;
}

export function OverviewStatBar({ items, ariaLabel, className }: { items: OverviewStatItem[]; ariaLabel: string; className?: string }) {
  return <div className={cn("flex min-w-0 flex-wrap items-center gap-2", className)} role="group" aria-label={ariaLabel}>{items.map((item) => <OverviewStat key={item.id} item={item} />)}</div>;
}
