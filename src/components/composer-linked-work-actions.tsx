"use client";

import { Fragment, useState } from "react";
import { PopoverItem, type PopoverItemSemantic } from "@/components/ui/popover";
import { useAnnouncer } from "@/components/ui/live-region";
import type { ChatLinkedContext } from "@/lib/chat-linked-context";
import type { ChatHandoffContext } from "@/lib/chat-task-handoff";
import { createSmartTaskFromChat } from "@/lib/chat-task-autofill";
import { publishBoardChanged } from "@/lib/board-cache-events";
import type { Card } from "@/lib/cave-board-types";
import { TaskLinkPicker } from "@/components/task-link-picker";
import { openExternalUrl } from "@/lib/open-external";
import { Icon, type IconName } from "@/lib/icon";

export function repoName(p?: string | null): string {
  if (!p) return "";
  const parts = p.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts[parts.length - 1] ?? p;
}

export function githubLabel(kind: string): string {
  if (kind === "pr") return "PR";
  if (kind === "issue") return "Issue";
  if (kind === "review_request") return "Review";
  if (kind === "discussion") return "Discussion";
  return "GitHub";
}

export function compactGitHubContextLabel(item: ChatLinkedContext["github"][number]): string {
  const repo = repoName(item.repo) || item.repo;
  return item.number ? `${repo} #${item.number}` : repo;
}

export function githubIcon(kind: string): IconName {
  if (kind === "issue") return "ph:bug-bold";
  if (kind === "discussion") return "ph:chats";
  if (kind === "review_request") return "ph:check-circle";
  if (kind === "notification") return "ph:bell";
  if (kind === "repo") return "ph:git-fork-bold";
  return "ph:git-pull-request";
}

export type ComposerLinkedWorkActionsProps = {
  linkedContext: ChatLinkedContext | null;
  onOpenTask?: (cardId: string) => void;
  sessionId?: string | null;
  onLinkedContextChange?: (updater: (prev: ChatLinkedContext | null) => ChatLinkedContext | null) => void;
  handoff?: ChatHandoffContext | null;
  sessionSettled?: boolean;
  onCloseMenu?: () => void;
  embedded?: boolean;
  itemSemantic?: PopoverItemSemantic;
};

/** Shared linked-work controller: the mark-done / link / create-task flows
 *  behind BOTH presentations (the composer menu's rows and the footer band's
 *  chip strip), so the two surfaces can't drift apart. */
