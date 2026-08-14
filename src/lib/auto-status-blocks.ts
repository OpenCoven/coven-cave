/**
 * `/auto` mission status blocks — the `<coven:auto-status …>` marker protocol
 * that makes an autonomous mission's phase visible in the chat thread and
 * lets the app decide when to interrupt the human (design mirrors
 * skill-blocks.ts's `<coven:skill>` protocol; see coven-marker-directive.ts
 * for the text taught to the model).
 *
 * States: clarifying (still needs answers), working (proceeding silently),
 * blocked (needs a human — permissions, a decision, credentials, anything the
 * familiar can't resolve itself), failed (hit something unrecoverable; the
 * mission is over either way), done (mission finished). Only blocked/failed/
 * done should draw the human's attention — that decision lives in the caller
 * (chat-view's auto-mode watcher), this module only extracts the latest
 * state per turn.
 *
 * `timed-out` also exists as a mission state, but deliberately has NO marker:
 * it is what the client concludes when the model says nothing at all, so
 * accepting it from the model would defeat the point. See auto-mission-state.ts.
 */

import { markdownCodeRanges } from "./github-blocks.ts";

export type AutoMissionState = "clarifying" | "working" | "blocked" | "failed" | "done";

export type AutoStatusUpdate = {
  state: AutoMissionState;
  note?: string;
};

/**
 * Accepted spellings → canonical state. A model that writes "complete" or
 * "Done" has told us exactly what we asked for; dropping that marker on a
 * string mismatch would strand the mission with no ping, which is the single
 * worst outcome this feature has. Matching is case-insensitive and tolerant of
 * the obvious synonyms rather than silently strict.
 */
const STATE_ALIASES: ReadonlyMap<string, AutoMissionState> = new Map([
  ["clarifying", "clarifying"],
  ["clarify", "clarifying"],
  ["questions", "clarifying"],
  ["working", "working"],
  ["in-progress", "working"],
  ["in_progress", "working"],
  ["running", "working"],
  ["blocked", "blocked"],
  ["needs-human", "blocked"],
  ["needs-approval", "blocked"],
  ["waiting", "blocked"],
  ["failed", "failed"],
  ["failure", "failed"],
  ["error", "failed"],
  ["done", "done"],
  ["complete", "done"],
  ["completed", "done"],
  ["finished", "done"],
  ["success", "done"],
]);

function canonicalState(raw: string | undefined): AutoMissionState | null {
  if (!raw) return null;
  return STATE_ALIASES.get(raw.trim().toLowerCase()) ?? null;
}

// Attributes segment treats quoted strings as atomic so a `>` inside a quoted
// note can't terminate the match early (same guard as skill-blocks.ts).
const MARKER_RE = /<coven:auto-status\b((?:[^">]|"[^"]*")*?)\/?>/g;
const ATTR_RE = /([a-zA-Z-]+)="([^"]*)"/g;

function parseAttrs(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  let m: RegExpExecArray | null;
  ATTR_RE.lastIndex = 0;
  while ((m = ATTR_RE.exec(raw)) !== null) out[m[1]] = m[2];
  return out;
}

/**
 * Extract auto-mission status markers from a turn's text. Streaming-safe:
 * complete markers are removed from `visible` (never rendered raw) and a
 * partial marker at the very end of the text is hidden until the stream
 * completes it. Keeps only the LAST state seen (in-place update semantics),
 * matching extractSkillMarkers.
 */
export function extractAutoStatusMarkers(text: string): { visible: string; update: AutoStatusUpdate | null } {
  if (!text || !text.includes("<coven:a")) return { visible: text, update: null };

  let update: AutoStatusUpdate | null = null;
  let visible = text;

  if (text.includes("<coven:auto-status")) {
    // Fenced markers are example text — stay literal, no updates.
    const codeRanges = markdownCodeRanges(text);
    MARKER_RE.lastIndex = 0;
    visible = text.replace(MARKER_RE, (m, rawAttrs: string, index: number) => {
      if (codeRanges.some(([start, end]) => index >= start && index < end)) return m;
      const attrs = parseAttrs(rawAttrs ?? "");
      const state = canonicalState(attrs.state);
      if (state) {
        const next: AutoStatusUpdate = { state };
        const note = attrs.note?.trim();
        if (note) next.note = note;
        update = next;
      }
      // Malformed markers are dropped silently — never raw tags.
      return "";
    });
  }

  // Partial tail: an unterminated `<coven:auto-status…` hides from the
  // visible stream until it either completes or the stream settles.
  const tail = visible.lastIndexOf("<coven:a");
  if (
    tail !== -1 &&
    !hasUnquotedGtAfter(visible, tail) &&
    !markdownCodeRanges(visible).some(([start, end]) => tail >= start && tail < end)
  ) {
    const frag = visible.slice(tail);
    if ("<coven:auto-status".startsWith(frag.slice(0, "<coven:auto-status".length))) {
      visible = visible.slice(0, tail);
    }
  }

  return { visible, update };
}

function hasUnquotedGtAfter(s: string, from: number): boolean {
  let inQuote = false;
  for (let i = from; i < s.length; i++) {
    const c = s[i];
    if (c === '"') inQuote = !inQuote;
    else if (c === ">" && !inQuote) return true;
  }
  return false;
}
