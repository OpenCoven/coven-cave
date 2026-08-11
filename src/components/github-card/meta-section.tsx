"use client";

/**
 * Assignees & labels — the chips, their add buttons and both pickers, as one
 * accordion section of the composer sheet.
 *
 * Presentation only. Chips are rendered from the parent's optimistic arrays and
 * every tap is a callback, so `PATCH /api/github/issue` and the
 * "server truth wins unless a picker is open" rule stay in
 * `github-card-composer.tsx`.
 */

import { Icon } from "@/lib/icon";

export type MetaSectionProps = {
  /** True when this section owns the sheet's single open slot. */
  expanded: boolean;
  onToggle: () => void;
  /** The optimistic assignee logins. */
  people: string[];
  /** The optimistic label names. */
  labels: string[];
  peopleSummary: string;
  labelSummary: string;
  /** Which picker is open, if either. */
  pick: "" | "people" | "labels";
  onTogglePick: (which: "people" | "labels") => void;
  /** Who can be assigned — author plus current assignees. */
  roster: { login: string; role: string }[];
  /** The repo's labels when they arrived, else the item's own. */
  labelPalette: { name: string; color: string }[];
  /** Hex (no `#`) for an applied label, from whichever source knows it. */
  labelColor: (name: string) => string | undefined;
  onTogglePerson: (login: string) => void;
  onToggleLabel: (name: string) => void;
};

export function MetaSection({
  expanded,
  onToggle,
  people,
  labels,
  peopleSummary,
  labelSummary,
  pick,
  onTogglePick,
  roster,
  labelPalette,
  labelColor,
  onTogglePerson,
  onToggleLabel,
}: MetaSectionProps) {
  return (
    <>
      <button
        type="button"
        className="ghc-sec focus-ring"
        aria-expanded={expanded}
        aria-label="Assignees and labels"
        onClick={onToggle}
      >
        <span aria-hidden className={`ghc-sec__caret${expanded ? " ghc-sec__caret--open" : ""}`}>
          <Icon name="ph:caret-right" width={11} />
        </span>
        <span aria-hidden className="ghc-sec__icon">
          <Icon name="ph:tag" width={13} />
        </span>
        <span className="ghc-sec__title">Assignees &amp; labels</span>
        <span className="ghc-sec__summary">
          <span>{peopleSummary}</span>
          <span>{labelSummary}</span>
        </span>
      </button>
      {expanded ? (
        <div className="ghc-body ghc-body--roomy">
          <div className="ghc-field">
            <span className="ghc-field__label">assignees</span>
            <div className="ghc-field__body">
              {people.map((p) => (
                <span key={p} className="ghc-chip">
                  <span aria-hidden className="ghc-avatar">
                    {p.slice(0, 1).toUpperCase()}
                  </span>
                  {p}
                  <button
                    type="button"
                    className="ghc-chip__x focus-ring"
                    onClick={() => onTogglePerson(p)}
                    aria-label={`Unassign ${p}`}
                  >
                    <Icon name="ph:x" width={8} aria-hidden />
                  </button>
                </span>
              ))}
              <button
                type="button"
                className="ghc-add focus-ring"
                aria-expanded={pick === "people"}
                onClick={() => onTogglePick("people")}
              >
                <Icon name="ph:plus" width={9} aria-hidden />
                add
              </button>
              {pick === "people" ? (
                <div className="ghc-picker">
                  <div className="ghc-pal__label">PEOPLE</div>
                  <div className="ghc-pal__rows">
                    {roster.map((p) => (
                      <button
                        key={p.login}
                        type="button"
                        className={`ghc-pal__row ghc-pal__row--person focus-ring${people.includes(p.login) ? " ghc-pal__row--active" : ""}`}
                        onClick={() => onTogglePerson(p.login)}
                      >
                        <span aria-hidden className="ghc-avatar">
                          {p.login.slice(0, 1).toUpperCase()}
                        </span>
                        <span className="ghc-pal__name">{p.login}</span>
                        <span className="ghc-pal__role">{p.role}</span>
                        <span className="ghc-pal__state">{people.includes(p.login) ? "assigned" : ""}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
          <div className="ghc-field">
            <span className="ghc-field__label">labels</span>
            <div className="ghc-field__body">
              {labels.map((name) => {
                const hex = labelColor(name);
                return (
                  <span key={name} className="ghc-chip ghc-chip--label">
                    <span aria-hidden className="ghc-chip__dot" style={hex ? { background: `#${hex}` } : undefined} />
                    {name}
                    <button
                      type="button"
                      className="ghc-chip__x focus-ring"
                      onClick={() => onToggleLabel(name)}
                      aria-label={`Remove label ${name}`}
                    >
                      <Icon name="ph:x" width={8} aria-hidden />
                    </button>
                  </span>
                );
              })}
              <button
                type="button"
                className="ghc-add ghc-add--label focus-ring"
                aria-expanded={pick === "labels"}
                onClick={() => onTogglePick("labels")}
              >
                <Icon name="ph:plus" width={9} aria-hidden />
                add
              </button>
              {pick === "labels" ? (
                <div className="ghc-picker">
                  <div className="ghc-pal__label">REPO LABELS</div>
                  <div className="ghc-pal__rows">
                    {labelPalette.map((l) => (
                      <button
                        key={l.name}
                        type="button"
                        className={`ghc-pal__row ghc-pal__row--person focus-ring${labels.includes(l.name) ? " ghc-pal__row--active" : ""}`}
                        onClick={() => onToggleLabel(l.name)}
                      >
                        <span
                          aria-hidden
                          className="ghc-chip__dot"
                          style={l.color ? { background: `#${l.color}` } : undefined}
                        />
                        <span className="ghc-pal__name">{l.name}</span>
                        <span className="ghc-pal__state">{labels.includes(l.name) ? "applied" : ""}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
