"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/lib/icon";
import type { Card } from "@/lib/cave-board-types";
import type { Familiar } from "@/lib/types";
import { parseBoardSearchQuery } from "@/lib/board-search";

/** A committed filter chip (key:value) shown inside the search field. */
type Chip = { key: string; value: string };

/** Search keys the token composer offers as typeahead. Mirrors the vocabulary
 *  `cardMatchesBoardSearch` understands, so every suggested chip is a real,
 *  applied filter — not decoration. Value lists are derived from live board
 *  data where the set is dynamic (familiar, cwd) and pinned where it's a fixed
 *  enum (is, priority, status). */
const SEARCH_KEYS: { key: string; label: string; staticOpts?: string[] }[] = [
  { key: "is", label: "Task state", staticOpts: ["open", "closed"] },
  { key: "priority", label: "Priority", staticOpts: ["urgent", "high", "medium", "low"] },
  { key: "status", label: "Bucket", staticOpts: ["backlog", "inbox", "running", "review", "blocked", "done"] },
  { key: "familiar", label: "Familiar" },
  { key: "cwd", label: "Working dir" },
  { key: "url", label: "Source", staticOpts: ["github", "linear", "portal"] },
];
const KNOWN_KEYS = new Set(SEARCH_KEYS.map((k) => k.key));

/** Rebuild the flat query string the board filter consumes from the chips plus
 *  whatever free text is still in the input. Chips carry a quoted value when it
 *  contains whitespace so the tokenizer keeps them whole. */
function composeQuery(chips: Chip[], text: string): string {
  const chipStr = chips
    .map((c) => `${c.key}:${/\s/.test(c.value) ? `"${c.value}"` : c.value}`)
    .join(" ");
  return `${chipStr} ${text}`.trim();
}

/** Decompose an incoming query string into committed chips (known keys) and the
 *  leftover free text. Unknown keys stay in the free text so nothing is lost. */
function decompose(query: string): { chips: Chip[]; text: string } {
  const chips: Chip[] = [];
  const free: string[] = [];
  for (const tok of parseBoardSearchQuery(query)) {
    if (tok.key && KNOWN_KEYS.has(tok.key) && !tok.negated) {
      chips.push({ key: tok.key, value: tok.value });
    } else {
      free.push(tok.negated ? `-${tok.key ? `${tok.key}:` : ""}${tok.value}` : `${tok.key ? `${tok.key}:` : ""}${tok.value}`);
    }
  }
  return { chips, text: free.join(" ") };
}

type Props = {
  value: string;
  onChange: (query: string) => void;
  familiars: Familiar[];
  cards: Card[];
  inputRef?: React.RefObject<HTMLInputElement | null>;
};

