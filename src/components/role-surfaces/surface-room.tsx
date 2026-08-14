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
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { SkeletonRows } from "@/components/ui/skeleton";
import { Icon, type IconName } from "@/lib/icon";

type RailSide = "left" | "right";

const RAIL_FOCUSABLE_SELECTOR =
  'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

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
  className,
  drawer,
  drawerOpen,
  drawerTitle,
  drawerSummary,
  header,
  onToggleDrawer,
}: {
  accentHue?: number;
  children: ReactNode;
  /** Extra class on the room shell — for a room that lays its own columns out. */
  className?: string;
  drawer?: ReactNode;
  drawerOpen?: boolean;
  drawerTitle?: string;
  /** Trailing text on the drawer toggle: what is inside without opening it. */
  drawerSummary?: ReactNode;
  /** Full-bleed bar above the columns, outside their padding. */
  header?: ReactNode;
  onToggleDrawer?: () => void;
}) {
  const [disclosureTarget, setDisclosureTarget] = useState<HTMLDivElement | null>(null);

  return (
    <RailDisclosureContext.Provider value={disclosureTarget}>
      <div
        className={`role-surface-room${className ? ` ${className}` : ""}`}
        style={accentHue != null ? ({ "--room-accent-h": String(accentHue) } as CSSProperties) : undefined}
      >
        {header}
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
              {drawerSummary != null && (
                <span className="role-surface-drawer-summary">{drawerSummary}</span>
              )}
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
  const disclosureRef = useRef<HTMLButtonElement | null>(null);
  const railRef = useRef<HTMLElement | null>(null);
  const railId = `${useId()}-rail`;
  const [localExpanded, setLocalExpanded] = useState(false);
  const isExpanded = expanded ?? localExpanded;

  const setExpanded = (next: boolean) => {
    if (expanded === undefined) setLocalExpanded(next);
    onExpandedChange?.(next);
  };

  const toggleExpanded = () => setExpanded(!isExpanded);

  useEffect(() => {
    if (
      !isExpanded ||
      disclosureTarget == null ||
      getComputedStyle(disclosureTarget).display === "none"
    ) {
      return;
    }
    const focusFrame = requestAnimationFrame(() => {
      const rail = railRef.current;
      const focusTarget = rail?.querySelector<HTMLElement>(RAIL_FOCUSABLE_SELECTOR) ?? rail;
      focusTarget?.focus();
    });
    return () => cancelAnimationFrame(focusFrame);
  }, [disclosureTarget, isExpanded]);

  const onRailKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key !== "Escape" || !isExpanded) return;
    e.preventDefault();
    e.stopPropagation();
    setExpanded(false);
    requestAnimationFrame(() => disclosureRef.current?.focus());
  };

  return (
    <>
      {disclosureTarget
        ? createPortal(
            <Button
              ref={disclosureRef}
              size="sm"
              variant="ghost"
              className={`role-surface-disclosure role-surface-disclosure--${side} focus-ring`}
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
        ref={railRef}
        id={railId}
        className={`role-surface-rail role-surface-rail--${side}${isExpanded ? " role-surface-rail--expanded" : ""}`}
        aria-label={label}
        tabIndex={-1}
        onKeyDown={onRailKeyDown}
      >
        {children}
      </aside>
    </>
  );
}

/**
 * Keep a responsive inspector aligned with selection changes without fighting
 * an explicit user close. A new (or restored) selection opens the rail; once
 * the user toggles it, it stays in that state until the selection key changes.
 */
export function useActiveSelectionRail(selectionKey: string | null): readonly [
  expanded: boolean,
  setExpanded: (next: boolean) => void,
] {
  const previousSelection = useRef(selectionKey);
  const [expanded, setExpanded] = useState(selectionKey != null);

  useEffect(() => {
    if (previousSelection.current === selectionKey) return;
    previousSelection.current = selectionKey;
    setExpanded(selectionKey != null);
  }, [selectionKey]);

  return [expanded, setExpanded] as const;
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

export function SurfaceLoading({ label, live = true }: { label: string; live?: boolean }) {
  return (
    <div
      className="role-surface-state role-surface-loading"
      role={live ? "status" : undefined}
      aria-label={label}
      aria-busy="true"
    >
      <span className="role-surface-state-label">{label}</span>
      <SkeletonRows count={3} />
    </div>
  );
}

export function SurfaceError({
  title,
  hint,
  onRetry,
  live,
}: {
  title: string;
  hint?: string;
  onRetry?: () => void;
  live?: boolean;
}) {
  return (
    <ErrorState
      compact
      live={live}
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
