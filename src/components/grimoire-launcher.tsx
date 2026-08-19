"use client";

import { useMemo, useState } from "react";
import { Icon } from "@/lib/icon";
import { relativeTime } from "@/lib/relative-time";
import { STITCH_PATTERNS } from "@/lib/stitch-patterns";
import type { DocGraph } from "@/lib/grimoire-graph";
import {
  buildLauncherItems,
  detectLauncherCapture,
  launcherGraphCounts,
  searchLauncherItems,
  type LauncherDocRef,
  type LauncherItem,
  type LauncherJournalInput,
  type LauncherKnowledgeInput,
  type LauncherMemoryInput,
} from "@/lib/grimoire-launcher-data";

const PATTERN_HOOKS: Record<string, string> = {
  "decision-record": "Record a choice and its tradeoffs",
  "how-to": "Keep steps that work",
  glossary: "Define a shared vocabulary",
  "api-contract": "Pin inputs and promises",
};

function Marker({ marker }: { marker: LauncherItem["marker"] }) {
  return <span aria-hidden className={`gl-marker gl-marker-${marker}`} />;
}

function MemoryRow({
  item,
  nowMs,
  journalTitle,
  onOpen,
}: {
  item: LauncherItem;
  nowMs: number;
  journalTitle: (date: string) => string;
  onOpen: (ref: LauncherDocRef) => void;
}) {
  const title =
    item.ref.kind === "journal"
      ? `Journal — ${journalTitle(item.ref.date)}`
      : item.title;
  return (
    <button
      type="button"
      className="gl-memory-row focus-ring"
      onClick={() => onOpen(item.ref)}
    >
      <Marker marker={item.marker} />
      <span className="gl-memory-row__body">
        <span className="gl-memory-row__title">{title}</span>
        {item.excerpt ? (
          <span className="gl-memory-row__excerpt">{item.excerpt}</span>
        ) : null}
        <span className="gl-memory-row__meta">
          {item.kindLabel}
          {item.modifiedMs !== null
            ? ` · ${relativeTime(new Date(item.modifiedMs).toISOString(), nowMs)}`
            : ""}
        </span>
      </span>
      <Icon name="ph:caret-right" width={11} aria-hidden />
    </button>
  );
}

