"use client";

import "@/styles/cave-chat.css";

/**
 * ChatArchiveNudge — persistent guidance above the composer, outside the
 * transcript scroller, when the chat is tied to a task whose execution lifecycle
 * has reached `completed`. Companion to the global inbox toast (see
 * `task-archive-nudge.ts`): the toast catches the user wherever they are, this
 * banner persists inside the chat itself so it's still here when they come
 * back to read the thread.
 *
 * Visibility decision lives in {@link shouldShowChatArchiveNudge}; this
 * component is purely presentational and renders whatever it's told to render.
 */

import { Icon } from "@/lib/icon";
import { Button } from "@/components/ui/button";

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
      className="cave-chat-archive-nudge mx-4 mb-2 flex shrink-0 items-start gap-3 rounded-[var(--radius-card)] border border-[var(--border-strong)] bg-[var(--bg-raised)] p-4 text-[length:var(--text-base)] text-[var(--text-primary)]"
      data-testid="chat-archive-nudge"
    >
      <Icon
        name="ph:archive"
        width={18}
        className="shrink-0 text-[var(--text-secondary)]"
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <h2 className="text-[length:var(--text-md)] font-semibold text-[var(--text-primary)]">
          Task complete. Ready to archive?
        </h2>
        <p className="mt-1 break-words text-[length:var(--text-sm)] text-[var(--text-secondary)]">
          <span className="font-medium text-[var(--text-primary)]">{title}</span>
          {" is complete. Archive when you're finished with this topic."}
        </p>
        <p className="mt-1 text-[length:var(--text-sm)] text-[var(--text-secondary)]">
          This clears the chat from active chats, not its history. Find it again with Show archived.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button
            variant="primary"
            onClick={onArchive}
            loading={archiving}
            leadingIcon="ph:archive"
            className="focus-ring"
          >
            {archiving ? "Archiving…" : "Archive chat"}
          </Button>
          <Button
            variant="ghost"
            onClick={onDismiss}
            disabled={archiving}
            className="focus-ring"
          >
            Keep chat open
          </Button>
        </div>
      </div>
    </div>
  );
}
