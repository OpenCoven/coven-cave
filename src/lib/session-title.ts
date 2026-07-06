// Display-boundary title cleaner for session lists (home Continue column).
// Composes the cave-chat-titles sanitizers (canon/runtime-scope leak
// rejection) and additionally rejects role-prompt-shaped titles that leak
// system prompts ("You are the spirit dwelling inside…"). Pure — unit-tested
// without DOM or network (see session-title.test.ts).

import { sanitizeSessionTitle, defaultChatTitleForSession } from "./cave-chat-titles.ts";

// Conservative, anchored role-prompt shapes. Deliberately narrow so real
// titles that merely contain "you" ("Are you able to…" — not anchored) or
// start with "Act" as a content word ("Actors list…" — \b guards) don't get
// eaten.
const ROLE_PROMPT_RE =
  /^(?:you\s+are\b|you['’]re\b|act\s+as\b|imagine\s+(?:you|that)\b|pretend\s+(?:you|to)\b|your\s+(?:role|task|job|purpose)\s+is\b|as\s+an?\s+ai\b|system\s+prompt\b)/i;

export function looksLikeRolePrompt(title: string): boolean {
  return ROLE_PROMPT_RE.test(title.trim());
}

/** Title for a session row at the display boundary: the sanitized stored
 *  title, unless it is empty or looks like a leaked system/role prompt — then
 *  the neutral "New chat" default. */
export function sessionDisplayTitle(session: { title?: string | null }): string {
  const sanitized = sanitizeSessionTitle(session.title ?? null);
  if (!sanitized || looksLikeRolePrompt(sanitized)) return defaultChatTitleForSession();
  return sanitized;
}
