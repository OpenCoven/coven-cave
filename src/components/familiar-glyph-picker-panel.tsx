"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/lib/icon";
import {
  categories,
  searchGlyphs,
  type GlyphCatalogEntry,
} from "@/lib/glyph-catalog";
import {
  clearGlyphOverride,
  setGlyphOverride,
  useGlyphOverrides,
  useRecentGlyphs,
} from "@/lib/cave-glyph-overrides";
import {
  parseGlyphString,
  serializeGlyph,
  type FamiliarGlyph,
} from "@/lib/familiar-glyph";
import { FamiliarGlyph as GlyphView } from "@/components/familiar-glyph";
import { useResolvedFamiliars } from "@/lib/familiar-resolve";
import type { Familiar } from "@/lib/types";

type Props = {
  familiar: Familiar;
  /** Notified whenever the hovered glyph entry changes; used by the modal header. */
  onHoverChange?: (entry: GlyphCatalogEntry | null) => void;
};

export function FamiliarGlyphPickerPanel({ familiar, onHoverChange }: Props) {
  const overrides = useGlyphOverrides();
  const recent = useRecentGlyphs();
  const [query, setQuery] = useState("");
  const [hovered, setHoveredState] = useState<GlyphCatalogEntry | null>(null);
  const setHovered = useCallback(
    (entry: GlyphCatalogEntry | null) => {
      setHoveredState(entry);
      onHoverChange?.(entry);
    },
    [onHoverChange],
  );
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Cmd/Ctrl+Backspace clears the current override.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Backspace") {
        e.preventDefault();
        clearGlyphOverride(familiar.id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [familiar.id]);

  const resolved = useResolvedFamiliars([familiar])[0];
  const currentGlyph: FamiliarGlyph = resolved?.glyph ?? { kind: "icon", name: "ph:sparkle-fill" };

  const results = useMemo(() => searchGlyphs({ query }).slice(0, 800), [query]);

  const categoryList = useMemo(() => {
    if (query.trim()) return [];
    return categories();
  }, [query]);

  // Recent only includes icon picks since the picker is icon-only now.
  // Older non-icon entries in localStorage are dropped from the recent strip.
  const recentEntries: GlyphCatalogEntry[] = useMemo(() => {
    const out: GlyphCatalogEntry[] = [];
    for (const value of recent) {
      const parsed = parseGlyphString(value);
      if (!parsed || parsed.kind !== "icon") continue;
      out.push({
        value: parsed.name,
        kind: "icon",
        name: parsed.name.replace(/^ph:/, "").replace(/-/g, " "),
        category: "Recent",
        keywords: [],
      });
      if (out.length >= 12) break;
    }
    return out;
  }, [recent]);

  const onPick = useCallback(
    (entry: GlyphCatalogEntry) => {
      setGlyphOverride(familiar.id, entry.value);
    },
    [familiar.id],
  );

  return (
    <div className="familiar-glyph-picker-panel">
      {/* Search */}
      <div className="border-b border-[var(--border-hairline)] px-4 py-2.5">
        <div className="relative">
          <Icon
            name="ph:magnifying-glass-bold"
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]"
            width="0.9rem"
            height="0.9rem"
          />
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search cat, wand, sparkle…"
            className="w-full rounded-md border border-[var(--border-hairline)] bg-[var(--bg-raised)]/50 py-1.5 pl-8 pr-3 text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)] focus:border-[var(--border-strong)]"
          />
        </div>
      </div>

      {/* Recent */}
      {recentEntries.length > 0 && !query.trim() ? (
        <div className="border-b border-[var(--border-hairline)] px-4 py-2.5">
          <div className="mb-1.5 text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
            Recent
          </div>
          <div className="flex flex-wrap gap-1">
            {recentEntries.map((e) => (
              <GlyphButton
                key={`recent:${e.value}`}
                entry={e}
                size="md"
                active={
                  currentGlyph &&
                  serializeGlyph(currentGlyph) === e.value
                    ? true
                    : false
                }
                onPick={onPick}
                onHover={setHovered}
              />
            ))}
          </div>
        </div>
      ) : null}

      {/* Results count */}
      <div className="flex items-center justify-between border-b border-[var(--border-hairline)] px-4 py-1.5 text-[10px] text-[var(--text-muted)]">
        {query.trim() ? (
          <>
            <span>
              {results.length.toLocaleString()} matches for {`"`}
              {query.trim()}
              {`"`}
            </span>
            <button
              onClick={() => setQuery("")}
              className="text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            >
              clear
            </button>
          </>
        ) : (
          <span>{results.length.toLocaleString()} icons</span>
        )}
      </div>

      {/* Grid */}
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {results.length === 0 ? (
          <div className="grid h-full place-items-center text-sm text-[var(--text-muted)]">
            No matches.
          </div>
        ) : query.trim() ? (
          <GlyphGrid
            entries={results}
            currentValue={currentGlyph ? serializeGlyph(currentGlyph) : null}
            onPick={onPick}
            onHover={setHovered}
          />
        ) : (
          <CategorizedGrid
            entries={results}
            categories={categoryList}
            currentValue={currentGlyph ? serializeGlyph(currentGlyph) : null}
            onPick={onPick}
            onHover={setHovered}
          />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function GlyphButton({
  entry,
  size = "sm",
  active,
  onPick,
  onHover,
}: {
  entry: GlyphCatalogEntry;
  size?: "sm" | "md";
  active: boolean;
  onPick: (e: GlyphCatalogEntry) => void;
  onHover: (e: GlyphCatalogEntry | null) => void;
}) {
  const cell = size === "md" ? "h-9 w-9" : "h-8 w-8";
  const glyph: FamiliarGlyph = { kind: "icon", name: entry.value };
  return (
    <button
      onClick={() => onPick(entry)}
      onMouseEnter={() => onHover(entry)}
      onMouseLeave={() => onHover(null)}
      title={entry.name}
      className={`${cell} grid place-items-center rounded-md text-[var(--text-primary)] transition-colors ${
        active
          ? "bg-[color-mix(in_oklch,var(--accent-presence)_30%,transparent)] ring-1 ring-[var(--accent-presence)]"
          : "hover:bg-[var(--bg-raised)]/70"
      }`}
    >
      <GlyphView glyph={glyph} size="sm" />
    </button>
  );
}

function GlyphGrid({
  entries,
  currentValue,
  onPick,
  onHover,
}: {
  entries: GlyphCatalogEntry[];
  currentValue: string | null;
  onPick: (e: GlyphCatalogEntry) => void;
  onHover: (e: GlyphCatalogEntry | null) => void;
}) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(2.25rem,1fr))] gap-1">
      {entries.map((e) => (
        <GlyphButton
          key={e.value}
          entry={e}
          active={e.value === currentValue}
          onPick={onPick}
          onHover={onHover}
        />
      ))}
    </div>
  );
}

function CategorizedGrid({
  entries,
  categories,
  currentValue,
  onPick,
  onHover,
}: {
  entries: GlyphCatalogEntry[];
  categories: string[];
  currentValue: string | null;
  onPick: (e: GlyphCatalogEntry) => void;
  onHover: (e: GlyphCatalogEntry | null) => void;
}) {
  const byCategory = useMemo(() => {
    const map = new Map<string, GlyphCatalogEntry[]>();
    for (const e of entries) {
      const arr = map.get(e.category);
      if (arr) arr.push(e);
      else map.set(e.category, [e]);
    }
    return map;
  }, [entries]);

  return (
    <div className="space-y-4">
      {categories
        .filter((c) => byCategory.has(c))
        .map((c) => (
          <section key={c}>
            <div className="mb-1.5 text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
              {c}
            </div>
            <GlyphGrid
              entries={byCategory.get(c) ?? []}
              currentValue={currentValue}
              onPick={onPick}
              onHover={onHover}
            />
          </section>
        ))}
    </div>
  );
}
