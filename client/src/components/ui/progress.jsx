import { forwardRef } from "react";
import { Progress as ProgressPrimitive } from "radix-ui";

import { cn } from "@/lib/utils";

const Progress = forwardRef(({ className, value = 0, max = 100, ...props }, ref) => {
  const safeMax = Number.isFinite(max) && max > 0 ? max : 100;
  const safeValue = Number.isFinite(value)
    ? Math.min(Math.max(value, 0), safeMax)
    : 0;
  const percentage = (safeValue / safeMax) * 100;

  return (
    <ProgressPrimitive.Root
      ref={ref}
      value={safeValue}
      max={safeMax}
      data-slot="progress"
      className={cn("relative h-1.5 w-full overflow-hidden bg-secondary", className)}
      {...props}
    >
      <ProgressPrimitive.Indicator
        data-slot="progress-indicator"
        className="h-full w-full bg-primary transition-transform"
        style={{ transform: `translateX(-${100 - percentage}%)` }}
      />
    </ProgressPrimitive.Root>
  );
});
Progress.displayName = "Progress";

export { Progress };
