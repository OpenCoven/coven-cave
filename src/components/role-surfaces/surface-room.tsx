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

import {
  createContext,
  useContext,
  useId,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { SkeletonRows } from "@/components/ui/skeleton";
import { Icon, type IconName } from "@/lib/icon";

type RailSide = "left" | "right";

type SurfaceRailProps = {
  side: RailSide;
  label: string;
  children: ReactNode;
  expanded?: boolean;
  onExpandedChange?: (next: boolean) => void;
};

const RailDisclosureContext = createContext<HTMLDivElement | null>(null);

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
  const [disclosureTarget, setDisclosureTarget] = useState<HTMLDivElement | null>(null);

  return (
    <RailDisclosureContext.Provider value={disclosureTarget}>
      <div
        className="role-surface-room"
        style={accentHue != null ? ({ "--room-accent-h": String(accentHue) } as CSSProperties) : undefined}
      >
        <div
          ref={setDisclosureTarget}
          className="role-surface-disclosures"
          role="group"
          aria-label="Room panels"
        />
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
    </RailDisclosureContext.Provider>
  );
}

export function SurfaceRail({
  side,
  label,
  children,
  expanded,
  onExpandedChange,
}: SurfaceRailProps) {
  const disclosureTarget = useContext(RailDisclosureContext);
  const railId = `${useId()}-rail`;
  const [localExpanded, setLocalExpanded] = useState(false);
  const isExpanded = expanded ?? localExpanded;

  const toggleExpanded = () => {
    const next = !isExpanded;
    if (expanded === undefined) setLocalExpanded(next);
    onExpandedChange?.(next);
  };

  return (
    <>
      {disclosureTarget
        ? createPortal(
            <Button
              size="sm"
              variant="ghost"
              className={`role-surface-disclosure role-surface-disclosure--${side}`}
              leadingIcon={side === "left" ? "ph:sidebar-simple" : undefined}
              trailingIcon={side === "right" ? "ph:sidebar-simple" : undefined}
              aria-label={`${isExpanded ? "Hide" : "Show"} ${label}`}
              aria-expanded={isExpanded}
              aria-controls={railId}
              onClick={toggleExpanded}
            >
              {label}
            </Button>,
            disclosureTarget,
          )
        : null}
      <aside
        id={railId}
        className={`role-surface-rail role-surface-rail--${side}${isExpanded ? " role-surface-rail--expanded" : ""}`}
        aria-label={label}
      >
        {children}
      </aside>
    </>
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
export function SurfaceEmpty({
  iconName,
  title,
  hint,
  action,
}: {
  iconName?: IconName;
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <EmptyState
      compact
      className="role-surface-state"
      icon={iconName}
      headline={title}
      subtitle={hint}
      actions={action}
    />
  );
}

export function SurfaceLoading({ label }: { label: string }) {
  return (
    <div className="role-surface-state role-surface-loading" role="status" aria-label={label} aria-busy="true">
      <span className="role-surface-state-label">{label}</span>
      <SkeletonRows count={3} />
    </div>
  );
}

export function SurfaceError({ title, hint, onRetry }: { title: string; hint?: string; onRetry?: () => void }) {
  return (
    <ErrorState
      compact
      className="role-surface-state"
      headline={title}
      subtitle={hint}
      actions={
        onRetry ? (
          <Button size="sm" onClick={onRetry}>
            Retry
          </Button>
        ) : undefined
      }
    />
  );
}
