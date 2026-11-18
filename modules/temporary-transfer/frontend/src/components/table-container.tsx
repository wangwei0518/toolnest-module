import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";
export function TableContainer({
  children,
  className,
  ...props
}: ComponentProps<"div">) {
  return (
    <div
      data-slot="table-container"
      className={cn("relative w-full overflow-x-auto", className)}
      {...props}
    >
      {children}
    </div>
  );
}
