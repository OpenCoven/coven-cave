// Local-only per-message feedback (thumbs). UI affordance; no server persistence (spec follow-up).
const KEY = "cave:msg-feedback:v1";
export type Feedback = "up" | "down";

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
