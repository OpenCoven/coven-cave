"use client";

/**
 * CodeSessionPicker — the Coding Room's session switcher (cave-0rcku).
 *
 * The `Cody Code Reading v2` frame replaces the permanently-docked session rail
 * with a header control: the current session's name in a button, opening a
 * filterable list grouped by project. The room gets the rail's width back and
 * the switch becomes an explicit act rather than an always-on column.
 *
 * The filter searches title, project and branch (`code-session-picker.ts`), and
 * a miss is not a dead end — Enter on an unmatched query offers to start a
 * session with that name, which is the frame's own affordance and the reason
 * the empty state is a button rather than a shrug.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/lib/icon";
import { Popover, usePopoverInitialFocus } from "@/components/ui/popover";
import { relativeTime } from "@/lib/relative-time";
import {
  codeSessionPickerResult,
  type CodeSessionPickerChip,
} from "@/lib/code-session-picker";
import { codeSessionActivity, codeSessionBranch } from "@/lib/code-surface";
import type { SessionRow } from "@/lib/types";

const ACTIVITY_LABEL = {
  running: "running",
  error: "failed",
  idle: "idle",
} as const;

function SessionRowButton({
  row,
  selected,
  onPick,
}: {
  row: SessionRow;
  selected: boolean;
  onPick: () => void;
}) {
  const activity = codeSessionActivity(row);
  const branch = codeSessionBranch(row);
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      className="focus-ring code-picker__row"
      data-selected={selected ? "true" : undefined}
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
      </span>
    </button>
  );
}

export type CodeSessionPickerProps = {
  sessions: SessionRow[];
  selected: SessionRow;
  onSelect: (sessionId: string) => void;
  /**
   * Start a new session from an unmatched query — the frame's Enter path. The
   * query is what the session should work on, so it seeds the kickoff prompt;
   * a session's title belongs to the daemon and is not set here.
   */
  onCreate?: (seed: string) => void;
};

export function CodeSessionPicker({
  sessions,
  selected,
  onSelect,
  onCreate,
}: CodeSessionPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [project, setProject] = useState<string | null>(null);
  const anchorRef = useRef<HTMLButtonElement | null>(null);

  // Reopening with the last search still applied reads as missing sessions, so
  // both filters reset on close.
  useEffect(() => {
    if (!open) {
      setQuery("");
      setProject(null);
    }
  }, [open]);

  usePopoverInitialFocus(open, "[data-code-picker-panel]");

  const result = useMemo(
    () => codeSessionPickerResult(sessions, query, project),
    [project, query, sessions],
  );

  const pick = useCallback(
    (id: string) => {
      setOpen(false);
      onSelect(id);
    },
    [onSelect],
  );

  const create = useCallback(() => {
    const seed = query.trim();
    if (!seed || !onCreate) return;
    setOpen(false);
    onCreate(seed);
  }, [onCreate, query]);

  const onQueryKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      if (result.offersCreate) {
        create();
        return;
      }
      const first = result.groups[0]?.sessions[0];
      if (first) pick(first.id);
    },
    [create, pick, result],
  );

  const chipButton = (chip: CodeSessionPickerChip) => {
    const on = chip.root === project || (chip.root === null && project === null);
    return (
      <button
        key={chip.id}
        type="button"
        aria-pressed={on}
        className="focus-ring code-picker__chip"
        data-on={on ? "true" : undefined}
        onClick={() => setProject(chip.root)}
      >
        {chip.label}
        <span className="code-picker__chip-count">{chip.count}</span>
      </button>
    );
  };

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
        <span className="code-picker__trigger-title">{selected.title || selected.id}</span>
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
              placeholder="Search sessions…"
              aria-label="Search sessions by title, project or branch"
              className="code-picker__search-input"
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
          {result.chips.length > 1 ? (
            <div className="code-picker__chips">{result.chips.map(chipButton)}</div>
          ) : null}
          <div className="code-picker__list" role="listbox" aria-label="Sessions">
            {result.groups.map((group) => (
              <div key={group.root || "unknown"} className="code-picker__group">
                <div className="code-picker__group-head">
                  <span className="code-picker__group-label">{group.label}</span>
                  <span className="code-picker__group-count">{group.sessions.length}</span>
                </div>
                {group.sessions.map((row) => (
                  <SessionRowButton
                    key={row.id}
                    row={row}
                    selected={row.id === selected.id}
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
              <p className="code-picker__empty-text">No coding sessions yet.</p>
            ) : null}
          </div>
        </div>
      </Popover>
    </>
  );
}
