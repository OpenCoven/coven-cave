"use client";

/**
 * CodeSourceContext — the "you got here from a conversation" bar (cave-f6mu9).
 *
 * A file opened from a chat code block arrives with no memory of why. This
 * strip sits above the workbench and holds the thread: which familiar, which
 * message, which lines, and a way back. Without it the return trip is a guess,
 * and the reader either loses the question they came to answer or gives up on
 * the handoff entirely.
 *
 * It is dismissible and only renders when an origin actually exists — a file
 * opened from the tree shows nothing, because there is no conversation to
 * point back to.
 */

import { Icon } from "@/lib/icon";
import type { PendingCodeOrigin } from "@/lib/pending-code-open";

export type CodeSourceContextProps = {
  origin: PendingCodeOrigin;
  /** Repo-relative path the open landed on. */
  path?: string | null;
  /** Return to the conversation this came from. */
  onBack?: () => void;
  onDismiss: () => void;
};

export function CodeSourceContext({ origin, path, onBack, onDismiss }: CodeSourceContextProps) {
  const who = origin.familiar?.trim();
  const title = origin.sessionTitle?.trim();
  const msg = typeof origin.messageIndex === "number" && origin.messageIndex > 0
    ? `msg ${origin.messageIndex}`
    : null;
  const detail = [path, origin.selectionLabel].filter(Boolean).join(" · ");

  return (
    <div
      className="flex shrink-0 items-center gap-2 border-b border-[color-mix(in_oklch,var(--accent-presence)_24%,transparent)] bg-[color-mix(in_oklch,var(--accent-presence)_6%,transparent)] px-3 py-1 text-[length:var(--text-xs)]"
      role="note"
      aria-label="Where this file came from"
    >
      <Icon name="ph:caret-left" width={11} />
      <span className="shrink-0">
        {who ? (
          <>
            from <strong className="font-semibold">{who}</strong>
          </>
        ) : (
          "from chat"
        )}
        {title ? <span className="text-[var(--text-secondary)]"> · “{title}”</span> : null}
      </span>
      {msg ? (
        <span className="shrink-0 rounded border border-[var(--border-hairline)] px-1.5 font-mono text-[length:var(--text-2xs)] text-[var(--text-secondary)]">
          {msg}
        </span>
      ) : null}
      {detail ? (
        <span className="min-w-0 truncate font-mono text-[length:var(--text-2xs)] text-[var(--text-secondary)]">
          {detail}
        </span>
      ) : null}
      <span className="flex-1" />
      {onBack ? (
        <button type="button" className="ui-btn ui-btn--ghost ui-btn--xs focus-ring shrink-0" onClick={onBack}>
          Back to chat
        </button>
      ) : null}
      <button
        type="button"
        className="focus-ring shrink-0 rounded p-0.5 text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
        onClick={onDismiss}
        aria-label="Dismiss the source context"
      >
        <Icon name="ph:x" width={11} />
      </button>
    </div>
  );
}
