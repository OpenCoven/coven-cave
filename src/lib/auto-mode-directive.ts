/**
 * `/auto` mission directive — the prompt block sent when a user runs
 * `/auto <mission>`. Mirrors the buildSkillPrompt pattern (slash-skill.ts):
 * the app constructs a deterministic instruction turn, the familiar's own
 * runtime carries out the work, and `<coven:auto-status>` markers (taught in
 * coven-marker-directive.ts, parsed in auto-status-blocks.ts) report phase
 * back to the UI.
 *
 * Learned preferences (buildPreferenceDigest, from past mission feedback —
 * see auto-mode-preferences.ts) are folded in so the familiar improves over
 * successive missions instead of repeating what the human already disliked.
 */

export function buildAutoModeDirective(mission: string, preferenceDigest?: string | null): string {
  const lines = [
    `Run this as an autonomous /auto mission: ${mission.trim()}`,
    "",
    "Rules for this mission:",
    "1. If you genuinely need clarification to proceed safely or correctly, ask it now — batch every question you need into this first turn. Once you have what you need (or decide you don't need anything), do not ask again.",
    "2. After that, work the mission to completion without checking in. No progress narration turn-by-turn — just do the work.",
    "3. The ONLY reasons to interrupt the human again are: (a) the mission is complete, or (b) you are blocked on something only a human can do — permissions, credentials, an irreversible decision, anything outside your authority.",
    '4. Report your phase with <coven:auto-status state="clarifying|working|blocked|done" note="short status" /> at each transition — emit it once when you start, again if you become blocked, and a final one when done. Keep note short and factual.',
    "5. When done, your note should summarize what you did in one line so the human can review it at a glance.",
  ];
  if (preferenceDigest && preferenceDigest.trim()) {
    lines.push(
      "",
      "Preferences learned from past /auto missions (apply these unless they conflict with this mission):",
      preferenceDigest.trim(),
    );
  }
  return lines.join("\n");
}
