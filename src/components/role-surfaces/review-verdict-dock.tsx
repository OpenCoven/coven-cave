"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Modal } from "@/components/ui/modal";
import { Icon } from "@/lib/icon";
import { GITHUB_REVIEW_BODY_MAX_LENGTH } from "@/lib/github/github-review";
import {
  draftChangeRequest,
  evidenceItems,
  mergeChecklist,
  type Blocker,
  type PrFacts,
} from "./review-readiness";

type ReviewMode = "approve" | "changes";

export function ReviewVerdictDock({
  selectionKey,
  selected,
  isPr,
  facts,
  canAct,
  ready,
  blockers,
  busy,
  actionError,
  note,
  noteError,
  reviewedCount,
  readableCount,
  onNote,
  onFocusBlockers,
  onApprove,
  onRequestChanges,
  onMerge,
}: {
  selectionKey: string;
  selected: boolean;
  isPr: boolean;
  facts: PrFacts | null;
  canAct: boolean;
  ready: boolean;
  blockers: readonly Blocker[];
  busy: "approve" | "changes" | "merge" | null;
  actionError: string | null;
  note: string;
  noteError: string | null;
  reviewedCount: number;
  readableCount: number;
  onNote: (value: string) => void;
  onFocusBlockers: () => void;
  onApprove: () => Promise<boolean>;
  onRequestChanges: () => Promise<boolean>;
  onMerge: () => Promise<boolean>;
}) {
  const [reviewMode, setReviewMode] = useState<ReviewMode | null>(null);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [evidenceOff, setEvidenceOff] = useState<Record<string, boolean>>({});
  const [evidenceExpanded, setEvidenceExpanded] = useState(false);
  const noteRef = useRef<HTMLTextAreaElement | null>(null);
  const evidence = useMemo(() => evidenceItems(facts), [facts]);
  const keptEvidence = useMemo(
    () => evidence.filter((item) => !evidenceOff[item.key]),
    [evidence, evidenceOff],
  );

  useEffect(() => {
    setReviewMode(null);
    setMergeOpen(false);
    setEvidenceOff({});
    setEvidenceExpanded(false);
  }, [selectionKey]);
  useEffect(() => {
    if (noteError && reviewMode != null) noteRef.current?.focus();
  }, [noteError, reviewMode]);

  const latestReview =
    facts?.latestReview?.state === "APPROVED"
      ? `Approved · @${facts.latestReview.author}`
      : facts?.latestReview?.state === "CHANGES_REQUESTED"
        ? `Changes requested · @${facts.latestReview.author}`
        : "No submitted review";
  const mergeTitle = !isPr
    ? "A pull request is required to merge."
    : facts?.draft
      ? "Draft pull requests can't be merged."
      : blockers.length > 0
        ? `Blocked: ${blockers.map((blocker) => blocker.title).join(" · ")}`
        : ready
          ? "Squash-merge after confirmation"
          : "Waiting on GitHub before a merge is safe.";

  return (
    <>
      <footer className="rd-verdict-dock" aria-label="Review verdict">
        <span className="rd-verdict-state">
          <span className="rd-eyebrow">Verdict</span>
          <strong>{selected ? (isPr ? latestReview : "Local review only") : "No session selected"}</strong>
          <span>
            {readableCount > 0
              ? `${reviewedCount} of ${readableCount} files reviewed`
              : "No readable files"}
            {note ? " · note draft kept for this session" : ""}
          </span>
        </span>
        {blockers.length > 0 ? (
          <button type="button" className="rd-blocker-chip focus-ring" onClick={onFocusBlockers}>
            <Icon name="ph:warning-circle-fill" width={12} height={12} aria-hidden />
            {blockers.length} {blockers.length === 1 ? "blocker" : "blockers"}
          </button>
        ) : null}
        {actionError ? <span className="rd-error">{actionError}</span> : null}
        <span className="rd-spacer" />
        {canAct ? (
          <span className="rd-verdict-actions">
            <button
              type="button"
              className="rd-btn rd-btn--changes focus-ring"
              disabled={busy != null}
              aria-haspopup="dialog"
              onClick={() => setReviewMode("changes")}
            >
              <Icon name="ph:arrow-bend-up-left" width={14} height={14} aria-hidden />
              {busy === "changes" ? "Requesting…" : "Request changes"}
            </button>
            <button
              type="button"
              className="rd-btn rd-btn--approve focus-ring"
              disabled={busy != null}
              aria-haspopup="dialog"
              onClick={() => setReviewMode("approve")}
            >
              <Icon name="ph:seal-check" width={14} height={14} aria-hidden />
              {busy === "approve" ? "Approving…" : "Approve"}
            </button>
            <button
              type="button"
              className="rd-btn rd-btn--merge focus-ring"
              disabled={!ready || busy != null}
              title={mergeTitle}
              aria-haspopup="dialog"
              onClick={() => setMergeOpen(true)}
            >
              <Icon name="ph:git-merge" width={14} height={14} aria-hidden />
              {busy === "merge" ? "Merging…" : "Squash & merge"}
            </button>
          </span>
        ) : selected ? (
          <span className="rd-verdict-why">
            {!isPr
              ? "GitHub verdicts stay unavailable while this session is a local working tree."
              : facts?.draft
                ? "This pull request is a draft. Verdicts count once the author marks it ready."
                : "Actions are held until the pull request's state loads."}
          </span>
        ) : null}
      </footer>

      <Modal
        open={reviewMode != null}
        onClose={() => setReviewMode(null)}
        dismissOnEscape={busy == null}
        breadcrumb={[
          "Review Deck",
          reviewMode === "changes" ? "Request changes" : "Approve",
        ]}
        wide={reviewMode === "changes"}
        footerPills={
          facts && reviewMode ? (
            <>
              <span className="ui-pill">
                {reviewMode === "changes" ? "REQUEST_CHANGES" : "APPROVE"}
              </span>
              <span className="ui-pill">
                posts to {facts.repo}#{facts.number}
              </span>
            </>
          ) : null
        }
        footerActions={
          <>
            <button type="button" className="rd-btn focus-ring" onClick={() => setReviewMode(null)}>
              Cancel
            </button>
            <button
              type="button"
              className={`rd-btn ${reviewMode === "changes" ? "rd-btn--changes" : "rd-btn--approve"} focus-ring`}
              disabled={busy != null || (reviewMode === "changes" && !note.trim())}
              onClick={() => {
                void (async () => {
                  const ok =
                    reviewMode === "changes"
                      ? await onRequestChanges()
                      : await onApprove();
                  if (ok) setReviewMode(null);
                })();
              }}
            >
              <Icon
                name={reviewMode === "changes" ? "ph:arrow-bend-up-left" : "ph:seal-check"}
                width={14}
                height={14}
                aria-hidden
              />
              {reviewMode === "changes" ? "Send request" : "Approve pull request"}
            </button>
          </>
        }
      >
        <div className="rd-composer">
          {reviewMode === "changes" ? (
            <section className="rd-composer-evidence" aria-label="Evidence from GitHub">
              <div className="rd-card-head">
                <span className="rd-eyebrow">Evidence from GitHub</span>
                <span className="rd-spacer" />
                {evidence.length > 2 ? (
                  <button
                    type="button"
                    className="rd-composer-more focus-ring"
                    aria-expanded={evidenceExpanded}
                    onClick={() => setEvidenceExpanded((open) => !open)}
                  >
                    <Icon
                      name={evidenceExpanded ? "ph:caret-down" : "ph:caret-right"}
                      width={10}
                      height={10}
                      aria-hidden
                    />
                    {evidenceExpanded ? "Show less" : `Show all ${evidence.length}`}
                  </button>
                ) : null}
                <span className="rd-checked">
                  {evidence.length > 0
                    ? `${keptEvidence.length} of ${evidence.length} cited`
                    : "nothing blocking"}
                </span>
              </div>
              <div className="rd-evidence-chips" data-expanded={evidenceExpanded ? "true" : undefined}>
                {evidence.map((item) => {
                  const on = !evidenceOff[item.key];
                  return (
                    <button
                      key={item.key}
                      type="button"
                      className="rd-evidence-chip focus-ring"
                      data-tone={item.tone}
                      data-off={on ? undefined : "true"}
                      aria-pressed={on}
                      title={item.title}
                      onClick={() =>
                        setEvidenceOff((current) => ({
                          ...current,
                          [item.key]: on,
                        }))
                      }
                    >
                      <Icon name={on ? item.icon : "ph:circle-dashed"} width={11} height={11} aria-hidden />
                      {item.label}
                    </button>
                  );
                })}
              </div>
              <div className="rd-composer-actions">
                <button
                  type="button"
                  className="rd-draft-btn focus-ring"
                  disabled={keptEvidence.length === 0}
                  onClick={() =>
                    facts &&
                    onNote(
                      draftChangeRequest(
                        `${facts.repo}#${facts.number}`,
                        keptEvidence,
                      ),
                    )
                  }
                >
                  <Icon name="ph:pencil-simple" width={13} height={13} aria-hidden />
                  {note ? "Redraft from evidence" : "Draft from evidence"}
                </button>
                <span>Every cited item comes from this pull request&apos;s current GitHub state.</span>
              </div>
            </section>
          ) : null}

          <div className="rd-composer-body">
            <label className="rd-eyebrow" htmlFor="rd-review-body">
              Review note {reviewMode === "approve" ? "· Optional" : ""}
            </label>
            <p id="rd-review-help" className="rd-hint">
              {reviewMode === "changes"
                ? "Required. GitHub sends this as the request-changes review body."
                : "Optional. GitHub sends this with the approving review."}
              {" "}The draft stays with this session while you move through the queue.
            </p>
            <textarea
              id="rd-review-body"
              ref={noteRef}
              className="rd-composer-textarea"
              placeholder={reviewMode === "changes" ? "Describe what has to change…" : "Add a note…"}
              value={note}
              maxLength={GITHUB_REVIEW_BODY_MAX_LENGTH}
              onChange={(event) =>
                onNote(event.target.value.slice(0, GITHUB_REVIEW_BODY_MAX_LENGTH))
              }
              aria-describedby="rd-review-help rd-review-count"
              aria-invalid={noteError ? true : undefined}
            />
            <span id="rd-review-count" className="rd-character-count">
              {note.length.toLocaleString()} / {GITHUB_REVIEW_BODY_MAX_LENGTH.toLocaleString()}
            </span>
            {noteError ? <span className="rd-error" role="alert">{noteError}</span> : null}
          </div>
        </div>
      </Modal>

      <Modal
        open={mergeOpen}
        onClose={() => setMergeOpen(false)}
        dismissOnEscape={busy == null}
        breadcrumb={["Review Deck", "Squash & merge"]}
        footerPills={
          facts ? (
            <>
              <span className="ui-pill">squash</span>
              <span className="ui-pill">{facts.commits} commits → 1</span>
              <span className="ui-pill">into {facts.baseRef}</span>
            </>
          ) : null
        }
        footerActions={
          <>
            <button type="button" className="rd-btn focus-ring" onClick={() => setMergeOpen(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="rd-btn rd-btn--merge focus-ring"
              disabled={!ready || busy != null}
              onClick={() => {
                void (async () => {
                  if (await onMerge()) setMergeOpen(false);
                })();
              }}
            >
              <Icon name="ph:git-merge" width={14} height={14} aria-hidden />
              Squash &amp; merge
            </button>
          </>
        }
      >
        <div className="rd-merge-confirm">
          <div className="rd-merge-subject">
            <span className="rd-merge-ref">{facts ? `${facts.repo}#${facts.number}` : ""}</span>
            <strong>Land this exact GitHub head as one commit.</strong>
          </div>
          <div className="rd-merge-checklist">
            <span className="rd-eyebrow">Pre-merge checklist</span>
            {mergeChecklist(facts).map((row) => (
              <div key={row.label} className="rd-merge-row" data-ok={row.ok ? "true" : undefined}>
                <Icon name={row.ok ? "ph:check-circle-fill" : "ph:x-circle-fill"} width={13} height={13} aria-hidden />
                <span>
                  <strong>{row.label}</strong>
                  <small>{row.detail}</small>
                </span>
              </div>
            ))}
          </div>
          <p className="rd-hint">
            This squash-merges on GitHub and closes the pull request. It never touches the working tree, and the deck re-reads GitHub afterwards.
          </p>
        </div>
      </Modal>
    </>
  );
}
