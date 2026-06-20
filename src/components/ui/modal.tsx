"use client";

import { useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@/lib/icon";
import { useFocusTrap } from "@/lib/use-focus-trap";

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
  /** Accessible label when there is no breadcrumb. */
  ariaLabel?: string;
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
  ariaLabel,
}: ModalProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const headingId = useId();

  useFocusTrap(open, dialogRef, { onEscape: onClose });

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="ui-modal-backdrop"
      onClick={dismissOnBackdrop ? onClose : undefined}
      role="presentation"
    >
      <div
        ref={dialogRef}
        className={`ui-modal${wide ? " ui-modal--wide" : ""}`}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        // Prefer naming the dialog from its breadcrumb header (the common case —
        // most call sites pass a breadcrumb and no ariaLabel). Without this the
        // dialog announces with no accessible name. Fall back to ariaLabel only
        // when there's no breadcrumb to point at.
        aria-labelledby={breadcrumb ? headingId : undefined}
        aria-label={breadcrumb ? undefined : ariaLabel}
        tabIndex={-1}
      >
        {breadcrumb ? (
          <header className="ui-modal-header">
            <div className="ui-modal-header-breadcrumb" id={headingId}>
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
              className="ui-modal-close focus-ring"
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
