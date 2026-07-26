"use client";

/**
 * Shared layout primitives for Role Surface rooms.
 *
 * Every room composes the same spatial grammar — left rail, center canvas,
 * right sidebar, bottom drawer — so surfaces feel like chambers of one Cave
 * while their contents stay vocation-specific. Styling lives in globals.css
 * under `.role-surface-*` (obsidian foundation, glass panels, per-room accent
 * hue via `--room-accent-h`).
 */

import type { CSSProperties, ReactNode } from "react";
import { Icon, type IconName } from "@/lib/icon";

export function SurfaceRoom({
  accentHue,
  children,
  drawer,
  drawerOpen,
  drawerTitle,
  onToggleDrawer,
}: {
  accentHue?: number;
  children: ReactNode;
  drawer?: ReactNode;
  drawerOpen?: boolean;
  drawerTitle?: string;
  onToggleDrawer?: () => void;
}) {
  return (
    <div
      className="role-surface-room"
      style={accentHue != null ? ({ "--room-accent-h": String(accentHue) } as CSSProperties) : undefined}
    >
      <div className="role-surface-columns">{children}</div>
      {drawer != null && (
        <section
          className={`role-surface-drawer${drawerOpen ? " role-surface-drawer--open" : ""}`}
          aria-label={drawerTitle}
        >
          <button
            type="button"
            className="role-surface-drawer-toggle focus-ring-inset"
            onClick={onToggleDrawer}
            aria-expanded={drawerOpen ?? false}
          >
            <Icon name={drawerOpen ? "ph:caret-down" : "ph:caret-up"} width={14} height={14} aria-hidden />
            <span>{drawerTitle}</span>
          </button>
          {drawerOpen && <div className="role-surface-drawer-body">{drawer}</div>}
        </section>
      )}
    </div>
  );
}

export function SurfaceRail({ side, label, children }: { side: "left" | "right"; label: string; children: ReactNode }) {
  return (
    <aside className={`role-surface-rail role-surface-rail--${side}`} aria-label={label}>
      {children}
    </aside>
  );
}

export function SurfaceCanvas({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="role-surface-canvas" aria-label={label}>
      {children}
    </section>
  );
}

export function RailSection({
  title,
  iconName,
  actions,
  children,
}: {
  title: string;
  iconName?: IconName;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="role-surface-section">
      <header className="role-surface-section-head">
        {iconName && <Icon name={iconName} width={13} height={13} aria-hidden />}
        <h3>{title}</h3>
        {actions && <span className="role-surface-section-actions">{actions}</span>}
      </header>
      {children}
    </section>
  );
}

/** Honest empty state — used wherever a backing integration doesn't exist yet
 *  or simply has nothing. Never renders placeholder data. */
export function SurfaceEmpty({ iconName, title, hint }: { iconName?: IconName; title: string; hint?: string }) {
  return (
    <div className="role-surface-empty">
      {iconName && <Icon name={iconName} width={18} height={18} aria-hidden />}
      <p className="role-surface-empty-title">{title}</p>
      {hint && <p className="role-surface-empty-hint">{hint}</p>}
    </div>
  );
}
