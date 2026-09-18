import { forwardRef } from "react";
import { Label as LabelPrimitive } from "radix-ui";

import { cn } from "@/lib/utils";

const Label = forwardRef(({ className, ...props }, ref) => (
  <LabelPrimitive.Root
    ref={ref}
    data-slot="label"
    className={cn(
      "flex items-center gap-2 text-sm font-normal leading-none text-foreground peer-disabled:cursor-not-allowed peer-disabled:opacity-50",
      className,
    )}
    {...props}
  />
));
Label.displayName = "Label";

export { Label };
