import * as React from "react"

import { cn } from "@/lib/utils"

function Label({ className, ...props }: React.ComponentProps<"label">) {
  return (
    <label
      data-slot="label"
      className={cn(
        "subv:flex subv:items-center subv:gap-2 subv:text-xs/relaxed subv:leading-none subv:font-medium subv:select-none subv:group-data-[disabled=true]:pointer-events-none subv:group-data-[disabled=true]:opacity-50 subv:peer-disabled:cursor-not-allowed subv:peer-disabled:opacity-50",
        className
      )}
      {...props}
    />
  )
}

export { Label }
