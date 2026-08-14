"use client";

/**
 * Draft with <familiar> — scope chips, the draft CTA, and the draft itself with
 * use / re-roll / discard, as one accordion section of the composer sheet.
 *
 * Presentation only, and that is load-bearing here: the draft has nowhere to go
 * but the textarea. `onUseDraft` hands it to the parent's own draft state, and
 * the write routes live in `github-card-composer.tsx`, so no callback on this
 * component can post a familiar's words to GitHub.
 */

import { Icon } from "@/lib/icon";
import { type GhDraftScopes } from "@/lib/gh-review-draft";

export type FamiliarSectionProps = {
  /** True when this section owns the sheet's single open slot. */
  expanded: boolean;
  onToggle: () => void;
  familiarName: string;
  /** Header line: drafting / ready / what it may read. */
  summary: string;
  drafting: boolean;
  /** null → the scope picker; a string (even empty, mid-stream) → the draft. */
  draft: string | null;
  error: string | null;
  scopes: GhDraftScopes;
  /** Which scopes to offer, already labelled for this item. */
  scopeChoices: [keyof GhDraftScopes, string][];
  onToggleScope: (key: keyof GhDraftScopes) => void;
  onDraft: () => void;
  onUseDraft: () => void;
  onDiscardDraft: () => void;
};

export function FamiliarSection({
  expanded,
  onToggle,
  familiarName,
  summary,
  drafting,
  draft,
  error,
  scopes,
  scopeChoices,
  onToggleScope,
  onDraft,
  onUseDraft,
  onDiscardDraft,
}: FamiliarSectionProps) {
  return (
    <>
      <button
        type="button"
        className="ghc-sec focus-ring"
        aria-expanded={expanded}
        aria-label={`Draft with the ${familiarName} familiar`}
        onClick={onToggle}
      >
        <span aria-hidden className={`ghc-sec__caret${expanded ? " ghc-sec__caret--open" : ""}`}>
          <Icon name="ph:caret-right" width={11} />
        </span>
        <span aria-hidden className="ghc-sec__icon ghc-sec__accent">
          <Icon name="ph:brain" width={13} />
        </span>
        <span className="ghc-sec__title">
          Draft with <span className="ghc-sec__accent">{familiarName}</span>
        </span>
        <span className="ghc-sec__summary">
          <span className={draft ? "ghc-sec__accent" : undefined}>{summary}</span>
        </span>
      </button>
      {expanded ? (
        <div className="ghc-body ghc-body--roomy ghc-body--familiar">
          {draft == null ? (
            <div className="ghc-scopes">
              <span className="ghc-field__label">scope</span>
              {scopeChoices.map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  className={`ghc-scope focus-ring${scopes[key] ? " ghc-scope--on" : ""}`}
                  aria-pressed={scopes[key]}
                  onClick={() => onToggleScope(key)}
                >
                  {label}
                </button>
              ))}
              <button type="button" className="ghc-draft-cta focus-ring" onClick={onDraft} disabled={drafting}>
                <Icon name="ph:sparkle" width={12} aria-hidden />
                {drafting ? "Drafting…" : "Draft the review"}
              </button>
            </div>
          ) : (
            <>
              <div className="ghc-draft-box">{draft || "…"}</div>
              <div className="ghc-draft-foot">
                <span className="ghc-draft-note">never auto-sent</span>
                <button
                  type="button"
                  className="ghc-draft-use focus-ring"
                  onClick={onUseDraft}
                  disabled={drafting || !draft}
                >
                  Use as my reply
                </button>
                <button type="button" className="ghc-draft-alt focus-ring" onClick={onDraft} disabled={drafting}>
                  <Icon name="ph:arrows-clockwise" width={10} aria-hidden />
                  Re-roll
                </button>
                <button
                  type="button"
                  className="ghc-draft-drop focus-ring"
                  aria-label="Discard the draft"
                  onClick={onDiscardDraft}
                >
                  <Icon name="ph:x" width={10} aria-hidden />
                </button>
              </div>
            </>
          )}
          {error ? (
            <span className="ghc-nudge" role="alert">
              {error}
            </span>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
