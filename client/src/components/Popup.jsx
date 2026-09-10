import { useEffect, useId } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

export default function Popup({ open, title, description, children, footer, onClose, size = "large" }) {
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    if (!open) return undefined;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event) => {
      if (event.key === "Escape") onClose?.();
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div className="popup-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose?.(); }}>
      <section className={`popup popup-${size}`} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={description ? descriptionId : undefined}>
        <header className="popup-header">
          <div>
            <h2 id={titleId}>{title}</h2>
            {description ? <p id={descriptionId}>{description}</p> : null}
          </div>
          <button className="icon-button popup-close" type="button" onClick={onClose} aria-label="Close popup"><X size={18} /></button>
        </header>
        <div className="popup-body">{children}</div>
        {footer ? <footer className="popup-footer">{footer}</footer> : null}
      </section>
    </div>,
    document.body,
  );
}
