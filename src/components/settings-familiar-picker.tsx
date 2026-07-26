"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from "react";
import { FamiliarAvatar } from "@/components/familiar-avatar";
import { Button } from "@/components/ui/button";
import { Popover } from "@/components/ui/popover";
import { Icon } from "@/lib/icon";
import type { ResolvedFamiliar } from "@/lib/familiar-resolve";
import {
  familiarRosterCountLabel,
  filterSettingsFamiliars,
  moveFamiliarPickerIndex,
} from "@/lib/settings-familiar-picker";

type Props = {
  familiars: ResolvedFamiliar[];
  value: string | null;
  onChange: (id: string) => void;
  onSummon?: () => void;
};

const LISTBOX_ID = "settings-familiar-picker-listbox";
const OPTION_ID_PREFIX = "settings-familiar-picker-option-";

function optionId(index: number): string {
  return OPTION_ID_PREFIX + index;
}

export function SettingsFamiliarPicker({ familiars, value, onChange, onSummon }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const active = useMemo(
    () => familiars.find((familiar) => familiar.id === value) ?? null,
    [familiars, value],
  );
  const filtered = useMemo(
    () => filterSettingsFamiliars(familiars, query),
    [familiars, query],
  );
  const rosterCount = familiarRosterCountLabel(familiars.length);

  const resetAndClose = () => {
    setOpen(false);
    setQuery("");
    setHighlightedIndex(-1);
  };

  const updateOpen = (next: boolean) => {
    if (!next) {
      resetAndClose();
      return;
    }
    setQuery("");
    const selectedIndex = familiars.findIndex((familiar) => familiar.id === value);
    setHighlightedIndex(selectedIndex >= 0 ? selectedIndex : familiars.length > 0 ? 0 : -1);
    setOpen(true);
  };

  const selectFamiliar = (id: string) => {
    onChange(id);
    resetAndClose();
  };

  useEffect(() => {
    if (!open) return;
    searchRef.current?.focus({ preventScroll: true });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setHighlightedIndex((current) => {
      if (filtered.length === 0) return -1;
      if (current < 0) return 0;
      return Math.min(current, filtered.length - 1);
    });
  }, [filtered.length, open]);

  useEffect(() => {
    if (!open || highlightedIndex < 0) return;
    optionRefs.current[highlightedIndex]?.scrollIntoView({ block: "nearest" });
  }, [filtered, highlightedIndex, open]);

  const handleQueryChange = (nextQuery: string) => {
    setQuery(nextQuery);
    const nextFiltered = filterSettingsFamiliars(familiars, nextQuery);
    const selectedIndex = nextFiltered.findIndex((familiar) => familiar.id === value);
    setHighlightedIndex(selectedIndex >= 0 ? selectedIndex : nextFiltered.length > 0 ? 0 : -1);
  };

  const handleSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const key = event.key;
    if (key === "ArrowDown" || key === "ArrowUp") {
      event.preventDefault();
      setHighlightedIndex((current) =>
        moveFamiliarPickerIndex(current, key, filtered.length),
      );
      return;
    }
    if (event.key === "Enter") {
      const familiar = filtered[highlightedIndex];
      if (!familiar) return;
      event.preventDefault();
      selectFamiliar(familiar.id);
    }
  };

  const activeDescendant =
    highlightedIndex >= 0 && filtered[highlightedIndex]
      ? optionId(highlightedIndex)
      : undefined;
  const triggerLabel = active
    ? "Choose familiar to edit. Current: " + active.display_name + ". " + rosterCount + "."
    : "Choose familiar to edit. " + rosterCount + ".";
  const resultSummary = query.trim()
    ? filtered.length + " of " + rosterCount
    : rosterCount;

  return (
    <div className="familiar-studio-inline__selector">
      <span className="familiar-studio-inline__selector-label" id="settings-familiar-picker-label">
        Familiar
      </span>
      <button
        ref={triggerRef}
        type="button"
        className="familiar-studio-picker__trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={triggerLabel}
        onClick={() => updateOpen(!open)}
        style={
          active
            ? ({ ["--familiar-accent"]: active.color } as CSSProperties)
            : undefined
        }
      >
        <span className="familiar-studio-picker__trigger-avatar" aria-hidden>
          {active ? (
            <FamiliarAvatar familiar={active} size="md" />
          ) : (
            <Icon name="ph:sparkle" width={16} />
          )}
        </span>
        <span className="familiar-studio-picker__trigger-copy">
          <span className="familiar-studio-picker__trigger-name">
            {active?.display_name ?? "Select a familiar"}
          </span>
          <span className="familiar-studio-picker__trigger-role">
            {active?.role || active?.id || "Choose who to edit"}
          </span>
        </span>
        <span className="familiar-studio-picker__trigger-count">{rosterCount}</span>
        <Icon
          name="ph:caret-up-down-bold"
          width={12}
          className="familiar-studio-picker__trigger-caret"
          aria-hidden
        />
      </button>

      <Popover
        open={open}
        onOpenChange={updateOpen}
        anchorRef={triggerRef}
        placement="bottom-start"
        minWidth={240}
        scrollStrategy="content"
        compactAtHeight={184}
        className="familiar-studio-picker__popover"
        ariaLabel="Choose familiar to edit"
      >
        <div className="familiar-studio-picker">
          <div className="familiar-studio-picker__search-shell">
            <Icon name="ph:magnifying-glass" width={14} aria-hidden />
            <input
              ref={searchRef}
              type="search"
              value={query}
              onChange={(event) => handleQueryChange(event.target.value)}
              onKeyDown={handleSearchKeyDown}
              role="combobox"
              aria-label="Search familiars"
              aria-expanded={open}
              aria-autocomplete="list"
              aria-controls={LISTBOX_ID}
              aria-activedescendant={activeDescendant}
              autoComplete="off"
              placeholder="Search name, role, or ID…"
              className="familiar-studio-picker__search"
            />
          </div>
          <div className="familiar-studio-picker__result-summary" aria-live="polite">
            {resultSummary}
          </div>

          <ul
            id={LISTBOX_ID}
            className="familiar-studio-picker__results"
            role="listbox"
            aria-label="Familiars"
          >
            {filtered.map((familiar, index) => {
              const selected = familiar.id === value;
              const highlighted = index === highlightedIndex;
              return (
                <li key={familiar.id} role="presentation">
                  <button
                    ref={(node) => {
                      optionRefs.current[index] = node;
                    }}
                    id={optionId(index)}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    tabIndex={-1}
                    data-selected={selected || undefined}
                    data-highlighted={highlighted || undefined}
                    className="familiar-studio-picker__option"
                    style={{ ["--familiar-accent"]: familiar.color } as CSSProperties}
                    onMouseEnter={() => setHighlightedIndex(index)}
                    onClick={() => selectFamiliar(familiar.id)}
                    title={familiar.display_name + " — " + (familiar.role || familiar.id)}
                  >
                    <span className="familiar-studio-picker__option-avatar" aria-hidden>
                      <FamiliarAvatar familiar={familiar} size="sm" />
                    </span>
                    <span className="familiar-studio-picker__option-copy">
                      <span className="familiar-studio-picker__option-name">
                        {familiar.display_name}
                      </span>
                      <span className="familiar-studio-picker__option-meta">
                        {familiar.role ? familiar.role + " · " : ""}
                        <span>{familiar.id}</span>
                      </span>
                    </span>
                    {selected ? <Icon name="ph:check-bold" width={13} aria-hidden /> : null}
                  </button>
                </li>
              );
            })}
            {filtered.length === 0 ? (
              <li className="familiar-studio-picker__empty" role="presentation">
                No familiars match “{query.trim()}”.
              </li>
            ) : null}
          </ul>

          {onSummon ? (
            <div className="familiar-studio-picker__footer">
              <Button
                variant="primary"
                size="lg"
                fullWidth
                className="familiar-studio-picker__summon"
                onClick={() => {
                  resetAndClose();
                  onSummon();
                }}
                leadingIcon="ph:magic-wand-fill"
              >
                Summon familiar
              </Button>
            </div>
          ) : null}
        </div>
      </Popover>
    </div>
  );
}
