// Time-gap dividers between transcript turns — the "18 MIN GAP" rule the
// "Chat Session - Prototype.dc.html" handoff draws across the reading column.
//
// Chat already knew about these gaps: the transcript reveals a timestamp on the
// turn after a long pause. But a timestamp answers "when did this happen?", not
// "you walked away here", so a reader scrolling back through a day-long thread
// reads a continuous conversation that was in fact four separate sittings. The
// divider names the pause, which is the thing that changes how the turns above
// and below it should be read.
//
// Pure and clock-free (the two timestamps carry it), so it is testable without
// a fake timer — the chat-recency.ts convention.

/** Below this a pause is just thinking time and needs no marker. Matches the
 *  threshold the transcript already uses to reveal a turn's timestamp, so the
 *  two signals agree instead of firing at different moments. */
export const CHAT_TURN_GAP_MIN_MS = 10 * 60 * 1000;

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * Label for the pause between two turns, or `null` when there is no pause worth
 * naming (too short, unknown, or backwards).
 *
 * Rounds toward the coarser unit deliberately: "3 hr gap" is what a reader
 * needs, and "2 hr 47 min gap" spends the divider's whole width on precision
 * nobody acts on.
 */
export function chatTurnGapLabel(
  previousIso: string | null | undefined,
  currentIso: string | null | undefined,
): string | null {
  if (!previousIso || !currentIso) return null;
  const from = Date.parse(previousIso);
  const to = Date.parse(currentIso);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  const gap = to - from;
  // A backwards gap means the transcript is out of order — a divider claiming
  // negative time is worse than no divider.
  if (gap < CHAT_TURN_GAP_MIN_MS) return null;
  if (gap < HOUR) return `${Math.round(gap / MINUTE)} min gap`;
  if (gap < DAY) {
    const hours = Math.round(gap / HOUR);
    return `${hours} hr gap`;
  }
  const days = Math.round(gap / DAY);
  return days === 1 ? "1 day gap" : `${days} days gap`;
}
