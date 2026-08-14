"use client";

import {
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from "react";

import { FamiliarAvatar } from "@/components/familiar-avatar";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { useAnnouncer } from "@/components/ui/live-region";
import { SearchInput } from "@/components/ui/search-input";
import {
  archiveFamiliar,
  unarchiveFamiliar,
} from "@/lib/cave-familiar-archive";
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
  /** Opens the selected familiar's existing undo-safe lifecycle controls. */
  onManageLifecycle?: (id: string) => void;
};

export function SettingsFamiliarPicker({
  familiars,
  value,
  onChange,
  onSummon,
  onManageLifecycle,
}: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const [query, setQuery] = useState("");
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const { announce } = useAnnouncer();

  const filtered = useMemo(
    () => filterSettingsFamiliars(familiars, query),
    [familiars, query],
  );
  const rosterCount = familiarRosterCountLabel(familiars.length);

  const moveFocus = (
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    event.stopPropagation();
    const next = moveFamiliarPickerIndex(index, event.key, filtered.length);
    optionRefs.current[next]?.focus();
  };

  return (
    <aside
      className="settings-familiar-roster"
      data-collapsed={collapsed || undefined}
      aria-label="Familiar roster"
    >
      <div className="settings-familiar-roster__header">
        <div className="settings-familiar-roster__heading">
          <span>Familiars</span>
          <span className="settings-familiar-roster__count">{familiars.length}</span>
        </div>
        {onSummon ? (
          <IconButton
            icon="ph:plus"
            size="sm"
            className="settings-familiar-roster__summon focus-ring"
            aria-label="Summon familiar"
            title="Summon familiar"
            onClick={onSummon}
          />
        ) : null}
        <IconButton
          icon="ph:sidebar-simple"
          size="sm"
          className="settings-familiar-roster__collapse focus-ring"
          aria-label={collapsed ? "Expand familiar list" : "Collapse familiar list"}
          title={collapsed ? "Expand familiar list" : "Collapse familiar list"}
          onClick={() => setCollapsed((current) => !current)}
        />
      </div>

      <SearchInput
        value={query}
        onValueChange={setQuery}
        onClear={() => setQuery("")}
        placeholder="Find a familiar…"
        aria-label="Find a familiar"
        containerClassName="settings-familiar-roster__search"
      />

      <div className="settings-familiar-roster__summary" aria-live="polite">
        {query.trim()
          ? `${filtered.length} of ${rosterCount}`
          : rosterCount}
      </div>

      <ul
        className="settings-familiar-roster__list"
        aria-label="Familiars"
      >
        {filtered.map((familiar, index) => {
          const selected = familiar.id === value;
          return (
            <li
              key={familiar.id}
              className="settings-familiar-roster__row reveal-scope"
              style={{ ["--familiar-accent"]: familiar.color } as CSSProperties}
              data-selected={selected || undefined}
              data-archived={familiar.archived || undefined}
            >
              <Button
                ref={(node) => {
                  optionRefs.current[index] = node;
                }}
                variant="ghost"
                fullWidth
                aria-current={selected ? "page" : undefined}
                className="settings-familiar-roster__option focus-ring"
                title={`${familiar.display_name} — ${familiar.role || familiar.id}`}
                onClick={() => onChange(familiar.id)}
                onKeyDown={(event) => moveFocus(event, index)}
              >
                <span className="settings-familiar-roster__avatar" aria-hidden>
                  <FamiliarAvatar
                    familiar={familiar}
                    size="md"
                    className="settings-familiar-roster__avatar-image"
                  />
                </span>
                <span className="settings-familiar-roster__copy">
                  <span className="settings-familiar-roster__name">
                    {familiar.display_name}
                  </span>
                  <span className="settings-familiar-roster__role">
                    {familiar.role || familiar.id}
                  </span>
                </span>
                <span className="sr-only">
                  {familiar.archived ? "Archived. " : ""}
                  Status: {familiar.status || "unknown"}
                </span>
              </Button>

              <span
                className="settings-familiar-roster__presence"
                data-status={familiar.status || "unknown"}
                title={familiar.status ? `Status: ${familiar.status}` : "Status unknown"}
                aria-hidden
              />

              <span className="settings-familiar-roster__actions reveal-on-hover">
                <IconButton
                  icon={familiar.archived ? "ph:arrow-counter-clockwise" : "ph:archive"}
                  size="xs"
                  aria-label={`${familiar.archived ? "Unarchive" : "Archive"} ${familiar.display_name}`}
                  title={familiar.archived
                    ? "Unarchive — return to active switchers"
                    : "Archive — hide from switchers; restore from this roster"}
                  onClick={() => {
                    familiar.archived
                      ? unarchiveFamiliar(familiar.id)
                      : archiveFamiliar(familiar.id);
                    announce(
                      `${familiar.archived ? "Unarchived" : "Archived"} ${familiar.display_name}.`,
                    );
                  }}
                />
                {onManageLifecycle ? (
                  <IconButton
                    icon="ph:trash"
                    size="xs"
                    danger
                    aria-label={`Dismiss ${familiar.display_name}`}
                    title="Dismiss — review the undo-safe remove controls"
                    onClick={() => {
                      onChange(familiar.id);
                      onManageLifecycle(familiar.id);
                    }}
                  />
                ) : null}
              </span>
            </li>
          );
        })}
        {filtered.length === 0 ? (
          <li className="settings-familiar-roster__empty" role="presentation">
            No familiar matches that.
          </li>
        ) : null}
      </ul>
    </aside>
  );
}
