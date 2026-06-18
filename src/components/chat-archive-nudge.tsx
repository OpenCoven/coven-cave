"use client";

/**
 * ChatArchiveNudge — the inline "final nudge" rendered at the bottom of a
 * chat transcript when the chat is tied to a task whose execution lifecycle
 * has reached `completed`. Companion to the global inbox toast (see
 * `task-archive-nudge.ts`): the toast catches the user wherever they are, this
 * banner persists inside the chat itself so it's still here when they come
 * back to read the thread.
 *
 * Visibility decision lives in {@link shouldShowChatArchiveNudge}; this
 * component is purely presentational and renders whatever it's told to render.
 */

import { Icon } from "@/lib/icon";

export type ChatArchiveNudgeProps = {
  /** Title of the linked task — surfaced in the nudge body for context. */
  taskTitle: string;
  /** Invoked when the user clicks the primary "Archive chat" CTA. */
  onArchive: () => void;
  /** Invoked when the user dismisses the nudge for this session. */
  onDismiss: () => void;
  /** Disables the archive button while the archive request is in flight. */
  archiving?: boolean;
};

export function ChatArchiveNudge({
  taskTitle,
  onArchive,
  onDismiss,
  archiving = false,
}: ChatArchiveNudgeProps) {
  const title = taskTitle.trim() || "this task";
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={`Ready to archive: ${title}`}
      className="cave-chat-archive-nudge focus-ring relative mx-auto my-4 flex w-full max-w-[42rem] items-start gap-3 rounded-xl border border-[color-mix(in_oklch,var(--accent-presence)_38%,transparent)] bg-[color-mix(in_oklch,var(--accent-presence)_10%,var(--bg-raised))] px-4 py-3 text-[13px] text-[var(--text-primary)] shadow-[0_1px_0_color-mix(in_oklch,var(--accent-presence)_20%,transparent)]"
      data-testid="chat-archive-nudge"
    >
      <Icon
        name="ph:archive"
        width={18}
        className="mt-0.5 shrink-0 text-[var(--accent-presence)]"
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <div className="font-medium text-[var(--text-primary)]">
          Ready to archive
        </div>
        <p className="mt-0.5 text-[12px] text-[var(--text-secondary)]">
          <span className="font-medium text-[var(--text-primary)]">{title}</span>
          {" is complete. Archive this chat to clear it from your active sessions."}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onArchive}
            disabled={archiving}
            className="focus-ring inline-flex items-center gap-1.5 rounded-md border border-[color-mix(in_oklch,var(--accent-presence)_55%,transparent)] bg-[color-mix(in_oklch,var(--accent-presence)_18%,transparent)] px-2.5 py-1 text-[11px] font-medium text-[var(--text-primary)] transition-colors hover:bg-[color-mix(in_oklch,var(--accent-presence)_28%,transparent)] disabled:opacity-50"
          >
            <Icon name="ph:archive" width={12} aria-hidden />
            {archiving ? "Archiving…" : "Archive chat"}
          </button>
          <button
            type="button"
            onClick={onDismiss}
            disabled={archiving}
            className="focus-ring inline-flex items-center gap-1.5 rounded-md border border-transparent px-2 py-1 text-[11px] font-medium text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)] disabled:opacity-50"
          >
            Dismiss
          </button>
        </div>
      </div>
      <button
        type="button"
        aria-label="Dismiss archive nudge"
        onClick={onDismiss}
        disabled={archiving}
        className="focus-ring absolute right-2 top-2 inline-flex h-6 w-6 items-center justify-center rounded-md text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)] disabled:opacity-50"
      >
        <Icon name="ph:x" width={12} aria-hidden />
      </button>
    </div>
  );
}
