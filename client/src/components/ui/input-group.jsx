import { forwardRef } from "react";
import { cva } from "class-variance-authority";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const InputGroup = forwardRef(({ className, ...props }, ref) => (
  <div
    ref={ref}
    role="group"
    data-slot="input-group"
    className={cn(
      "group/input-group relative flex h-9 w-full min-w-0 items-center rounded-sm border border-input bg-background outline-none transition-colors has-[[data-slot=input]:focus-visible]:border-ring has-[[data-slot=input]:focus-visible]:ring-2 has-[[data-slot=input]:focus-visible]:ring-ring/30 has-[[aria-invalid=true]]:border-destructive has-[[aria-invalid=true]]:ring-2 has-[[aria-invalid=true]]:ring-destructive/20",
      className,
    )}
    {...props}
  />
));
InputGroup.displayName = "InputGroup";

const inputGroupAddonVariants = cva(
  "flex shrink-0 items-center gap-2 text-sm font-normal text-muted-foreground [&_svg]:size-4",
  {
    variants: {
      align: {
        inlineStart: "order-first pl-3",
        inlineEnd: "order-last pr-3",
      },
    },
    defaultVariants: { align: "inlineStart" },
  },
);

function InputGroupAddon({ className, align, onClick, ...props }) {
  return (
    <div
      data-slot="input-group-addon"
      data-align={align}
      className={cn(inputGroupAddonVariants({ align }), className)}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented && !event.target.closest("button")) {
          event.currentTarget.parentElement?.querySelector("input")?.focus();
        }
      }}
      {...props}
    />
  );
}

const InputGroupInput = forwardRef(({ className, ...props }, ref) => (
  <Input
    ref={ref}
    className={cn(
      "h-full flex-1 rounded-none border-0 bg-transparent shadow-none focus-visible:border-transparent focus-visible:ring-0",
      className,
    )}
    {...props}
  />
));
InputGroupInput.displayName = "InputGroupInput";

function InputGroupButton({ className, size = "icon", variant = "ghost", ...props }) {
  return (
    <Button
      data-slot="input-group-button"
      size={size}
      variant={variant}
      className={cn("m-0.5 h-7 shrink-0", size === "icon" && "w-7", className)}
      {...props}
    />
  );
}

function InputGroupText({ className, ...props }) {
  return (
    <span
      data-slot="input-group-text"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  );
}

export {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  InputGroupText,
};
