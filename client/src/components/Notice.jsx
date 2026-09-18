import { AlertCircle, CheckCircle2, Info, TriangleAlert, X } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

const icons = { danger: AlertCircle, warning: TriangleAlert, success: CheckCircle2, info: Info };
const variants = { danger: "destructive", warning: "warning", success: "success", info: "info" };

export default function Notice({ tone = "info", title, children, onClose }) {
  const Icon = icons[tone] || Info;

  return (
    <Alert
      variant={variants[tone] || "info"}
      role={tone === "danger" ? "alert" : "status"}
      className={onClose ? "pr-12" : undefined}
    >
      <Icon aria-hidden="true" />
      <AlertTitle>{title}</AlertTitle>
      {children ? <AlertDescription>{children}</AlertDescription> : null}
      {onClose ? (
        <Button
          variant="ghost"
          size="icon"
          className="absolute right-2 top-1/2 size-8 -translate-y-1/2 text-current hover:bg-current/10"
          onClick={onClose}
          aria-label="Dismiss"
        >
          <X aria-hidden="true" />
        </Button>
      ) : null}
    </Alert>
  );
}
