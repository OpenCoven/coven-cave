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
  ALL_EMOJI_ENTRIES,
  categoriesFor,
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

type PickerTab = "emoji" | "icon";

type Props = {
  open: boolean;
  familiar: Familiar | null;
  onClose: () => void;
};

export function FamiliarGlyphPicker({ open, familiar, onClose }: Props) {
  const overrides = useGlyphOverrides();
  const recent = useRecentGlyphs();
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<PickerTab>("emoji");
  const [hovered, setHovered] = useState<GlyphCatalogEntry | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Reset state each time the picker opens for a new familiar.
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setHovered(null);
    // Default tab: emoji if the user has any recents that are emoji, else
    // whatever the current glyph kind is.
    const currentGlyph = familiar
      ? resolveFamiliarGlyph(familiar, overrides)
      : null;
    setTab(currentGlyph?.kind === "icon" ? "icon" : "emoji");
    const t = setTimeout(() => inputRef.current?.focus(), 20);
    return () => clearTimeout(t);
    // overrides intentionally NOT in deps — we only want this on open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    return searchGlyphs({
      query,
      kinds: query.trim() ? ["emoji", "icon"] : [tab],
    }).slice(0, 800);
  }, [query, tab]);

  const categories = useMemo(() => {
    if (query.trim()) return [];
    return categoriesFor([tab]);
  }, [tab, query]);

  const recentEntries: GlyphCatalogEntry[] = useMemo(() => {
    return recent
      .map((value) => {
        const parsed = parseGlyphString(value);
        if (!parsed) return null;
        if (parsed.kind === "emoji") {
          const found = ALL_EMOJI_ENTRIES.find((e) => e.value === parsed.char);
          if (found) return found;
          return {
            value: parsed.char,
            kind: "emoji" as const,
            name: parsed.char,
            category: "Recent",
            keywords: [],
          };
        }
        return {
          value: parsed.name,
          kind: "icon" as const,
          name: parsed.name.replace(/^ph:/, "").replace(/-/g, " "),
          category: "Recent",
          keywords: [],
        };
      })
      .filter((e): e is GlyphCatalogEntry => e !== null)
      .slice(0, 12);
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/70 backdrop-blur-sm"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative flex h-[560px] w-[640px] max-w-[92vw] flex-col overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950 shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-zinc-900 px-4 py-3">
          {currentGlyph ? (
            <span className="grid h-9 w-9 place-items-center rounded-lg bg-zinc-900">
              <GlyphView glyph={currentGlyph} size="md" />
            </span>
          ) : null}
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-sm font-medium text-zinc-100">
              {familiar.display_name}
            </span>
            <span className="text-[11px] text-zinc-500">
              {hovered?.name ?? "Pick a glyph"}
            </span>
          </div>
          <button
            onClick={onClose}
            className="grid h-7 w-7 place-items-center rounded-md text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
            aria-label="Close"
            title="Close (esc)"
          >
            <Icon name="ph:x-bold" />
          </button>
        </div>

        {/* Search */}
        <div className="border-b border-zinc-900 px-4 py-2.5">
          <div className="relative">
            <Icon
              name="ph:magnifying-glass-bold"
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500"
              width="0.9rem"
              height="0.9rem"
            />
            <input
              ref={inputRef}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search cat, wand, sparkle…"
              className="w-full rounded-md border border-zinc-800 bg-zinc-900/50 py-1.5 pl-8 pr-3 text-sm text-zinc-100 outline-none placeholder:text-zinc-500 focus:border-zinc-700"
            />
          </div>
        </div>

        {/* Recent */}
        {recentEntries.length > 0 && !query.trim() ? (
          <div className="border-b border-zinc-900 px-4 py-2.5">
            <div className="mb-1.5 text-[10px] uppercase tracking-wider text-zinc-600">
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

        {/* Tabs (hidden during free-text search since we merge both kinds) */}
        {!query.trim() ? (
          <div className="flex items-center gap-0.5 border-b border-zinc-900 px-4 py-1.5 text-[11px]">
            <TabButton
              active={tab === "emoji"}
              onClick={() => setTab("emoji")}
              label="Emoji"
            />
            <TabButton
              active={tab === "icon"}
              onClick={() => setTab("icon")}
              label="Icons"
            />
            <div className="ml-auto text-[10px] text-zinc-600">
              {results.length.toLocaleString()} options
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between border-b border-zinc-900 px-4 py-1.5 text-[10px] text-zinc-500">
            <span>
              {results.length.toLocaleString()} matches for {`"`}
              {query.trim()}
              {`"`}
            </span>
            <button
              onClick={() => setQuery("")}
              className="text-zinc-400 hover:text-zinc-200"
            >
              clear
            </button>
          </div>
        )}

        {/* Grid */}
        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
          {results.length === 0 ? (
            <div className="grid h-full place-items-center text-sm text-zinc-500">
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
              categories={categories}
              currentValue={currentGlyph ? serializeGlyph(currentGlyph) : null}
              onPick={onPick}
              onHover={setHovered}
            />
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-zinc-900 px-4 py-2 text-[11px] text-zinc-500">
          <button
            onClick={() => clearGlyphOverride(familiar.id)}
            disabled={!overrides[familiar.id]}
            className="text-zinc-400 transition-colors hover:text-zinc-200 disabled:cursor-not-allowed disabled:text-zinc-700"
          >
            reset to default
          </button>
          <span className="font-mono text-zinc-600">esc to close</span>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function TabButton({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-md px-2.5 py-1 transition-colors ${
        active
          ? "bg-zinc-800 text-zinc-100"
          : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
      }`}
    >
      {label}
    </button>
  );
}

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
  const glyph: FamiliarGlyph =
    entry.kind === "emoji"
      ? { kind: "emoji", char: entry.value }
      : { kind: "icon", name: entry.value };
  return (
    <button
      onClick={() => onPick(entry)}
      onMouseEnter={() => onHover(entry)}
      onMouseLeave={() => onHover(null)}
      title={entry.name}
      className={`${cell} grid place-items-center rounded-md text-zinc-200 transition-colors ${
        active
          ? "bg-purple-600/30 ring-1 ring-purple-400"
          : "hover:bg-zinc-800/70"
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
          key={`${e.kind}:${e.value}`}
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
            <div className="mb-1.5 text-[10px] uppercase tracking-wider text-zinc-600">
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
