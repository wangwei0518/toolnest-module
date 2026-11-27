import { cn } from "@/lib/utils"

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("tn-motion-skeleton subv:animate-pulse subv:rounded-md subv:bg-muted", className)}
      {...props}
    />
  )
}

export { Skeleton }
