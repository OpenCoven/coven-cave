"use client";

/**
 * CodeSessionPicker — the Coding Desk's session switcher (cave-0rcku).
 *
 * The `Cody Code Reading v2` frame replaces the permanently-docked session rail
 * with a header control: the current session's name in a button, opening a
 * filterable list from the same precomputed queue the rail uses. The room gets
 * the rail's width back and the switch becomes an explicit act rather than an
 * always-on column.
 *
 * The filter searches title, project, repository and branch
 * (`code-session-picker.ts`), and a miss is not a dead end — Enter on an
 * unmatched query offers to start a session with that name, which is the
 * frame's own affordance and the reason the empty state is a button rather
 * than a shrug.
 */

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { CodeReviewQueueControls } from "@/components/code-review-queue-controls";
import { Icon } from "@/lib/icon";
import { Popover, usePopoverInitialFocus } from "@/components/ui/popover";
import { relativeTime } from "@/lib/relative-time";
import {
  codeSessionPickerResult,
  type CodeSessionPickerChip,
} from "@/lib/code-session-picker";
import type { CodeQueueMode, CodeReviewQueue } from "@/lib/code-review-queue";
import { codeSessionActivity, codeSessionBranch } from "@/lib/code-surface";
import type { SessionRow } from "@/lib/types";

const ACTIVITY_LABEL = {
  running: "running",
  error: "failed",
  idle: "idle",
} as const;

// Picking another session remounts the desk, and the popover's focus return
// went to a detached trigger (#5745). The pick leaves a note here; the new
// desk's picker takes focus if it mounts within a moment.
let focusTriggerAfterPickAt = 0;
const FOCUS_AFTER_PICK_MS = 2000;

function SessionRowButton({
  row,
  id,
  current,
  active,
  onPick,
}: {
  row: SessionRow;
  id: string;
  /** The session the desk is showing now. */
  current: boolean;
  /** The option the search field's arrow keys point at. */
  active: boolean;
  onPick: () => void;
}) {
  const activity = codeSessionActivity(row);
  const branch = codeSessionBranch(row);
  return (
    <button
      type="button"
      role="option"
      id={id}
      // The listbox is driven from the search field (a combobox): one option
      // is active at a time, and the rows are not separate Tab stops.
      aria-selected={active}
      tabIndex={-1}
      className="focus-ring code-picker__row"
      data-selected={current ? "true" : undefined}
      data-active={active ? "true" : undefined}
      data-code-session-id={row.id}
      onClick={onPick}
    >
      {/* Activity is carried by the word beside the dot, never the dot alone. */}
      <span className="code-picker__dot" data-activity={activity} aria-hidden="true" />
      <span className="code-picker__row-main">
        <span className="code-picker__row-title">{row.title || row.id}</span>
        <span className="code-picker__row-meta">{branch ?? "no branch"}</span>
      </span>
      <span className="code-picker__row-side">
        <span className="code-picker__row-age">{relativeTime(row.updated_at)}</span>
        <span className="code-picker__row-state" data-activity={activity}>
          {ACTIVITY_LABEL[activity]}
        </span>
        {current ? <span className="sr-only">, current session</span> : null}
      </span>
    </button>
  );
}

export type CodeSessionPickerProps = {
  queue: CodeReviewQueue;
  mode: CodeQueueMode;
  selected: SessionRow | null;
  onModeChange: (mode: CodeQueueMode) => void;
  onSelect: (sessionId: string) => void;
  /**
   * Start a new session from an unmatched query — the frame's Enter path. The
   * query is what the session should work on, so it seeds the kickoff prompt;
   * a session's title belongs to the daemon and is not set here.
   */
  onCreate?: (seed: string) => void;
};

