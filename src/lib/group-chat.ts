/**
 * group-chat.ts — pure model + reducers for the Group Chat ("coven") surface.
 *
 * A *coven* is a saved set of familiars you talk to together. Sending a prompt
 * fans it out to every participant in parallel (one `/api/chat/send` stream per
 * familiar — the same client-side broadcast model the iOS app uses, since the
 * daemon/coven CLI has no server-side "group session" concept). Each familiar
 * keeps its own resumable session; the group just remembers which session id
 * belongs to which familiar so every thread persists across reloads.
 *
 * Everything here is framework-free and deterministic (except the thin
 * localStorage + id/time wrappers at the bottom) so the streaming reducers and
 * group bookkeeping are unit-testable without a DOM.
 */

const GROUPS_KEY = "cave:group-chat:groups:v1";
const TRANSCRIPTS_KEY_PREFIX = "cave:group-chat:transcript:";

/** A saved group of familiars chatted with together. */
export type CovenGroup = {
  id: string;
  name: string;
  familiarIds: string[];
  /** Per-familiar resumed session ids so each thread survives reloads. */
  sessions: Record<string, string>;
  createdAt: string;
  updatedAt: string;
};

/** One prompt the user broadcast to the whole coven. */
export type GroupUserTurn = {
  id: string;
  role: "user";
  text: string;
  /**
   * Familiar ids this prompt was directed at via `@mentions`. When present the
   * message was *targeted* — only these participants replied. Absent/undefined
   * means it was broadcast to the whole coven.
   */
  targetFamiliarIds?: string[];
  createdAt: string;
};

export type GroupReplyStatus = "queued" | "streaming" | "done" | "error";

/** One familiar's reply to a user turn. There is exactly one per participant. */
export type GroupReply = {
  id: string;
  role: "assistant";
  familiarId: string;
  /** Id of the {@link GroupUserTurn} this answers. */
  replyTo: string;
  /** Resolved once the stream emits its `session` event. */
  sessionId: string | null;
  text: string;
  status: GroupReplyStatus;
  /** Latest progress/tool label — the "thinking…" line while streaming. */
  activity?: string;
  error?: string;
  durationMs?: number;
  costUsd?: number;
  createdAt: string;
};

export type GroupTurn = GroupUserTurn | GroupReply;

/**
 * The subset of `/api/chat/send` stream events the group surface consumes.
 * Mirrors the shape in chat-view.tsx; unknown kinds are ignored by the reducer.
 */
export type GroupStreamEvent =
  | { kind: "session"; sessionId: string }
  | { kind: "user"; text: string }
  | { kind: "assistant_chunk"; text: string }
  | { kind: "progress"; label?: string; status?: "running" | "done" | "error" }
  | { kind: "tool_use"; name?: string; status?: "running" | "ok" | "error" }
  | { kind: "done"; durationMs?: number; isError?: boolean; sessionId?: string; costUsd?: number }
  | { kind: "error"; message: string; code?: string };

// ---------------------------------------------------------------------------
// Streaming reducers (pure)
// ---------------------------------------------------------------------------

/** Apply one stream event to a reply, returning the next immutable state. */
export function applyGroupEvent(reply: GroupReply, ev: GroupStreamEvent): GroupReply {
  switch (ev.kind) {
    case "session":
      return { ...reply, sessionId: ev.sessionId };
    case "assistant_chunk":
      return { ...reply, status: "streaming", activity: undefined, text: reply.text + ev.text };
    case "progress":
      return {
        ...reply,
        status: reply.status === "queued" ? "streaming" : reply.status,
        activity: ev.status === "done" ? reply.activity : ev.label ?? reply.activity,
      };
    case "tool_use":
      return {
        ...reply,
        status: reply.status === "queued" ? "streaming" : reply.status,
        activity: ev.name ? `${ev.name}…` : reply.activity,
      };
    case "done":
      return {
        ...reply,
        status: ev.isError ? "error" : "done",
        sessionId: ev.sessionId ?? reply.sessionId,
        durationMs: ev.durationMs ?? reply.durationMs,
        costUsd: ev.costUsd ?? reply.costUsd,
        activity: undefined,
        error: ev.isError ? reply.error ?? "request failed" : reply.error,
      };
    case "error":
      return { ...reply, status: "error", error: ev.message, activity: undefined };
    default:
      return reply;
  }
}

