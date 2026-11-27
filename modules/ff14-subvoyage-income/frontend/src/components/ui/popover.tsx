import * as React from "react"
import { Popover as PopoverPrimitive } from "@base-ui/react/popover"

import { cn } from "@/lib/utils"

function Popover({ ...props }: PopoverPrimitive.Root.Props) {
  return <PopoverPrimitive.Root data-slot="popover" {...props} />
}

function PopoverTrigger({ ...props }: PopoverPrimitive.Trigger.Props) {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />
}

function PopoverContent({
  className,
  align = "center",
  alignOffset = 0,
  side = "bottom",
  sideOffset = 4,
  ...props
}: PopoverPrimitive.Popup.Props &
  Pick<
    PopoverPrimitive.Positioner.Props,
    "align" | "alignOffset" | "side" | "sideOffset"
  >) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Positioner
        align={align}
        alignOffset={alignOffset}
        side={side}
        sideOffset={sideOffset}
        className="subv:isolate subv:z-50"
      >
        <PopoverPrimitive.Popup
          data-slot="popover-content"
          className={cn(
            "tn-motion-overlay subv:z-50 subv:flex subv:w-72 subv:origin-(--transform-origin) subv:flex-col subv:gap-4 subv:rounded-lg subv:bg-popover subv:p-2.5 subv:text-xs subv:text-popover-foreground subv:shadow-md subv:ring-1 subv:ring-foreground/10 subv:outline-hidden subv:duration-100 subv:data-[side=bottom]:slide-in-from-top-2 subv:data-[side=inline-end]:slide-in-from-left-2 subv:data-[side=inline-start]:slide-in-from-right-2 subv:data-[side=left]:slide-in-from-right-2 subv:data-[side=right]:slide-in-from-left-2 subv:data-[side=top]:slide-in-from-bottom-2 subv:data-open:animate-in subv:data-open:fade-in-0 subv:data-open:zoom-in-95 subv:data-closed:animate-out subv:data-closed:fade-out-0 subv:data-closed:zoom-out-95",
            className
          )}
          {...props}
        />
      </PopoverPrimitive.Positioner>
    </PopoverPrimitive.Portal>
  )
}

function PopoverHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="popover-header"
      className={cn("subv:flex subv:flex-col subv:gap-1 subv:text-xs", className)}
      {...props}
    />
  )
}

function PopoverTitle({ className, ...props }: PopoverPrimitive.Title.Props) {
  return (
    <PopoverPrimitive.Title
      data-slot="popover-title"
      className={cn("subv:text-sm subv:font-medium", className)}
      {...props}
    />
  )
}

function PopoverDescription({
  className,
  ...props
}: PopoverPrimitive.Description.Props) {
  return (
    <PopoverPrimitive.Description
      data-slot="popover-description"
      className={cn("subv:text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
}
