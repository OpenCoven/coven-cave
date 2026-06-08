import { loadBoard } from "@/lib/cave-board";
import type { CardGitHubKind } from "@/lib/cave-board-types";

export type ChatLinkedContext = {
  task:
    | {
        id: string;
        title: string;
        status: string;
        priority: string;
        lifecycle: string;
        labels: string[];
        cwd: string | null;
        notes: string | null;
      }
    | null;
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
  const card = board.cards.find((card) => card.sessionId === sessionId);
  if (!card) return null;

  return {
    task: {
      id: card.id,
      title: card.title,
      status: card.status,
      priority: card.priority,
      lifecycle: card.lifecycle,
      labels: card.labels,
      cwd: card.cwd,
      notes: card.notes.trim() ? card.notes : null,
    },
    github: card.github.map((item) => ({
      id: item.id,
      kind: item.kind,
      repo: item.repo,
      number: item.number,
      title: item.title,
      url: item.url,
      state: item.state,
      labels: item.labels,
    })),
  };
}
