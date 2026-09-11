import { cn } from "@/lib/utils";

export function ticketStatusRailClass(status: string): string {
  return cn(
    "absolute inset-y-1 left-1 w-1 rounded-sm bg-primary",
    status === "blocked" && "bg-destructive",
    ["cancelled", "archived"].includes(status) && "bg-muted-foreground",
  );
}
