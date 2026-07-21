// Chat → board task handoff (cave-px7): let useful chat work become board work
// without manual copy/paste. The pure helpers here derive a card title from the
// conversation and build notes that carry an auditable "Source" block — the
// session id, which turns were captured, and when — plus a bounded transcript
// excerpt. `createTaskFromChat` POSTs the assembled card to /api/board with
// `sessionId` already set, so the new card is linked to this chat from birth:
// the chat header's task chips pick it up, and the board's task-chat dispatch
// (`buildInitialTaskChatPrompt` + `taskContextForSession`) can send it to a
// familiar with the captured context included.

import type { Card } from "@/lib/cave-board-types";
import { publishBoardChanged } from "@/lib/board-cache-events";

export type HandoffTurn = {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  createdAt?: string;
  pending?: boolean;
  error?: boolean;
};

/** What the chat surface hands to the picker: the visible turns plus the
 *  chat's current familiar/project so the new card inherits them. */
export type ChatHandoffContext = {
  turns: HandoffTurn[];
  familiarId?: string | null;
  projectId?: string | null;
};

const TITLE_MAX = 80;
const DEFAULT_EXCERPT_TURNS = 6;
const TURN_TEXT_MAX = 700;

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/** Turns worth carrying onto a card: settled user/assistant turns with real
 *  text. System chrome, in-flight (pending) and failed turns are dropped. */
export function handoffTurns(turns: HandoffTurn[]): HandoffTurn[] {
  return turns.filter(
    (turn) =>
      (turn.role === "user" || turn.role === "assistant") &&
      !turn.pending &&
      !turn.error &&
      turn.text.trim().length > 0,
  );
}

/** Card title from the conversation: the first line of the first user turn
 *  (what the user asked for), truncated. Falls back to the first turn of any
 *  role, then to a generic title, so this never returns an empty string. */
export function deriveTaskTitleFromTurns(turns: HandoffTurn[]): string {
  const usable = handoffTurns(turns);
  const source = usable.find((turn) => turn.role === "user") ?? usable[0];
  const firstLine = source?.text
    .split("\n")
    .map((line) => line.trim())
    .find(Boolean);
  return firstLine ? truncate(firstLine, TITLE_MAX) : "Task from chat";
}

/** Bounded transcript excerpt: the LAST `maxTurns` usable turns (recent work is
 *  what's being handed off), each prefixed with its role and truncated so a
 *  long chat can't bloat the board file. */
export function buildChatExcerpt(
  turns: HandoffTurn[],
  { maxTurns = DEFAULT_EXCERPT_TURNS }: { maxTurns?: number } = {},
): string {
  return handoffTurns(turns)
    .slice(-maxTurns)
    .map((turn) => `${turn.role}: ${truncate(turn.text.trim(), TURN_TEXT_MAX)}`)
    .join("\n\n");
}

/** Card notes with the audit trail: which session and turns the card was cut
 *  from and when, followed by the excerpt itself. */
export function buildChatHandoffNotes({
  sessionId,
  turns,
  capturedAt,
  maxTurns = DEFAULT_EXCERPT_TURNS,
}: {
  sessionId: string;
  turns: HandoffTurn[];
  capturedAt: string;
  maxTurns?: number;
}): string {
  const usable = handoffTurns(turns);
  const included = usable.slice(-maxTurns);
  const lines = [
    `Source: chat session ${sessionId}`,
    included.length
      ? `Turns: ${included.length} of ${usable.length} (${included[0].id} → ${included[included.length - 1].id})`
      : null,
    `Captured: ${capturedAt}`,
  ].filter((line): line is string => Boolean(line));
  const excerpt = buildChatExcerpt(turns, { maxTurns });
  return excerpt ? `${lines.join("\n")}\n\nTranscript excerpt:\n\n${excerpt}` : lines.join("\n");
}

/** Create a board card from the current chat. The card lands in `inbox`,
 *  linked to this chat (`sessionId`) and inheriting the chat's familiar and
 *  project, with source-context notes for auditability. */
export async function createTaskFromChat({
  sessionId,
  context,
  title,
  capturedAt,
}: {
  sessionId: string;
  context: ChatHandoffContext;
  /** Explicit title (e.g. the picker's typed query); derived from the turns when omitted. */
  title?: string;
  capturedAt?: string;
}): Promise<{ ok: boolean; card?: Card; error?: string }> {
  const notes = buildChatHandoffNotes({
    sessionId,
    turns: context.turns,
    capturedAt: capturedAt ?? new Date().toISOString(),
  });
  try {
    const res = await fetch("/api/board", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: title?.trim() || deriveTaskTitleFromTurns(context.turns),
        notes,
        status: "inbox" as const,
        sessionId,
        familiarId: context.familiarId ?? null,
        projectId: context.projectId ?? null,
        labels: ["chat-handoff"],
      }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.ok) {
      return { ok: false, error: data?.error ?? `HTTP ${res.status}` };
    }
    publishBoardChanged();
    return { ok: true, card: data.card as Card };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Network error" };
  }
}
