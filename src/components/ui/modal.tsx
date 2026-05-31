"use client";

import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@/lib/icon";

type ModalProps = {
  open: boolean;
  onClose: () => void;
  /** Breadcrumb-style header. Final segment renders bold. */
  breadcrumb?: ReactNode[];
  /** Footer pills row (left side). Use PropertyPill instances. */
  footerPills?: ReactNode;
  /** Footer actions (right side). Typically Cancel + primary action. */
  footerActions?: ReactNode;
  children: ReactNode;
  wide?: boolean;
  /** Click-outside dismiss (default true). */
  dismissOnBackdrop?: boolean;
};

export function Modal({
  open,
  onClose,
  breadcrumb,
  footerPills,
  footerActions,
  children,
  wide,
  dismissOnBackdrop = true,
}: ModalProps) {
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="ui-modal-backdrop"
      onClick={dismissOnBackdrop ? onClose : undefined}
      role="presentation"
    >
      <div
        className={`ui-modal${wide ? " ui-modal--wide" : ""}`}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        {breadcrumb ? (
          <header className="ui-modal-header">
            <div className="ui-modal-header-breadcrumb">
              {breadcrumb.map((segment, i) => (
                <span key={i} className="contents">
                  {i > 0 ? (
                    <span className="ui-modal-header-breadcrumb-sep" aria-hidden>
                      ›
                    </span>
                  ) : null}
                  {i === breadcrumb.length - 1 ? <strong>{segment}</strong> : <span>{segment}</span>}
                </span>
              ))}
            </div>
            <button
              type="button"
              className="ui-modal-close"
              onClick={onClose}
              aria-label="Close"
            >
              <Icon name="ph:x" width={14} />
            </button>
          </header>
        ) : null}

        <div className="ui-modal-body">{children}</div>

        {footerPills || footerActions ? (
          <footer className="ui-modal-footer">
            <div className="ui-modal-footer-pills">{footerPills}</div>
            <div className="ui-modal-footer-actions">{footerActions}</div>
          </footer>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
