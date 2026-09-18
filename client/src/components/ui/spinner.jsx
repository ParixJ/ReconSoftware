import { LoaderCircleIcon } from "lucide-react";

import { cn } from "@/lib/utils";

function Spinner({ className, label = "Loading", ...props }) {
  return (
    <span
      role="status"
      data-slot="spinner"
      className="inline-flex items-center"
      {...props}
    >
      <LoaderCircleIcon
        className={cn("size-4 animate-spin", className)}
        aria-hidden="true"
      />
      <span className="sr-only">{label}</span>
    </span>
  );
}

export { Spinner };
