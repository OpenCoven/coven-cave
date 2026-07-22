// Ask Salem — pure helpers for the dedicated full-screen section.
//
// React-free so thread persistence, familiar fallback, history capping, and
// local-index context building are unit-testable (ask-salem-thread.test.ts).
// The context builder emits the same `SalemSearchContext` wire shape the ⌘K
// palette sends (`command-palette-salem-context.ts`), which /api/salem parses
// via `formatSearchContextForPrompt` — one context format, two producers.

import type { SalemSearchContext } from "@/lib/command-palette-salem-context";

export type AskSalemRole = "user" | "salem";

export type AskSalemMessage = {
  role: AskSalemRole;
  text: string;
  /** Epoch ms when the turn was recorded; absent on legacy entries. */
  at?: number;
};

/** Versioned key — bump the suffix when the persisted shape changes. */
export const ASK_SALEM_THREAD_KEY = "cave:ask-salem:thread:v1";

/** Hard cap on persisted turns; oldest drop first. */
export const ASK_SALEM_THREAD_CAP = 50;

/** Turns of prior conversation forwarded to /api/salem for follow-ups. */
export const ASK_SALEM_HISTORY_CAP = 8;

/** Per-turn character budget when history rides the synthesis prompt. */
export const ASK_SALEM_HISTORY_CHAR_CAP = 600;

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function isAskSalemMessage(value: unknown): value is AskSalemMessage {
  if (!value || typeof value !== "object") return false;
  const entry = value as { role?: unknown; text?: unknown };
  return (
    (entry.role === "user" || entry.role === "salem") &&
    typeof entry.text === "string" &&
    entry.text.length > 0
  );
}

/** Restore the persisted thread. Corrupt or foreign payloads yield []. */
export function loadThread(storage: StorageLike): AskSalemMessage[] {
  try {
    const raw = storage.getItem(ASK_SALEM_THREAD_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isAskSalemMessage).slice(-ASK_SALEM_THREAD_CAP);
  } catch {
    return [];
  }
}

/** Persist the thread (capped to the newest ASK_SALEM_THREAD_CAP turns).
 *  Returns the capped list so callers can mirror state. Quota or serialization
 *  failures are swallowed — history is a convenience, never a blocker. */
export function saveThread(
  storage: StorageLike,
  messages: readonly AskSalemMessage[],
): AskSalemMessage[] {
  const capped = messages.filter(isAskSalemMessage).slice(-ASK_SALEM_THREAD_CAP);
  try {
    storage.setItem(ASK_SALEM_THREAD_KEY, JSON.stringify(capped));
  } catch {
    /* storage full / privacy mode — in-memory thread still works */
  }
  return capped;
}

export function clearThread(storage: StorageLike): void {
  try {
    storage.removeItem(ASK_SALEM_THREAD_KEY);
  } catch {
    /* ignore */
  }
}

/** The familiar whose connected model synthesizes the answer. Mirrors the ⌘K
 *  palette's fallback: active familiar → the "salem" familiar → first in the
 *  coven → null (familiar-less asks use the route's hosted fallback). Never
 *  invents an id. */
export function pickAskFamiliar<T extends { id: string }>(
  familiars: readonly T[],
  activeFamiliarId?: string | null,
): T | null {
  if (activeFamiliarId) {
    const active = familiars.find((f) => f.id === activeFamiliarId);
    if (active) return active;
  }
  return familiars.find((f) => f.id === "salem") ?? familiars[0] ?? null;
}

/** Prior turns for the synthesis prompt: everything before the question being
 *  asked, newest-last, capped in count and per-turn length. */
export function historyForApi(
  messages: readonly AskSalemMessage[],
): Array<{ role: AskSalemRole; text: string }> {
  return messages
    .filter(isAskSalemMessage)
    .slice(-ASK_SALEM_HISTORY_CAP)
    .map((m) => ({ role: m.role, text: m.text.slice(0, ASK_SALEM_HISTORY_CHAR_CAP) }));
}

// ── Local index context ───────────────────────────────────────────────────────
// The palette filters its corpora as the user types; here the full corpora
// arrive unfiltered (/api/board, /api/coven-memory, /api/memory), so relevance
// is scored against the question. Conversation hits come from /api/chat/search,
// which already matched server-side — they rank by matchCount instead.

export type AskSalemCard = {
  title: string;
  status?: string;
  priority?: string;
  labels?: string[];
};

export type AskSalemCovenMemory = {
  title: string;
  familiar_id?: string;
  path?: string;
  excerpt?: string;
};

export type AskSalemFsMemory = {
  relPath: string;
  rootLabel?: string;
};

export type AskSalemConversationHit = {
  title?: string;
  snippet: string;
  matchCount?: number;
};

export type AskSalemCorpora = {
  cards?: readonly AskSalemCard[];
  covenMemory?: readonly AskSalemCovenMemory[];
  fsMemory?: readonly AskSalemFsMemory[];
  conversationHits?: readonly AskSalemConversationHit[];
};

const CONTEXT_MATCH_LIMIT = 8;

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2);
}

function overlapScore(queryTokens: readonly string[], haystack: string): number {
  const hay = haystack.toLowerCase();
  let score = 0;
  for (const token of queryTokens) {
    if (hay.includes(token)) score++;
  }
  return score;
}

type ScoredMatch = { type: string; title: string; detail?: string; score: number };

/** Build the untrusted local-index context for a question, or null when
 *  nothing local is relevant (the route treats a missing context the same). */
export function buildAskSalemContext(
  query: string,
  corpora: AskSalemCorpora,
): SalemSearchContext | null {
  const queryTokens = tokenize(query);
  const scored: ScoredMatch[] = [];

  // Server-matched conversation hits are always relevant; matchCount ranks them.
  for (const hit of corpora.conversationHits ?? []) {
    if (!hit.snippet) continue;
    scored.push({
      type: "chat",
      title: hit.title?.trim() || "(untitled chat)",
      detail: hit.snippet,
      score: 1 + (hit.matchCount ?? 0),
    });
  }

  if (queryTokens.length > 0) {
    for (const card of corpora.cards ?? []) {
      if (!card.title) continue;
      const detailParts = [card.status, card.priority, ...(card.labels ?? [])].filter(Boolean);
      const score = overlapScore(queryTokens, `${card.title} ${detailParts.join(" ")}`);
      if (score > 0) scored.push({ type: "task", title: card.title, detail: detailParts.join(" · "), score });
    }
    for (const entry of corpora.covenMemory ?? []) {
      if (!entry.title) continue;
      const score = overlapScore(
        queryTokens,
        `${entry.title} ${entry.path ?? ""} ${entry.excerpt ?? ""}`,
      );
      if (score > 0) {
        scored.push({
          type: "memory",
          title: entry.title,
          detail: [entry.familiar_id, entry.path].filter(Boolean).join(" · "),
          score,
        });
      }
    }
    for (const entry of corpora.fsMemory ?? []) {
      if (!entry.relPath) continue;
      const score = overlapScore(queryTokens, `${entry.relPath} ${entry.rootLabel ?? ""}`);
      if (score > 0) {
        scored.push({ type: "memory-file", title: entry.relPath, detail: entry.rootLabel, score });
      }
    }
  }

  if (scored.length === 0) return null;

  const matches = scored
    .sort((a, b) => b.score - a.score)
    .slice(0, CONTEXT_MATCH_LIMIT)
    .map(({ type, title, detail }) => (detail ? { type, title, detail } : { type, title }));

  return { source: "top-search", query, matches };
}