export function CodeSessionPicker({
  queue,
  mode,
  selected,
  onModeChange,
  onSelect,
  onCreate,
}: CodeSessionPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [groupKey, setGroupKey] = useState<string | null>(null);
  const anchorRef = useRef<HTMLButtonElement | null>(null);
  const listboxId = useId();
  const optionId = useCallback((sessionId: string) => `${listboxId}-option-${sessionId}`, [listboxId]);
  const [activeIndex, setActiveIndex] = useState(0);
  const listRef = useRef<HTMLDivElement | null>(null);

  // The pick that remounted the desk asked for the new trigger to take focus.
  useEffect(() => {
    if (!focusTriggerAfterPickAt || Date.now() - focusTriggerAfterPickAt > FOCUS_AFTER_PICK_MS) return;
    // Consumed only when focus actually moves: a cancelled frame (StrictMode's
    // second effect run) must leave the request for the run that sticks.
    const frame = requestAnimationFrame(() => {
      focusTriggerAfterPickAt = 0;
      anchorRef.current?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  // Reopening with the last search still applied reads as missing sessions, so
  // both filters reset on close.
  useEffect(() => {
    if (!open) {
      setQuery("");
      setGroupKey(null);
    }
  }, [open]);

  usePopoverInitialFocus(open, "[data-code-picker-panel]");

  const result = useMemo(
    () => codeSessionPickerResult(queue, query, groupKey),
    [groupKey, query, queue],
  );
  const options = useMemo(() => result.groups.flatMap((group) => group.sessions), [result]);
  // A new search or filter starts from the top match.
  useEffect(() => {
    setActiveIndex(0);
  }, [groupKey, open, query]);
  const active = options[Math.min(activeIndex, Math.max(0, options.length - 1))] ?? null;
  useEffect(() => {
    if (!open || !active) return;
    const id = optionId(active.id);
    Array.from(listRef.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? [])
      .find((option) => option.id === id)
      ?.scrollIntoView?.({ block: "nearest" });
  }, [active, open, optionId]);

  const pick = useCallback(
    (id: string) => {
      setOpen(false);
      if (id !== selected?.id) focusTriggerAfterPickAt = Date.now();
      onSelect(id);
    },
    [onSelect, selected?.id],
  );

  const create = useCallback(() => {
    const seed = query.trim();
    if (!seed || !onCreate) return;
    setOpen(false);
    onCreate(seed);
  }, [onCreate, query]);

  const onQueryKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      // Arrow keys move the active option (#5745); they used to do nothing,
      // and Enter could only ever pick the first match.
      if ((event.key === "ArrowDown" || event.key === "ArrowUp") && options.length > 0) {
        event.preventDefault();
        const step = event.key === "ArrowDown" ? 1 : -1;
        setActiveIndex((index) => (Math.min(index, options.length - 1) + step + options.length) % options.length);
        return;
      }
      if (event.key !== "Enter") return;
      event.preventDefault();
      if (result.offersCreate) {
        create();
        return;
      }
      if (active) pick(active.id);
    },
    [active, create, options.length, pick, result.offersCreate],
  );

  const chipButton = (chip: CodeSessionPickerChip) => {
    const on = chip.key === groupKey || (chip.key === null && groupKey === null);
    return (
      <button
        key={chip.id}
        type="button"
        aria-pressed={on}
        className="focus-ring code-picker__chip"
        data-on={on ? "true" : undefined}
        onClick={() => setGroupKey(chip.key)}
      >
        {chip.label}
        <span className="code-picker__chip-count">{chip.count}</span>
      </button>
    );
  };

  const triggerTitle = selected?.title || selected?.id || "Search sessions";
  const emptyMessage =
    mode === "reviewable"
      ? "No GitHub repository sessions need review."
      : "No coding sessions yet.";

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        aria-expanded={open}
        aria-haspopup="listbox"
        className="focus-ring code-picker__trigger"
        onClick={() => setOpen((value) => !value)}
      >
        <span className="code-picker__trigger-title">{triggerTitle}</span>
        <Icon name="ph:caret-down" width={11} height={11} aria-hidden />
      </button>
      <Popover
        open={open}
        onOpenChange={setOpen}
        anchorRef={anchorRef}
        placement="bottom-start"
        minWidth={352}
        scrollStrategy="content"
        ariaLabel="Switch session"
      >
        <div className="code-picker__panel" data-code-picker-panel="">
          <div className="code-picker__search">
            <Icon name="ph:magnifying-glass" width={12} height={12} aria-hidden />
            <input
              type="text"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={onQueryKeyDown}
              role="combobox"
              aria-expanded={open}
              aria-controls={listboxId}
              aria-autocomplete="list"
              aria-activedescendant={active ? optionId(active.id) : undefined}
              placeholder="Search sessions…"
              aria-label="Search sessions by title, project, repository or branch"
              className="code-picker__search-input"
              data-code-session-search=""
            />
            {query ? (
              <button
                type="button"
                className="focus-ring code-picker__search-clear"
                aria-label="Clear the search"
                onClick={() => setQuery("")}
              >
                <Icon name="ph:x" width={10} height={10} aria-hidden />
              </button>
            ) : null}
          </div>
          <CodeReviewQueueControls
            mode={mode}
            reviewableCount={queue.reviewableCount}
            allLocalCount={queue.allLocalCount}
            outsideCurrentFilter={queue.outsideCurrentFilter}
            onModeChange={(next) => {
              setGroupKey(null);
              onModeChange(next);
            }}
          />
          {result.chips.length > 1 ? (
            <div className="code-picker__chips">{result.chips.map(chipButton)}</div>
          ) : null}
          <div ref={listRef} className="code-picker__list" role="listbox" id={listboxId} aria-label="Sessions">
            {result.groups.map((group) => (
              <div key={group.key || "unknown"} className="code-picker__group">
                <div className="code-picker__group-head">
                  <span className="code-picker__group-label">{group.label}</span>
                  <span className="code-picker__group-count">{group.sessions.length}</span>
                </div>
                {group.sessions.map((row) => (
                  <SessionRowButton
                    key={row.id}
                    row={row}
                    id={optionId(row.id)}
                    current={row.id === selected?.id}
                    active={row.id === active?.id}
                    onPick={() => pick(row.id)}
                  />
                ))}
              </div>
            ))}
            {result.offersCreate ? (
              <div className="code-picker__empty">
                <p className="code-picker__empty-text">
                  No session matches <strong>{query.trim()}</strong>.
                </p>
                {onCreate ? (
                  <button type="button" className="focus-ring code-picker__empty-action" onClick={create}>
                    Start a new session about “{query.trim()}”
                  </button>
                ) : null}
              </div>
            ) : null}
            {!result.offersCreate && result.count === 0 ? (
              <p className="code-picker__empty-text">{emptyMessage}</p>
            ) : null}
          </div>
        </div>
      </Popover>
    </>
  );
}
