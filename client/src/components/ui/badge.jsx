import { cva } from "class-variance-authority";
import { Slot } from "radix-ui";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex w-fit shrink-0 items-center gap-1 border px-2 py-0.5 text-xs font-normal whitespace-nowrap [&>svg]:size-3",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground",
        secondary: "border-transparent bg-secondary text-secondary-foreground",
        outline: "border-border bg-transparent text-foreground",
        success: "border-success/25 bg-success/12 text-success",
        warning: "border-warning/30 bg-warning/12 text-warning",
        destructive: "border-destructive/30 bg-destructive/10 text-destructive",
        info: "border-info/25 bg-info/10 text-info",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

function Badge({ className, variant, asChild = false, ...props }) {
  const Component = asChild ? Slot.Root : "span";
  return (
    <Component
      data-slot="badge"
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  );
}

export { Badge, badgeVariants };
