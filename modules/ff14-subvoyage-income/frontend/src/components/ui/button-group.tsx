import type { ComponentProps } from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonGroupVariants = cva(
  "subv:flex subv:w-fit subv:items-stretch subv:*:focus-visible:relative subv:*:focus-visible:z-10 subv:has-[>[data-slot=button-group]]:gap-2 subv:has-[select[aria-hidden=true]:last-child]:[&>[data-slot=select-trigger]:last-of-type]:rounded-r-md subv:[&>[data-slot=select-trigger]:not([class*='w-'])]:w-fit subv:[&>input]:flex-1",
  {
    variants: {
      orientation: {
        horizontal:
          "subv:*:data-slot:rounded-r-none subv:[&>[data-slot]:not(:has(~[data-slot]))]:rounded-r-md subv:[&>[data-slot]~[data-slot]]:rounded-l-none subv:[&>[data-slot]~[data-slot]]:border-l-0",
        vertical:
          "subv:flex-col subv:*:data-slot:rounded-b-none subv:[&>[data-slot]:not(:has(~[data-slot]))]:rounded-b-md subv:[&>[data-slot]~[data-slot]]:rounded-t-none subv:[&>[data-slot]~[data-slot]]:border-t-0",
      },
    },
    defaultVariants: { orientation: "horizontal" },
  },
);

export function ButtonGroup({
  className,
  orientation = "horizontal",
  ...props
}: ComponentProps<"div"> & VariantProps<typeof buttonGroupVariants>) {
  return (
    <div
      role="group"
      data-slot="button-group"
      data-orientation={orientation}
      className={cn(buttonGroupVariants({ orientation }), className)}
      {...props}
    />
  );
}
