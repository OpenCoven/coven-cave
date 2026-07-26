/**
 * Skill stage blocks — the `<coven:skill …>` marker protocol that makes skill
 * invocations visible in the chat thread (design:
 * docs/chat-github-integration.md §5; bead cave-fpqx.11).
 *
 * Two producers, one card:
 *   1. Agents emit markers as a skill loads/progresses/finishes:
 *        <coven:skill name="brainstorming" stage="running" note="asking q3" />
 *      Repeated markers for the same name UPDATE the turn's card in place —
 *      extraction keeps the LAST stage per name.
 *   2. The `/skill` directive is deterministic: the app built the invocation
 *      prompt itself (buildSkillPrompt), so parseSkillInvocation recovers the
 *      skill name from the user turn with no harness cooperation.
 *
 * Pure and JSX-free (node --test); the card lives in
 * src/components/skill-stage-card.tsx.
 */

import { fencedRanges } from "./github-blocks.ts";

export type SkillStage = "loaded" | "running" | "done" | "error";

export type SkillStageUpdate = {
  name: string;
  stage: SkillStage;
  note?: string;
};

const STAGES: ReadonlySet<string> = new Set(["loaded", "running", "done", "error"]);

// Attributes segment treats quoted strings as atomic so a `>` inside a quoted
// note can't terminate the match early (review finding on #3175).
const MARKER_RE = /<coven:skill\b((?:[^">]|"[^"]*")*?)\/?>/g;
const ATTR_RE = /([a-zA-Z-]+)="([^"]*)"/g;

function parseAttrs(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  let m: RegExpExecArray | null;
  ATTR_RE.lastIndex = 0;
  while ((m = ATTR_RE.exec(raw)) !== null) out[m[1]] = m[2];
  return out;
}

/**
 * Extract skill markers from a turn's text. Streaming-safe: complete markers
 * are removed from `visible` (never rendered raw) and a PARTIAL marker at the
 * very end of the text is hidden until the stream completes it. Updates keep
 * the last stage per skill name (in-place update semantics), in first-seen
 * name order.
 */
export function extractSkillMarkers(text: string): { visible: string; updates: SkillStageUpdate[] } {
  if (!text || !text.includes("<coven:s")) return { visible: text, updates: [] };

  const byName = new Map<string, SkillStageUpdate>();
  let visible = text;

  if (text.includes("<coven:skill")) {
    // Fenced markers are example text — stay literal, no updates
    // (review finding, cave-m0r6; same contract as coven:github).
    const fences = fencedRanges(text);
    MARKER_RE.lastIndex = 0;
    visible = text.replace(MARKER_RE, (m, rawAttrs: string, index: number) => {
      if (fences.some(([start, end]) => index >= start && index < end)) return m;
      const attrs = parseAttrs(rawAttrs ?? "");
      const name = attrs.name?.trim();
      const stage = attrs.stage?.trim();
      if (name && stage && STAGES.has(stage)) {
        const update: SkillStageUpdate = { name, stage: stage as SkillStage };
        const note = attrs.note?.trim();
        if (note) update.note = note;
        // Map.set keeps first-insertion order while the value carries the
        // LAST marker's stage — exactly the in-place update semantics.
        byName.set(name, update);
      }
      // Malformed markers are dropped silently — never raw tags.
      return "";
    });
  }

  // Partial tail: an unterminated `<coven:skill…` (or any prefix of the tag
  // name) with no UNQUOTED closing `>` hides from the visible stream — a `>`
  // inside a still-open quoted note must not read as the tag close (review
  // finding, cave-m0r6). Fenced tails are example text and stay literal.
  const tail = visible.lastIndexOf("<coven:s");
  if (
    tail !== -1 &&
    !hasUnquotedGtAfter(visible, tail) &&
    !fencedRanges(visible).some(([start, end]) => tail >= start && tail < end)
  ) {
    const frag = visible.slice(tail);
    if ("<coven:skill".startsWith(frag.slice(0, "<coven:skill".length))) {
      visible = visible.slice(0, tail);
    }
  }

  return { visible, updates: [...byName.values()] };
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

// buildSkillPrompt (src/lib/slash-skill.ts) shapes — anchored so ordinary
// prose starting with "Use the" doesn't false-positive.
const INVOCATION_RE = /^Use the "([^"\n]+)" skill(?:\.$|( with: )([\s\S]+)$)/;

/**
 * Deterministic `/skill` detection: recover the invocation the app itself
 * sent (buildSkillPrompt). Returns null for anything else.
 */
export function parseSkillInvocation(text: string): { name: string; args?: string } | null {
  const m = INVOCATION_RE.exec(text.trim());
  if (!m) return null;
  const name = m[1].trim();
  if (!name) return null;
  const args = m[3]?.trim();
  return args ? { name, args } : { name };
}
