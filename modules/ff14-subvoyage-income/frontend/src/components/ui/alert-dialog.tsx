"use client"

import * as React from "react"
import { AlertDialog as AlertDialogPrimitive } from "@base-ui/react/alert-dialog"
import { cn } from "@/lib/utils"

import { Button } from "@/components/ui/button"

function AlertDialog({ ...props }: AlertDialogPrimitive.Root.Props) {
  return <AlertDialogPrimitive.Root data-slot="alert-dialog" {...props} />
}

function AlertDialogPortal({ ...props }: AlertDialogPrimitive.Portal.Props) {
  return (
    <AlertDialogPrimitive.Portal data-slot="alert-dialog-portal" {...props} />
  )
}

function AlertDialogOverlay({
  className,
  ...props
}: AlertDialogPrimitive.Backdrop.Props) {
  return (
    <AlertDialogPrimitive.Backdrop
      data-slot="alert-dialog-overlay"
      className={cn(
        "subv:fixed subv:inset-0 subv:isolate subv:z-50 subv:bg-black/80 subv:duration-100 subv:supports-backdrop-filter:backdrop-blur-xs subv:data-open:animate-in subv:data-open:fade-in-0 subv:data-closed:animate-out subv:data-closed:fade-out-0",
        className
      )}
      {...props}
    />
  )
}

function AlertDialogContent({
  className,
  size = "default",
  ...props
}: AlertDialogPrimitive.Popup.Props & {
  size?: "default" | "sm"
}) {
  return (
    <AlertDialogPortal>
      <AlertDialogOverlay />
      <AlertDialogPrimitive.Popup
        data-slot="alert-dialog-content"
        data-size={size}
        className={cn(
          "subv:group/alert-dialog-content subv:fixed subv:top-1/2 subv:left-1/2 subv:z-50 subv:grid subv:w-full subv:-translate-x-1/2 subv:-translate-y-1/2 subv:gap-3 subv:rounded-xl subv:bg-popover subv:p-4 subv:text-popover-foreground subv:ring-1 subv:ring-foreground/10 subv:duration-100 subv:outline-none subv:data-[size=default]:max-w-xs subv:data-[size=sm]:max-w-64 subv:data-[size=default]:sm:max-w-sm subv:data-open:animate-in subv:data-open:fade-in-0 subv:data-open:zoom-in-95 subv:data-closed:animate-out subv:data-closed:fade-out-0 subv:data-closed:zoom-out-95",
          className
        )}
        {...props}
      />
    </AlertDialogPortal>
  )
}

function AlertDialogHeader({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-dialog-header"
      className={cn(
        "subv:grid subv:grid-rows-[auto_1fr] subv:place-items-center subv:gap-1 subv:text-center subv:has-data-[slot=alert-dialog-media]:grid-rows-[auto_auto_1fr] subv:has-data-[slot=alert-dialog-media]:gap-x-4 subv:sm:group-data-[size=default]/alert-dialog-content:place-items-start subv:sm:group-data-[size=default]/alert-dialog-content:text-left subv:sm:group-data-[size=default]/alert-dialog-content:has-data-[slot=alert-dialog-media]:grid-rows-[auto_1fr]",
        className
      )}
      {...props}
    />
  )
}

function AlertDialogFooter({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-dialog-footer"
      className={cn(
        "subv:flex subv:flex-col-reverse subv:gap-2 subv:group-data-[size=sm]/alert-dialog-content:grid subv:group-data-[size=sm]/alert-dialog-content:grid-cols-2 subv:sm:flex-row subv:sm:justify-end",
        className
      )}
      {...props}
    />
  )
}

function AlertDialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Title>) {
  return (
    <AlertDialogPrimitive.Title
      data-slot="alert-dialog-title"
      className={cn(
        "subv:text-sm subv:font-medium subv:sm:group-data-[size=default]/alert-dialog-content:group-has-data-[slot=alert-dialog-media]/alert-dialog-content:col-start-2",
        className
      )}
      {...props}
    />
  )
}

function AlertDialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Description>) {
  return (
    <AlertDialogPrimitive.Description
      data-slot="alert-dialog-description"
      className={cn(
        "subv:text-xs/relaxed subv:text-balance subv:text-muted-foreground subv:md:text-pretty subv:*:[a]:underline subv:*:[a]:underline-offset-3 subv:*:[a]:hover:text-foreground",
        className
      )}
      {...props}
    />
  )
}

function AlertDialogAction({
  className,
  ...props
}: React.ComponentProps<typeof Button>) {
  return (
    <Button
      data-slot="alert-dialog-action"
      className={cn(className)}
      {...props}
    />
  )
}

function AlertDialogCancel({
  className,
  variant = "outline",
  size = "default",
  ...props
}: AlertDialogPrimitive.Close.Props &
  Pick<React.ComponentProps<typeof Button>, "variant" | "size">) {
  return (
    <AlertDialogPrimitive.Close
      data-slot="alert-dialog-cancel"
      className={cn(className)}
      render={<Button variant={variant} size={size} />}
      {...props}
    />
  )
}

export {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogOverlay,
  AlertDialogPortal,
  AlertDialogTitle,
}
