"use client";

import { useEffect, useRef } from "react";
import { FamiliarIcon } from "@/components/familiar-icon";
import { Icon } from "@/lib/icon";
import type { TranscriptHit } from "@/lib/transcript-find";
import type { Familiar } from "@/lib/types";

/**
 * Find in chat (Chat.dc.html 2a).
 *
 * The design promotes find from an icon in the header action cluster to a band
 * that slides open under the title row: a control row over a scrollable list
 * of every hit. The list is the point — a bare "3 / 17" makes you press Next
 * seventeen times to find out which one you wanted, while rows let you read
 * the matches and jump straight to the right one.
 */

function HitText({ hit }: { hit: TranscriptHit }) {
  const before = hit.snippet.slice(0, hit.snippetStart);
  const match = hit.snippet.slice(hit.snippetStart, hit.snippetEnd);
  const after = hit.snippet.slice(hit.snippetEnd);
  return (
    <span className="cave-find-hit__text">
      {hit.ellipsisStart ? <span aria-hidden>…</span> : null}
      {before}
      <mark className="cave-find-hit__mark">{match}</mark>
      {after}
      {hit.ellipsisEnd ? <span aria-hidden>…</span> : null}
    </span>
  );
}

export function ChatFindBand({
  open,
  query,
  hits,
  activeIndex,
  matchCase,
  wholeWord,
  focusNonce,
  familiar,
  operatorName,
  onQueryChange,
  onToggleMatchCase,
  onToggleWholeWord,
  onSelectHit,
  onNext,
  onPrev,
  onClose,
}: {
  open: boolean;
  query: string;
  hits: TranscriptHit[];
  /** 0-based index into `hits`; rendered 1-based. */
  activeIndex: number;
  matchCase: boolean;
  wholeWord: boolean;
  /** Bumped on every ⌘F so an already-open band refocuses its input. */
  focusNonce: number;
  familiar: Familiar;
  operatorName: string;
  onQueryChange: (value: string) => void;
  onToggleMatchCase: () => void;
  onToggleWholeWord: () => void;
  onSelectHit: (index: number) => void;
  onNext: () => void;
  onPrev: () => void;
  onClose: () => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [open, focusNonce]);

  // Keep the active row visible as Enter / arrows walk the list. `nearest`
  // so a row already on screen doesn't yank the list around under the reader.
  useEffect(() => {
    if (!open) return;
    const row = listRef.current?.querySelector<HTMLElement>('[data-active="true"]');
    row?.scrollIntoView({ block: "nearest" });
  }, [open, activeIndex, hits.length]);

  if (!open) return null;

  const trimmed = query.trim();
  const hasQuery = trimmed.length > 0;

  return (
    <div className="cave-find-band" role="search" aria-label="Find in conversation">
      <div className="cave-find-band__controls">
        <Icon name="ph:magnifying-glass" width={12} className="cave-find-band__glyph" aria-hidden />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              e.stopPropagation();
              if (e.shiftKey) onPrev();
              else onNext();
              return;
            }
            if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              onClose();
              return;
            }
            // Walk the hit list without leaving the input.
            if (e.key === "ArrowDown") {
              e.preventDefault();
              onNext();
              return;
            }
            if (e.key === "ArrowUp") {
              e.preventDefault();
              onPrev();
            }
          }}
          placeholder="Find in chat…"
          aria-label="Find in conversation"
          className="cave-find-band__input"
        />
        <button
          type="button"
          className="cave-find-band__toggle focus-ring"
          aria-pressed={matchCase}
          title="Match case"
          aria-label="Match case"
          onClick={onToggleMatchCase}
        >
          Aa
        </button>
        <button
          type="button"
          className="cave-find-band__toggle focus-ring"
          aria-pressed={wholeWord}
          title="Whole word"
          aria-label="Whole word"
          onClick={onToggleWholeWord}
        >
          ab|
        </button>
        {/* Tabular so the count does not jitter the controls as it changes. */}
        <span className="cave-find-band__count" aria-live="polite">
          {hits.length > 0 ? `${activeIndex + 1}/${hits.length}` : hasQuery ? "0/0" : ""}
        </span>
        <button
          type="button"
          className="cave-find-band__nav focus-ring"
          aria-label="Previous match"
          title="Previous match (shift+enter)"
          disabled={hits.length === 0}
          onClick={onPrev}
        >
          <Icon name="ph:caret-up" width={10} aria-hidden />
        </button>
        <button
          type="button"
          className="cave-find-band__nav focus-ring"
          aria-label="Next match"
          title="Next match (enter)"
          disabled={hits.length === 0}
          onClick={onNext}
        >
          <Icon name="ph:caret-down" width={10} aria-hidden />
        </button>
        <button
          type="button"
          className="cave-find-band__nav focus-ring"
          aria-label="Close find"
          title="Close find (esc)"
          onClick={onClose}
        >
          <Icon name="ph:x" width={10} aria-hidden />
        </button>
      </div>

      {hasQuery ? (
        hits.length > 0 ? (
          <ul className="cave-find-band__list" ref={listRef}>
            {hits.map((hit, index) => (
              <li key={`${hit.turnId}-${hit.occurrenceInTurn}`}>
                <button
                  type="button"
                  className="cave-find-hit focus-ring"
                  data-active={index === activeIndex ? "true" : undefined}
                  aria-current={index === activeIndex ? "true" : undefined}
                  onClick={() => onSelectHit(index)}
                >
                  <span className="cave-find-hit__who">
                    {/* Non-interactive avatars only: the whole row is already
                        a button, and UserChatAvatar is itself a button that
                        navigates to settings — nesting it would be invalid
                        markup and would steal the row's click. */}
                    {hit.role === "user" ? (
                      <span className="cave-find-hit__initial" aria-hidden>
                        {operatorName.trim().charAt(0).toUpperCase() || "?"}
                      </span>
                    ) : (
                      <FamiliarIcon familiar={familiar} size="sm" />
                    )}
                    <span
                      className="cave-find-hit__name"
                      data-role={hit.role}
                    >
                      {hit.role === "user" ? operatorName : familiar.display_name}
                    </span>
                  </span>
                  <HitText hit={hit} />
                  <span className="cave-find-hit__where">
                    {/* Where in the thread, and which hit inside that turn when
                        the turn holds more than one. */}
                    <span className="cave-find-hit__step">#{hit.turnIndex + 1}</span>
                    {hit.occurrencesInTurn > 1 ? (
                      <span className="cave-find-hit__nth">
                        {hit.occurrenceInTurn}/{hit.occurrencesInTurn}
                      </span>
                    ) : null}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <div className="cave-find-band__empty" role="status">
            <span className="cave-find-band__empty-title">No matches in this chat</span>
            {/* Only offer to relax a filter that is actually on — suggesting
                "turn off Match case" when it is already off is noise. ⌘K is a
                hint, not a control: the palette is the workspace's own state
                and the shortcut already works from here. */}
            <span className="cave-find-band__empty-hint">
              {matchCase || wholeWord ? (
                <>
                  Try turning off{" "}
                  {matchCase ? (
                    <button type="button" className="cave-find-band__link focus-ring" onClick={onToggleMatchCase}>
                      Match case
                    </button>
                  ) : null}
                  {matchCase && wholeWord ? " or " : null}
                  {wholeWord ? (
                    <button type="button" className="cave-find-band__link focus-ring" onClick={onToggleWholeWord}>
                      Whole word
                    </button>
                  ) : null}
                  , or search every session with <kbd className="cave-find-band__kbd">⌘K</kbd>.
                </>
              ) : (
                <>
                  Search every session instead with{" "}
                  <kbd className="cave-find-band__kbd">⌘K</kbd>.
                </>
              )}
            </span>
          </div>
        )
      ) : null}
    </div>
  );
}
