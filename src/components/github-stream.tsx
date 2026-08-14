"use client";

/**
 * GitHubStream — the sectioned triage list that replaces the GitHub surface's
 * sortable table.
 *
 * A table answers "what changed most recently". This answers "what is asking
 * something of me": rows carry a stage badge, sit under a heading that says why
 * the bucket exists, and expose a three-segment signal strip (checks · linked
 * work · triage) that reads at a glance without a legend. Peek expands the
 * next step in place, so triage does not cost a detail-panel round trip per row.
 *
 * Presentation only. Stage and section derivation live in `lib/github-stage.ts`
 * so the headings, the facet chips and their counts are computed once from one
 * source and cannot drift apart. Per-row verbs arrive as `renderRowActions` —
 * the existing chat/board/merge actions keep their own wiring.
 */

import { useCallback, useEffect, useRef, type ReactNode } from "react";
import { Icon } from "@/lib/icon";
import type { IconName } from "@/lib/icon";
import { RelativeTime } from "@/components/ui/relative-time";
import {
  GH_NEXT_STEP,
  GH_SIGNAL_TITLE,
  signalSegments,
  type GhSectionKey,
  type GhStreamEntry,
  type GhStreamSection,
  type GhTone,
} from "@/lib/github-stage";
import type { GitHubItem } from "@/lib/github-tasks";

/** One glyph per tone, so the badge never relies on colour alone (a11y §). */
const TONE_ICON: Record<GhTone, IconName> = {
  ok: "ph:check",
  bad: "ph:x",
  warn: "ph:warning-circle",
  acc: "ph:sparkle",
  mute: "ph:circle",
};

/** A row's tonal chips — the signals worth naming in words next to the meta. */
type RowChip = { tone: GhTone; label: string };

function chipsFor(item: GitHubItem): RowChip[] {
  const chips: RowChip[] = [];
  if (item.draft) chips.push({ tone: "mute", label: "draft" });
  if (item.checkStatus === "failing") chips.push({ tone: "bad", label: "checks failing" });
  else if (item.checkStatus === "passing") chips.push({ tone: "ok", label: "checks pass" });
  else if (item.checkStatus === "pending") chips.push({ tone: "warn", label: "checks running" });
  return chips;
}

/** The muted second line: labels for issues, the branch-ish detail for PRs. */
function metaFor(entry: GhStreamEntry<GitHubItem>): string {
  const labels = entry.row.labels ?? [];
  if (labels.length > 0) return labels.slice(0, 3).join(" · ");
  if (entry.linkedCount > 0) {
    return `${entry.linkedCount} linked task${entry.linkedCount === 1 ? "" : "s"}`;
  }
  return "";
}

export type GitHubStreamProps = {
  sections: GhStreamSection<GitHubItem>[];
  /** Currently inspected row — drives the rail accent and the roving tab stop. */
  selectedId: string | null;
  /** Section keys the user collapsed. Absent key = expanded. */
  collapsed: Partial<Record<GhSectionKey, boolean>>;
  onToggleSection: (key: GhSectionKey) => void;
  /** Rows whose peek panel is open, by item id. */
  peeked: Record<string, boolean>;
  onTogglePeek: (id: string) => void;
  /** Select without leaving the list. */
  onSelect: (id: string) => void;
  /** Select and raise the focused detail view. */
  onOpen: (id: string) => void;
  /**
   * The row's hand-off verb. A slot rather than a callback because handing work
   * to a familiar means choosing WHICH familiar — that picker is the host's
   * (it reads the user's own roster), and this component must never assume a
   * name or a default.
   */
  renderHandOff?: (item: GitHubItem) => ReactNode;
  /** The existing chat / board / merge verbs, rendered into the peek footer. */
  renderRowActions?: (item: GitHubItem) => ReactNode;
};

