import { cn } from "@/lib/utils";

function Empty({ className, ...props }) {
  return (
    <div
      data-slot="empty"
      className={cn(
        "flex min-h-44 w-full flex-col items-center justify-center gap-4 rounded-md bg-muted/45 p-8 text-center",
        className,
      )}
      {...props}
    />
  );
}

function EmptyHeader({ className, ...props }) {
  return (
    <div
      data-slot="empty-header"
      className={cn("flex max-w-sm flex-col items-center gap-1.5", className)}
      {...props}
    />
  );
}

function EmptyMedia({ className, variant = "default", ...props }) {
  return (
    <div
      data-slot="empty-media"
      data-variant={variant}
      className={cn(
        "mb-1 grid place-items-center text-muted-foreground [&_svg]:size-6",
        variant === "icon" && "size-10 rounded-sm bg-background",
        className,
      )}
      {...props}
    />
  );
}

function EmptyTitle({ className, ...props }) {
  return (
    <h3
      data-slot="empty-title"
      className={cn("text-base font-normal text-foreground", className)}
      {...props}
    />
  );
}

function EmptyDescription({ className, ...props }) {
  return (
    <p
      data-slot="empty-description"
      className={cn("text-sm leading-relaxed text-muted-foreground", className)}
      {...props}
    />
  );
}

function EmptyContent({ className, ...props }) {
  return (
    <div
      data-slot="empty-content"
      className={cn("flex flex-wrap items-center justify-center gap-2", className)}
      {...props}
    />
  );
}

export { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle };
