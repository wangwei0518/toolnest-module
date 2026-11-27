import * as React from "react"

import { cn } from "@/lib/utils"

function Card({
  className,
  size = "default",
  ...props
}: React.ComponentProps<"div"> & { size?: "default" | "sm" }) {
  return (
    <div
      data-slot="card"
      data-size={size}
      className={cn(
        "subv:group/card subv:flex subv:flex-col subv:gap-(--card-spacing) subv:overflow-hidden subv:rounded-lg subv:bg-card subv:py-(--card-spacing) subv:text-xs/relaxed subv:text-card-foreground subv:ring-1 subv:ring-foreground/10 subv:[--card-spacing:--spacing(4)] subv:has-[>img:first-child]:pt-0 subv:data-[size=sm]:[--card-spacing:--spacing(3)] subv:*:[img:first-child]:rounded-t-lg subv:*:[img:last-child]:rounded-b-lg",
        className
      )}
      {...props}
    />
  )
}

function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-header"
      className={cn(
        "subv:group/card-header subv:@container/card-header subv:grid subv:auto-rows-min subv:items-start subv:gap-1 subv:rounded-t-lg subv:px-(--card-spacing) subv:has-data-[slot=card-action]:grid-cols-[1fr_auto] subv:has-data-[slot=card-description]:grid-rows-[auto_auto] subv:[.border-b]:pb-(--card-spacing)",
        className
      )}
      {...props}
    />
  )
}

function CardTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-title"
      className={cn("subv:text-sm subv:font-medium", className)}
      {...props}
    />
  )
}

function CardDescription({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-description"
      className={cn("subv:text-xs/relaxed subv:text-muted-foreground", className)}
      {...props}
    />
  )
}

function CardAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-action"
      className={cn(
        "subv:col-start-2 subv:row-span-2 subv:row-start-1 subv:self-start subv:justify-self-end",
        className
      )}
      {...props}
    />
  )
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-content"
      className={cn("subv:px-(--card-spacing)", className)}
      {...props}
    />
  )
}

function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-footer"
      className={cn(
        "subv:flex subv:items-center subv:rounded-b-lg subv:px-(--card-spacing) subv:[.border-t]:pt-(--card-spacing)",
        className
      )}
      {...props}
    />
  )
}

export {
  Card,
  CardHeader,
  CardFooter,
  CardTitle,
  CardAction,
  CardDescription,
  CardContent,
}