export function GitHubStream({
  sections,
  selectedId,
  collapsed,
  onToggleSection,
  peeked,
  onTogglePeek,
  onSelect,
  onOpen,
  renderHandOff,
  renderRowActions,
}: GitHubStreamProps) {
  const listRef = useRef<HTMLDivElement | null>(null);

  // ↑/↓/Home/End move a roving tab stop across every visible row, selection
  // follows focus so the detail panel tracks the keyboard, and Enter raises the
  // focused detail. Rebinds when the visible row set changes (collapse, filter).
  const visibleCount = sections.reduce(
    (n, s) => n + (collapsed[s.key] ? 0 : s.entries.length),
    0,
  );
  useEffect(() => {
    const host = listRef.current;
    if (!host) return;
    const rows = () => Array.from(host.querySelectorAll<HTMLElement>('[data-gh-stream-row="true"]'));
    const focusAt = (i: number) => {
      const list = rows();
      if (list.length === 0) return;
      const row = list[Math.max(0, Math.min(list.length - 1, i))];
      if (row.dataset.itemId) onSelect(row.dataset.itemId);
      row.focus();
    };
    const onKey = (e: KeyboardEvent) => {
      const current = (e.target as HTMLElement | null)?.closest?.(
        '[data-gh-stream-row="true"]',
      ) as HTMLElement | null;
      const list = rows();
      const i = current
        ? list.indexOf(current)
        : list.findIndex((r) => r.getAttribute("aria-current") === "true");
      switch (e.key) {
        case "ArrowDown": e.preventDefault(); focusAt((i < 0 ? -1 : i) + 1); break;
        case "ArrowUp": e.preventDefault(); focusAt((i < 0 ? list.length : i) - 1); break;
        case "Home": e.preventDefault(); focusAt(0); break;
        case "End": e.preventDefault(); focusAt(list.length - 1); break;
      }
    };
    host.addEventListener("keydown", onKey);
    return () => host.removeEventListener("keydown", onKey);
  }, [visibleCount, onSelect]);

  return (
    <div className="gh-stream" ref={listRef}>
      {sections.map((section) => {
        const isCollapsed = Boolean(collapsed[section.key]);
        return (
          <section key={section.key} className="gh-stream-section">
            <h3 className={`gh-stream-head gh-tone--${section.tone}`}>
              <span className="gh-stream-head-rail" aria-hidden />
              <button
                type="button"
                className="gh-stream-head-button focus-ring"
                aria-expanded={!isCollapsed}
                onClick={() => onToggleSection(section.key)}
              >
                <span className={`gh-stream-head-caret${isCollapsed ? " is-collapsed" : ""}`} aria-hidden>
                  <Icon name="ph:caret-down" width={9} />
                </span>
                <span className="gh-stream-head-label">{section.label}</span>
                <span className="gh-stream-head-count">{section.entries.length}</span>
                <span className="gh-stream-head-hint">
                  {isCollapsed && section.entries[0]
                    ? `hidden · ${section.entries[0].row.title}`
                    : section.hint}
                </span>
              </button>
            </h3>
            {isCollapsed
              ? null
              : section.entries.map((entry) => (
                  <StreamRow
                    key={entry.row.id}
                    entry={entry}
                    selected={entry.row.id === selectedId}
                    peekOpen={Boolean(peeked[entry.row.id])}
                    onTogglePeek={onTogglePeek}
                    onSelect={onSelect}
                    onOpen={onOpen}
                    renderHandOff={renderHandOff}
                    renderRowActions={renderRowActions}
                  />
                ))}
          </section>
        );
      })}
    </div>
  );
}

