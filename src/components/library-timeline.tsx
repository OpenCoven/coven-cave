"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ViewHeader } from "@/components/ui/view-header";
import { SearchInput } from "@/components/ui/search-input";
import { EmptyState } from "@/components/ui/empty-state";
import { SkeletonRows } from "@/components/ui/skeleton";
import { LibraryTimelineRow } from "@/components/library-timeline-row";
import type { TimelineEntry } from "@/app/api/library/all/route";
import type { Familiar } from "@/lib/types";

type GroupBy = "date" | "source";
type ListFilter = "all" | "bookmarks" | "reading" | "github";

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
    <div className="flex h-full flex-col">
      <ViewHeader
        eyebrow="LIBRARY"
        title="All"
        search={
          <SearchInput
            value={search}
            onValueChange={setSearch}
            placeholder="Search links — try chat: github: sage:"
            onClear={() => setSearch("")}
          />
        }
        filters={
          <>
            <select
              className="focus-ring rounded border border-[var(--border-hairline)] bg-[var(--bg-raised)] px-2 py-1 text-[11px] text-[var(--text-primary)]"
              value={familiarFilter}
              onChange={(e) => setFamiliarFilter(e.target.value)}
              aria-label="Filter by familiar"
            >
              <option value="all">Familiar: all</option>
              {familiars.map((f) => (
                <option key={f.id} value={f.id}>{f.display_name}</option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => setGroupBy((g) => g === "date" ? "source" : "date")}
              className="focus-ring rounded border border-[var(--border-hairline)] bg-[var(--bg-raised)] px-2 py-1 text-[11px] text-[var(--text-primary)]"
            >
              Group: {groupBy}
            </button>
            <select
              className="focus-ring rounded border border-[var(--border-hairline)] bg-[var(--bg-raised)] px-2 py-1 text-[11px] text-[var(--text-primary)]"
              value={listFilter}
              onChange={(e) => setListFilter(e.target.value as ListFilter)}
              aria-label="Filter by list"
            >
              <option value="all">All lists</option>
              <option value="bookmarks">Bookmarks</option>
              <option value="reading">Reading</option>
              <option value="github">GitHub</option>
            </select>
          </>
        }
      />
      <div className="flex-1 overflow-y-auto">
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
            <div key={g.label}>
              <div className="border-b border-[var(--border-hairline)] bg-[var(--bg-panel)] px-3 py-1.5 text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
                {g.label} <span className="ml-2 normal-case text-[var(--text-muted)]">{g.items.length} link{g.items.length === 1 ? "" : "s"}</span>
              </div>
              {g.items.map((e) => (
                <LibraryTimelineRow
                  key={e.item.id}
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
