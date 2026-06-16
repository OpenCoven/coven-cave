"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/lib/icon";
import { ViewHeader } from "@/components/ui/view-header";
import { SearchInput } from "@/components/ui/search-input";
import { EmptyState } from "@/components/ui/empty-state";
import { SkeletonRows } from "@/components/ui/skeleton";
import { LibraryTimelineRow } from "@/components/library-timeline-row";
import type { TimelineEntry } from "@/app/api/library/all/route";
import type { Familiar } from "@/lib/types";

type GroupBy = "date" | "source";
type ListFilter = "all" | "bookmarks" | "reading" | "github";

/**
 * Compact, app-styled replacement for a native `<select>` in the timeline
 * controls. The trigger keeps the `.library-timeline-select` look (and its
 * mobile touch-target sizing); only the open menu is custom — a dense
 * `role="menu"` with a check on the active option — instead of the OS dropdown.
 */
function TimelineSelect<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (next: T) => void;
  ariaLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const current = options.find((o) => o.value === value);

  return (
    <div
      ref={wrapRef}
      className="library-timeline-dropdown"
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(false);
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape" && open) {
          e.stopPropagation();
          setOpen(false);
        }
      }}
    >
      <button
        type="button"
        className="library-timeline-select library-timeline-select--trigger focus-ring"
        aria-label={ariaLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {current?.label ?? ""}
      </button>
      {open ? (
        <ul className="library-timeline-menu" role="menu" aria-label={ariaLabel}>
          {options.map((o) => {
            const active = o.value === value;
            return (
              <li key={o.value} role="none">
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={active}
                  className="library-timeline-menu-item focus-ring"
                  onClick={() => {
                    onChange(o.value);
                    setOpen(false);
                  }}
                >
                  <Icon
                    name="ph:check-bold"
                    width={12}
                    className="library-timeline-menu-item__check"
                    aria-hidden
                  />
                  <span className="library-timeline-menu-item__label">{o.label}</span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

function timelineEntryKey(entry: TimelineEntry, index: number): string {
  const item = entry.item as TimelineEntry["item"] & { id?: string; url?: string };
  if (item.id) return `${entry.list}:${item.id}`;
  return `${entry.list}:legacy:${item.url ?? item.title ?? "untitled"}:${entry.capturedAt ?? "unknown"}:${index}`;
}

export function LibraryTimeline({
  familiars,
  selectedEntryId,
  onSelect,
}: {
  familiars: Familiar[];
  selectedEntryId: string | null;
  onSelect: (entry: TimelineEntry) => void;
}) {
  const [entries, setEntries] = useState<TimelineEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [groupBy, setGroupBy] = useState<GroupBy>("date");
  const [familiarFilter, setFamiliarFilter] = useState<string>("all");
  const [listFilter, setListFilter] = useState<ListFilter>("all");
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (familiarFilter !== "all") qs.set("familiar", familiarFilter);
      if (listFilter !== "all") qs.set("list", listFilter);
      const res = await fetch(`/api/library/all${qs.toString() ? "?" + qs.toString() : ""}`, { cache: "no-store" });
      const json = await res.json() as { ok: boolean; entries?: TimelineEntry[] };
      if (json.ok) setEntries(json.entries ?? []);
    } catch { setEntries([]); }
    finally { setLoading(false); }
  }, [familiarFilter, listFilter]);

  useEffect(() => { void load(); }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter((e) => {
      const hay = [e.item.title, (e.item as any).url ?? "", e.familiar ?? "",
        e.source?.kind === "chat" ? e.source.chatTitle : ""].join(" ").toLowerCase();
      return hay.includes(q);
    });
  }, [entries, search]);

  const groups = useMemo(() => {
    if (groupBy === "source") {
      const map = new Map<string, TimelineEntry[]>();
      for (const e of filtered) {
        const key = e.source?.kind === "chat"
          ? `chat "${e.source.chatTitle}"${e.familiar ? ` · ${e.familiar}` : ""}`
          : e.source?.kind === "browser" ? "Save button"
          : e.source?.kind === "slash" ? "/save"
          : e.source?.kind === "feed" ? `RSS · ${e.source.feedTitle}`
          : "Manual";
        (map.get(key) ?? map.set(key, []).get(key)!).push(e);
      }
      return Array.from(map.entries()).map(([label, items]) => ({ label, items }));
    }
    // group by date label
    const dayLabel = (iso: string) => {
      const d = new Date(iso);
      const today = new Date();
      const diff = Math.floor((today.getTime() - d.getTime()) / 86_400_000);
      if (diff < 1) return "Today";
      if (diff < 2) return "Yesterday";
      if (diff < 7) return "This week";
      if (diff < 30) return "This month";
      return "Older";
    };
    const map = new Map<string, TimelineEntry[]>();
    for (const e of filtered) {
      const k = dayLabel(e.capturedAt);
      (map.get(k) ?? map.set(k, []).get(k)!).push(e);
    }
    return Array.from(map.entries()).map(([label, items]) => ({ label, items }));
  }, [filtered, groupBy]);

  return (
    <div className="library-timeline flex h-full flex-col">
      <ViewHeader
        className="library-timeline-header"
        eyebrow="LIBRARY"
        title="All"
        search={
          <SearchInput
            value={search}
            onValueChange={setSearch}
            placeholder="Search links…"
            title="Search links — try chat: github: sage:"
            onClear={() => setSearch("")}
            containerClassName="library-timeline-search"
          />
        }
        filters={
          <div className="library-timeline-filters">
            <TimelineSelect
              ariaLabel="Filter by familiar"
              value={familiarFilter}
              onChange={setFamiliarFilter}
              options={[
                { value: "all", label: "Familiar: all" },
                ...familiars.map((f) => ({ value: f.id, label: f.display_name })),
              ]}
            />
            <div className="library-timeline-group-toggle" role="group" aria-label="Group by">
              {(["date", "source"] as const).map((g) => (
                <button
                  key={g}
                  type="button"
                  onClick={() => setGroupBy(g)}
                  aria-pressed={groupBy === g}
                  className="library-timeline-group-toggle-option focus-ring"
                >
                  {g === "date" ? "Date" : "Source"}
                </button>
              ))}
            </div>
            <TimelineSelect<ListFilter>
              ariaLabel="Filter by list"
              value={listFilter}
              onChange={setListFilter}
              options={[
                { value: "all", label: "All lists" },
                { value: "bookmarks", label: "Bookmarks" },
                { value: "reading", label: "Reading" },
                { value: "github", label: "GitHub" },
              ]}
            />
          </div>
        }
      />
      <div className="library-timeline-scroll flex-1 overflow-y-auto">
        {loading ? (
          <div className="p-3"><SkeletonRows count={6} /></div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon="ph:link"
            headline="No links yet"
            subtitle="Drop a URL in any chat, hit Save in the browser, or run /save in the composer."
          />
        ) : (
          groups.map((g) => (
            <div className="library-timeline-group" key={g.label}>
              <div className="library-timeline-group-header">
                <span className="library-timeline-group-label">{g.label}</span>
                <span className="library-timeline-group-count">{g.items.length}</span>
              </div>
              {g.items.map((e, index) => (
                <LibraryTimelineRow
                  key={timelineEntryKey(e, index)}
                  entry={e}
                  familiars={familiars}
                  selected={e.item.id === selectedEntryId}
                  onSelect={() => onSelect(e)}
                />
              ))}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
