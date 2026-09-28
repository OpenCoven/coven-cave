// Per-message feedback (thumbs). `setFeedback` persists the vote LOCALLY for an
// instant UI toggle; `recordFeedbackAnalytics` additionally mirrors it to the
// local `/api/feedback/message` store (best-effort, fire-and-forget) so votes
// can seed later quality analytics. No message content is ever sent.
const KEY = "cave:msg-feedback:v1";
export type Feedback = "up" | "down";

/** Extra, non-identifying context stamped alongside an analytics vote. */
export type FeedbackContext = {
  familiarId?: string;
  /** Effective model id that produced the response (per-model analytics). */
  model?: string;
  /** Runtime/harness id that produced the response (per-runtime analytics). */
  runtime?: string;
  /** The chat thread the voted message belongs to, so a vote can be joined to
   *  that thread's self-report (familiar outcome calibration). Not content. */
  sessionId?: string;
};

/**
 * One-tap reasons offered after a thumbs-down. Fixed categories, never free
 * text, so the store keeps no message content and outcomes can be grouped.
 * Four at most, so the reason row stays one line.
 */
export const FEEDBACK_REASONS = [
  { id: "misunderstood", label: "Misunderstood me" },
  { id: "incorrect", label: "Wrong or broken" },
  { id: "incomplete", label: "Didn't finish" },
  { id: "ignored-instructions", label: "Ignored instructions" },
] as const;
export type FeedbackReason = (typeof FEEDBACK_REASONS)[number]["id"];

export function isFeedbackReason(value: unknown): value is FeedbackReason {
  return FEEDBACK_REASONS.some((reason) => reason.id === value);
}

export function feedbackReasonLabel(reason: FeedbackReason): string {
  return FEEDBACK_REASONS.find((entry) => entry.id === reason)?.label ?? reason;
}

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
 * back off (i.e. the local vote is now null after `setFeedback`). `reason` is
 * the optional one-tap category chosen after a thumbs-down; it is sent as a
 * follow-up entry for the same vote.
 */
export function recordFeedbackAnalytics(
  messageId: string,
  vote: Feedback,
  cleared: boolean,
  ctx?: FeedbackContext,
  reason?: FeedbackReason,
): void {
  if (typeof fetch !== "function") return;
  try {
    void fetch("/api/feedback/message", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        messageId,
        vote,
        cleared,
        familiarId: ctx?.familiarId,
        model: ctx?.model,
        runtime: ctx?.runtime,
        sessionId: ctx?.sessionId,
        ...(reason ? { reason } : {}),
      }),
      keepalive: true,
    }).catch(() => { /* best-effort analytics */ });
  } catch { /* fetch unavailable */ }
}
