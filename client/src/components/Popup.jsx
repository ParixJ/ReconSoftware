import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

const sizeClasses = {
  small: "sm:max-w-md",
  medium: "sm:max-w-xl",
  large: "sm:max-w-3xl",
  wide: "sm:max-w-6xl",
};

export default function Popup({ open, title, description, children, footer, onClose, size = "large" }) {
  if (!open) return null;

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose?.(); }}>
      <DialogContent
        showCloseButton={false}
        className={cn("max-h-[calc(100vh-2rem)] gap-0 overflow-hidden rounded-none p-0", sizeClasses[size] || sizeClasses.large)}
      >
        <DialogHeader className="relative border-b border-border px-5 py-4 pr-14">
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
          <DialogClose asChild>
            <Button variant="ghost" size="icon" className="absolute right-3 top-3" aria-label="Close popup"><X aria-hidden="true" /></Button>
          </DialogClose>
        </DialogHeader>
        <div className="max-h-[calc(100vh-11rem)] overflow-y-auto p-5">{children}</div>
        {footer ? <DialogFooter className="border-t border-border px-5 py-4">{footer}</DialogFooter> : null}
      </DialogContent>
    </Dialog>
  );
}
