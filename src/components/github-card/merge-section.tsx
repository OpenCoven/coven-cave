"use client";

/**
 * Merge — method, branch tidy, commit preview and the arm field, as one
 * accordion section of the composer sheet.
 *
 * Presentation only. The arm field reports its keystrokes upward and nothing
 * else: the "does this literally read merge" decision and the `/api/github/merge`
 * call both stay in `github-card-composer.tsx`, so the one irreversible verb has
 * exactly one gate.
 */

import { Icon } from "@/lib/icon";
import { METHOD_LABEL, segTight, type Method } from "@/components/github-card/shared";

export type MergeSectionProps = {
  /** True when this section owns the sheet's single open slot. */
  expanded: boolean;
  onToggle: () => void;
  method: Method;
  onSelectMethod: (method: Method) => void;
  baseRef: string;
  /** What the chosen method does to the history, in words. */
  commitSummary: string;
  /** Absent → no branch to tidy, so the switch is omitted. */
  headRef: string | null;
  deleteBranch: boolean;
  onToggleDeleteBranch: () => void;
  /** The commit subject GitHub will write, previewed. */
  commitTitle: string;
  arm: string;
  onArmChange: (value: string) => void;
  /** The arm field agrees — the footer CTA is live. */
  armed: boolean;
  /** The user tried to merge unarmed; flash the field. */
  nudged: boolean;
  armRef: React.RefObject<HTMLInputElement | null>;
};

export function MergeSection({
  expanded,
  onToggle,
  method,
  onSelectMethod,
  baseRef,
  commitSummary,
  headRef,
  deleteBranch,
  onToggleDeleteBranch,
  commitTitle,
  arm,
  onArmChange,
  armed,
  nudged,
  armRef,
}: MergeSectionProps) {
  return (
    <>
      <button
        type="button"
        className="ghc-sec focus-ring"
        aria-expanded={expanded}
        aria-label="Merge — method, commit and branch"
        onClick={onToggle}
      >
        <span aria-hidden className={`ghc-sec__caret${expanded ? " ghc-sec__caret--open" : ""}`}>
          <Icon name="ph:caret-right" width={11} />
        </span>
        <span aria-hidden className="ghc-sec__icon">
          <Icon name="ph:git-merge" width={13} />
        </span>
        <span className="ghc-sec__title">Merge</span>
        <span className="ghc-sec__summary">
          <span>
            {METHOD_LABEL[method]} → {baseRef}
          </span>
          <span>{commitSummary}</span>
          <span>{deleteBranch ? "delete branch" : "keep branch"}</span>
        </span>
      </button>
      {expanded ? (
        <div className="ghc-body ghc-body--roomy">
          <div className="ghc-row">
            <div className="ghc-seg ghc-seg--sunken">
              {(["squash", "merge", "rebase"] as Method[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  className={segTight(method === m)}
                  onClick={() => onSelectMethod(m)}
                  aria-pressed={method === m}
                >
                  {m === "squash" ? "Squash" : m === "merge" ? "Merge commit" : "Rebase"}
                </button>
              ))}
            </div>
            {headRef ? (
              <button
                type="button"
                className="ghc-switch focus-ring"
                aria-pressed={deleteBranch}
                aria-label={`Delete ${headRef} after merging`}
                onClick={onToggleDeleteBranch}
              >
                <span aria-hidden className={`ghc-switch__track${deleteBranch ? " ghc-switch__track--on" : ""}`}>
                  <span className="ghc-switch__knob" />
                </span>
                delete <span className="ghc-switch__branch">{headRef}</span>
              </button>
            ) : null}
          </div>
          <div className="ghc-commit">
            <div className="ghc-commit__head">
              <span className="ghc-commit__eyebrow">COMMIT</span>
              <span className="ghc-commit__method">{METHOD_LABEL[method]}</span>
            </div>
            <div className="ghc-commit__title">{commitTitle}</div>
          </div>
          <div className={`ghc-arm${nudged ? " ghc-arm--nudged" : ""}`}>
            <span className="ghc-arm__label">type</span>
            <span className="ghc-arm__word">merge</span>
            <span className="ghc-arm__label">to arm</span>
            <input
              ref={armRef}
              className="ghc-arm__input focus-ring"
              value={arm}
              onChange={(e) => onArmChange(e.target.value)}
              placeholder="…"
              aria-label="Type merge to arm the merge button"
            />
            {armed ? (
              <span aria-hidden className="ghc-arm__ok">
                <Icon name="ph:check" width={12} />
              </span>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
}
