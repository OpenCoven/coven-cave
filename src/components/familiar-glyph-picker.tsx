"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/lib/icon";
import {
  clearGlyphOverride,
  useGlyphOverrides,
} from "@/lib/cave-glyph-overrides";
import { useResolvedFamiliars } from "@/lib/familiar-resolve";
import { FamiliarGlyph as GlyphView } from "@/components/familiar-glyph";
import { FamiliarGlyphPickerPanel } from "@/components/familiar-glyph-picker-panel";
import type { GlyphCatalogEntry } from "@/lib/glyph-catalog";
import type { Familiar } from "@/lib/types";

type Props = {
  open: boolean;
  familiar: Familiar | null;
  onClose: () => void;
};

export function FamiliarGlyphPicker({ open, familiar, onClose }: Props) {
  const resolvedFamiliarList = useResolvedFamiliars(familiar ? [familiar] : []);
  const resolvedFamiliar = resolvedFamiliarList[0] ?? null;
  const overrides = useGlyphOverrides();
  const [hovered, setHovered] = useState<GlyphCatalogEntry | null>(null);

  // Reset state each time the picker opens for a new familiar.
  useEffect(() => {
    if (!open) return;
  }, [open, familiar?.id]);

  // Esc closes the modal. Cmd/Ctrl+Backspace clear is handled by the panel.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const currentGlyph = resolvedFamiliar?.glyph ?? null;

  if (!open || !familiar) return null;

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--bg-base)]/70 backdrop-blur-sm"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative flex h-[560px] w-[640px] max-w-[92vw] flex-col overflow-hidden rounded-2xl border border-[var(--border-hairline)] bg-[var(--bg-base)] shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-[var(--border-hairline)] px-4 py-3">
          {currentGlyph ? (
            <span className="grid h-9 w-9 place-items-center rounded-lg bg-[var(--bg-raised)]">
              <GlyphView glyph={currentGlyph} size="md" />
            </span>
          ) : null}
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-sm font-medium text-[var(--text-primary)]">
              {familiar.display_name}
            </span>
            <span className="text-[11px] text-[var(--text-muted)]">
              {hovered?.name ?? "Pick an icon"}
            </span>
          </div>
          <button
            onClick={onClose}
            className="grid h-7 w-7 place-items-center rounded-md text-[var(--text-secondary)] hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)]"
            aria-label="Close"
            title="Close (esc)"
          >
            <Icon name="ph:x-bold" />
          </button>
        </div>

        {/* Panel body: search, recent, results count, grid */}
        <FamiliarGlyphPickerPanel familiar={familiar} onHoverChange={setHovered} />

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-[var(--border-hairline)] px-4 py-2 text-[11px] text-[var(--text-muted)]">
          <button
            onClick={() => clearGlyphOverride(familiar.id)}
            disabled={!overrides[familiar.id]}
            className="text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:text-[var(--text-muted)]"
          >
            reset to default
          </button>
          <span className="font-mono text-[var(--text-muted)]">esc to close</span>
        </div>
      </div>
    </div>
  );
}
