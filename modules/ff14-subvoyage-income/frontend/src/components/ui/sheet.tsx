import * as React from "react"
import { Dialog as SheetPrimitive } from "@base-ui/react/dialog"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { RiCloseLine } from "@remixicon/react"

function Sheet({ ...props }: SheetPrimitive.Root.Props) {
  return <SheetPrimitive.Root data-slot="sheet" {...props} />
}

function SheetTrigger({ ...props }: SheetPrimitive.Trigger.Props) {
  return <SheetPrimitive.Trigger data-slot="sheet-trigger" {...props} />
}

function SheetClose({ ...props }: SheetPrimitive.Close.Props) {
  return <SheetPrimitive.Close data-slot="sheet-close" {...props} />
}

function SheetPortal({ ...props }: SheetPrimitive.Portal.Props) {
  return <SheetPrimitive.Portal data-slot="sheet-portal" {...props} />
}

function SheetOverlay({ className, ...props }: SheetPrimitive.Backdrop.Props) {
  return (
    <SheetPrimitive.Backdrop
      data-slot="sheet-overlay"
      className={cn(
        "tn-motion-overlay subv:fixed subv:inset-0 subv:z-50 subv:bg-black/20 subv:transition-opacity subv:duration-150 subv:data-ending-style:opacity-0 subv:data-starting-style:opacity-0 subv:supports-backdrop-filter:backdrop-blur-sm",
        className
      )}
      {...props}
    />
  )
}

function SheetContent({
  className,
  children,
  side = "right",
  showCloseButton = true,
  ...props
}: SheetPrimitive.Popup.Props & {
  side?: "top" | "right" | "bottom" | "left"
  showCloseButton?: boolean
}) {
  return (
    <SheetPortal>
      <SheetOverlay />
      <SheetPrimitive.Popup
        data-slot="sheet-content"
        data-side={side}
        className={cn(
          "tn-motion-overlay subv:fixed subv:z-50 subv:flex subv:flex-col subv:bg-popover subv:bg-clip-padding subv:text-xs/relaxed subv:text-popover-foreground subv:shadow-lg subv:transition subv:duration-200 subv:ease-in-out subv:data-ending-style:opacity-0 subv:data-starting-style:opacity-0 subv:data-[side=bottom]:inset-x-0 subv:data-[side=bottom]:bottom-0 subv:data-[side=bottom]:h-auto subv:data-[side=bottom]:border-t subv:data-[side=bottom]:data-ending-style:translate-y-[2.5rem] subv:data-[side=bottom]:data-starting-style:translate-y-[2.5rem] subv:data-[side=left]:inset-y-0 subv:data-[side=left]:left-0 subv:data-[side=left]:h-full subv:data-[side=left]:w-3/4 subv:data-[side=left]:border-r subv:data-[side=left]:data-ending-style:translate-x-[-2.5rem] subv:data-[side=left]:data-starting-style:translate-x-[-2.5rem] subv:data-[side=right]:inset-y-0 subv:data-[side=right]:right-0 subv:data-[side=right]:h-full subv:data-[side=right]:w-full subv:max-lg:data-[side=right]:max-w-none subv:lg:data-[side=right]:w-3/4 subv:data-[side=right]:border-l subv:data-[side=right]:data-ending-style:translate-x-[2.5rem] subv:data-[side=right]:data-starting-style:translate-x-[2.5rem] subv:data-[side=top]:inset-x-0 subv:data-[side=top]:top-0 subv:data-[side=top]:h-auto subv:data-[side=top]:border-b subv:data-[side=top]:data-ending-style:translate-y-[-2.5rem] subv:data-[side=top]:data-starting-style:translate-y-[-2.5rem] subv:data-[side=left]:sm:max-w-sm subv:data-[side=right]:lg:max-w-sm",
          className
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <SheetPrimitive.Close
            data-slot="sheet-close"
            render={
              <Button
                variant="ghost"
                className="subv:absolute subv:top-4 subv:right-4"
                size="icon-sm"
              />
            }
          >
            <RiCloseLine
            />
            <span className="subv:sr-only">Close</span>
          </SheetPrimitive.Close>
        )}
      </SheetPrimitive.Popup>
    </SheetPortal>
  )
}

function SheetHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-header"
      className={cn("subv:flex subv:flex-col subv:gap-1.5 subv:p-6", className)}
      {...props}
    />
  )
}

function SheetFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-footer"
      className={cn("subv:mt-auto subv:flex subv:flex-col subv:gap-2 subv:p-6", className)}
      {...props}
    />
  )
}

function SheetTitle({ className, ...props }: SheetPrimitive.Title.Props) {
  return (
    <SheetPrimitive.Title
      data-slot="sheet-title"
      className={cn(
        "subv:font-heading subv:text-sm subv:font-medium subv:text-foreground",
        className
      )}
      {...props}
    />
  )
}

function SheetDescription({
  className,
  ...props
}: SheetPrimitive.Description.Props) {
  return (
    <SheetPrimitive.Description
      data-slot="sheet-description"
      className={cn("subv:text-xs/relaxed subv:text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Sheet,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
}
