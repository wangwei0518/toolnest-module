import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "subv:group/badge subv:inline-flex subv:h-5 subv:w-fit subv:shrink-0 subv:items-center subv:justify-center subv:gap-1 subv:overflow-hidden subv:rounded-full subv:border subv:border-transparent subv:px-2 subv:py-0.5 subv:text-[0.625rem] subv:font-medium subv:whitespace-nowrap subv:transition-all subv:focus-visible:border-ring subv:focus-visible:ring-[3px] subv:focus-visible:ring-ring/50 subv:has-data-[icon=inline-end]:pr-1.5 subv:has-data-[icon=inline-start]:pl-1.5 subv:aria-invalid:border-destructive subv:aria-invalid:ring-destructive/20 subv:dark:aria-invalid:ring-destructive/40 subv:[&>svg]:pointer-events-none subv:[&>svg]:size-2.5",
  {
    variants: {
      variant: {
        default: "subv:bg-primary subv:text-primary-foreground subv:[a]:hover:bg-primary/80",
        secondary:
          "subv:bg-secondary subv:text-secondary-foreground subv:[a]:hover:bg-secondary/80",
        destructive:
          "subv:bg-destructive/10 subv:text-destructive subv:focus-visible:ring-destructive/20 subv:dark:bg-destructive/20 subv:dark:focus-visible:ring-destructive/40 subv:[a]:hover:bg-destructive/20",
        outline:
          "subv:border-border subv:bg-input/20 subv:text-foreground subv:dark:bg-input/30 subv:[a]:hover:bg-muted subv:[a]:hover:text-muted-foreground",
        ghost:
          "subv:hover:bg-muted subv:hover:text-muted-foreground subv:dark:hover:bg-muted/50",
        link: "subv:text-primary subv:underline-offset-4 subv:hover:underline",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant = "default",
  render,
  ...props
}: useRender.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return useRender({
    defaultTagName: "span",
    props: mergeProps<"span">(
      {
        className: cn(badgeVariants({ variant }), className),
      },
      props
    ),
    render,
    state: {
      slot: "badge",
      variant,
    },
  })
}

export { Badge, badgeVariants }
