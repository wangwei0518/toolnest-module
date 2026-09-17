"use client"

import * as React from "react"

import { cn } from "@/lib/utils"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  InputGroup,
  InputGroupAddon,
} from "@/components/ui/input-group"
import { RiSearchLine, RiCheckLine } from "@remixicon/react"

function Command({
  className,
  shouldFilter: _shouldFilter,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { shouldFilter?: boolean }) {
  return (
    <div
      data-slot="command"
      className={cn(
        "flex size-full flex-col overflow-hidden rounded-xl bg-popover p-1 text-popover-foreground",
        className
      )}
      {...props}
    />
  )
}

function CommandDialog({
  title = "Command Palette",
  description = "Search for a command to run...",
  children,
  className,
  showCloseButton = false,
  ...props
}: Omit<React.ComponentProps<typeof Dialog>, "children"> & {
  title?: string
  description?: string
  className?: string
  showCloseButton?: boolean
  children: React.ReactNode
}) {
  return (
    <Dialog {...props}>
      <DialogHeader className="sr-only">
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </DialogHeader>
      <DialogContent
        className={cn(
          "top-1/3 translate-y-0 overflow-hidden rounded-xl! p-0",
          className
        )}
        showCloseButton={showCloseButton}
      >
        {children}
      </DialogContent>
    </Dialog>
  )
}

function CommandInput({
  className,
  wrapperClassName,
  onValueChange,
  onChange,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & {
  wrapperClassName?: string
  onValueChange?: (value: string) => void
}) {
  return (
    <div data-slot="command-input-wrapper" className={cn("p-1 pb-0", wrapperClassName)}>
      <InputGroup className="h-8 rounded-lg border-0 bg-muted/50 shadow-none">
        <input
          data-slot="command-input"
          className={cn(
            "h-8 w-full text-sm/relaxed outline-hidden placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50",
            className
          )}
          onChange={(event) => {
            onChange?.(event)
            onValueChange?.(event.target.value)
          }}
          {...props}
        />
        <InputGroupAddon>
          <RiSearchLine className="size-3.5 shrink-0 opacity-50" />
        </InputGroupAddon>
      </InputGroup>
    </div>
  )
}

function CommandList({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="command-list"
      className={cn(
        "no-scrollbar max-h-72 scroll-py-1 overflow-x-hidden overflow-y-auto outline-none",
        className
      )}
      {...props}
    />
  )
}

function CommandEmpty({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="command-empty"
      className={cn("py-6 text-center text-xs/relaxed", className)}
      {...props}
    />
  )
}

function CommandGroup({
  className,
  heading,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { heading?: React.ReactNode }) {
  return (
    <div
      data-slot="command-group"
      className={cn(
        "overflow-hidden p-1 text-foreground",
        className
      )}
      {...props}
    >
      {heading ? <div className="px-2.5 py-1.5 text-xs font-medium text-muted-foreground">{heading}</div> : null}
      {props.children}
    </div>
  )
}

function CommandSeparator({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="command-separator"
      className={cn("-mx-1 my-1 h-px bg-border/50", className)}
      {...props}
    />
  )
}

function CommandItem({
  className,
  children,
  onSelect,
  onClick,
  value,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  value?: string
  onSelect?: (value: string) => void
}) {
  return (
    <button
      type="button"
      data-slot="command-item"
      className={cn(
        "group/command-item relative flex min-h-7 w-full cursor-default items-center gap-2 rounded-md border-0 bg-transparent px-2.5 py-1.5 text-left text-xs/relaxed outline-hidden select-none hover:bg-muted disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
        className
      )}
      value={value}
      onClick={(event) => {
        onClick?.(event)
        if (!event.defaultPrevented && !props.disabled) onSelect?.(value ?? "")
      }}
      {...props}
    >
      {children}
      <RiCheckLine className="ml-auto opacity-0 group-has-data-[slot=command-shortcut]/command-item:hidden group-data-[checked=true]/command-item:opacity-100" />
    </button>
  )
}

function CommandShortcut({
  className,
  ...props
}: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="command-shortcut"
      className={cn(
        "ml-auto text-[0.625rem] tracking-widest text-muted-foreground group-data-selected/command-item:text-foreground",
        className
      )}
      {...props}
    />
  )
}

export {
  Command,
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandShortcut,
  CommandSeparator,
}
