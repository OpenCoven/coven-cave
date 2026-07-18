"use client";

/**
 * Grimoire launcher — the Memories surface's Knowledge home screen
 * ("Memories Prototype" redesign): an aurora banner, one big search that
 * doubles as a URL intake, and a bento of live entry points into the corpus.
 *
 * Shown by grimoire-view when the Knowledge tab has no open tabs; all data
 * (knowledge/memory/journal/graph) is what the view already loaded — this
 * component fetches nothing. Pure derivations live in
 * src/lib/grimoire-launcher-data.ts (unit-tested there).
 */

import { useMemo, useState } from "react";
import { Icon } from "@/lib/icon";
import { relativeTime } from "@/lib/relative-time";
import { STITCH_PATTERNS } from "@/lib/stitch-patterns";
import type { DocGraph } from "@/lib/grimoire-graph";
import {
  buildLauncherItems,
  detectLauncherCapture,
  journalStreakDays,
  launcherGraphCounts,
  launcherWeekStats,
  searchLauncherItems,
  topMemoryRoot,
  type LauncherDocRef,
  type LauncherItem,
  type LauncherJournalInput,
  type LauncherKnowledgeInput,
  type LauncherMemoryInput,
} from "@/lib/grimoire-launcher-data";

/** One-line template hooks, after the prototype's new-stitch row. */
const PATTERN_HOOKS: Record<string, string> = {
  "decision-record": "Why we chose it",
  "how-to": "Steps that work",
  glossary: "Terms, pinned down",
  "api-contract": "Inputs & promises",
};

function Marker({ marker }: { marker: LauncherItem["marker"] }) {
  return <span aria-hidden className={`gl-marker gl-marker-${marker}`} />;
}

