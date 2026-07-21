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
