import { forwardRef } from "react";
import { Tabs as TabsPrimitive } from "radix-ui";

import { cn } from "@/lib/utils";

const Tabs = TabsPrimitive.Root;

const TabsList = forwardRef(({ className, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    data-slot="tabs-list"
    className={cn(
      "inline-flex h-9 items-center justify-center bg-muted p-1 text-muted-foreground",
      className,
    )}
    {...props}
  />
));
TabsList.displayName = "TabsList";

const TabsTrigger = forwardRef(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    data-slot="tabs-trigger"
    className={cn(
      "inline-flex h-7 items-center justify-center gap-1.5 whitespace-nowrap rounded-[2px] px-3 text-sm font-normal outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/40 disabled:pointer-events-none disabled:opacity-50 data-[state=active]:bg-background data-[state=active]:text-foreground",
      className,
    )}
    {...props}
  />
));
TabsTrigger.displayName = "TabsTrigger";

const TabsContent = forwardRef(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    data-slot="tabs-content"
    className={cn("mt-2 outline-none focus-visible:ring-2 focus-visible:ring-ring/40", className)}
    {...props}
  />
));
TabsContent.displayName = "TabsContent";

export { Tabs, TabsContent, TabsList, TabsTrigger };