/**
 * Parse the rolling SSE buffer into complete `data:` events, returning the
 * leftover partial frame. Same `\n\n`-delimited framing as chat-view.tsx.
 */
export function parseSseBuffer(buffer: string): { events: GroupStreamEvent[]; rest: string } {
  const events: GroupStreamEvent[] = [];
  let rest = buffer;
  let idx: number;
  while ((idx = rest.indexOf("\n\n")) >= 0) {
    const frame = rest.slice(0, idx);
    rest = rest.slice(idx + 2);
    if (!frame.startsWith("data:")) continue;
    const payload = frame.slice(5).trim();
    if (!payload) continue;
    try {
      events.push(JSON.parse(payload) as GroupStreamEvent);
    } catch {
      /* skip malformed frame */
    }
  }
  return { events, rest };
}

// ---------------------------------------------------------------------------
// Group bookkeeping (pure)
// ---------------------------------------------------------------------------

/** Derive a friendly default name from participant display names. */
export function defaultGroupName(names: string[]): string {
  const clean = names.map((n) => n.trim()).filter(Boolean);
  if (clean.length === 0) return "New coven";
  if (clean.length === 1) return clean[0];
  if (clean.length === 2) return `${clean[0]} & ${clean[1]}`;
  return `${clean[0]}, ${clean[1]} +${clean.length - 2}`;
}

// ---------------------------------------------------------------------------
// @mentions — tag specific familiars to target a message at them (pure)
// ---------------------------------------------------------------------------

/** A coven member as seen by the mention parser/autocomplete. */
export type MentionableFamiliar = { id: string; name: string };

/** True for a char that may not abut the end of a matched `@name` (a word char,
 *  so `@Nova` does not greedily match a participant named `Nov`). */
function isWordChar(ch: string | undefined): boolean {
  return ch !== undefined && /[a-z0-9_]/i.test(ch);
}

/** True if char `before` permits an `@` to *start* a mention (start-of-string
 *  or whitespace — so an email like `a@b` is never read as a mention). */
function isMentionBoundary(before: string): boolean {
  return before === "" || /\s/.test(before);
}

/**
 * Scan free text for `@mentions` of the given participants and return the ids
 * of every familiar named (deduped, in first-seen order). Matching is
 * case-insensitive and prefers the longest participant name, so `@Nova Star`
 * resolves to "Nova Star" rather than a shorter "Nova". Only ids present in
 * `participants` are ever returned. Empty result ⇒ no valid mention ⇒ caller
 * should broadcast to the whole coven.
 */
export function parseMentions(text: string, participants: MentionableFamiliar[]): string[] {
  const byLongest = [...participants]
    .filter((p) => p.name.trim())
    .sort((a, b) => b.name.length - a.name.length);
  if (byLongest.length === 0) return [];
  const lower = text.toLowerCase();
  const ids: string[] = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== "@") continue;
    if (!isMentionBoundary(i === 0 ? "" : text[i - 1])) continue;
    const rest = lower.slice(i + 1);
    for (const p of byLongest) {
      const name = p.name.toLowerCase();
      if (!rest.startsWith(name)) continue;
      if (isWordChar(rest[name.length])) continue; // `@Novak` ≠ `@Nova`
      if (!ids.includes(p.id)) ids.push(p.id);
      break;
    }
  }
  return ids;
}

/**
 * Locate the `@mention` token the caret is currently editing, for autocomplete.
 * Returns the `@`'s index and the partial query typed after it, or `null` when
 * the caret is not inside a mention. The token starts at an `@` preceded by
 * whitespace/start and does not span an `@` or newline.
 */
export function findActiveMention(
  text: string,
  caret: number,
): { start: number; query: string } | null {
  let i = caret - 1;
  while (i >= 0 && text[i] !== "@" && text[i] !== "\n") i--;
  if (i < 0 || text[i] !== "@") return null;
  if (!isMentionBoundary(i === 0 ? "" : text[i - 1])) return null;
  return { start: i, query: text.slice(i + 1, caret) };
}

