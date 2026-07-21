"use client";

/**
 * SurfaceRail — the shared collapsible/resizable list rail for surface tabs
 * (Sessions / Projects / Group / Familiar share this grammar). An <aside>
 * with a header row (uppercase title, caller actions, collapse toggle), an
 * optional search slot, a scrollable content slot, and a drag/keyboard
 * resizable right edge. Width and open state persist per `storageKey`.
 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Icon } from "@/lib/icon";
import {
  SURFACE_RAIL_DEFAULT_WIDTH,
  SURFACE_RAIL_MAX_WIDTH,
  SURFACE_RAIL_MIN_WIDTH,
  clampSurfaceRailWidth,
  readSurfaceRailPrefs,
  surfaceRailKeyboardResize,
  writeSurfaceRailOpen,
  writeSurfaceRailWidth,
} from "@/lib/surface-rail-state";
import "@/styles/surface-rail.css";

function localStorageOrNull(): Storage | null {
  return typeof window === "undefined" ? null : window.localStorage;
}

export function SurfaceRail(props: {
  storageKey: string;
  title?: string;
  defaultWidth?: number; // 280
  /** Header buttons, rendered after the title and before the collapse toggle. */
  actions?: ReactNode;
  /** Rendered under the header row only while the rail is open. */
  search?: ReactNode;
  children: ReactNode | ((open: boolean) => ReactNode);
  ariaLabel: string;
}): React.JSX.Element {
  const { storageKey, title, actions, search, children, ariaLabel } = props;
  const defaultWidth = clampSurfaceRailWidth(props.defaultWidth ?? SURFACE_RAIL_DEFAULT_WIDTH);

  // Read persisted prefs lazily on first render (storage failures → defaults).
  const [initial] = useState(() => readSurfaceRailPrefs(localStorageOrNull(), storageKey, defaultWidth));
  const [width, setWidth] = useState(initial.width);
  const [open, setOpen] = useState(initial.open);
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{ pointerId: number; startX: number; startWidth: number } | null>(null);

  useEffect(() => {
    writeSurfaceRailWidth(localStorageOrNull(), storageKey, width);
  }, [storageKey, width]);
  useEffect(() => {
    writeSurfaceRailOpen(localStorageOrNull(), storageKey, open);
  }, [storageKey, open]);

  const toggleLabel = open ? "Collapse sidebar" : "Expand sidebar";

  return (
    <aside
      className="surface-rail"
      aria-label={ariaLabel}
      data-open={open ? "true" : "false"}
      data-dragging={dragging ? "true" : "false"}
      style={open ? { width } : undefined}
    >
      <div className="surface-rail__header">
        <div className="surface-rail__header-row">
          {title && open ? <span className="surface-rail__title">{title}</span> : null}
          {actions}
          <button
            type="button"
            className="surface-rail__toggle focus-ring"
            aria-expanded={open}
            title={toggleLabel}
            aria-label={toggleLabel}
            onClick={() => setOpen((value) => !value)}
          >
            <Icon name="ph:sidebar-simple" width={15} aria-hidden />
          </button>
        </div>
        {open && search ? <div className="surface-rail__search">{search}</div> : null}
      </div>
      <div className="surface-rail__content">
        {typeof children === "function" ? children(open) : children}
      </div>
      {open ? (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize sidebar"
          aria-valuemin={SURFACE_RAIL_MIN_WIDTH}
          aria-valuemax={SURFACE_RAIL_MAX_WIDTH}
          aria-valuenow={width}
          tabIndex={0}
          title="Drag to resize"
          className="surface-rail__resize focus-ring"
          onPointerDown={(event) => {
            if (event.pointerType === "mouse" && event.button !== 0) return;
            event.preventDefault();
            event.currentTarget.setPointerCapture(event.pointerId);
            dragRef.current = { pointerId: event.pointerId, startX: event.clientX, startWidth: width };
            setDragging(true);
          }}
          onPointerMove={(event) => {
            const drag = dragRef.current;
            if (!drag || event.pointerId !== drag.pointerId) return;
            setWidth(clampSurfaceRailWidth(drag.startWidth + (event.clientX - drag.startX)));
          }}
          onPointerUp={(event) => {
            if (dragRef.current?.pointerId !== event.pointerId) return;
            dragRef.current = null;
            setDragging(false);
          }}
          onPointerCancel={(event) => {
            if (dragRef.current?.pointerId !== event.pointerId) return;
            dragRef.current = null;
            setDragging(false);
          }}
          onDoubleClick={() => setWidth(defaultWidth)}
          onKeyDown={(event) => {
            const next = surfaceRailKeyboardResize(width, event.key);
            if (next == null) return;
            event.preventDefault();
            setWidth(next);
          }}
        />
      ) : null}
    </aside>
  );
}
