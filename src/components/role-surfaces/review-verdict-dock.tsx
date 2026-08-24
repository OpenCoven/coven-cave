"use client";

/**
 * review-verdict-dock — the only verdict on the page.
 *
 * One primary action, chosen by state, plus the alternatives it does not
 * recommend. A disabled Merge keeps its place in the row rather than
 * disappearing, and its tooltip names the blockers — a control that vanishes
 * teaches nothing about why it is unavailable, and a reviewer hunting for a
 * missing button is a reviewer who will reach for GitHub instead.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Icon } from "@/lib/icon";
import { GITHUB_REVIEW_BODY_MAX_LENGTH } from "@/lib/github-review";
import type { TriagedBlocker } from "./review-cockpit";
import {
  draftChangeRequest,
  evidenceItems,
  type MergeChecklistRow,
  type PrFacts,
} from "./review-readiness";
import type { ReviewCheckpoint } from "./review-deck";

type ReviewMode = "approve" | "changes";

type Verdict = {
  label: string;
  tone: "accent" | "success" | "warning" | "muted";
  disabled: boolean;
  title: string;
  icon: "ph:seal-check" | "ph:arrow-bend-up-left" | "ph:git-merge" | "ph:hourglass";
  run: () => void;
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  return kb < 1024 ? `${kb.toFixed(1)} KB` : `${(kb / 1024).toFixed(1)} MB`;
}

export function ReviewVerdictDock({
  selectionKey,
  selected,
  isPr,
  facts,
  canAct,
  ready,
  blockers,
  checklist,
  busy,
  actionError,
  note,
  noteError,
  checkpoints,
  checkpointsOpen,
  checkpointsError,
  onNote,
  onApprove,
  onRequestChanges,
  onMerge,
  onSkip,
  onCloseCheckpoints,
}: {
  selectionKey: string;
  selected: boolean;
  isPr: boolean;
  facts: PrFacts | null;
  canAct: boolean;
  ready: boolean;
  blockers: readonly TriagedBlocker[];
  checklist: readonly MergeChecklistRow[];
  busy: "approve" | "changes" | "merge" | null;
  actionError: string | null;
  note: string;
  noteError: string | null;
  checkpoints: readonly ReviewCheckpoint[] | null;
  checkpointsOpen: boolean;
  checkpointsError: string | null;
  onNote: (value: string) => void;
  onApprove: () => Promise<boolean>;
  onRequestChanges: () => Promise<boolean>;
  onMerge: () => Promise<boolean>;
  onSkip: () => void;
  onCloseCheckpoints: () => void;
}) {
  const [reviewMode, setReviewMode] = useState<ReviewMode | null>(null);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [evidenceOff, setEvidenceOff] = useState<Record<string, boolean>>({});
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
  }, [selectionKey]);
  useEffect(() => {
    if (noteError && reviewMode != null) noteRef.current?.focus();
  }, [noteError, reviewMode]);

  const mergeTitle = !isPr
    ? "Merging needs a pull request — this session is a local working tree."
    : facts?.draft
      ? "Draft pull requests can't be merged."
      : blockers.length > 0
        ? `Blocked: ${blockers.map((blocker) => blocker.title).join(" · ")}`
        : ready
          ? "Confirms against the live checklist first"
          : "Needs an approving review and a clean mergeable state.";

  const openChanges = () => setReviewMode("changes");
  const openApprove = () => setReviewMode("approve");

  let primary: Verdict;
  const secondaries: Verdict[] = [];

  if (canAct && ready) {
    primary = {
      label: "Squash & merge",
      tone: "success",
      disabled: busy != null,
      title: mergeTitle,
      icon: "ph:git-merge",
      run: () => setMergeOpen(true),
    };
    secondaries.push({
      label: "Request changes",
      tone: "muted",
      disabled: busy != null,
      title: "Posts a request-changes review instead of merging",
      icon: "ph:arrow-bend-up-left",
      run: openChanges,
    });
  } else if (canAct && blockers.length > 0) {
    primary = {
      label: "Request changes",
      tone: "warning",
      disabled: busy != null,
      title: "Drafts from the blockers above",
      icon: "ph:arrow-bend-up-left",
      run: openChanges,
    };
    secondaries.push(
      {
        label: "Approve anyway",
        tone: "muted",
        disabled: busy != null,
        title: "Approving does not clear the blockers",
        icon: "ph:seal-check",
        run: openApprove,
      },
      {
        label: "Merge",
        tone: "muted",
        disabled: true,
        title: mergeTitle,
        icon: "ph:git-merge",
        run: () => {},
      },
    );
  } else if (canAct) {
    primary = {
      label: "Approve",
      tone: "accent",
      disabled: busy != null,
      title: facts ? `Posts an approving review to ${facts.repo}#${facts.number}` : "",
      icon: "ph:seal-check",
      run: openApprove,
    };
    secondaries.push(
      {
        label: "Request changes",
        tone: "muted",
        disabled: busy != null,
        title: "Posts a request-changes review",
        icon: "ph:arrow-bend-up-left",
        run: openChanges,
      },
      {
        label: "Merge",
        tone: "muted",
        disabled: true,
        title: mergeTitle,
        icon: "ph:git-merge",
        run: () => {},
      },
    );
  } else {
    primary = {
      label: !selected
        ? "Nothing selected"
        : !isPr
          ? "Verdicts need a pull request"
          : facts?.draft
            ? "Waiting on the author"
            : "Reading GitHub state…",
      tone: "muted",
      disabled: true,
      title: !isPr
        ? "This session is a local working tree; open a pull request to unlock verdicts."
        : facts?.draft
          ? "Draft pull requests can't take a verdict."
          : "Actions are held until the pull request's state loads.",
      icon: "ph:hourglass",
      run: () => {},
    };
    if (selected) {
      secondaries.push({
        label: "Skip to next item",
        tone: "muted",
        disabled: false,
        title: "]",
        icon: "ph:arrow-bend-up-left",
        run: onSkip,
      });
    }
  }

  const busyLabel =
    busy === "approve"
      ? "Approving…"
      : busy === "changes"
        ? "Requesting…"
        : busy === "merge"
          ? "Merging…"
          : null;

  const footnote = !selected
    ? "Pick an item from the queue."
    : !isPr
      ? "The deck never applies patches or edits a working tree."
      : canAct && facts
        ? `Posts to ${facts.repo}#${facts.number} · merge re-reads GitHub first.`
        : "Read-only until the author acts.";

  return (
    <>
      <footer className="rd-verdict" aria-label="Review verdict">
        {actionError ? (
          <span className="rd-error" role="alert">
            {actionError}
          </span>
        ) : null}
        <button
          type="button"
          className="rd-verdict-primary focus-ring"
          data-rd-tone={primary.tone}
          disabled={primary.disabled}
          title={primary.title}
          aria-haspopup={primary.disabled ? undefined : "dialog"}
          onClick={primary.run}
        >
          <Icon name={primary.icon} width={14} height={14} aria-hidden />
          {busyLabel ?? primary.label}
        </button>
        {secondaries.length > 0 ? (
          <div className="rd-verdict-secondary">
            {secondaries.map((action) => (
              <button
                key={action.label}
                type="button"
                className="rd-btn focus-ring"
                disabled={action.disabled}
                title={action.title}
                onClick={action.run}
              >
                {action.label}
              </button>
            ))}
          </div>
        ) : null}
        <span className="rd-verdict-footnote">{footnote}</span>
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
                {facts.repo}#{facts.number}
              </span>
            </>
          ) : null
        }
        footerActions={
          <>
            <Button variant="ghost" size="sm" onClick={() => setReviewMode(null)}>
              Cancel
            </Button>
            <button
              type="button"
              className="rd-verdict-primary rd-verdict-primary--inline focus-ring"
              data-rd-tone={reviewMode === "changes" ? "warning" : "accent"}
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
            <section className="rd-composer-evidence" aria-label="Cited evidence">
              <div className="rd-section-head">
                <Icon name="ph:chat-circle-dots" width={11} height={11} aria-hidden />
                <span className="rd-eyebrow">Cited evidence</span>
                <span className="rd-spacer" />
                <span className="rd-checked">
                  {evidence.length > 0
                    ? `${keptEvidence.length} of ${evidence.length} cited`
                    : "nothing blocking"}
                </span>
              </div>
              <div className="rd-evidence-chips">
                {evidence.map((item) => {
                  const on = !evidenceOff[item.key];
                  return (
                    <button
                      key={item.key}
                      type="button"
                      className="rd-evidence-chip focus-ring"
                      data-rd-tone={item.tone}
                      data-off={on ? undefined : "true"}
                      aria-pressed={on}
                      title={item.title}
                      onClick={() =>
                        setEvidenceOff((current) => ({ ...current, [item.key]: on }))
                      }
                    >
                      <Icon
                        name={on ? item.icon : "ph:circle-dashed"}
                        width={11}
                        height={11}
                        aria-hidden
                      />
                      {item.label}
                    </button>
                  );
                })}
              </div>
              <div className="rd-composer-actions">
                <Button
                  size="xs"
                  leadingIcon="ph:pencil-simple"
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
                  {note ? "Redraft from evidence" : "Draft note from evidence"}
                </Button>
                <span>Every cited item is this pull request&apos;s live GitHub state.</span>
              </div>
            </section>
          ) : null}

          <div className="rd-composer-body">
            <label className="rd-eyebrow" htmlFor="rd-review-body">
              Review note · {reviewMode === "changes" ? "Required" : "Optional"}
            </label>
            <p id="rd-review-help" className="rd-hint">
              {reviewMode === "changes"
                ? "GitHub sends this as the request-changes review body."
                : "GitHub sends this with the approving review."}{" "}
              The draft stays with this session while you move through the queue.
            </p>
            <textarea
              id="rd-review-body"
              ref={noteRef}
              className="rd-composer-textarea"
              placeholder={
                reviewMode === "changes"
                  ? "Describe what has to change…"
                  : "Add a note…"
              }
              value={note}
              maxLength={GITHUB_REVIEW_BODY_MAX_LENGTH}
              onChange={(event) =>
                onNote(event.target.value.slice(0, GITHUB_REVIEW_BODY_MAX_LENGTH))
              }
              aria-describedby="rd-review-help rd-review-count"
              aria-invalid={noteError ? true : undefined}
            />
            <span id="rd-review-count" className="rd-character-count">
              {note.length.toLocaleString()} /{" "}
              {GITHUB_REVIEW_BODY_MAX_LENGTH.toLocaleString()}
            </span>
            {noteError ? (
              <span className="rd-error" role="alert">
                {noteError}
              </span>
            ) : null}
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
            <Button variant="ghost" size="sm" onClick={() => setMergeOpen(false)}>
              Cancel
            </Button>
            <button
              type="button"
              className="rd-verdict-primary rd-verdict-primary--inline focus-ring"
              data-rd-tone="success"
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
            <span className="rd-merge-mark" aria-hidden>
              <Icon name="ph:git-merge" width={17} height={17} />
            </span>
            <span>
              <strong>Land this exact GitHub head as one commit.</strong>
              <small>
                {facts
                  ? `${facts.headRef} → ${facts.baseRef} · head ${facts.headSha.slice(0, 7)}`
                  : ""}
              </small>
            </span>
          </div>
          <ul className="rd-checklist rd-checklist--boxed">
            {checklist.map((row) => (
              <li
                key={row.label}
                data-ok={row.ok ? "true" : undefined}
                data-soft={row.soft ? "true" : undefined}
              >
                <Icon
                  name={
                    row.ok
                      ? "ph:check-circle-fill"
                      : row.soft
                        ? "ph:eye"
                        : "ph:warning-circle-fill"
                  }
                  width={13}
                  height={13}
                  aria-hidden
                />
                <span>
                  <b>{row.label}</b> — {row.detail}
                </span>
              </li>
            ))}
          </ul>
          <p className="rd-hint">
            <Icon name="ph:seal-check" width={13} height={13} aria-hidden />
            This squash-merges on GitHub and closes the pull request. It never
            touches a working tree; the deck re-reads GitHub afterwards.
          </p>
        </div>
      </Modal>

      <Modal
        open={checkpointsOpen}
        onClose={onCloseCheckpoints}
        breadcrumb={["Review Deck", "Local checkpoints"]}
        footerActions={
          <Button variant="ghost" size="sm" onClick={onCloseCheckpoints}>
            Close
          </Button>
        }
      >
        <p className="rd-hint">
          Snapshots the chat&apos;s change tools saved for this session&apos;s project
          before risky edits. Read-only — the deck never applies a patch.
        </p>
        {checkpointsError ? (
          <p className="rd-error" role="alert">
            {checkpointsError}
          </p>
        ) : checkpoints == null ? (
          <p className="rd-hint">Loading checkpoints…</p>
        ) : checkpoints.length === 0 ? (
          <p className="rd-hint">No checkpoints saved for this project.</p>
        ) : (
          <ul className="rd-checkpoints">
            {checkpoints.map((checkpoint) => (
              <li key={checkpoint.name}>
                <span className="rd-checkpoint-name">{checkpoint.name}</span>
                <span className="rd-spacer" />
                <small>{formatBytes(checkpoint.bytes)}</small>
              </li>
            ))}
          </ul>
        )}
      </Modal>
    </>
  );
}