/**
 * Filter participants matching an in-progress mention query (case-insensitive
 * prefix on the display name). A blank query lists everyone.
 */
export function matchMentions(
  query: string,
  participants: MentionableFamiliar[],
): MentionableFamiliar[] {
  const q = query.trim().toLowerCase();
  if (!q) return participants;
  return participants.filter((p) => p.name.toLowerCase().startsWith(q));
}

/**
 * Replace the active mention token (`@<query>` at `start`) with the chosen
 * familiar's full `@name `, returning the new text and caret position.
 */
export function applyMention(
  text: string,
  start: number,
  query: string,
  name: string,
): { text: string; caret: number } {
  const insert = `@${name} `;
  const end = start + 1 + query.length;
  return { text: text.slice(0, start) + insert + text.slice(end), caret: start + insert.length };
}

export function makeGroup(
  name: string,
  familiarIds: string[],
  now: string,
  id: string,
): CovenGroup {
  return {
    id,
    name: name.trim() || "New coven",
    familiarIds: dedupe(familiarIds),
    sessions: {},
    createdAt: now,
    updatedAt: now,
  };
}

/** Insert or replace a group, keeping most-recently-updated first. */
export function upsertGroup(groups: CovenGroup[], group: CovenGroup): CovenGroup[] {
  const rest = groups.filter((g) => g.id !== group.id);
  return [group, ...rest].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function removeGroup(groups: CovenGroup[], id: string): CovenGroup[] {
  return groups.filter((g) => g.id !== id);
}

/** Record (or clear) the resumed session id for one familiar in a group. */
export function setGroupSession(
  group: CovenGroup,
  familiarId: string,
  sessionId: string | null,
  now: string,
): CovenGroup {
  const sessions = { ...group.sessions };
  if (sessionId) sessions[familiarId] = sessionId;
  else delete sessions[familiarId];
  return { ...group, sessions, updatedAt: now };
}

/** Update a group's participant roster, dropping orphaned session pins. */
export function setGroupParticipants(
  group: CovenGroup,
  familiarIds: string[],
  now: string,
): CovenGroup {
  const ids = dedupe(familiarIds);
  const sessions: Record<string, string> = {};
  for (const id of ids) {
    if (group.sessions[id]) sessions[id] = group.sessions[id];
  }
  return { ...group, familiarIds: ids, sessions, updatedAt: now };
}

function dedupe(ids: string[]): string[] {
  return [...new Set(ids.filter(Boolean))];
}

// ---------------------------------------------------------------------------
// Persistence (thin localStorage wrappers — safe to call client-side only)
// ---------------------------------------------------------------------------

export function loadGroups(): CovenGroup[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(GROUPS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isCovenGroup);
  } catch {
    return [];
  }
}

export function saveGroups(groups: CovenGroup[]): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(GROUPS_KEY, JSON.stringify(groups));
  } catch {
    /* storage full / private mode — keep the in-memory copy */
  }
}

export function loadTranscript(groupId: string): GroupTurn[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(TRANSCRIPTS_KEY_PREFIX + groupId);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as GroupTurn[]) : [];
  } catch {
    return [];
  }
}

export function saveTranscript(groupId: string, turns: GroupTurn[]): void {
  if (typeof localStorage === "undefined") return;
  try {
    // Drop in-flight replies — a reload can't resume a half-finished stream, so
    // persisting "streaming" state would strand a permanent spinner.
    const settled = turns.filter(
      (t) => t.role === "user" || (t as GroupReply).status === "done" || (t as GroupReply).status === "error",
    );
    localStorage.setItem(TRANSCRIPTS_KEY_PREFIX + groupId, JSON.stringify(settled));
  } catch {
    /* ignore */
  }
}

function isCovenGroup(value: unknown): value is CovenGroup {
  if (!value || typeof value !== "object") return false;
  const g = value as Record<string, unknown>;
  return (
    typeof g.id === "string" &&
    typeof g.name === "string" &&
    Array.isArray(g.familiarIds) &&
    typeof g.sessions === "object" &&
    g.sessions !== null
  );
}
