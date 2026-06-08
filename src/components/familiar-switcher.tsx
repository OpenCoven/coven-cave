"use client";

import { useEffect, useRef, useState } from "react";
import type { Familiar } from "@/lib/types";
import { Icon } from "@/lib/icon";
import { FamiliarGlyph } from "@/components/familiar-glyph";
import { resolveFamiliarGlyph } from "@/lib/familiar-glyph";
import { useGlyphOverrides } from "@/lib/cave-glyph-overrides";

type Props = {
  familiar: Familiar;
  familiars?: Familiar[];
  onSelect?: (id: string) => void;
  /**
   * Compact single-line variant used inline alongside toolbar controls.
   * Shows the familiar avatar + name only (no role caption) at toolbar
   * height (h-7) and keeps the trigger right-sized for action rows.
   */
  compact?: boolean;
};

/**
 * FamiliarSwitcher
 * Renders the active familiar's name as a clickable pill. Clicking opens
 * a compact dropdown listing all familiars so the user can switch without
 * leaving the chat panel.
 */
export function FamiliarSwitcher({ familiar, familiars = [], onSelect, compact = false }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const glyphOverrides = useGlyphOverrides();
  const glyph = resolveFamiliarGlyph(familiar, glyphOverrides);
  const triggerClassName = compact
    ? [
        "focus-ring group inline-flex h-7 min-w-0 items-center gap-1.5 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-raised)]/20 px-2 transition-colors",
        "hover:bg-[var(--bg-raised)]/60",
      ].join(" ")
    : [
        "focus-ring group flex w-full min-w-0 items-center justify-between gap-3 rounded-lg px-2 py-1.5 -ml-2 transition-colors",
        "hover:bg-[var(--bg-raised)]/60",
      ].join(" ");

  // Close on outside click / Esc
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onMouse = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onMouse);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onMouse);
    };
  }, [open]);

  // Don't render a switcher if there's only one familiar
  if (familiars.length <= 1) {
    if (compact) {
      return (
        <div className="inline-flex h-7 min-w-0 items-center gap-1.5 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-raised)]/20 px-2">
          <span
            className="grid h-4 w-4 shrink-0 place-items-center rounded-sm border border-[var(--border-hairline)] bg-[var(--bg-raised)]"
            aria-hidden
          >
            <FamiliarGlyph glyph={glyph} size="sm" />
          </span>
          <span className="min-w-0 truncate text-[12px] font-medium text-[var(--text-primary)]">
            {familiar.display_name}
          </span>
        </div>
      );
    }
    return (
      <div className="relative min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className="grid h-6 w-6 shrink-0 place-items-center rounded-md border border-[var(--border-hairline)] bg-[var(--bg-raised)]"
            aria-hidden
          >
            <FamiliarGlyph glyph={glyph} size="sm" />
          </span>
          <h2 className="min-w-0 truncate text-[15px] font-semibold text-[var(--text-primary)]">
            {familiar.display_name}
          </h2>
        </div>
      </div>
    );
  }

  return (
    <div ref={ref} className={compact ? "relative inline-block" : "relative min-w-0 flex-1"}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={triggerClassName}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Switch familiar from ${familiar.display_name}`}
      >
        {compact ? (
          <>
            <span
              className="grid h-4 w-4 shrink-0 place-items-center rounded-sm border border-[var(--border-hairline)] bg-[var(--bg-raised)]"
              aria-hidden
            >
              <FamiliarGlyph glyph={glyph} size="sm" />
            </span>
            <span className="min-w-0 truncate max-w-[120px] text-[12px] font-medium text-[var(--text-primary)]">
              {familiar.display_name}
            </span>
            <Icon
              name="ph:caret-up-down-bold"
              width={10}
              className="shrink-0 text-[var(--text-muted)] opacity-60 transition-opacity group-hover:opacity-100"
            />
          </>
        ) : (
          <>
            <span className="flex min-w-0 items-center gap-2">
              <span
                className="grid h-6 w-6 shrink-0 place-items-center rounded-md border border-[var(--border-hairline)] bg-[var(--bg-raised)]"
                aria-hidden
              >
                <FamiliarGlyph glyph={glyph} size="sm" />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-[15px] font-semibold leading-tight text-[var(--text-primary)]">
                  {familiar.display_name}
                </span>
                <span className="block truncate text-[10px] leading-tight text-[var(--text-muted)]">
                  {familiar.role || familiar.harness || "Familiar"}
                </span>
              </span>
            </span>
            <Icon
              name="ph:caret-up-down-bold"
              width={11}
              className="shrink-0 text-[var(--text-muted)] opacity-60 transition-opacity group-hover:opacity-100"
            />
          </>
        )}
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute left-0 right-0 top-full z-40 mt-1.5 min-w-[220px] overflow-hidden rounded-xl border border-[var(--border-strong)] bg-[var(--bg-elevated)] shadow-2xl"
        >
          <div className="px-2 py-1.5 text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
            Switch familiar
          </div>
          {familiars.map((f) => {
            const isActive = f.id === familiar.id;
            const fGlyph = resolveFamiliarGlyph(f, glyphOverrides);
            return (
              <button
                key={f.id}
                role="menuitem"
                aria-current={isActive ? "true" : undefined}
                type="button"
                onClick={() => {
                  setOpen(false);
                  if (!isActive) onSelect?.(f.id);
                }}
                className={[
                  "focus-ring-inset flex w-full items-center gap-2.5 px-2.5 py-2 text-left transition-colors",
                  isActive
                    ? "bg-[color-mix(in_oklch,var(--accent-presence)_14%,transparent)] text-[var(--text-primary)]"
                    : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]",
                ].join(" ")}
              >
                <span
                  className="grid h-7 w-7 shrink-0 place-items-center rounded-md border border-[var(--border-hairline)] bg-[var(--bg-raised)]"
                  aria-hidden
                >
                  <FamiliarGlyph glyph={fGlyph} size="sm" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-medium leading-tight">
                    {f.display_name}
                  </div>
                  {f.role ? (
                    <div className="truncate text-[11px] text-[var(--text-muted)]">{f.role}</div>
                  ) : null}
                </div>
                {isActive ? (
                  <Icon name="ph:check-bold" width={11} className="shrink-0 text-[var(--accent-presence)]" />
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
