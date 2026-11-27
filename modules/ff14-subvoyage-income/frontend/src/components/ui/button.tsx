import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "subv:group/button subv:inline-flex subv:shrink-0 subv:items-center subv:justify-center subv:rounded-md subv:border subv:border-transparent subv:bg-clip-padding subv:text-xs/relaxed subv:font-medium subv:whitespace-nowrap subv:transition-all subv:outline-none subv:select-none subv:focus-visible:border-ring subv:focus-visible:ring-2 subv:focus-visible:ring-ring/30 subv:active:not-aria-[haspopup]:translate-y-px subv:disabled:pointer-events-none subv:disabled:opacity-50 subv:aria-invalid:border-destructive subv:aria-invalid:ring-2 subv:aria-invalid:ring-destructive/20 subv:dark:aria-invalid:border-destructive/50 subv:dark:aria-invalid:ring-destructive/40 subv:[&_svg]:pointer-events-none subv:[&_svg]:shrink-0 subv:[&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "subv:bg-primary subv:text-primary-foreground subv:hover:bg-primary/80",
        outline:
          "subv:border-border subv:hover:bg-input/50 subv:hover:text-foreground subv:aria-expanded:bg-muted subv:aria-expanded:text-foreground subv:dark:bg-input/30",
        secondary:
          "subv:bg-secondary subv:text-secondary-foreground subv:hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)] subv:aria-expanded:bg-secondary subv:aria-expanded:text-secondary-foreground",
        ghost:
          "subv:hover:bg-muted subv:hover:text-foreground subv:aria-expanded:bg-muted subv:aria-expanded:text-foreground subv:dark:hover:bg-muted/50",
        destructive:
          "subv:bg-destructive/10 subv:text-destructive subv:hover:bg-destructive/20 subv:focus-visible:border-destructive/40 subv:focus-visible:ring-destructive/20 subv:dark:bg-destructive/20 subv:dark:hover:bg-destructive/30 subv:dark:focus-visible:ring-destructive/40",
        link: "subv:text-primary subv:underline-offset-4 subv:hover:underline",
      },
      size: {
        default:
          "subv:h-7 subv:gap-1 subv:px-2 subv:text-xs/relaxed subv:has-data-[icon=inline-end]:pr-1.5 subv:has-data-[icon=inline-start]:pl-1.5 subv:[&_svg:not([class*='size-'])]:size-3.5",
        xs: "subv:h-5 subv:gap-1 subv:rounded-sm subv:px-2 subv:text-[0.625rem] subv:has-data-[icon=inline-end]:pr-1.5 subv:has-data-[icon=inline-start]:pl-1.5 subv:[&_svg:not([class*='size-'])]:size-2.5",
        sm: "subv:h-6 subv:gap-1 subv:px-2 subv:text-xs/relaxed subv:has-data-[icon=inline-end]:pr-1.5 subv:has-data-[icon=inline-start]:pl-1.5 subv:[&_svg:not([class*='size-'])]:size-3",
        lg: "subv:h-8 subv:gap-1 subv:px-2.5 subv:text-xs/relaxed subv:has-data-[icon=inline-end]:pr-2 subv:has-data-[icon=inline-start]:pl-2 subv:[&_svg:not([class*='size-'])]:size-4",
        icon: "subv:size-7 subv:[&_svg:not([class*='size-'])]:size-3.5",
        "icon-xs": "size-5 rounded-sm [&_svg:not([class*='size-'])]:size-2.5",
        "icon-sm": "size-6 [&_svg:not([class*='size-'])]:size-3",
        "icon-lg": "size-8 [&_svg:not([class*='size-'])]:size-4",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
