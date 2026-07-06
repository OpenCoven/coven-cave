// @ts-nocheck
import assert from "node:assert/strict";
import {
  NARRATIVE_MAX_CHARS,
  NARRATIVE_MIN_REGEN_MS,
  buildDailyNarrativePrompt,
  normalizeNarrativeText,
  shouldRegenerateNarrative,
} from "./daily-narrative.ts";

const now = new Date("2026-06-18T21:15:00.000Z");

// ── Prompt ──────────────────────────────────────────────────────────────────
{
  const report = {
    prsMerged: [
      { repo: "OpenCoven/coven-cave", number: 2504, title: "day-in-review facts", url: "u", mergedAt: "2026-06-18T17:00:00.000Z" },
    ],
    cardsCompleted: [
      { id: "c1", title: "Ship it", completedAt: "2026-06-18T15:00:00.000Z" },
    ],
    sessionGroups: [
      { key: "/repo/coven-cave", label: "coven-cave", additions: 9, deletions: 4, sessions: [{ id: "s1", title: "Ship the parser" }] },
    ],
    factsHash: "abc123",
    refreshedAt: "2026-06-18T21:00:00.000Z",
  };
  const stats = { reminders: 0, responses: 1, familiars: 0, sessions: 3, prsMerged: 1, cardsCompleted: 1 };
  const prompt = buildDailyNarrativePrompt(report, stats, "Jun 18");
  assert.match(prompt, /Jun 18/, "prompt should carry the day label");
  assert.match(prompt, /Two to four sentences/, "prompt should constrain length");
  assert.match(prompt, /no preamble, no sign-off/i, "prompt should forbid wrapper text");
  assert.match(prompt, /OpenCoven\/coven-cave#2504 — day-in-review facts/, "prompt should list merged PRs");
  assert.match(prompt, /done: Ship it/, "prompt should list completed cards");
  assert.match(prompt, /coven-cave \(\+9 -4\): Ship the parser/, "prompt should carry project groups with diff totals");

  const bare = buildDailyNarrativePrompt({ factsHash: "x", refreshedAt: "t" }, { reminders: 0, responses: 0, familiars: 0, sessions: 2 }, "Jun 18");
  assert.doesNotMatch(bare, /Pull requests merged/, "unavailable sources should not be claimed to the model");
}

// ── Regeneration policy ─────────────────────────────────────────────────────
{
  const fresh = { text: "narr", familiarId: "sage", generatedAt: now.toISOString(), factsHash: "h1" };
  assert.equal(
    shouldRegenerateNarrative({ narrative: null, factsHash: "h1", now }),
    true,
    "missing narrative should generate",
  );
  assert.equal(
    shouldRegenerateNarrative({ narrative: fresh, factsHash: "h1", now }),
    false,
    "unchanged facts should never regenerate",
  );
  assert.equal(
    shouldRegenerateNarrative({ narrative: fresh, factsHash: "h2", now }),
    false,
    "changed facts inside the regen interval should wait",
  );
  const stale = { ...fresh, generatedAt: new Date(now.getTime() - NARRATIVE_MIN_REGEN_MS - 1000).toISOString() };
  assert.equal(
    shouldRegenerateNarrative({ narrative: stale, factsHash: "h2", now }),
    true,
    "changed facts past the regen interval should regenerate",
  );
  assert.equal(
    shouldRegenerateNarrative({ narrative: stale, factsHash: null, now }),
    false,
    "no facts hash (pre-Phase-B item) should never trigger generation",
  );
}

// ── Normalization ───────────────────────────────────────────────────────────
{
  assert.equal(normalizeNarrativeText("  a day well spent \n\n\n\nmore  "), "a day well spent \n\nmore");
  const long = normalizeNarrativeText("x".repeat(NARRATIVE_MAX_CHARS + 500));
  assert.ok(long.length <= NARRATIVE_MAX_CHARS, "narrative should cap at the max length");
  assert.match(long, /…$/, "capped narrative should end with an ellipsis");
}

console.log("daily-narrative.test.ts: ok");
