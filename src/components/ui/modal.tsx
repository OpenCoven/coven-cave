"use client";

import { useCallback, useContext, useEffect, useId, useMemo, useRef, type ReactNode, type RefObject, type PointerEvent } from "react";
import { createPortal } from "react-dom";
import { acquireModalEnvironment, refreshModalEnvironment } from "@/lib/modal-environment";
import { Icon } from "@/lib/icon";
import {
  FocusTrapPortalLayersContext,
  FocusTrapOwnerHiddenContext,
  PortalLayerDepthContext,
  PortalLayerRootContext,
  useFocusTrap,
  usePortalLayerRootId,
  usePortalLayerZIndex,
} from "@/lib/use-focus-trap";

export type ModalSize = "compact" | "standard" | "wide" | "reader" | "workspace";
export type ModalPresentation = "dialog" | "sheet-left" | "sheet-right" | "fullscreen";
export type ModalCloseReason = "escape" | "backdrop" | "close" | "owner-hidden";

export type ModalProps = {
  open: boolean;
  id?: string;
  /** Retain chat/reader state while closed; the layer becomes hidden and inert. */
  keepMounted?: boolean;
  /** A separate dialog temporarily owns interaction, e.g. setup diagnostics. */
  covered?: boolean;
  /** Pane-scoped required gates stay inside their existing positioned owner. */
  scope?: "viewport" | "container";
  onClose: (reason?: ModalCloseReason) => void;
  /** Plain heading for dialogs without a navigation breadcrumb. */
  title?: ReactNode;
  /** Short supporting copy; structured documents belong in the body. */
  description?: ReactNode;
  /** Visual identity beside the shared heading, e.g. a marketplace logo. */
  headerIcon?: ReactNode;
  /** Print this document surface without the app or modal controls. */
  printable?: boolean;
  headerActions?: ReactNode;
  closeLabel?: string;
  /** Breadcrumb-style header. Final segment renders bold. */
  breadcrumb?: ReactNode[];
  /** Footer pills row (left side). Use PropertyPill instances. */
  footerPills?: ReactNode;
  /** Footer actions (right side). Typically Cancel + primary action. */
  footerActions?: ReactNode;
  children: ReactNode;
  size?: ModalSize;
  presentation?: ModalPresentation;
  /** Fill lets content such as a file browser own its internal scroll areas. */
  bodyLayout?: "scroll" | "fill";
  /** Blocks every user dismissal while a mutation is pending. */
  busy?: boolean;
  /** Required gates provide their own navigation action instead of dismissal. */
  dismissible?: boolean;
  initialFocusRef?: RefObject<HTMLElement | null>;
  restoreFocus?: () => boolean;
  containTabFocus?: boolean;
  /** A command surface can forward a backdrop press to its underlying target. */
  onBackdropPress?: (event: PointerEvent<HTMLDivElement>) => void;
  /** Click-outside dismiss (default true). */
  dismissOnBackdrop?: boolean;
  /** Escape-key dismiss (default true). Pass `{!busy}` while a submit is in
   *  flight so Esc can't close the dialog mid-mutation — the focus trap
   *  itself stays active either way; only dismissal is gated. */
  dismissOnEscape?: boolean;
  /** Accessible label when there is no breadcrumb. */
  ariaLabel?: string;
  /** Description element inside the modal body. */
  ariaDescribedBy?: string;
  /** Called with the complete backdrop layer once mounted, and null on
   *  unmount. This lets a caller register the whole Modal — including backdrop
   *  presses — with an owning portaled layer such as Popover. */
  onLayerElement?: (el: HTMLDivElement | null) => void;
};

