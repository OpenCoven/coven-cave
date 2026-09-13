"use client";

/**
 * The one card in the room with a decision in it, which is why it is first.
 *
 * Six states, each with its own icon, dot, border tint and exactly one primary
 * action. The predecessor stated the state in a label and left approved and
 * draft looking identical; here the card's own edge carries it, and the rows
 * below spell out the slot, who approved it and when, and who will see it —
 * wrapping rather than truncating, because an approver who cannot read the
 * values is being asked to trust a label.
 *
 * Destructive actions ask inside the card rather than in a modal that covers
 * the thing being destroyed, and every state change is undoable for 8s.
 */

import { Button } from "@/components/ui/button";
import { Icon, type IconName } from "@/lib/icon";
import {
  countdownLabel,
  formatCount,
  handleOf,
  relativeLabel,
  slotLabel,
  X_STATUS,
  type XDraft,
} from "@/lib/x-comms-model";

const HOUR_MS = 3_600_000;

export type XConfirmKind = "discard" | "revoke";

const CONFIRM_COPY: Record<
  XConfirmKind,
  { title: string; body: string; action: string }
> = {
  discard: {
    title: "Discard this draft?",
    body: "removes it from the room · undo for 8s",
    action: "Discard",
  },
  revoke: {
    title: "Revoke and unqueue?",
    body: "leaves the schedule · marked revoked · undo for 8s",
    action: "Revoke",
  },
};

function reachOf(draft: XDraft): string {
  if (draft.kind === "article") return "article · followers";
  if (draft.type === "dm") return `private · ${draft.target || "@…"}`;
  if (draft.type === "reply") return `thread of ${handleOf(draft) || "@…"}`;
  if (draft.type === "quote") return `followers · quotes ${handleOf(draft) || "@…"}`;
  return `followers · replies: ${draft.replyPermission}`;
}

