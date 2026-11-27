import { Tabs as TabsPrimitive } from "@base-ui/react/tabs"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

function Tabs({
  className,
  orientation = "horizontal",
  ...props
}: TabsPrimitive.Root.Props) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      data-orientation={orientation}
      className={cn(
        "subv:group/tabs subv:flex subv:gap-2 subv:data-horizontal:flex-col",
        className
      )}
      {...props}
    />
  )
}

const tabsListVariants = cva(
  "subv:group/tabs-list subv:inline-flex subv:w-fit subv:items-center subv:justify-center subv:rounded-lg subv:p-[3px] subv:text-muted-foreground subv:group-data-horizontal/tabs:h-8 subv:group-data-vertical/tabs:h-fit subv:group-data-vertical/tabs:flex-col subv:data-[variant=line]:rounded-none",
  {
    variants: {
      variant: {
        default: "subv:bg-muted",
        line: "subv:gap-1 subv:bg-transparent",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function TabsList({
  children,
  className,
  variant = "default",
  ...props
}: TabsPrimitive.List.Props & VariantProps<typeof tabsListVariants>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      data-variant={variant}
      className={cn("tn-motion-tab-list", tabsListVariants({ variant }), className)}
      {...props}
    >
      <TabsPrimitive.Indicator data-slot="tabs-indicator" className="tn-motion-tab-indicator" />
      {children}
    </TabsPrimitive.List>
  )
}

function TabsTrigger({ className, ...props }: TabsPrimitive.Tab.Props) {
  return (
    <TabsPrimitive.Tab
      data-slot="tabs-trigger"
      className={cn(
        "tn-motion-control subv:relative subv:inline-flex subv:h-[calc(100%-1px)] subv:flex-1 subv:items-center subv:justify-center subv:gap-1.5 subv:rounded-md subv:border subv:border-transparent subv:px-1.5 subv:py-0.5 subv:text-xs subv:font-medium subv:whitespace-nowrap subv:text-foreground/60 subv:transition-all subv:group-data-vertical/tabs:w-full subv:group-data-vertical/tabs:justify-start subv:group-data-vertical/tabs:py-[calc(--spacing(1.25))] subv:hover:text-foreground subv:focus-visible:border-ring subv:focus-visible:ring-[3px] subv:focus-visible:ring-ring/50 subv:focus-visible:outline-1 subv:focus-visible:outline-ring subv:disabled:pointer-events-none subv:disabled:opacity-50 subv:has-data-[icon=inline-end]:pr-1 subv:has-data-[icon=inline-start]:pl-1 subv:aria-disabled:pointer-events-none subv:aria-disabled:opacity-50 subv:dark:text-muted-foreground subv:dark:hover:text-foreground subv:[&_svg]:pointer-events-none subv:[&_svg]:shrink-0 subv:[&_svg:not([class*='size-'])]:size-3.5",
        "subv:group-data-[variant=line]/tabs-list:bg-transparent subv:group-data-[variant=line]/tabs-list:data-active:bg-transparent subv:dark:group-data-[variant=line]/tabs-list:data-active:border-transparent subv:dark:group-data-[variant=line]/tabs-list:data-active:bg-transparent",
        "subv:data-active:bg-background subv:data-active:text-foreground subv:dark:data-active:border-input subv:dark:data-active:bg-input/30 subv:dark:data-active:text-foreground",
        "subv:after:absolute subv:after:bg-foreground subv:after:opacity-0 subv:after:transition-opacity subv:group-data-horizontal/tabs:after:inset-x-0 subv:group-data-horizontal/tabs:after:bottom-[-5px] subv:group-data-horizontal/tabs:after:h-0.5 subv:group-data-vertical/tabs:after:inset-y-0 subv:group-data-vertical/tabs:after:-right-1 subv:group-data-vertical/tabs:after:w-0.5 subv:group-data-[variant=line]/tabs-list:data-active:after:opacity-100",
        className
      )}
      {...props}
    />
  )
}

function TabsContent({ className, ...props }: TabsPrimitive.Panel.Props) {
  return (
    <TabsPrimitive.Panel
      data-slot="tabs-content"
      className={cn("tn-motion-panel subv:flex-1 subv:text-xs/relaxed subv:outline-none", className)}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent, tabsListVariants }
