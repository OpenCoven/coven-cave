"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { useAnnouncer } from "@/components/ui/live-region";
import { TextInput } from "@/components/ui/text-input";
import {
  buildTaskDraftFromChat,
  createTaskFromDraft,
  type ChatTaskDraft,
} from "@/lib/chat-task-autofill";
import type { Card } from "@/lib/cave-board-types";
import type { ChatHandoffContext } from "@/lib/chat-task-handoff";
import type { NextPath } from "@/lib/next-paths";

type TaskSuggestion = Extract<NextPath, { kind: "task" }>;

export type FollowUpTaskReviewProps = {
  open: boolean;
  sessionId: string;
  context: ChatHandoffContext;
  suggestion: TaskSuggestion;
  onCreated: (card: Card) => void;
  onClose: () => void;
};

/** A review-first task handoff. Building its draft does not write to the board. */
export function FollowUpTaskReview({
  open,
  sessionId,
  context,
  suggestion,
  onCreated,
  onClose,
}: FollowUpTaskReviewProps) {
  const { announce } = useAnnouncer();
  const initialDraft = useMemo(
    () => buildTaskDraftFromChat({ sessionId, context, title: suggestion.prompt }),
    [sessionId, context.turns, context.familiarId, context.projectId, suggestion.prompt],
  );
  const [draft, setDraft] = useState<ChatTaskDraft>(initialDraft);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setDraft(initialDraft);
    setError(null);
  }, [initialDraft, open]);

  const close = () => {
    if (!creating) onClose();
  };

  const create = async () => {
    if (creating) return;
    setCreating(true);
    setError(null);
    const result = await createTaskFromDraft(draft);
    setCreating(false);
    if (!result.ok || !result.card) {
      const message = result.error ?? "Couldn't create task.";
      setError(message);
      announce(message, "assertive");
      return;
    }
    announce(`Task "${result.card.title}" created from this chat.`);
    onCreated(result.card);
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={close}
      breadcrumb={["Chat", "Review task"]}
      dismissOnBackdrop={!creating}
      dismissOnEscape={!creating}
      footerActions={
        <>
          <Button variant="ghost" onClick={close} disabled={creating}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void create()} loading={creating}>
            Create task
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <p className="m-0 text-[length:var(--text-base)] text-[var(--text-secondary)]">
          This task will be linked to this conversation and inherit its familiar and project context.
        </p>
        <Field label="Task title" error={error ?? undefined}>
          <TextInput
            className="focus-ring"
            aria-label="Task title"
            value={draft.title}
            onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))}
            disabled={creating}
          />
        </Field>
      </div>
    </Modal>
  );
}
