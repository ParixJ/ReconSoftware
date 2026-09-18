import { forwardRef } from "react";
import { Slot } from "radix-ui";
import { cva } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-sm text-sm font-normal transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        destructive:
          "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        outline:
          "border border-input bg-background text-foreground hover:bg-accent hover:text-accent-foreground",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost: "text-foreground hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 px-3 text-xs",
        lg: "h-10 px-6",
        icon: "size-9",
      },
      cursor:{
        pointer: "cursor-pointer",
        disabled: "cursor-not-allowed"
      }
    },
    defaultVariants: {
      variant: "default",
      size: "default",
      cursor: "pointer"
    },
  },
);

const Button = forwardRef(
  ({ className, variant, cursor: cursorProp, disabled, size, asChild = false, type, ...props }, ref) => {
    const Component = asChild ? Slot.Root : "button";
    const cursor = cursorProp || (disabled?"disabled":"pointer");
    return (
      <Component
        ref={ref}
        type={asChild ? undefined : (type ?? "button")}
        className={cn(buttonVariants({ variant, size, cursor }), className)}
        data-slot="button"
        disabled={disabled}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
