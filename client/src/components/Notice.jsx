import { AlertCircle, CheckCircle2, Info, TriangleAlert, X } from "lucide-react";

const icons = { danger: AlertCircle, warning: TriangleAlert, success: CheckCircle2, info: Info };

export default function Notice({ tone = "info", title, children, onClose }) {
  const Icon = icons[tone] || Info;
  return (
    <div className={`notice notice-${tone}`} role={tone === "danger" ? "alert" : "status"}>
      <Icon size={18} aria-hidden="true" />
      <div><strong>{title}</strong>{children ? <div>{children}</div> : null}</div>
      {onClose ? <button className="icon-button notice-close" onClick={onClose} aria-label="Dismiss"><X size={16} /></button> : null}
    </div>
  );
}

