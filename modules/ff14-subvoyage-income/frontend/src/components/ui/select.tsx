"use client"

import * as React from "react"
import { Select as SelectPrimitive } from "@base-ui/react/select"

import { cn } from "@/lib/utils"
import { RiArrowDownSLine, RiCheckLine, RiArrowUpSLine } from "@remixicon/react"

const Select = SelectPrimitive.Root

function SelectGroup({ className, ...props }: SelectPrimitive.Group.Props) {
  return (
    <SelectPrimitive.Group
      data-slot="select-group"
      className={cn("subv:scroll-my-1 subv:p-1", className)}
      {...props}
    />
  )
}

function SelectValue({ className, ...props }: SelectPrimitive.Value.Props) {
  return (
    <SelectPrimitive.Value
      data-slot="select-value"
      className={cn("subv:flex subv:flex-1 subv:text-left", className)}
      {...props}
    />
  )
}

function SelectTrigger({
  className,
  size = "default",
  children,
  ...props
}: SelectPrimitive.Trigger.Props & {
  size?: "sm" | "default"
}) {
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      data-size={size}
      className={cn(
        "subv:flex subv:w-fit subv:items-center subv:justify-between subv:gap-1.5 subv:rounded-md subv:border subv:border-input subv:bg-input/20 subv:px-2 subv:py-1.5 subv:text-xs/relaxed subv:whitespace-nowrap subv:transition-colors subv:outline-none subv:focus-visible:border-ring subv:focus-visible:ring-2 subv:focus-visible:ring-ring/30 subv:disabled:cursor-not-allowed subv:disabled:opacity-50 subv:aria-invalid:border-destructive subv:aria-invalid:ring-2 subv:aria-invalid:ring-destructive/20 subv:data-placeholder:text-muted-foreground subv:data-[size=default]:h-7 subv:data-[size=sm]:h-6 subv:*:data-[slot=select-value]:line-clamp-1 subv:*:data-[slot=select-value]:flex subv:*:data-[slot=select-value]:items-center subv:*:data-[slot=select-value]:gap-1.5 subv:dark:bg-input/30 subv:dark:hover:bg-input/50 subv:dark:aria-invalid:border-destructive/50 subv:dark:aria-invalid:ring-destructive/40 subv:[&_svg]:pointer-events-none subv:[&_svg]:shrink-0 subv:[&_svg:not([class*='size-'])]:size-3.5",
        className
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon
        render={
          <RiArrowDownSLine className="subv:pointer-events-none subv:size-3.5 subv:text-muted-foreground" />
        }
      />
    </SelectPrimitive.Trigger>
  )
}

function SelectContent({
  className,
  children,
  side = "bottom",
  sideOffset = 4,
  align = "center",
  alignOffset = 0,
  alignItemWithTrigger = true,
  ...props
}: SelectPrimitive.Popup.Props &
  Pick<
    SelectPrimitive.Positioner.Props,
    "align" | "alignOffset" | "side" | "sideOffset" | "alignItemWithTrigger"
  >) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Positioner
        side={side}
        sideOffset={sideOffset}
        align={align}
        alignOffset={alignOffset}
        alignItemWithTrigger={alignItemWithTrigger}
        className="subv:isolate subv:z-50"
      >
        <SelectPrimitive.Popup
          data-slot="select-content"
          data-align-trigger={alignItemWithTrigger}
          className={cn("tn-motion-overlay subv:relative subv:isolate subv:z-50 subv:max-h-(--available-height) subv:w-(--anchor-width) subv:min-w-32 subv:origin-(--transform-origin) subv:overflow-x-hidden subv:overflow-y-auto subv:rounded-lg subv:bg-popover subv:text-popover-foreground subv:shadow-md subv:ring-1 subv:ring-foreground/10 subv:duration-100 subv:data-[align-trigger=true]:animate-none subv:data-[side=bottom]:slide-in-from-top-2 subv:data-[side=inline-end]:slide-in-from-left-2 subv:data-[side=inline-start]:slide-in-from-right-2 subv:data-[side=left]:slide-in-from-right-2 subv:data-[side=right]:slide-in-from-left-2 subv:data-[side=top]:slide-in-from-bottom-2 subv:data-open:animate-in subv:data-open:fade-in-0 subv:data-open:zoom-in-95 subv:data-closed:animate-out subv:data-closed:fade-out-0 subv:data-closed:zoom-out-95", className )}
          {...props}
        >
          <SelectScrollUpButton />
          <SelectPrimitive.List>{children}</SelectPrimitive.List>
          <SelectScrollDownButton />
        </SelectPrimitive.Popup>
      </SelectPrimitive.Positioner>
    </SelectPrimitive.Portal>
  )
}

