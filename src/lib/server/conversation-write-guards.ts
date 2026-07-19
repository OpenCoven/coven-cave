import type { ChatTurn } from "@/lib/cave-conversations";

/**
 * Conversation write contract + bounds (issue #3469).
 *
 * WHO WRITES WHAT.
 *   - `chat/send` is the harness-truth writer. It calls `saveConversation`
 *     directly with real assistant turns, tool metadata, usage and cost. It is
 *     the authoritative producer of assistant/system content and is NOT routed
 *     through these guards.
 *   - `chat/conversation/[id]` POST/PUT are client-facing turn writers (branch
 *     edits, imports, replays). They may persist turn *text*, role, attachments
 *     and branching pointers, but they must not be able to forge harness
 *     telemetry onto assistant/system turns. `sanitizeClientTurn` strips the
 *     server-owned fields below so a client cannot fabricate a "real" assistant
 *     response with fake usage/cost/tool traces.
 *
 * MOBILE. The chat namespace is intentionally reachable by the iOS app over
 * `tailscale serve` (see local-origin.ts), so these writes are NOT locked to
 * loopback — doing so would break mobile chat. Trust is instead enforced by
 * bounding size and by field ownership, which hold regardless of origin.
 *
 * BOUNDS. Turn count, per-turn text length, and total serialized payload are
 * capped so a single write cannot pressure disk or the UI; over-limit writes
 * return 413.
 */

/** Max turns persisted in one conversation write (full-list PUT or append POST). */
export const MAX_CONVERSATION_TURNS = 5000;

/** Max characters in a single turn's text. */
export const MAX_TURN_TEXT_CHARS = 200_000;

/** Max serialized byte size of an incoming turns payload. */
export const MAX_TURNS_PAYLOAD_BYTES = 8 * 1024 * 1024;

/**
 * Fields on a ChatTurn that only the harness (`chat/send`) may author. A
 * client-supplied assistant/system turn cannot set these — they are stripped
 * before persistence so run/telemetry truth stays harness-owned.
 */
const HARNESS_OWNED_ASSISTANT_FIELDS = [
  "usage",
  "costUsd",
  "tools",
  "reasoning",
  "durationMs",
  "responseMetadata",
  "harnessSessionId",
] as const;

export type TurnBoundsError =
  | { ok: false; status: 400 | 413; error: string };

/**
 * Enforce count + per-turn + total-payload bounds on a normalized turn list.
 * Returns null when within bounds, or a typed error for the route to return.
 */
export function checkTurnBounds(turns: ChatTurn[]): TurnBoundsError | null {
  if (turns.length > MAX_CONVERSATION_TURNS) {
    return {
      ok: false,
      status: 413,
      error: `too many turns (max ${MAX_CONVERSATION_TURNS})`,
    };
  }
  for (const turn of turns) {
    if (typeof (turn as any).text !== "string") {
      return { ok: false, status: 400, error: "turn text must be a string" };
    }
    if (turn.text.length > MAX_TURN_TEXT_CHARS) {
      return {
        ok: false,
        status: 413,
        error: `turn text too long (max ${MAX_TURN_TEXT_CHARS} chars)`,
      };
    }
  }
  let bytes: number;
  try {
    bytes = Buffer.byteLength(JSON.stringify(turns), "utf8");
  } catch {
    return { ok: false, status: 400, error: "turns not serializable" };
  }
  if (bytes > MAX_TURNS_PAYLOAD_BYTES) {
    return {
      ok: false,
      status: 413,
      error: `turns payload too large (max ${MAX_TURNS_PAYLOAD_BYTES} bytes)`,
    };
  }
  return null;
}

/**
 * Strip harness-owned telemetry from a client-authored assistant/system turn.
 * User turns are returned unchanged. Returns the original turn when no fields
 * are stripped; otherwise returns a shallow clone. Never mutates the input.
 */
export function sanitizeClientTurn(turn: ChatTurn): ChatTurn {
  if (turn.role === "user") return turn;
  const clone: Record<string, unknown> = { ...turn };
  let stripped = false;
  for (const field of HARNESS_OWNED_ASSISTANT_FIELDS) {
    if (field in clone) {
      delete clone[field];
      stripped = true;
    }
  }
  return stripped ? (clone as unknown as ChatTurn) : turn;
}

/** Apply `sanitizeClientTurn` across a list. */
export function sanitizeClientTurns(turns: ChatTurn[]): ChatTurn[] {
  return turns.map(sanitizeClientTurn);
}
