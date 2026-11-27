import { Menu as MenuPrimitive } from "@base-ui/react/menu"
import { cn } from "@/lib/utils"

function DropdownMenu({ ...props }: MenuPrimitive.Root.Props) {
  return <MenuPrimitive.Root data-slot="dropdown-menu" {...props} />
}

function DropdownMenuTrigger({ ...props }: MenuPrimitive.Trigger.Props) {
  return <MenuPrimitive.Trigger data-slot="dropdown-menu-trigger" {...props} />
}

function DropdownMenuContent({
  align = "start",
  alignOffset = 0,
  side = "bottom",
  sideOffset = 4,
  className,
  ...props
}: MenuPrimitive.Popup.Props &
  Pick<
    MenuPrimitive.Positioner.Props,
    "align" | "alignOffset" | "side" | "sideOffset"
  >) {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Positioner
        className="subv:isolate subv:z-50 subv:outline-none"
        align={align}
        alignOffset={alignOffset}
        side={side}
        sideOffset={sideOffset}
      >
        <MenuPrimitive.Popup
          data-slot="dropdown-menu-content"
          className={cn("subv:z-50 subv:max-h-(--available-height) subv:w-(--anchor-width) subv:min-w-32 subv:origin-(--transform-origin) subv:overflow-x-hidden subv:overflow-y-auto subv:rounded-lg subv:bg-popover subv:p-1 subv:text-popover-foreground subv:shadow-md subv:ring-1 subv:ring-foreground/10 subv:duration-100 subv:outline-none subv:data-[side=bottom]:slide-in-from-top-2 subv:data-[side=inline-end]:slide-in-from-left-2 subv:data-[side=inline-start]:slide-in-from-right-2 subv:data-[side=left]:slide-in-from-right-2 subv:data-[side=right]:slide-in-from-left-2 subv:data-[side=top]:slide-in-from-bottom-2 subv:data-open:animate-in subv:data-open:fade-in-0 subv:data-open:zoom-in-95 subv:data-closed:animate-out subv:data-closed:overflow-hidden subv:data-closed:fade-out-0 subv:data-closed:zoom-out-95", className )}
          {...props}
        />
      </MenuPrimitive.Positioner>
    </MenuPrimitive.Portal>
  )
}

function DropdownMenuGroup({ ...props }: MenuPrimitive.Group.Props) {
  return <MenuPrimitive.Group data-slot="dropdown-menu-group" {...props} />
}

function DropdownMenuItem({
  className,
  inset,
  variant = "default",
  ...props
}: MenuPrimitive.Item.Props & {
  inset?: boolean
  variant?: "default" | "destructive"
}) {
  return (
    <MenuPrimitive.Item
      data-slot="dropdown-menu-item"
      data-inset={inset}
      data-variant={variant}
      className={cn(
        "subv:group/dropdown-menu-item subv:relative subv:flex subv:min-h-7 subv:cursor-default subv:items-center subv:gap-2 subv:rounded-md subv:px-2 subv:py-1 subv:text-xs/relaxed subv:outline-hidden subv:select-none subv:focus:bg-accent subv:focus:text-accent-foreground subv:not-data-[variant=destructive]:focus:**:text-accent-foreground subv:data-inset:pl-7.5 subv:data-[variant=destructive]:text-destructive subv:data-[variant=destructive]:focus:bg-destructive/10 subv:data-[variant=destructive]:focus:text-destructive subv:dark:data-[variant=destructive]:focus:bg-destructive/20 subv:data-disabled:pointer-events-none subv:data-disabled:opacity-50 subv:[&_svg]:pointer-events-none subv:[&_svg]:shrink-0 subv:[&_svg:not([class*=size-])]:size-3.5 subv:data-[variant=destructive]:*:[svg]:text-destructive",
        className
      )}
      {...props}
    />
  )
}

export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
}
