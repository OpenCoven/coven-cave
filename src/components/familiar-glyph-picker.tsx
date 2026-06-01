"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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
  resolveFamiliarGlyph,
  serializeGlyph,
  type FamiliarGlyph,
} from "@/lib/familiar-glyph";
import { FamiliarGlyph as GlyphView } from "@/components/familiar-glyph";
import type { Familiar } from "@/lib/types";

type Props = {
  open: boolean;
  familiar: Familiar | null;
  onClose: () => void;
};

export function FamiliarGlyphPicker({ open, familiar, onClose }: Props) {
  const overrides = useGlyphOverrides();
  const recent = useRecentGlyphs();
  const [query, setQuery] = useState("");
  const [hovered, setHovered] = useState<GlyphCatalogEntry | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Reset state each time the picker opens for a new familiar.
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setHovered(null);
    const t = setTimeout(() => inputRef.current?.focus(), 20);
    return () => clearTimeout(t);
  }, [open, familiar?.id]);

  // Esc closes; Cmd/Ctrl+Backspace clears the current override.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if ((e.metaKey || e.ctrlKey) && e.key === "Backspace" && familiar) {
        e.preventDefault();
        clearGlyphOverride(familiar.id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, familiar]);

  const currentGlyph: FamiliarGlyph | null = useMemo(() => {
    if (!familiar) return null;
    return resolveFamiliarGlyph(familiar, overrides);
  }, [familiar, overrides]);

  const results = useMemo(() => {
    return searchGlyphs({ query }).slice(0, 800);
  }, [query]);

  const categoryList = useMemo(() => {
    if (query.trim()) return [];
    return categories();
  }, [query]);

  // Recent only includes icon picks since the picker is icon-only now.
  // Older emoji entries in localStorage are dropped from the recent strip
  // (still render fine on the familiar itself via the legacy renderer).
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
      if (!familiar) return;
      setGlyphOverride(familiar.id, entry.value);
    },
    [familiar],
  );

  if (!open || !familiar) return null;

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-[--bg-base]/70 backdrop-blur-sm"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative flex h-[560px] w-[640px] max-w-[92vw] flex-col overflow-hidden rounded-2xl border border-[--border-hairline] bg-[--bg-base] shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-[--border-hairline] px-4 py-3">
          {currentGlyph ? (
            <span className="grid h-9 w-9 place-items-center rounded-lg bg-[--bg-raised]">
              <GlyphView glyph={currentGlyph} size="md" />
            </span>
          ) : null}
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-sm font-medium text-[--text-primary]">
              {familiar.display_name}
            </span>
            <span className="text-[11px] text-[--text-muted]">
              {hovered?.name ?? "Pick an icon"}
            </span>
          </div>
          <button
            onClick={onClose}
            className="grid h-7 w-7 place-items-center rounded-md text-[--text-secondary] hover:bg-[--bg-raised] hover:text-[--text-primary]"
            aria-label="Close"
            title="Close (esc)"
          >
            <Icon name="ph:x-bold" />
          </button>
        </div>

        {/* Search */}
        <div className="border-b border-[--border-hairline] px-4 py-2.5">
          <div className="relative">
            <Icon
              name="ph:magnifying-glass-bold"
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[--text-muted]"
              width="0.9rem"
              height="0.9rem"
            />
            <input
              ref={inputRef}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search cat, wand, sparkle…"
              className="w-full rounded-md border border-[--border-hairline] bg-[--bg-raised]/50 py-1.5 pl-8 pr-3 text-sm text-[--text-primary] outline-none placeholder:text-[--text-muted] focus:border-[--border-strong]"
            />
          </div>
        </div>

        {/* Recent */}
        {recentEntries.length > 0 && !query.trim() ? (
          <div className="border-b border-[--border-hairline] px-4 py-2.5">
            <div className="mb-1.5 text-[10px] uppercase tracking-wider text-[--text-muted]">
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
        <div className="flex items-center justify-between border-b border-[--border-hairline] px-4 py-1.5 text-[10px] text-[--text-muted]">
          {query.trim() ? (
            <>
              <span>
                {results.length.toLocaleString()} matches for {`"`}
                {query.trim()}
                {`"`}
              </span>
              <button
                onClick={() => setQuery("")}
                className="text-[--text-secondary] hover:text-[--text-primary]"
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
            <div className="grid h-full place-items-center text-sm text-[--text-muted]">
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

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-[--border-hairline] px-4 py-2 text-[11px] text-[--text-muted]">
          <button
            onClick={() => clearGlyphOverride(familiar.id)}
            disabled={!overrides[familiar.id]}
            className="text-[--text-secondary] transition-colors hover:text-[--text-primary] disabled:cursor-not-allowed disabled:text-[--text-muted]"
          >
            reset to default
          </button>
          <span className="font-mono text-[--text-muted]">esc to close</span>
        </div>
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
      className={`${cell} grid place-items-center rounded-md text-[--text-primary] transition-colors ${
        active
          ? "bg-purple-600/30 ring-1 ring-purple-400"
          : "hover:bg-[--bg-raised]/70"
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
            <div className="mb-1.5 text-[10px] uppercase tracking-wider text-[--text-muted]">
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