export function Modal({
  open,
  id,
  keepMounted = false,
  covered = false,
  scope = "viewport",
  onClose,
  title,
  description,
  printable = false,
  headerIcon,
  headerActions,
  closeLabel = "Close",
  breadcrumb,
  footerPills,
  footerActions,
  children,
  size = "standard",
  presentation = "dialog",
  bodyLayout = "scroll",
  busy = false,
  dismissible = true,
  initialFocusRef,
  restoreFocus,
  containTabFocus = false,
  onBackdropPress,
  dismissOnBackdrop = true,
  dismissOnEscape = true,
  ariaLabel,
  ariaDescribedBy,
  onLayerElement,
}: ModalProps) {
  const layerRef = useRef<HTMLDivElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const ownerHidden = useContext(FocusTrapOwnerHiddenContext);
  const visible = open && !ownerHidden;
  // Read the new render during trap cleanup, before passive effects update.
  const coveredRef = useRef(covered);
  coveredRef.current = covered;
  const portalLayerElementsRef = useRef<Map<HTMLElement, number>>(new Map());
  const ownerLayerDepth = useContext(PortalLayerDepthContext);
  const portalLayerRootId = usePortalLayerRootId();
  const layerZIndex = usePortalLayerZIndex(visible, portalLayerRootId, ownerLayerDepth + 1);
  const headingId = useId();
  const descriptionId = useId();
  const hasBreadcrumb = Boolean(breadcrumb?.length);
  const heading = title ?? ariaLabel;
  const hasHeading = hasBreadcrumb || heading != null;
  const canDismiss = dismissible && !busy;
  const requestClose = useCallback((reason: ModalCloseReason) => {
    if (canDismiss) onClose(reason);
  }, [canDismiss, onClose]);
  const setLayerElement = useCallback(
    (el: HTMLDivElement | null) => {
      layerRef.current = el;
      onLayerElement?.(el);
    },
    [onLayerElement],
  );
  const portalLayers = useMemo(
    () => ({
      register: (el: HTMLElement) => {
        portalLayerElementsRef.current.set(
          el,
          (portalLayerElementsRef.current.get(el) ?? 0) + 1,
        );
        refreshModalEnvironment();
        return () => {
          const next = (portalLayerElementsRef.current.get(el) ?? 1) - 1;
          if (next === 0) portalLayerElementsRef.current.delete(el);
          else portalLayerElementsRef.current.set(el, next);
          refreshModalEnvironment();
        };
      },
      contains: (node: Node | null) => {
        if (!node) return false;
        for (const el of portalLayerElementsRef.current.keys()) if (el.contains(node)) return true;
        return false;
      },
      elements: () => Array.from(portalLayerElementsRef.current.keys()),
    }),
    [],
  );

  // Release background inert before the focus trap restores its opener.
  useEffect(() => {
    if (!visible || covered || scope !== "viewport" || !layerRef.current) return;
    return acquireModalEnvironment(layerRef.current, portalLayers.elements, layerZIndex);
  }, [visible, covered, scope, portalLayers, layerZIndex]);

  // Keep the trap active regardless of dismissability — an undefined onEscape
  // makes Esc a no-op without releasing Tab cycling or focus return.
  useFocusTrap(visible && !covered, dialogRef, {
    onEscape: dismissOnEscape && canDismiss ? () => requestClose("escape") : undefined,
    initialFocusRef,
    restoreFocus: () => !coveredRef.current && restoreFocus?.() !== false,
    containTabFocus,
    portalLayers,
    portalRootId: portalLayerRootId,
  });

  useEffect(() => {
    // A retained parent must not reopen stale idle descendants. Busy children
    // remain hidden until their mutation settles, then dismiss normally.
    if (open && ownerHidden && canDismiss) requestClose("owner-hidden");
  }, [open, ownerHidden, canDismiss, requestClose]);

  useEffect(() => {
    // Disabling the active action must not leave keyboard focus on the page.
    if (visible && !covered && busy && document.activeElement?.matches(":disabled")) {
      dialogRef.current?.focus();
    }
  }, [busy, covered, visible]);

  useEffect(() => {
    if (!visible || covered || scope !== "container") return;
    // A pane can be taller than its scrollport. Focusing only the close
    // control reveals that control, while leaving the dialog's footer below
    // the viewport. Scroll the pane to the whole bounded dialog instead.
    const reveal = () => dialogRef.current?.scrollIntoView?.({ block: "center", inline: "nearest", behavior: "instant" });
    reveal();
    window.addEventListener("resize", reveal);
    return () => window.removeEventListener("resize", reveal);
  }, [covered, scope, visible]);

  if ((!visible && !keepMounted) || typeof document === "undefined") return null;

  const layer = (
    <div
      ref={setLayerElement}
      className="ui-modal-backdrop"
      style={{ zIndex: layerZIndex }}
      hidden={!visible}
      inert={!visible || undefined}
      aria-hidden={!visible || undefined}
      data-presentation={presentation}
      data-scope={scope}
      data-printable={printable || undefined}
      onPointerDown={dismissOnBackdrop && canDismiss && onBackdropPress ? (event) => {
        if (event.target === event.currentTarget) onBackdropPress(event);
      } : undefined}
      onClick={dismissOnBackdrop && canDismiss && !onBackdropPress ? () => requestClose("backdrop") : undefined}
      role="presentation"
    >
      <div
        ref={dialogRef}
        id={id}
        className={`ui-modal${size === "wide" ? " ui-modal--wide" : ""}`}
        data-size={size}
        data-body-layout={bodyLayout}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal={visible && !covered ? "true" : undefined}
        inert={covered || undefined}
        aria-labelledby={hasHeading ? headingId : undefined}
        aria-label={hasHeading ? undefined : ariaLabel}
        aria-describedby={[description != null ? descriptionId : null, ariaDescribedBy].filter(Boolean).join(" ") || undefined}
        aria-busy={busy || undefined}
        tabIndex={-1}
      >
        <FocusTrapOwnerHiddenContext.Provider value={!visible}>
        <FocusTrapPortalLayersContext.Provider value={portalLayers}>
          <PortalLayerRootContext.Provider value={portalLayerRootId}>
            <PortalLayerDepthContext.Provider value={ownerLayerDepth + 1}>
              {hasHeading ? (
                <header className="ui-modal-header">
                  {headerIcon ? <div className="ui-modal-icon">{headerIcon}</div> : null}
                  <div className="ui-modal-heading">
                    {hasBreadcrumb ? (
                      <div className="ui-modal-header-breadcrumb" id={headingId}>
                        {breadcrumb!.map((segment, i) => (
                          <span key={i} className="contents">
                            {i > 0 ? (
                              <span className="ui-modal-header-breadcrumb-sep" aria-hidden>›</span>
                            ) : null}
                            {i === breadcrumb!.length - 1 ? <strong>{segment}</strong> : <span>{segment}</span>}
                          </span>
                        ))}
                      </div>
                    ) : <h2 className="ui-modal-title" id={headingId}>{heading}</h2>}
                    {description != null ? <p className="ui-modal-description" id={descriptionId}>{description}</p> : null}
                  </div>
                  {headerActions ? <div className="ui-modal-header-actions">{headerActions}</div> : null}
                  {dismissible ? (
                    <button
                      type="button"
                      className="ui-modal-close focus-ring"
                      onClick={() => requestClose("close")}
                      disabled={busy}
                      aria-label={closeLabel}
                    >
                      <Icon name="ph:x" width={14} />
                    </button>
                  ) : null}
                </header>
              ) : null}

              {!hasHeading && description != null ? <p className="ui-modal-description" id={descriptionId}>{description}</p> : null}
              <div className="ui-modal-body" data-layout={bodyLayout}>{children}</div>

              {footerPills || footerActions ? (
                <footer className="ui-modal-footer">
                  <div className="ui-modal-footer-pills">{footerPills}</div>
                  <div className="ui-modal-footer-actions">{footerActions}</div>
                </footer>
              ) : null}
            </PortalLayerDepthContext.Provider>
          </PortalLayerRootContext.Provider>
        </FocusTrapPortalLayersContext.Provider>
        </FocusTrapOwnerHiddenContext.Provider>
      </div>
    </div>
  );
  return scope === "container" ? layer : createPortal(layer, document.body);
}
