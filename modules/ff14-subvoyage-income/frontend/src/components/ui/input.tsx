import * as React from "react"
import { Input as InputPrimitive } from "@base-ui/react/input"

import { cn } from "@/lib/utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        "subv:h-7 subv:w-full subv:min-w-0 subv:rounded-md subv:border subv:border-input subv:bg-input/20 subv:px-2 subv:py-0.5 subv:text-sm subv:transition-colors subv:outline-none subv:file:inline-flex subv:file:h-6 subv:file:border-0 subv:file:bg-transparent subv:file:text-xs/relaxed subv:file:font-medium subv:file:text-foreground subv:placeholder:text-muted-foreground subv:focus-visible:border-ring subv:focus-visible:ring-2 subv:focus-visible:ring-ring/30 subv:disabled:pointer-events-none subv:disabled:cursor-not-allowed subv:disabled:opacity-50 subv:aria-invalid:border-destructive subv:aria-invalid:ring-2 subv:aria-invalid:ring-destructive/20 subv:lg:text-xs/relaxed subv:dark:bg-input/30 subv:dark:aria-invalid:border-destructive/50 subv:dark:aria-invalid:ring-destructive/40",
        className
      )}
      {...props}
    />
  )
}

export { Input }