export function GrimoireLauncher({
  knowledge,
  memory,
  journal,
  graph,
  journalTitle,
  onOpen,
  onNewStitch,
  onBlankEntry,
  onShowJournal,
  onShowGraph,
}: {
  knowledge: LauncherKnowledgeInput[];
  memory: LauncherMemoryInput[];
  journal: LauncherJournalInput[];
  graph: DocGraph | null;
  /** Prefs-formatted journal day label (grimoire-view's journalDayLabel). */
  journalTitle: (date: string) => string;
  onOpen: (ref: LauncherDocRef) => void;
  onNewStitch: (opts?: { patternId?: string; pinUrl?: string }) => void;
  onBlankEntry: () => void;
  onShowJournal: () => void;
  onShowGraph: () => void;
}) {
  const [query, setQuery] = useState("");
  // One clock per mount: stable stats, no re-render drift.
  const [nowMs] = useState(() => Date.now());

  const items = useMemo(
    () => buildLauncherItems({ knowledge, memory, journal }),
    [knowledge, memory, journal],
  );
  const results = useMemo(() => searchLauncherItems(items, query), [items, query]);
  const capture = useMemo(() => detectLauncherCapture(query), [query]);
  const week = useMemo(
    () => launcherWeekStats(items, journal, nowMs),
    [items, journal, nowMs],
  );
  const streak = useMemo(() => {
    const d = new Date(nowMs);
    const todayIso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    return journalStreakDays(journal.map((j) => j.date), todayIso);
  }, [journal, nowMs]);
  const graphCounts = useMemo(() => launcherGraphCounts(graph), [graph]);
  const topRoot = useMemo(() => topMemoryRoot(memory), [memory]);

  const hero = items[0] ?? null;
  const smallRecents = items.slice(1, 5);
  const latestMemory = useMemo(
    () => items.find((i) => i.ref.kind === "memory") ?? null,
    [items],
  );

  const displayTitle = (item: LauncherItem) =>
    item.ref.kind === "journal" ? `Journal — ${journalTitle(item.ref.date)}` : item.title;

  const dateLine = useMemo(() => {
    const d = new Date(nowMs);
    const weekday = d.toLocaleDateString(undefined, { weekday: "long" });
    const monthDay = d.toLocaleDateString(undefined, { month: "long", day: "numeric" });
    return `${weekday} · ${monthDay}`;
  }, [nowMs]);

  const searching = query.trim().length > 0;

  return (
    <div className="gl-root">
      <div className="gl-col">
        <div className="gl-banner" aria-hidden>
          <span className="gl-orb gl-orb-1" />
          <span className="gl-orb gl-orb-2" />
          <span className="gl-sheen" />
        </div>

        <section aria-label="Search and capture" className="gl-panel">
          <span className="gl-chip">Continue where you left off</span>
          <span className="gl-meta" suppressHydrationWarning>
            {dateLine} · {items.length.toLocaleString()} {items.length === 1 ? "document" : "documents"}
          </span>
          <div className="gl-search">
            <Icon name="ph:magnifying-glass" width={14} aria-hidden />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape" && query) setQuery("");
                if (e.key === "Enter") {
                  if (capture) onNewStitch({ pinUrl: capture.url });
                  else if (results[0]) onOpen(results[0].ref);
                }
              }}
              placeholder="Search all documents — or paste a URL to capture it…"
              aria-label="Search all documents or paste a URL"
            />
          </div>

          {searching ? (
            <div className="gl-results" aria-label="Search results">
              {capture ? (
                <>
                  <button type="button" className="gl-capture" onClick={() => onNewStitch({ pinUrl: capture.url })}>
                    <Icon name="ph:push-pin" width={13} aria-hidden />
                    <span className="gl-result-title">{capture.label}</span>
                    <span className="gl-result-kind">
                      {capture.flavor === "github" ? "GitHub" : capture.flavor === "llms" ? "llms.txt" : "Web page"}
                    </span>
                  </button>
                  <button type="button" className="gl-result" onClick={() => onNewStitch()}>
                    <Icon name="ph:plus" width={12} aria-hidden />
                    <span className="gl-result-title">Start an empty stitch instead</span>
                  </button>
                </>
              ) : results.length === 0 ? (
                <p className="gl-empty-results">No documents match — press ⏎ after pasting a URL to capture it, or sew a new stitch.</p>
              ) : (
                results.map((item) => (
                  <button key={item.key} type="button" className="gl-result" onClick={() => onOpen(item.ref)}>
                    <Marker marker={item.marker} />
                    <span className="gl-result-title">{displayTitle(item)}</span>
                    <span className="gl-result-kind">
                      {item.kindLabel}
                      {item.modifiedMs !== null
                        ? ` · ${relativeTime(new Date(item.modifiedMs).toISOString(), nowMs)}`
                        : ""}
                    </span>
                  </button>
                ))
              )}
            </div>
          ) : null}
        </section>

        {!searching ? (
          <section aria-label="Knowledge overview" className="gl-bento">
            {hero ? (
              <button type="button" className="gl-card gl-hero" onClick={() => onOpen(hero.ref)}>
                <span className="gl-kicker">Most recent</span>
                <span className="gl-card-title">{displayTitle(hero)}</span>
                <span className="gl-card-line">
                  <Marker marker={hero.marker} />
                  {hero.kindLabel}
                  {hero.modifiedMs !== null
                    ? ` · edited ${relativeTime(new Date(hero.modifiedMs).toISOString(), nowMs)}`
                    : ""}
                </span>
                {hero.excerpt ? <span className="gl-hero-excerpt">{hero.excerpt}</span> : null}
              </button>
            ) : (
              <button type="button" className="gl-card gl-hero" onClick={() => onNewStitch()}>
                <span className="gl-kicker">Getting started</span>
                <span className="gl-card-title">No documents yet</span>
                <span className="gl-card-sub">Pin sources and sew your first stitch — it lands here.</span>
              </button>
            )}

            <div className="gl-card gl-week">
              <span className="gl-shine" aria-hidden />
              <span className="gl-kicker">This week</span>
              <span className="gl-week-row">
                <span className="gl-stat">{week.filesTouched}</span>
                <span>files touched</span>
              </span>
              <span className="gl-week-row">
                <span className="gl-stat">{week.reflections}</span>
                <span>reflections written</span>
              </span>
              <span className="gl-week-row">
                <span className="gl-stat">{knowledge.length}</span>
                <span>stitches total</span>
              </span>
            </div>

            {smallRecents.map((item) => (
              <button key={item.key} type="button" className="gl-card" onClick={() => onOpen(item.ref)}>
                <span className="gl-card-line">
                  <Marker marker={item.marker} />
                  <span className="gl-line-title">{displayTitle(item)}</span>
                </span>
                <span className="gl-card-sub">
                  {item.kindLabel}
                  {item.modifiedMs !== null
                    ? ` · ${relativeTime(new Date(item.modifiedMs).toISOString(), nowMs)}`
                    : ""}
                </span>
              </button>
            ))}

            <button type="button" className="gl-card gl-detached" onClick={onShowGraph}>
              <span className="gl-stat">{graphCounts.detached}</span>
              <span className="gl-card-sub">detached docs with no links</span>
              <span className="gl-arrow">weave them in →</span>
            </button>

            <button type="button" className="gl-card" onClick={onShowJournal}>
              <span className="gl-stat">{streak > 0 ? `${streak}-day` : "No"}</span>
              <span className="gl-card-sub">journal streak</span>
              <span className="gl-arrow">
                {week.reflections} reflection{week.reflections === 1 ? "" : "s"} this week →
              </span>
            </button>

            <button type="button" className="gl-card" onClick={onShowGraph}>
              <span className="gl-stat">{graphCounts.nodes.toLocaleString()}</span>
              <span className="gl-card-sub">nodes in the graph</span>
              <span className="gl-arrow">{graphCounts.edges.toLocaleString()} connections woven →</span>
            </button>

            <button
              type="button"
              className="gl-card"
              onClick={() => (latestMemory ? onOpen(latestMemory.ref) : onNewStitch())}
            >
              <span className="gl-stat">{memory.length.toLocaleString()}</span>
              <span className="gl-card-sub">memory files</span>
              <span className="gl-arrow">
                {topRoot ? `${topRoot.count.toLocaleString()} from ${topRoot.label} →` : "agents write these →"}
              </span>
            </button>

            <div className="gl-card">
              <span className="gl-kicker">Tip</span>
              <span className="gl-card-sub">
                Link docs with [[wiki-links]] — connected stitches surface each other here and in Relations.
              </span>
            </div>

            <div className="gl-newrow">
              <span className="gl-chip">New stitch</span>
              <button
                type="button"
                className="gl-template gl-template-primary"
                onClick={() => onNewStitch()}
              >
                <Icon name="ph:plus" width={12} aria-hidden />
                <span className="gl-template-name">Blank stitch</span>
              </button>
              {STITCH_PATTERNS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className="gl-template"
                  title={p.description}
                  onClick={() => onNewStitch({ patternId: p.id })}
                >
                  <span className="gl-template-name">{p.name}</span>
                  <span className="gl-template-sub">{PATTERN_HOOKS[p.id] ?? p.description}</span>
                </button>
              ))}
              <button type="button" className="gl-template" onClick={onBlankEntry}>
                <span className="gl-template-name">Blank entry</span>
                <span className="gl-template-sub">Write by hand</span>
              </button>
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}