function useLinkedWorkController({
  linkedContext,
  sessionId,
  onLinkedContextChange,
  handoff,
}: {
  linkedContext: ChatLinkedContext | null;
  sessionId?: string | null;
  onLinkedContextChange?: (updater: (prev: ChatLinkedContext | null) => ChatLinkedContext | null) => void;
  handoff?: ChatHandoffContext | null;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [markingId, setMarkingId] = useState<string | null>(null);
  const [creatingTask, setCreatingTask] = useState(false);
  const { announce } = useAnnouncer();
  const task = linkedContext?.task ?? null;
  const tasks = linkedContext?.tasks ?? (task ? [task] : []);
  const github = linkedContext?.github ?? [];
  const canLink = Boolean(sessionId && onLinkedContextChange);

  const linkedIds = new Set(tasks.map((t) => t.id));

  const markDone = async (t: (typeof tasks)[number]) => {
    setMarkingId(t.id);
    try {
      const res = await fetch(`/api/board/${encodeURIComponent(t.id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          lifecycle: "completed",
          lifecycleReason: sessionId
            ? `Marked done from chat (session ${sessionId})`
            : "Marked done from chat",
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json.ok === false) throw new Error(String(json.error ?? res.status));
      publishBoardChanged();
      const done = (x: NonNullable<ChatLinkedContext["task"]>) =>
        x.id === t.id ? { ...x, status: "done" as const, lifecycle: "completed" as const } : x;
      onLinkedContextChange?.((prev) =>
        prev
          ? { ...prev, task: prev.task ? done(prev.task) : prev.task, tasks: prev.tasks?.map(done) ?? prev.tasks }
          : prev,
      );
      announce(`Task "${t.title}" marked done.`);
    } catch {
      announce(`Couldn't mark "${t.title}" done — check your connection.`, "assertive");
    } finally {
      setMarkingId(null);
    }
  };

  const onAssigned = (card: Card) => {
    const linked = {
      id: card.id,
      title: card.title,
      status: card.status,
      priority: card.priority,
      lifecycle: card.lifecycle,
      labels: card.labels,
      cwd: card.cwd,
      projectId: card.projectId ?? null,
      notes: card.notes.trim() || null,
    };
    onLinkedContextChange?.((prev) => {
      const baseCtx = prev ?? { task: null, tasks: [], github: [] };
      if (baseCtx.tasks.some((t) => t.id === linked.id)) return baseCtx;
      return { ...baseCtx, task: baseCtx.task ?? linked, tasks: [...baseCtx.tasks, linked] };
    });
  };

  const createTaskFromConversation = async () => {
    if (!handoff || !sessionId || creatingTask) return;
    setCreatingTask(true);
    try {
      const result = await createSmartTaskFromChat({ sessionId, context: handoff });
      if (!result.ok || !result.card) throw new Error(result.error ?? "Failed to create task");
      onAssigned(result.card);
      const filled = [
        result.card.steps?.length ? `${result.card.steps.length} subtasks` : null,
        result.card.priority !== "medium" ? `priority ${result.card.priority}` : null,
        result.card.endDate ? `due ${result.card.endDate}` : null,
        result.card.github?.length ? `${result.card.github.length} GitHub links` : null,
      ].filter(Boolean);
      announce(
        `Task "${result.card.title}" created from this chat${filled.length ? ` with ${filled.join(", ")}` : ""}.`,
      );
    } catch (err) {
      const reason =
        err instanceof Error && err.message ? err.message.replace(/\.$/, "") : "check your connection";
      announce(`Couldn't create a task from this chat — ${reason}.`, "assertive");
    } finally {
      setCreatingTask(false);
    }
  };

  return {
    task,
    tasks,
    github,
    canLink,
    linkedIds,
    pickerOpen,
    setPickerOpen,
    markingId,
    markDone,
    creatingTask,
    createTaskFromConversation,
    onAssigned,
  };
}

export function ComposerLinkedWorkActions({
  linkedContext,
  onOpenTask,
  sessionId,
  onLinkedContextChange,
  handoff,
  sessionSettled = false,
  onCloseMenu,
  embedded = false,
  itemSemantic,
}: ComposerLinkedWorkActionsProps) {
  const {
    task,
    tasks,
    github,
    canLink,
    linkedIds,
    pickerOpen,
    setPickerOpen,
    markingId,
    markDone,
    creatingTask,
    createTaskFromConversation,
    onAssigned,
  } = useLinkedWorkController({ linkedContext, sessionId, onLinkedContextChange, handoff });

  if (!task && github.length === 0 && !canLink) {
    return (
      <div className="px-2.5 py-2 text-[length:var(--text-xs)] text-[var(--text-muted)]">
        No linked work yet — open a chat session to link tasks or wait for GitHub context to arrive.
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1">
      {tasks.map((t) => {
        const statusLine = [t.status, t.priority].filter(Boolean).join(" · ");
        return (
          <Fragment key={t.id}>
            <PopoverItem
              semantic={itemSemantic}
              icon="ph:kanban"
              title={`Open task: ${t.title}`}
              onSelect={() => {
                onCloseMenu?.();
                onOpenTask?.(t.id);
              }}
            >
              <span className="flex min-w-0 items-center gap-2">
                <span className="min-w-0 truncate">{t.title}</span>
                {statusLine ? <span className="shrink-0 text-[var(--text-muted)]">{statusLine}</span> : null}
              </span>
            </PopoverItem>
            {sessionSettled && t.status !== "done" && onLinkedContextChange ? (
              <PopoverItem
                semantic={itemSemantic}
                icon="ph:check-bold"
                disabled={markingId === t.id}
                title={`Mark task done: ${t.title}`}
                onSelect={() => void markDone(t)}
              >
                {markingId === t.id ? "Marking…" : "Mark done"}
              </PopoverItem>
            ) : null}
          </Fragment>
        );
      })}
      {canLink && handoff ? (
        <PopoverItem
          semantic={itemSemantic}
          icon="ph:kanban"
          disabled={creatingTask}
          title="Create a task from this conversation — auto-fills title, subtasks, priority, due date, and links"
          onSelect={() => void createTaskFromConversation()}
        >
          {creatingTask ? "Creating…" : "Create task"}
        </PopoverItem>
      ) : null}
      {canLink ? (
        <div className={embedded ? "min-w-0" : "relative"}>
          <PopoverItem
            semantic={itemSemantic}
            icon="ph:plus"
            title="Link a task to this chat"
            onSelect={() => setPickerOpen((open) => !open)}
          >
            Link a task to this chat
          </PopoverItem>
          {pickerOpen && sessionId ? (
            <TaskLinkPicker
              sessionId={sessionId}
              linkedIds={linkedIds}
              onAssigned={onAssigned}
              onClose={() => setPickerOpen(false)}
              embedded={embedded}
              handoff={handoff}
            />
          ) : null}
        </div>
      ) : null}
      {github.map((item) => {
        const compactLabel = compactGitHubContextLabel(item);
        return (
          <PopoverItem
            semantic={itemSemantic}
            key={item.id}
            leading={<Icon name={githubIcon(item.kind)} width={12} className="shrink-0 text-[var(--text-muted)]" />}
            title={`Open ${githubLabel(item.kind)} on GitHub: ${item.title}`}
            onSelect={() => {
              onCloseMenu?.();
              openExternalUrl(item.url);
            }}
          >
            <span className="flex min-w-0 items-center gap-2">
              <span className="min-w-0 truncate">{compactLabel}</span>
              {item.state ? <span className="shrink-0 text-[var(--text-muted)]">{item.state}</span> : null}
            </span>
          </PopoverItem>
        );
      })}
    </div>
  );
}

function TaskChip({
  task,
  onOpenTask,
}: {
  task: NonNullable<ChatLinkedContext["task"]>;
  onOpenTask?: (cardId: string) => void;
}) {
  const base =
    "cave-chat-linked-chip cave-chat-linked-chip--task inline-flex min-w-0 items-center border border-[color-mix(in_oklch,var(--accent-presence)_30%,transparent)] bg-[color-mix(in_oklch,var(--accent-presence)_9%,transparent)] text-[var(--text-secondary)]";
  const statusLine = [task.status, task.priority].filter(Boolean).join(" · ");
  const accessibleLabel = [task.title, task.status, task.priority].filter(Boolean).join(" ");
  const body = (
    <>
      <Icon name="ph:kanban" width={12} className="shrink-0 text-[var(--accent-presence)]" />
      <span className="min-w-0 truncate">{task.title}</span>
      {statusLine ? <span className="shrink-0 text-[var(--text-muted)]">{statusLine}</span> : null}
    </>
  );
  return onOpenTask ? (
    <button
      type="button"
      aria-label={accessibleLabel}
      onClick={() => onOpenTask(task.id)}
      title={`Open task: ${task.title}`}
      className={`${base} focus-ring transition-colors hover:border-[color-mix(in_oklch,var(--accent-presence)_55%,transparent)] hover:bg-[color-mix(in_oklch,var(--accent-presence)_18%,transparent)] hover:text-[var(--text-primary)]`}
    >
      {body}
      <Icon name="ph:arrow-square-out" width={10} className="shrink-0 text-[var(--text-muted)]" />
    </button>
  ) : (
    <span className={base}>{body}</span>
  );
}

/** Chip-strip presentation of the same linked-work controller: task chips ·
 *  mark-done · create/link affordances · GitHub chips, riding the composer's
 *  footer band. The composer menu's linked-work group offers the same flows
 *  as menu rows; both surfaces share useLinkedWorkController. */
export function LinkedContextRow({
  linkedContext,
  onOpenTask,
  sessionId,
  onLinkedContextChange,
  handoff,
  sessionSettled = false,
}: {
  linkedContext: ChatLinkedContext | null;
  onOpenTask?: (cardId: string) => void;
  sessionId?: string | null;
  onLinkedContextChange?: (updater: (prev: ChatLinkedContext | null) => ChatLinkedContext | null) => void;
  /** Recent turns + familiar/project for the picker's "New task from this chat"
   *  handoff (cave-px7). Absent → the picker only links existing tasks. */
  handoff?: ChatHandoffContext | null;
  /** True once the latest assistant turn settled cleanly — gates the
   *  one-click "Mark done" on linked tasks (cave-32ks phase 3): finished
   *  familiar work is the moment the card can flip without leaving chat. */
  sessionSettled?: boolean;
}) {
  const {
    task,
    tasks,
    github,
    canLink,
    linkedIds,
    pickerOpen,
    setPickerOpen,
    markingId,
    markDone,
    creatingTask,
    createTaskFromConversation,
    onAssigned,
  } = useLinkedWorkController({ linkedContext, sessionId, onLinkedContextChange, handoff });
  if (!task && github.length === 0 && !canLink) return null;

  return (
    <div className="cave-chat-linked-context">
      {tasks.map((t) => (
        <span key={t.id} className="inline-flex min-w-0 items-center gap-1">
          <TaskChip task={t} onOpenTask={onOpenTask} />
          {sessionSettled && t.status !== "done" && onLinkedContextChange ? (
            <button
              type="button"
              onClick={() => void markDone(t)}
              disabled={markingId === t.id}
              title={`Mark task done: ${t.title}`}
              aria-label={`Mark task done: ${t.title}`}
              className="cave-chat-linked-chip cave-chat-linked-chip--mark-done focus-ring inline-flex items-center gap-1 border border-[color-mix(in_oklch,var(--color-success)_32%,transparent)] bg-[color-mix(in_oklch,var(--color-success)_9%,transparent)] text-[var(--color-success)] transition-colors hover:bg-[color-mix(in_oklch,var(--color-success)_18%,transparent)] disabled:opacity-60"
            >
              <Icon name="ph:check-bold" width={10} className="shrink-0" />
              {markingId === t.id ? "Marking…" : "Mark done"}
            </button>
          ) : null}
        </span>
      ))}
      {canLink && handoff ? (
        <button
          type="button"
          onClick={() => void createTaskFromConversation()}
          disabled={creatingTask}
          title="Create a task from this conversation — auto-fills title, subtasks, priority, due date, and links"
          aria-label="Create a task from this conversation"
          className="cave-chat-linked-chip cave-chat-linked-chip--create-task focus-ring inline-flex items-center gap-1 border border-dashed border-[color-mix(in_oklch,var(--accent-presence)_45%,transparent)] bg-transparent text-[var(--text-muted)] transition-colors hover:border-[var(--accent-presence)] hover:bg-[color-mix(in_oklch,var(--accent-presence)_9%,transparent)] hover:text-[var(--text-primary)] disabled:opacity-60"
        >
          <Icon name="ph:kanban" width={11} className="shrink-0 text-[var(--accent-presence)]" />
          {creatingTask ? "Creating…" : "Create task"}
        </button>
      ) : null}
      {canLink ? (
        <span className="relative inline-flex">
          <button
            type="button"
            onClick={() => setPickerOpen((open) => !open)}
            title="Link a task to this chat"
            aria-label="Link a task to this chat"
            className="cave-chat-linked-chip cave-chat-linked-chip--link-task focus-ring inline-flex items-center justify-center border border-dashed border-[var(--border-strong)] bg-transparent text-[var(--text-muted)] transition-colors hover:border-[var(--accent-presence)] hover:text-[var(--text-primary)]"
          >
            <Icon name="ph:plus" width={11} className="shrink-0" />
          </button>
          {pickerOpen && sessionId ? (
            <TaskLinkPicker
              sessionId={sessionId}
              linkedIds={linkedIds}
              onAssigned={onAssigned}
              onClose={() => setPickerOpen(false)}
              handoff={handoff}
            />
          ) : null}
        </span>
      ) : null}
      {github.map((item) => {
        const compactLabel = compactGitHubContextLabel(item);
        return (
          <a
            key={item.id}
            href={item.url}
            title={`Open ${githubLabel(item.kind)} on GitHub: ${item.title}`}
            className="cave-chat-linked-chip cave-chat-linked-chip--github inline-flex min-w-0 items-center border border-[var(--border-hairline)] bg-[var(--bg-raised)]/30 text-[var(--text-secondary)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]"
            onClick={(event) => {
              event.preventDefault();
              openExternalUrl(item.url);
            }}
          >
            <Icon name={githubIcon(item.kind)} width={12} className="shrink-0 text-[var(--text-muted)]" />
            <span className="min-w-0 truncate">{compactLabel}</span>
            {item.state ? <span className="shrink-0 text-[var(--text-muted)]">{item.state}</span> : null}
          </a>
        );
      })}
    </div>
  );
}
