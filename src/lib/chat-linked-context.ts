import { loadBoard } from "@/lib/cave-board";
import type { CardGitHubKind } from "@/lib/cave-board-types";

type LinkedTask = {
  id: string;
  title: string;
  status: string;
  priority: string;
  lifecycle: string;
  labels: string[];
  cwd: string | null;
  /** Stable project id from the card — the task's project association, which
   *  the chat picker prefers over the session's recorded cwd. */
  projectId: string | null;
  notes: string | null;
};

export type ChatLinkedContext = {
  // `task` is the primary (first) linked task, kept for single-task consumers
  // (mobile header, meta title, lifecycle chip); `tasks` lists every card that
  // shares this chat's session.
  task:
    | {
        id: string;
        title: string;
        status: string;
        priority: string;
        lifecycle: string;
        labels: string[];
        cwd: string | null;
        projectId: string | null;
        notes: string | null;
      }
    | null;
  tasks: LinkedTask[];
  github: Array<{
    id: string;
    kind: CardGitHubKind;
    repo: string;
    number?: number;
    title: string;
    url: string;
    state?: string;
    labels: string[];
  }>;
};

export async function linkedContextForSession(sessionId: string): Promise<ChatLinkedContext | null> {
  const board = await loadBoard();
  const cards = board.cards.filter((card) => card.sessionId === sessionId);
  if (cards.length === 0) return null;

  const tasks: LinkedTask[] = cards.map((card) => ({
    id: card.id,
    title: card.title,
    status: card.status,
    priority: card.priority,
    lifecycle: card.lifecycle,
    labels: card.labels,
    cwd: card.cwd,
    projectId: card.projectId ?? null,
    notes: card.notes.trim() || null,
  }));

  // Aggregate GitHub links across every linked card, de-duped by id.
  const github: ChatLinkedContext["github"] = [];
  const seen = new Set<string>();
  for (const card of cards) {
    for (const item of card.github) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      github.push({
        id: item.id,
        kind: item.kind,
        repo: item.repo,
        number: item.number,
        title: item.title,
        url: item.url,
        state: item.state,
        labels: item.labels,
      });
    }
  }

  return { task: tasks[0] ?? null, tasks, github };
}
