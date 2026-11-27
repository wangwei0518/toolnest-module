import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const alertVariants = cva(
  "subv:group/alert subv:relative subv:grid subv:w-full subv:gap-0.5 subv:rounded-lg subv:border subv:px-2 subv:py-1.5 subv:text-left subv:text-xs/relaxed subv:has-data-[slot=alert-action]:relative subv:has-data-[slot=alert-action]:pr-18 subv:has-[>svg]:grid-cols-[auto_1fr] subv:has-[>svg]:gap-x-1.5 subv:*:[svg]:row-span-2 subv:*:[svg]:translate-y-0.5 subv:*:[svg]:text-current subv:*:[svg:not([class*='size-'])]:size-3.5",
  {
    variants: {
      variant: {
        default: "subv:bg-card subv:text-card-foreground",
        destructive:
          "subv:bg-card subv:text-destructive subv:*:data-[slot=alert-description]:text-destructive/90 subv:*:[svg]:text-current",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Alert({
  className,
  variant,
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof alertVariants>) {
  return (
    <div
      data-slot="alert"
      role="alert"
      className={cn(alertVariants({ variant }), className)}
      {...props}
    />
  )
}

function AlertTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-title"
      className={cn(
        "subv:font-medium subv:group-has-[>svg]/alert:col-start-2 subv:[&_a]:underline subv:[&_a]:underline-offset-3 subv:[&_a]:hover:text-foreground",
        className
      )}
      {...props}
    />
  )
}

function AlertDescription({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-description"
      className={cn(
        "subv:text-xs/relaxed subv:text-balance subv:text-muted-foreground subv:md:text-pretty subv:[&_a]:underline subv:[&_a]:underline-offset-3 subv:[&_a]:hover:text-foreground subv:[&_p:not(:last-child)]:mb-4",
        className
      )}
      {...props}
    />
  )
}

function AlertAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-action"
      className={cn("subv:absolute subv:top-1.5 subv:right-2", className)}
      {...props}
    />
  )
}

export { Alert, AlertTitle, AlertDescription, AlertAction }