export function BoardTokenSearch({ value, onChange, familiars, cards, inputRef }: Props) {
  const localRef = useRef<HTMLInputElement>(null);
  const ref = inputRef ?? localRef;
  const [inputText, setInputText] = useState("");
  const [open, setOpen] = useState(false);

  // The parent's query string is the single source of truth; chips are derived
  // from it so an external clear (Escape / clear button) collapses them too.
  const { chips } = useMemo(() => decompose(value), [value]);

  // When the query is cleared from outside, drop any half-typed free text too.
  useEffect(() => {
    if (value === "") setInputText("");
  }, [value]);

  const commit = useCallback(
    (nextChips: Chip[], nextText: string) => {
      onChange(composeQuery(nextChips, nextText));
    },
    [onChange],
  );

  const addChip = useCallback(
    (key: string, val: string) => {
      const exists = chips.some((c) => c.key === key && c.value === val.toLowerCase());
      const next = exists ? chips : [...chips, { key, value: val.toLowerCase() }];
      setInputText("");
      commit(next, "");
      setOpen(false);
      requestAnimationFrame(() => ref.current?.focus());
    },
    [chips, commit, ref],
  );

  const removeChip = useCallback(
    (idx: number) => {
      commit(chips.filter((_, i) => i !== idx), inputText);
    },
    [chips, inputText, commit],
  );

  const onInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const text = e.target.value;
    setInputText(text);
    setOpen(true);
    commit(chips, text);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      if (open) { setOpen(false); return; }
      if (inputText || chips.length) { e.preventDefault(); setInputText(""); onChange(""); }
    } else if (e.key === "Backspace" && inputText === "" && chips.length) {
      e.preventDefault();
      removeChip(chips.length - 1);
    }
  };

  // Suggestions: when the input looks like `key:partial`, offer that key's
  // values; otherwise offer the keys themselves (filtered by the typed prefix).
  const suggestions = useMemo(() => {
    const match = /^\s*([a-zA-Z]+):(.*)$/.exec(inputText);
    if (match && KNOWN_KEYS.has(match[1].toLowerCase())) {
      const key = match[1].toLowerCase();
      const part = match[2].trim().toLowerCase();
      const cfg = SEARCH_KEYS.find((k) => k.key === key)!;
      let opts = cfg.staticOpts ?? [];
      if (key === "familiar") {
        opts = familiars.map((f) => f.display_name || f.name || f.id).filter(Boolean) as string[];
      } else if (key === "cwd") {
        opts = [...new Set(cards.map((c) => c.cwd).filter(Boolean) as string[])].map((p) => {
          const seg = p.split("/").filter(Boolean).pop();
          return seg ?? p;
        });
        opts = [...new Set(opts)];
      }
      return {
        label: cfg.label,
        items: opts
          .filter((o) => o.toLowerCase().includes(part))
          .slice(0, 8)
          .map((o) => ({ tag: `${key}:${o}`, label: cfg.label, onPick: () => addChip(key, o) })),
      };
    }
    const word = inputText.trim().toLowerCase();
    return {
      label: "Filter by",
      items: SEARCH_KEYS.filter((k) => !word || k.key.startsWith(word)).map((k) => ({
        tag: `${k.key}:`,
        label: k.label,
        onPick: () => { setInputText(`${k.key}:`); setOpen(true); requestAnimationFrame(() => ref.current?.focus()); },
      })),
    };
  }, [inputText, familiars, cards, addChip, ref]);

  const showSuggest = open && suggestions.items.length > 0;

  return (
    <div className="board-token-search">
      {showSuggest ? <div className="board-token-search-scrim" onClick={() => setOpen(false)} /> : null}
      <div className="board-token-field">
        <Icon name="ph:magnifying-glass" width={15} className="board-token-search-icon" />
        <label className="sr-only" htmlFor="board-search">Search tasks</label>
        {chips.map((chip, i) => (
          <span key={`${chip.key}:${chip.value}`} className="board-token-chip">
            <span className="board-token-chip-key">{chip.key}:</span>
            {chip.value}
            <button
              type="button"
              className="board-token-chip-remove"
              onClick={() => removeChip(i)}
              aria-label={`Remove ${chip.key} filter`}
            >
              <Icon name="ph:x-bold" width={10} />
            </button>
          </span>
        ))}
        <input
          ref={ref}
          id="board-search"
          className="board-token-input"
          value={inputText}
          onChange={onInput}
          onKeyDown={onKeyDown}
          onFocus={() => setOpen(true)}
          placeholder={chips.length ? "Add filter…" : "Search tasks or type is:open cwd:coven-cave url:github"}
        />
        <kbd aria-hidden className="board-token-kbd">/</kbd>
      </div>
      {showSuggest ? (
        <div className="board-token-suggest" role="listbox" aria-label="Search suggestions">
          <div className="board-token-suggest-label">{suggestions.label}</div>
          {suggestions.items.map((opt) => (
            <button key={opt.tag} type="button" className="board-token-suggest-item" onClick={opt.onPick}>
              <span className="board-token-suggest-tag">{opt.tag}</span>
              <span className="board-token-suggest-desc">{opt.label}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