export function ApprovalCard({
  draft,
  now,
  open,
  blocker,
  confirm,
  nextSlotAt,
  primaryRef,
  onToggle,
  onRequestApproval,
  onApprove,
  onDecline,
  onOpenSlotPicker,
  onRetry,
  onAskConfirm,
  onResolveConfirm,
}: {
  draft: XDraft;
  now: number;
  open: boolean;
  blocker: string;
  confirm: XConfirmKind | null;
  nextSlotAt: number;
  primaryRef: React.RefObject<HTMLSpanElement | null>;
  onToggle: () => void;
  onRequestApproval: () => void;
  onApprove: () => void;
  onDecline: () => void;
  onOpenSlotPicker: () => void;
  onRetry: () => void;
  onAskConfirm: (kind: XConfirmKind) => void;
  onResolveConfirm: (proceed: boolean) => void;
}) {
  const status = X_STATUS[draft.status];
  const isDraftLike = draft.status === "draft" || draft.status === "revoked";
  const isPending = draft.status === "needs-approval";
  const isApproved = draft.status === "approved";
  const isPosted = draft.status === "posted";
  const isFailed = draft.status === "failed";

  const summary = draft.slotPassed
    ? "Its slot passed while waiting. Approving picks the next 6:10 PM slot."
    : isFailed
      ? `${status.summary} ${draft.failReason ?? ""}`.trim()
      : status.summary;

  const slotKey = isPosted
    ? "Posted"
    : isFailed
      ? "Failed"
      : draft.status === "revoked"
        ? "Revoked"
        : "Slot";

  const slotValue = isPosted
    ? `${slotLabel(now, draft.postedAt!)} · ${relativeLabel(now, draft.postedAt!)}`
    : isFailed
      ? `${slotLabel(now, draft.failedAt!)} · ${draft.failReason ?? ""}`
      : draft.status === "revoked"
        ? `${relativeLabel(now, draft.revokedAt!)} · by you`
        : draft.scheduledAt
          ? slotLabel(now, draft.scheduledAt)
          : `next · ${slotLabel(now, nextSlotAt)}`;

  const confirmCopy = confirm ? CONFIRM_COPY[confirm] : null;

  return (
    <section
      className="x-comms-card"
      data-state-tint={draft.status === "draft" ? undefined : "true"}
      style={{ "--x-card-tone": status.tone } as React.CSSProperties}
      aria-label="Approval"
    >
      <header className="x-comms-card-head">
        <button
          type="button"
          className="x-comms-card-toggle focus-ring"
          aria-expanded={open}
          aria-label={open ? "Collapse Approval" : "Expand Approval"}
          title={open ? "Collapse" : "Expand"}
          onClick={onToggle}
        >
          <Icon
            name={open ? "ph:caret-down" : "ph:caret-right"}
            width={12}
            height={12}
            aria-hidden
          />
        </button>
        <span className="x-comms-card-icon" data-tone="state">
          <Icon name={status.icon as IconName} width={13} height={13} aria-hidden />
        </span>
        <span className="x-comms-card-heading">
          <h3>Approval</h3>
          <span className="x-comms-card-sub">{summary}</span>
        </span>
      </header>

      {open && (
        <>
          <dl className="x-comms-kv">
            <div className="x-comms-kv-row">
              <dt>State</dt>
              <dd data-tone="state">
                <span
                  className="x-comms-dot"
                  data-filled={status.filled ? "true" : "false"}
                  style={{ "--x-dot-tone": status.tone } as React.CSSProperties}
                  aria-hidden
                />
                {draft.slotPassed ? "awaiting approval · slot passed" : status.label}
              </dd>
            </div>
            <div className="x-comms-kv-row">
              <dt>{slotKey}</dt>
              <dd>
                {slotValue}
                {isApproved && draft.scheduledAt && (
                  <span
                    className="x-comms-countdown"
                    data-soon={draft.scheduledAt - now < 2 * HOUR_MS ? "true" : "false"}
                  >
                    {countdownLabel(now, draft.scheduledAt)}
                  </span>
                )}
              </dd>
            </div>
            {draft.approvedBy && (
              <div className="x-comms-kv-row">
                <dt>Approved</dt>
                <dd>
                  {draft.approvedBy} · {slotLabel(now, draft.approvedAt!)} ·{" "}
                  {relativeLabel(now, draft.approvedAt!)}
                </dd>
              </div>
            )}
            <div className="x-comms-kv-row">
              <dt>Reach</dt>
              <dd>{reachOf(draft)}</dd>
            </div>
          </dl>

          <div className="x-comms-card-body">
            {isDraftLike && (
              <span ref={primaryRef} className="x-comms-primary">
                <Button
                  variant="secondary"
                  size="sm"
                  fullWidth
                  disabled={blocker.length > 0}
                  title={blocker || undefined}
                  onClick={onRequestApproval}
                >
                  Request approval
                </Button>
              </span>
            )}
            {isPending && (
              <span ref={primaryRef} className="x-comms-primary" data-emphasis="true">
                <Button
                  variant="secondary"
                  size="sm"
                  fullWidth
                  leadingIcon="ph:check"
                  disabled={blocker.length > 0}
                  title={blocker || "Approve and queue for the next 6:10 PM PT slot"}
                  onClick={onApprove}
                >
                  Approve &amp; queue
                </Button>
              </span>
            )}
            {isApproved && (
              <span ref={primaryRef} className="x-comms-primary">
                <Button
                  variant="secondary"
                  size="sm"
                  fullWidth
                  leadingIcon="ph:clock"
                  onClick={onOpenSlotPicker}
                >
                  Change slot
                </Button>
              </span>
            )}
            {isFailed && (
              <span ref={primaryRef} className="x-comms-primary" data-emphasis="true">
                <Button
                  variant="secondary"
                  size="sm"
                  fullWidth
                  leadingIcon="ph:arrows-clockwise"
                  onClick={onRetry}
                >
                  Retry at next slot
                </Button>
              </span>
            )}

            {/* Only where it blocks something. A posted draft whose account has
                since disconnected is not waiting on anyone, and a refusal
                printed under it would read as a problem with the post. */}
            {blocker && (isDraftLike || isPending || isFailed) && (
              <span
                role="status"
                className="x-comms-blocked"
                data-hard={
                  blocker.startsWith("room rule") || blocker.startsWith("X disconnected")
                    ? "true"
                    : "false"
                }
              >
                {blocker}
              </span>
            )}

            {confirmCopy && (
              <div
                role="alertdialog"
                aria-label={confirmCopy.title}
                className="x-comms-confirm"
              >
                <span className="x-comms-confirm-title">{confirmCopy.title}</span>
                <span className="x-comms-confirm-body">{confirmCopy.body}</span>
                <span className="x-comms-confirm-actions">
                  <Button variant="danger" size="xs" onClick={() => onResolveConfirm(true)}>
                    {confirmCopy.action}
                  </Button>
                  <Button variant="ghost" size="xs" onClick={() => onResolveConfirm(false)}>
                    Keep
                  </Button>
                </span>
              </div>
            )}

            {!isPosted && (
              <div className="x-comms-secondary-row">
                {isPending && (
                  <button
                    type="button"
                    className="x-comms-text-button focus-ring"
                    title="Send back to Echo as a draft. Nothing is lost."
                    onClick={onDecline}
                  >
                    Decline
                  </button>
                )}
                {isApproved && (
                  <button
                    type="button"
                    className="x-comms-text-button focus-ring"
                    title="Pull it out of the queue. Goes back to draft."
                    onClick={() => onAskConfirm("revoke")}
                  >
                    Revoke &amp; unqueue
                  </button>
                )}
                {isFailed && (
                  <button
                    type="button"
                    className="x-comms-text-button focus-ring"
                    onClick={onDecline}
                  >
                    Back to draft
                  </button>
                )}
                {isDraftLike && (
                  <span className="x-comms-draft-note">
                    {draft.status === "revoked"
                      ? "revoked · edits stay local"
                      : "edits stay local"}
                  </span>
                )}
                <button
                  type="button"
                  className="x-comms-discard focus-ring"
                  aria-label="Discard draft"
                  title="Discard draft · asks first, undo for 8s"
                  onClick={() => onAskConfirm("discard")}
                >
                  <Icon name="ph:trash" width={13} height={13} aria-hidden />
                </button>
              </div>
            )}

            {isPosted && (
              <span className="x-comms-posted-meta">
                <span className="x-comms-permalink">{draft.permalink}</span>
                <span>
                  posted {relativeLabel(now, draft.postedAt!)}
                  {draft.metrics
                    ? ` · ${formatCount(draft.metrics.impressions)} impressions · ${draft.metrics.engagementRate}% eng`
                    : ""}
                </span>
              </span>
            )}
          </div>
        </>
      )}
    </section>
  );
}
