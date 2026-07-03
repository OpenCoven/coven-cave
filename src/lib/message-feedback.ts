// Per-message feedback (thumbs). `setFeedback` persists the vote LOCALLY for an
// instant UI toggle; `recordFeedbackAnalytics` additionally mirrors it to the
// local `/api/feedback/message` store (best-effort, fire-and-forget) so votes
// can seed later quality analytics. No message content is ever sent.
const KEY = "cave:msg-feedback:v1";
export type Feedback = "up" | "down";

/** Extra, non-identifying context stamped alongside an analytics vote. */
export type FeedbackContext = { familiarId?: string };

function read(): Record<string, Feedback> {
  if (typeof window === "undefined") return {};
  try { return JSON.parse(window.localStorage.getItem(KEY) || "{}"); } catch { return {}; }
}
function write(map: Record<string, Feedback>): void {
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(KEY, JSON.stringify(map)); } catch { /* quota */ }
}

export function getFeedback(messageId: string): Feedback | null {
  return read()[messageId] ?? null;
}
export function setFeedback(messageId: string, vote: Feedback): void {
  const map = read();
  if (map[messageId] === vote) delete map[messageId];   // toggle off
  else map[messageId] = vote;
  write(map);
}

/**
 * Mirror a thumbs vote to the local analytics store. Best-effort and
 * fire-and-forget — never blocks the UI, swallows all errors, and no-ops under
 * SSR / when `fetch` is unavailable. `cleared` is true when the vote was toggled
 * back off (i.e. the local vote is now null after `setFeedback`).
 */
export function recordFeedbackAnalytics(
  messageId: string,
  vote: Feedback,
  cleared: boolean,
  ctx?: FeedbackContext,
): void {
  if (typeof fetch !== "function") return;
  try {
    void fetch("/api/feedback/message", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messageId, vote, cleared, familiarId: ctx?.familiarId }),
      keepalive: true,
    }).catch(() => { /* best-effort analytics */ });
  } catch { /* fetch unavailable */ }
}