function StreamRow({
  entry,
  selected,
  peekOpen,
  onTogglePeek,
  onSelect,
  onOpen,
  renderHandOff,
  renderRowActions,
}: {
  entry: GhStreamEntry<GitHubItem>;
  selected: boolean;
  peekOpen: boolean;
  onTogglePeek: (id: string) => void;
  onSelect: (id: string) => void;
  onOpen: (id: string) => void;
  renderHandOff?: (item: GitHubItem) => ReactNode;
  renderRowActions?: (item: GitHubItem) => ReactNode;
}) {
  const { row, stage } = entry;
  const segments = signalSegments(entry);
  const chips = chipsFor(row);
  const meta = metaFor(entry);
  const numberSuffix = row.number != null ? ` #${row.number}` : "";

  // The row is a click target AND a double-click target, so anything
  // interactive nested inside it has to swallow both. Stopping only `click`
  // leaves `dblclick` bubbling — an impatient double-click on the hand-off
  // picker or the Peek verb would open the focused read out from under you.
  const stopRowActivation = useCallback((e: React.SyntheticEvent) => {
    e.stopPropagation();
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      // The nested peek / hand-off buttons keep their own activation — only the
      // row itself opens the detail.
      if (e.target !== e.currentTarget) return;
      e.preventDefault();
      onOpen(row.id);
    },
    [onOpen, row.id],
  );

  return (
    <div
      data-gh-stream-row="true"
      data-item-id={row.id}
      role="button"
      tabIndex={selected ? 0 : -1}
      aria-current={selected ? "true" : undefined}
      aria-label={`${stage.label} — ${row.title} in ${row.repo}${numberSuffix}`}
      className={`gh-stream-row reveal-scope gh-tone--${stage.tone}${selected ? " is-selected" : ""}`}
      onClick={() => onSelect(row.id)}
      onDoubleClick={() => onOpen(row.id)}
      onKeyDown={handleKeyDown}
    >
      <span className="gh-stream-row-rail" aria-hidden />
      <span className="gh-stream-row-main">
        <span className="gh-stream-row-head">
          <span className={`gh-stage gh-tone--${stage.tone}`}>
            <Icon name={TONE_ICON[stage.tone]} width={9} aria-hidden />
            {stage.label}
          </span>
          <span className="gh-stream-row-title" title={row.title}>{row.title}</span>
          <span className="gh-stream-signal" role="img" aria-label={GH_SIGNAL_TITLE} title={GH_SIGNAL_TITLE}>
            {segments.map((tone, i) => (
              <span key={i} className={`gh-stream-signal-seg gh-tone--${tone}`} />
            ))}
          </span>
          <RelativeTime iso={row.updatedAt} className="gh-stream-row-age" />
          <span
            className="gh-stream-row-verbs reveal-on-hover"
            onClick={stopRowActivation}
            onDoubleClick={stopRowActivation}
          >
            <button
              type="button"
              className="gh-stream-verb focus-ring"
              aria-expanded={peekOpen}
              title={peekOpen ? "Hide the peek" : "Peek without leaving the list"}
              onClick={(e) => { e.stopPropagation(); onTogglePeek(row.id); }}
              onDoubleClick={stopRowActivation}
            >
              <Icon name={peekOpen ? "ph:caret-up" : "ph:caret-down"} width={9} aria-hidden />
              Peek
            </button>
            {renderHandOff ? (
              // The wrapper is not the affordance — the picker inside it is.
              // It only keeps the row's own click/double-click from firing while
              // you are choosing a familiar, so it needs no key handler.
              <span
                className="gh-stream-handoff"
                onClick={stopRowActivation}
                onDoubleClick={stopRowActivation}
              >
                {renderHandOff(row)}
              </span>
            ) : null}
          </span>
        </span>

        <span className="gh-stream-row-meta">
          <span className="gh-stream-row-repo">{row.repo}{numberSuffix}</span>
          {meta ? <span className="gh-stream-row-note">{meta}</span> : null}
          <span className="gh-stream-row-spacer" />
          {chips.map((chip) => (
            <span key={chip.label} className={`gh-stream-chip gh-tone--${chip.tone}`} title={chip.label}>
              <Icon name={TONE_ICON[chip.tone]} width={9} aria-hidden />
              {chip.label}
            </span>
          ))}
          {entry.session ? (
            <span className="gh-stream-session" title="Linked to a familiar's Cave work">
              <Icon name="ph:sparkle" width={9} aria-hidden />
              {entry.session}
            </span>
          ) : null}
        </span>

        {peekOpen ? (
          <span className="gh-stream-peek">
            <span className="gh-stream-peek-row">
              <span className="gh-stream-peek-key">signal</span>
              <span className="gh-stream-peek-value">
                {chips.length > 0 ? chips.map((c) => c.label).join(" · ") : "no checks reported"}
              </span>
            </span>
            <span className="gh-stream-peek-row">
              <span className="gh-stream-peek-key">linked</span>
              <span className="gh-stream-peek-value">
                {entry.session
                  ? `${entry.session} — a familiar has this open`
                  : entry.linkedCount > 0
                    ? `${entry.linkedCount} Cave task${entry.linkedCount === 1 ? "" : "s"}`
                    : "no Cave task linked yet"}
              </span>
            </span>
            <span className="gh-stream-peek-row">
              <span className="gh-stream-peek-key">next</span>
              <span className="gh-stream-peek-value">{GH_NEXT_STEP[stage.key]}</span>
            </span>
            <span className="gh-stream-peek-actions">
              <button
                type="button"
                className="gh-stream-peek-primary focus-ring"
                onClick={(e) => { e.stopPropagation(); onOpen(row.id); }}
                onDoubleClick={stopRowActivation}
              >
                Open detail
              </button>
              {renderRowActions ? (
                <span
                  className="gh-stream-peek-verbs"
                  onClick={stopRowActivation}
                  onDoubleClick={stopRowActivation}
                >
                  {renderRowActions(row)}
                </span>
              ) : null}
            </span>
          </span>
        ) : null}
      </span>
    </div>
  );
}
