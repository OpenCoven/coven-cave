"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { Icon, type IconName } from "@/lib/icon";
import { useRovingTabIndex } from "@/lib/use-roving-tabindex";

/**
 * Shared Vercel-style tabs — one coherent tab visual language for the whole app.
 *
 * Horizontal (default): a row of chromeless text (optionally icon) labels sitting
 * on a hairline divider. The active tab gets a 2px underline bar flush with the
 * divider; inactive tabs are muted and brighten on hover with a faint underline
 * preview. NO pill backgrounds, NO per-tab borders.
 *
 * Vertical: a column of labels with a 2px accent left-border on the active tab
 * (Vercel's vertical-nav variant) — used where a left tab rail is wanted.
 *
 * The canonical inline pattern this generalises lives in chat-surface.tsx and
 * inspector-pane.tsx; both now delegate here. Accessibility (role=tablist/tab,
 * aria-selected) plus a roving tabindex (arrow-key navigation per WAI-ARIA APG)
 * are built in.
 */

export type TabItem<T extends string = string> = {
  /** Stable id; passed back to onChange and used for aria wiring. */
  id: T;
  /** Visible label. */
  label: ReactNode;
  /** Optional leading icon. */
  icon?: IconName;
  /** Optional trailing count badge. */
  count?: number;
  /** Optional accessible title (tooltip). */
  title?: string;
  /** Disable selection of this tab. */
  disabled?: boolean;
  /** Override the underline/indicator colour for this tab (e.g. a surface accent). */
  accent?: string;
};

type TabsProps<T extends string> = {
  items: ReadonlyArray<TabItem<T>>;
  value: T;
  onChange: (id: T) => void;
  /** "horizontal" (underline, default) or "vertical" (left-border indicator). */
  orientation?: "horizontal" | "vertical";
  /** Stretch tabs to fill the track (equal-width). Horizontal only. */
  fill?: boolean;
  /** aria-label for the tablist. */
  ariaLabel?: string;
  /** Extra classes on the tablist container. */
  className?: string;
  /** Compact density (smaller padding/text), used by tight surfaces. */
  size?: "md" | "sm";
  /** Prefix for tab/panel ids so callers can wire aria-controls/labelledby. */
  idPrefix?: string;
  /**
   * Draw the hairline divider under the tablist. Default true. Set false when
   * the parent container already provides the divider the underline sits on
   * (e.g. a header row that spans tabs + actions).
   */
  bordered?: boolean;
  /** "underline" (default) or "segment" (rounded pill container, raised active bg). */
  variant?: "underline" | "segment";
};

export function Tabs<T extends string>({
  items,
  value,
  onChange,
  orientation = "horizontal",
  fill = false,
  ariaLabel,
  className,
  size = "md",
  idPrefix,
  bordered = true,
  variant = "underline",
}: TabsProps<T>) {
  const listRef = useRef<HTMLDivElement>(null);
  const { setActiveIndex } = useRovingTabIndex({
    containerRef: listRef,
    itemSelector: '[role="tab"]:not([aria-disabled="true"])',
    orientation,
    loop: false,
  });

  useEffect(() => {
    const selectedIndex = items
      .filter((item) => !item.disabled)
      .findIndex((item) => item.id === value);
    if (selectedIndex >= 0) {
      setActiveIndex(selectedIndex);
    }
  }, [items, setActiveIndex, value]);

  const vertical = orientation === "vertical";
  const sm = size === "sm";
  const segment = variant === "segment";

  const listClass = [
    "flex",
    segment
      ? "items-center gap-1 rounded-lg border border-[var(--border-hairline)] p-1"
      : vertical
        ? "flex-col gap-1"
        : bordered
          ? "items-end gap-1 border-b border-[var(--border-hairline)]"
          : "items-end gap-1",
    className ?? "",
  ].join(" ");

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label={ariaLabel}
      aria-orientation={vertical ? "vertical" : undefined}
      className={listClass}
    >
      {items.map((t) => {
        const isActive = t.id === value;
        const tabId = idPrefix ? `${idPrefix}-tab-${t.id}` : undefined;
        const panelId = idPrefix ? `${idPrefix}-panel-${t.id}` : undefined;

        const className = segment
          ? segmentTabClass(isActive, sm)
          : vertical
            ? verticalTabClass(isActive, t.disabled, sm)
            : horizontalTabClass(isActive, fill, sm);

        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={tabId}
            aria-selected={isActive}
            aria-controls={panelId}
            aria-disabled={t.disabled ? true : undefined}
            disabled={t.disabled}
            title={t.title}
            onClick={() => !t.disabled && onChange(t.id)}
            className={className}
            style={
              isActive && t.accent
                ? ({ ["--cv-tab-accent" as string]: t.accent } as React.CSSProperties)
                : undefined
            }
          >
            {t.icon ? <Icon name={t.icon} width={sm ? 12 : 13} aria-hidden /> : null}
            <span className="cv-tab-label truncate">{t.label}</span>
            {typeof t.count === "number" ? (
              <span className="cv-tab-count text-[10px] tabular-nums opacity-70">
                {t.count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

function horizontalTabClass(isActive: boolean, fill: boolean, sm: boolean): string {
  return [
    "relative inline-flex items-center gap-1.5 outline-none",
    sm ? "px-2.5 py-1.5 text-[11px]" : "px-3 py-2.5 text-[12px]",
    "font-medium transition-colors",
    fill ? "flex-1 justify-center min-w-0" : "",
    // 2px underline bar that sits flush on the tablist divider; faint preview
    // on hover so the affordance reads before click.
    "after:absolute after:bottom-0 after:left-3 after:right-3 after:h-[2px] after:rounded-full after:transition-colors",
    isActive
      ? "text-[var(--text-primary)] after:bg-[var(--cv-tab-accent,var(--text-primary))]"
      : "text-[var(--text-muted)] hover:text-[var(--text-secondary)] after:bg-transparent hover:after:bg-[color-mix(in_oklch,var(--text-muted)_45%,transparent)]",
    "focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)] focus-visible:ring-offset-0 rounded-t-sm",
  ].join(" ");
}

function verticalTabClass(isActive: boolean, disabled: boolean | undefined, sm: boolean): string {
  return [
    "relative inline-flex items-center gap-2 text-left outline-none",
    sm ? "px-2 py-1.5 text-[11px]" : "px-3 py-2 text-[12px]",
    "font-medium transition-colors border-l-2",
    isActive
      ? "text-[var(--text-primary)] border-[var(--cv-tab-accent,var(--accent-presence))]"
      : "text-[var(--text-muted)] border-transparent hover:text-[var(--text-secondary)] hover:border-[color-mix(in_oklch,var(--text-muted)_35%,transparent)]",
    disabled ? "opacity-40 cursor-not-allowed" : "",
    "focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)] focus-visible:ring-offset-0 rounded-r-sm",
  ].join(" ");
}

function segmentTabClass(isActive: boolean, sm: boolean): string {
  return [
    "relative inline-flex items-center gap-1.5 outline-none rounded-md",
    sm ? "px-2.5 py-1 text-[11px]" : "px-3 py-1.5 text-[12px]",
    "font-medium transition-colors",
    isActive
      ? "bg-[var(--cv-tab-accent,var(--bg-raised))] text-[var(--text-primary)]"
      : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]",
    "focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)] focus-visible:ring-offset-0",
  ].join(" ");
}