function SelectLabel({
  className,
  ...props
}: SelectPrimitive.GroupLabel.Props) {
  return (
    <SelectPrimitive.GroupLabel
      data-slot="select-label"
      className={cn("subv:px-2 subv:py-1.5 subv:text-xs subv:text-muted-foreground", className)}
      {...props}
    />
  )
}

function SelectItem({
  className,
  children,
  ...props
}: SelectPrimitive.Item.Props) {
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      className={cn(
        "subv:relative subv:flex subv:min-h-7 subv:w-full subv:cursor-default subv:items-center subv:gap-2 subv:rounded-md subv:px-2 subv:py-1 subv:text-xs/relaxed subv:outline-hidden subv:select-none subv:focus:bg-accent subv:focus:text-accent-foreground subv:not-data-[variant=destructive]:focus:**:text-accent-foreground subv:data-disabled:pointer-events-none subv:data-disabled:opacity-50 subv:[&_svg]:pointer-events-none subv:[&_svg]:shrink-0 subv:[&_svg:not([class*='size-'])]:size-3.5 subv:*:[span]:last:flex subv:*:[span]:last:items-center subv:*:[span]:last:gap-2",
        className
      )}
      {...props}
    >
      <SelectPrimitive.ItemText className="subv:flex subv:flex-1 subv:shrink-0 subv:gap-2 subv:whitespace-nowrap">
        {children}
      </SelectPrimitive.ItemText>
      <SelectPrimitive.ItemIndicator
        render={
          <span className="subv:pointer-events-none subv:absolute subv:right-2 subv:flex subv:items-center subv:justify-center" />
        }
      >
        <RiCheckLine className="subv:pointer-events-none" />
      </SelectPrimitive.ItemIndicator>
    </SelectPrimitive.Item>
  )
}

function SelectSeparator({
  className,
  ...props
}: SelectPrimitive.Separator.Props) {
  return (
    <SelectPrimitive.Separator
      data-slot="select-separator"
      className={cn(
        "subv:pointer-events-none subv:-mx-1 subv:my-1 subv:h-px subv:bg-border/50",
        className
      )}
      {...props}
    />
  )
}

function SelectScrollUpButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollUpArrow>) {
  return (
    <SelectPrimitive.ScrollUpArrow
      data-slot="select-scroll-up-button"
      className={cn(
        "subv:top-0 subv:z-10 subv:flex subv:w-full subv:cursor-default subv:items-center subv:justify-center subv:bg-popover subv:py-1 subv:[&_svg:not([class*='size-'])]:size-3.5",
        className
      )}
      {...props}
    >
      <RiArrowUpSLine
      />
    </SelectPrimitive.ScrollUpArrow>
  )
}

function SelectScrollDownButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollDownArrow>) {
  return (
    <SelectPrimitive.ScrollDownArrow
      data-slot="select-scroll-down-button"
      className={cn(
        "subv:bottom-0 subv:z-10 subv:flex subv:w-full subv:cursor-default subv:items-center subv:justify-center subv:bg-popover subv:py-1 subv:[&_svg:not([class*='size-'])]:size-3.5",
        className
      )}
      {...props}
    >
      <RiArrowDownSLine
      />
    </SelectPrimitive.ScrollDownArrow>
  )
}

export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectScrollDownButton,
  SelectScrollUpButton,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
}
