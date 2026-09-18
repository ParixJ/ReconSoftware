import { forwardRef } from "react";

import { cn } from "@/lib/utils";

const Input = forwardRef(({ className, type = "text", ...props }, ref) => (
  <input
    ref={ref}
    type={type}
    data-slot="input"
    className={cn(
      "flex h-9 w-full min-w-0 rounded-sm border border-input bg-background px-3 py-1 text-sm font-normal text-foreground outline-none transition-colors placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/20 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30",
      className,
    )}
    {...props}
  />
));
Input.displayName = "Input";

export { Input };
