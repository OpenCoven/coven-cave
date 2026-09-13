"use client";

/**
 * The work queue: every draft the room knows about, grouped by what it needs.
 *
 * "Needs you" is first and tinted because it is the only group holding a
 * decision. Its rows carry inline approve / decline so the common case — a
 * one-line reply that is obviously fine — does not require crossing the room
 * to the Approval card and back.
 *
 * Row titles clamp to two lines with the full text on hover rather than
 * truncating to one. An operator approving what they cannot read is the defect
 * the rail is shaped around; the rail is also drag-resizable between 240 and
 * 360 for the same reason.
 */

import type { KeyboardEvent, PointerEvent } from "react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Icon, type IconName } from "@/lib/icon";
import {
  derivedTitle,
  metaOf,
  shortWhen,
  titleOf,
  X_GROUPS,
  X_POST_TYPES,
  X_STATUS,
  type XDraft,
  type XGroupLabel,
} from "@/lib/x-comms-model";

export const X_QUEUE_MIN_WIDTH = 240;
export const X_QUEUE_MAX_WIDTH = 360;

function iconFor(draft: XDraft): IconName {
  const name =
    draft.kind === "article" ? "ph:file-text" : X_POST_TYPES[draft.type].icon;
  return name as IconName;
}

export function QueueRail({
  drafts,
  selectedId,
  collapsedGroups,
  connectionLabel,
  connectionTone,
  blockerFor,
  onToggleGroup,
  onSelect,
  onApprove,
  onDecline,
  onNewPost,
  onNewArticle,
  onResizeStart,
  onResizeKey,
  now,
}: {
  drafts: readonly XDraft[];
  selectedId: string | null;
  collapsedGroups: Partial<Record<XGroupLabel, boolean>>;
  connectionLabel: string;
  connectionTone: string;
  /** "" when the draft can be approved; the reason otherwise. */
  blockerFor: (draft: XDraft) => string;
  onToggleGroup: (label: XGroupLabel) => void;
  onSelect: (id: string) => void;
  onApprove: (id: string) => void;
  onDecline: (id: string) => void;
  onNewPost: () => void;
  onNewArticle: () => void;
  onResizeStart: (event: PointerEvent<HTMLButtonElement>) => void;
  onResizeKey: (event: KeyboardEvent<HTMLButtonElement>) => void;
  now: number;
}) {
  return (
    <aside className="x-comms-queue" aria-label="Work queue">
      <div className="x-comms-queue-actions">
        <Button
          variant="secondary"
          size="md"
          leadingIcon="ph:plus"
          fullWidth
          onClick={onNewPost}
        >
          New post
        </Button>
        <Button
          variant="secondary"
          size="md"
          leadingIcon="ph:file-text"
          onClick={onNewArticle}
          title="Long-form X Article · same approval flow"
        >
          Article
        </Button>
      </div>

      <div className="x-comms-queue-scroll">
        {drafts.length === 0 ? (
          <EmptyState
            icon="ph:pencil-simple"
            headline="Nothing drafted."
            subtitle="Start a post or an article."
            compact
          />
        ) : (
          X_GROUPS.map(({ label, statuses }) => {
            const items = drafts.filter((draft) => statuses.includes(draft.status));
            const open = !collapsedGroups[label];
            const hot = label === "Needs you" && items.length > 0;
            const descriptor = X_STATUS[statuses[0]];
            return (
              <section
                key={label}
                className="x-comms-group"
                data-hot={hot ? "true" : undefined}
                data-open={open ? "true" : "false"}
              >
                <button
                  type="button"
                  className="x-comms-group-head focus-ring-inset"
                  aria-expanded={open}
                  onClick={() => onToggleGroup(label)}
                >
                  <span
                    className="x-comms-dot"
                    data-size="lg"
                    data-filled={descriptor.filled ? "true" : "false"}
                    style={{ "--x-dot-tone": descriptor.tone } as React.CSSProperties}
                    aria-hidden
                  />
                  <h3>{label}</h3>
                  <span className="x-comms-count">{items.length}</span>
                  <Icon
                    name={open ? "ph:caret-up" : "ph:caret-down"}
                    width={11}
                    height={11}
                    aria-hidden
                  />
                </button>

                {open && (
                  <>
                    {items.length === 0 && descriptor.emptyHint && (
                      <p className="x-comms-group-empty" role="status">
                        {descriptor.emptyHint}
                      </p>
                    )}
                    <ul className="x-comms-rows">
                      {items.map((draft) => {
                        const status = X_STATUS[draft.status];
                        const selected = draft.id === selectedId;
                        const inline = draft.status === "needs-approval";
                        const blocker = inline ? blockerFor(draft) : "";
                        return (
                          <li key={draft.id}>
                            <div
                              className="x-comms-row"
                              data-selected={selected ? "true" : "false"}
                            >
                              <button
                                type="button"
                                className="x-comms-row-open focus-ring-inset"
                                aria-current={selected ? "true" : undefined}
                                title={`${titleOf(draft)}\n${metaOf(draft)} · ${status.label}`}
                                onClick={() => onSelect(draft.id)}
                              >
                                <span className="x-comms-row-icon">
                                  <Icon
                                    name={iconFor(draft)}
                                    width={13}
                                    height={13}
                                    aria-hidden
                                  />
                                </span>
                                <span className="x-comms-row-title">
                                  {titleOf(draft)}
                                </span>
                                <span className="x-comms-row-when">
                                  {shortWhen(now, draft.postedAt ?? draft.createdAt)}
                                </span>
                                <span className="x-comms-row-meta">
                                  <span
                                    className="x-comms-dot"
                                    data-filled={status.filled ? "true" : "false"}
                                    style={
                                      { "--x-dot-tone": status.tone } as React.CSSProperties
                                    }
                                    aria-hidden
                                  />
                                  {/* The state is named, not just coloured — the
                                      dot alone would make six states one hue. */}
                                  <span className="sr-only">{status.label}</span>
                                  <span title={metaOf(draft)}>{metaOf(draft)}</span>
                                </span>
                              </button>

                              {inline && (
                                <div className="x-comms-row-inline">
                                  <button
                                    type="button"
                                    className="x-comms-inline-action focus-ring-inset"
                                    data-variant="approve"
                                    disabled={blocker.length > 0}
                                    title={
                                      blocker
                                        ? `blocked · ${blocker}`
                                        : "Approve & queue for next slot"
                                    }
                                    onClick={() => onApprove(draft.id)}
                                  >
                                    <Icon name="ph:check" width={12} height={12} aria-hidden />
                                    approve
                                  </button>
                                  <button
                                    type="button"
                                    className="x-comms-inline-action focus-ring-inset"
                                    title="Decline · back to draft"
                                    onClick={() => onDecline(draft.id)}
                                  >
                                    <Icon name="ph:x" width={12} height={12} aria-hidden />
                                    decline
                                  </button>
                                </div>
                              )}
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  </>
                )}
              </section>
            );
          })
        )}
      </div>

      <div className="x-comms-queue-foot">
        <span
          className="x-comms-dot"
          data-filled="true"
          style={{ "--x-dot-tone": connectionTone } as React.CSSProperties}
          aria-hidden
        />
        {connectionLabel}
      </div>

      {/* A separator you can also drive from the keyboard: dragging is the
          obvious gesture, but it must not be the only one. */}
      <button
        type="button"
        className="x-comms-resize focus-ring"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize work queue"
        title="Drag or use the arrow keys to resize"
        onPointerDown={onResizeStart}
        onKeyDown={onResizeKey}
      />
    </aside>
  );
}

/** Used by the empty canvas so both surfaces name a draft the same way. */
export { derivedTitle };