export function GrimoireLauncher({
  knowledge,
  memory,
  journal,
  graph,
  scopeLabel,
  query,
  onQueryChange,
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
  scopeLabel?: string | null;
  query: string;
  onQueryChange: (query: string) => void;
  journalTitle: (date: string) => string;
  onOpen: (ref: LauncherDocRef) => void;
  onNewStitch: (opts?: { patternId?: string; pinUrl?: string }) => void;
  onBlankEntry: () => void;
  onShowJournal: () => void;
  onShowGraph: () => void;
}) {
  const [captureValue, setCaptureValue] = useState("");
  const [nowMs] = useState(() => Date.now());
  const items = useMemo(
    () => buildLauncherItems({ knowledge, memory, journal }),
    [knowledge, memory, journal],
  );
  const results = useMemo(
    () =>
      query.trim()
        ? searchLauncherItems(items, query)
        : items.slice(1, 6),
    [items, query],
  );
  const capture = useMemo(
    () => detectLauncherCapture(captureValue),
    [captureValue],
  );
  const graphCounts = useMemo(() => launcherGraphCounts(graph), [graph]);
  const continueItems = items.slice(0, 1);

  const captureUrl = () => {
    if (!capture) return;
    onNewStitch({ pinUrl: capture.url });
  };

  return (
    <div className="gl-root">
      <div className="gl-col">
        <header className="gl-intro">
          <p className="gl-intro__eyebrow">Threaded reading room</p>
          <h2>Continue what matters. Recall it when needed. Weave it forward.</h2>
          <p>
            {items.length === 0
              ? "Your durable knowledge will gather here."
              : `${items.length.toLocaleString()} ${items.length === 1 ? "document" : "documents"} across stitches, familiar memory, and journal.`}
          </p>
        </header>

        <div className="gl-sequence">
          <span className="gl-thread" aria-hidden />

          <section className="gl-stage" aria-labelledby="memories-continue">
            <span className="gl-stage__knot" aria-hidden />
            <div className="gl-stage__header">
              <div>
                <p className="gl-stage__index">01</p>
                <h3 id="memories-continue">Continue</h3>
                <p>Return to recent reading and editing.</p>
              </div>
              {journal.length > 0 ? (
                <button type="button" className="gl-quiet-action focus-ring" onClick={onShowJournal}>
                  Open Journal
                </button>
              ) : null}
            </div>
            <div className="gl-stage__content">
              {continueItems.length > 0 ? (
                continueItems.map((item) => (
                  <MemoryRow
                    key={item.key}
                    item={item}
                    nowMs={nowMs}
                    journalTitle={journalTitle}
                    onOpen={onOpen}
                  />
                ))
              ) : (
                <div className="gl-empty">
                  <p>No memories yet.</p>
                  <button type="button" className="gl-primary-action focus-ring" onClick={() => onNewStitch()}>
                    <Icon name="ph:plus" width={12} aria-hidden />
                    New stitch
                  </button>
                </div>
              )}
            </div>
          </section>

          <section className="gl-stage" aria-labelledby="memories-recall">
            <span className="gl-stage__knot" aria-hidden />
            <div className="gl-stage__header">
              <div>
                <p className="gl-stage__index">02</p>
                <h3 id="memories-recall">Recall</h3>
                <p>
                  Search stitches and {scopeLabel ? `${scopeLabel}'s familiar memory` : "familiar memory"}.
                </p>
              </div>
            </div>
            <div className="gl-stage__content">
              <label className="gl-field">
                <span>Search memories</span>
                <span className="gl-search">
                  <Icon name="ph:magnifying-glass" width={14} aria-hidden />
                  <input
                    type="search"
                    value={query}
                    onChange={(event) => onQueryChange(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Escape" && query) onQueryChange("");
                      if (event.key === "Enter" && results[0]) onOpen(results[0].ref);
                    }}
                    placeholder="Search memories…"
                    aria-label="Search memories"
                  />
                  {query ? (
                    <button
                      type="button"
                      className="gl-search__clear focus-ring"
                      aria-label="Clear search"
                      onClick={() => onQueryChange("")}
                    >
                      <Icon name="ph:x-bold" width={10} aria-hidden />
                    </button>
                  ) : null}
                </span>
              </label>
              <div className="gl-results" aria-live="polite">
                {results.length > 0 ? (
                  results.map((item) => (
                    <MemoryRow
                      key={item.key}
                      item={item}
                      nowMs={nowMs}
                      journalTitle={journalTitle}
                      onOpen={onOpen}
                    />
                  ))
                ) : (
                  <p className="gl-empty-results">
                    {query
                      ? `No memories match “${query}”. Clear the search or start a new stitch.`
                      : "Search for a memory or open the recent document above."}
                  </p>
                )}
              </div>
            </div>
          </section>

          <section className="gl-stage" aria-labelledby="memories-weave">
            <span className="gl-stage__knot" aria-hidden />
            <div className="gl-stage__header">
              <div>
                <p className="gl-stage__index">03</p>
                <h3 id="memories-weave">Weave</h3>
                <p>Capture a source or start a durable entry.</p>
              </div>
              <button type="button" className="gl-primary-action focus-ring" onClick={() => onNewStitch()}>
                <Icon name="ph:plus" width={12} aria-hidden />
                New stitch
              </button>
            </div>
            <div className="gl-stage__content gl-weave">
              <label className="gl-field">
                <span>Capture a URL</span>
                <span className="gl-capture">
                  <input
                    type="url"
                    value={captureValue}
                    onChange={(event) => setCaptureValue(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") captureUrl();
                    }}
                    placeholder="https://example.com/article"
                    aria-label="URL to capture"
                    aria-invalid={captureValue.trim() !== "" && !capture}
                  />
                  <button
                    type="button"
                    className="gl-capture__action focus-ring"
                    onClick={captureUrl}
                    disabled={!capture}
                  >
                    <Icon name="ph:push-pin" width={12} aria-hidden />
                    Capture
                  </button>
                </span>
              </label>
              {captureValue.trim() !== "" && !capture ? (
                <p className="gl-field__hint" role="status">
                  Enter a complete http or https URL.
                </p>
              ) : null}
              <div className="gl-template-list" aria-label="Stitch templates">
                {STITCH_PATTERNS.map((pattern) => (
                  <button
                    key={pattern.id}
                    type="button"
                    className="gl-template focus-ring"
                    onClick={() => onNewStitch({ patternId: pattern.id })}
                  >
                    <span>{pattern.name}</span>
                    <small>{PATTERN_HOOKS[pattern.id] ?? pattern.description}</small>
                  </button>
                ))}
                <button type="button" className="gl-template focus-ring" onClick={onBlankEntry}>
                  <span>Blank entry</span>
                  <small>Write directly in the editor</small>
                </button>
              </div>
              <button type="button" className="gl-relations focus-ring" onClick={onShowGraph}>
                <Icon name="ph:path" width={13} aria-hidden />
                <span>
                  Review relations
                  {graphCounts.nodes > 0
                    ? ` · ${graphCounts.nodes.toLocaleString()} documents connected by ${graphCounts.edges.toLocaleString()} links`
                    : ""}
                </span>
                <Icon name="ph:caret-right" width={11} aria-hidden />
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
