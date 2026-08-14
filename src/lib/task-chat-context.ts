import { buildPromptWithAttachments, type ChatAttachment } from "@/lib/chat-attachments";
import type { Card } from "@/lib/cave-board-types";

type TaskContextCard = {
  title: string;
  notes?: string | null;
  status?: string | null;
  priority?: string | null;
  labels?: string[] | null;
  links?: string[] | null;
  github?: Array<{ title: string; url: string }> | null;
  /** Files carried onto the card at creation. Folded into the initial dispatch
   * prompt so the familiar working the task can read them. */
  attachments?: ChatAttachment[] | null;
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

  // Name the card's attachments so follow-up turns know files exist. Only the
  // initial dispatch prompt carries their full content (buildInitialTaskChatPrompt);
  // here a summary line keeps every later turn's context small.
  const attachmentNames = (card.attachments ?? [])
    .map((attachment) => attachment.name.trim())
    .filter(Boolean);
  if (attachmentNames.length) lines.push(`Attachments: ${attachmentNames.join(", ")}`);

  return lines.join("\n");
}

export function buildTaskAwarePrompt(prompt: string, taskContext: string | null): string {
  const text = prompt.trim();
  if (!taskContext) return text;
  return `${taskContext}\n\nCurrent user message:\n${text}`;
}

export function buildInitialTaskChatPrompt(card: TaskContextCard): string {
  const base = `${buildTaskContext(card)}\n\nUse this session as the working thread for the task.`;
  const attachments = card.attachments ?? [];
  // Board attachments are stored lean (text inlined; image dataUrls stripped),
  // so buildPromptWithAttachments renders text bodies in full and images as a
  // metadata line — exactly the once-at-dispatch delivery the composer uses.
  return attachments.length
    ? buildPromptWithAttachments(base, attachments, { imagesMetadataOnly: true })
    : base;
}

/**
 * Look up the server-owned task relation for a conversation. Consumers that
 * need to launch a task chat use this rather than accepting project or
 * familiar identity from the browser alongside a reserved conversation id.
 */
export async function taskCardForSession(sessionId?: string | null): Promise<Card | null> {
  if (!sessionId) return null;
  const { loadBoard } = await import("@/lib/cave-board");
  const board = await loadBoard();
  return board.cards.find((candidate) => candidate.sessionId === sessionId) ?? null;
}

export async function taskContextForSession(sessionId?: string | null): Promise<string | null> {
  const card = await taskCardForSession(sessionId);
  return card ? buildTaskContext(card) : null;
}
