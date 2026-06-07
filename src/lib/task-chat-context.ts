type TaskContextCard = {
  title: string;
  notes?: string | null;
  status?: string | null;
  priority?: string | null;
  labels?: string[] | null;
  links?: string[] | null;
  github?: Array<{ title: string; url: string }> | null;
};

function linesForList(title: string, values: string[]): string[] {
  if (values.length === 0) return [];
  return [title, ...values.map((value) => `- ${value}`)];
}

export function buildTaskContext(card: TaskContextCard): string {
  const lines = [
    "Task context:",
    `Title: ${card.title.trim()}`,
    card.status ? `Status: ${card.status}` : null,
    card.priority ? `Priority: ${card.priority}` : null,
    card.labels?.length ? `Labels: ${card.labels.join(", ")}` : null,
  ].filter((line): line is string => Boolean(line));

  const notes = card.notes?.trim();
  if (notes) lines.push("Notes:", notes);

  lines.push(
    ...linesForList("Links:", (card.links ?? []).map((link) => link.trim()).filter(Boolean)),
    ...linesForList(
      "GitHub:",
      (card.github ?? [])
        .map((item) => {
          const title = item.title.trim();
          const url = item.url.trim();
          if (!title && !url) return "";
          if (!title) return url;
          if (!url) return title;
          return `${title}: ${url}`;
        })
        .filter(Boolean),
    ),
  );

  return lines.join("\n");
}

export function buildTaskAwarePrompt(prompt: string, taskContext: string | null): string {
  const text = prompt.trim();
  if (!taskContext) return text;
  return `${taskContext}\n\nCurrent user message:\n${text}`;
}

export function buildInitialTaskChatPrompt(card: TaskContextCard): string {
  return `${buildTaskContext(card)}\n\nUse this session as the working thread for the task.`;
}

export async function taskContextForSession(sessionId?: string | null): Promise<string | null> {
  if (!sessionId) return null;
  const { loadBoard } = await import("@/lib/cave-board");
  const board = await loadBoard();
  const card = board.cards.find((candidate) => candidate.sessionId === sessionId);
  return card ? buildTaskContext(card) : null;
}
