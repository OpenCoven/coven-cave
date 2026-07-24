// Chat auto-rename policy + decision logic. When enabled, a chat's title is
// periodically re-derived from its LATEST exchange so a long thread's name
// tracks where the conversation actually went (not just its opening prompt).
//
// "Apply rules intelligently": a title a person set by hand is sacred — the
// periodic rename only ever overwrites a title it still owns (an auto-derived
// default, or one this feature itself set last). Provenance is tracked in
// cave-config state (`sessionTitleAuto`); the decision here is pure and
// unit-tested (see chat-auto-rename.test.ts) with no config/network access.

import { chatSummaryTitle } from "./cave-chat-titles.ts";

export type ChatAutoRenamePolicy = {
  /** Master switch for periodic context-aware renaming. */
  enabled: boolean;
  /** Re-derive the title every N assistant turns (2–50). */
  everyTurns: number;
  /** Never overwrite a title a person set by hand. */
  preserveManualTitles: boolean;
};

// Off by default — renaming a chat out from under someone is surprising, so it
// is opt-in. The cadence tracks the conversation without thrashing the title.
export const DEFAULT_CHAT_AUTO_RENAME_POLICY: ChatAutoRenamePolicy = {
  enabled: false,
  everyTurns: 4,
  preserveManualTitles: true,
};

export const MIN_RENAME_TURNS = 2;
export const MAX_RENAME_TURNS = 50;

export function clampRenameTurns(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  const turns = Math.floor(value);
  return Math.min(Math.max(turns, MIN_RENAME_TURNS), MAX_RENAME_TURNS);
}

/** Tolerate partial/corrupt stored policies; unknown fields are dropped. */
export function normalizeChatAutoRenamePolicy(
  raw: Partial<ChatAutoRenamePolicy> | null | undefined,
): ChatAutoRenamePolicy {
  const d = DEFAULT_CHAT_AUTO_RENAME_POLICY;
  if (!raw || typeof raw !== "object") return { ...d };
  return {
    enabled: typeof raw.enabled === "boolean" ? raw.enabled : d.enabled,
    everyTurns: clampRenameTurns(raw.everyTurns, d.everyTurns),
    preserveManualTitles:
      typeof raw.preserveManualTitles === "boolean"
        ? raw.preserveManualTitles
        : d.preserveManualTitles,
  };
}

/**
 * The cadence gate: a rename is due once the thread has reached a positive
 * multiple of `everyTurns` assistant turns. Modulo (rather than a stored
 * "last renamed at" counter) keeps the trigger stateless — the first-exchange
 * auto-name already covers turn 1, so periodic renames land at N, 2N, 3N…
 */
export function isRenameDueAtTurn(assistantTurns: number, everyTurns: number): boolean {
  if (!Number.isInteger(assistantTurns) || assistantTurns < everyTurns) return false;
  if (everyTurns <= 0) return false;
  return assistantTurns % everyTurns === 0;
}

/**
 * Whether the periodic rename is allowed to replace `current`. It owns the
 * title when there is none yet, when it is still one of the auto-derived
 * defaults (New chat / first-prompt summary), or when this feature set it last
 * (`lastAutoTitle`). Anything else is a human's choice and is left untouched
 * while `preserveManualTitles` is on.
 */
export function isAutoOwnedTitle(input: {
  current: string | null | undefined;
  lastAutoTitle: string | null | undefined;
  autoDefaults: ReadonlySet<string>;
  preserveManualTitles: boolean;
}): boolean {
  const current = input.current?.trim();
  if (!current) return true;
  if (input.autoDefaults.has(current)) return true;
  if (input.lastAutoTitle && current === input.lastAutoTitle) return true;
  return !input.preserveManualTitles;
}

export type RenameExchange = { userText?: string | null; assistantText?: string | null };

/**
 * Re-derive a title from the LATEST exchange (the freshest signal for where a
 * thread is now), reusing the same pure heuristic the first-exchange auto-name
 * uses. Returns null when nothing meaningful can be derived — callers keep the
 * current title.
 */
export function renameTitleFromLatestExchange(exchange: RenameExchange): string | null {
  return chatSummaryTitle({
    userText: exchange.userText ?? null,
    assistantText: exchange.assistantText ?? null,
  });
}
