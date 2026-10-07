// @ts-nocheck
import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_JOURNAL_ROUTINE_TIME,
  buildJournalRoutinePrompt,
  formatRoutineHour,
  formatRoutineTime,
  isValidRoutineTime,
  journalRRule,
  journalRoutineId,
  parseJournalRRule,
} from "./journal-automation.ts";
import { JOURNAL_FORMAT_RULES, JOURNAL_TONE_RULES } from "./journal-prompt.ts";

// ── Routine identity: one daily reflection routine per familiar ──────────────
assert.equal(journalRoutineId("astra"), "journal-reflection-astra");
assert.notEqual(journalRoutineId("astra"), journalRoutineId("nova"), "each familiar owns its own routine");

// ── Daily RRULE round-trip (hour-only: the native scheduler's vocabulary) ───
// The daemon refuses BYMINUTE ("rrule key `BYMINUTE` is not supported" —
// coven crates/coven-cli/src/automations/rrule.rs), so a reflection time is an
// hour and every rule this module writes must be one the daemon accepts.
assert.deepEqual(DEFAULT_JOURNAL_ROUTINE_TIME, { hour: 21, minute: 0 }, "the default reflection time is 21:00");
assert.equal(journalRRule(21), "FREQ=DAILY;BYHOUR=21", "stored without the RRULE: prefix, like the daemon");
assert.equal(journalRRule(0, 0), "FREQ=DAILY;BYHOUR=0");
for (const h of [0, 7, 21, 23]) {
  const rule = journalRRule(h);
  assert.doesNotMatch(rule, /BYMINUTE/, "never writes a key the native scheduler refuses");
  assert.deepEqual(parseJournalRRule(rule), { hour: h, minute: 0 }, `${h}:00 round-trips`);
}
assert.throws(() => journalRRule(24), "hour 24 is not a time of day");
assert.throws(() => journalRRule(9, 30), "the scheduler cannot run at :30");
assert.throws(() => journalRRule(9.5), "fractional hours are rejected");
assert.deepEqual(parseJournalRRule("RRULE:FREQ=DAILY;BYHOUR=8"), { hour: 8, minute: 0 }, "the RRULE: prefix is tolerated");
assert.equal(parseJournalRRule("FREQ=DAILY;BYHOUR=8;BYMINUTE=15"), null, "a BYMINUTE rule is not one the daemon runs");
assert.equal(parseJournalRRule("FREQ=WEEKLY;BYHOUR=8;BYDAY=MO"), null, "a weekly rule is not a daily reflection time");
assert.equal(parseJournalRRule("FREQ=DAILY"), null, "a daily rule without an hour has no time");
assert.equal(parseJournalRRule("FREQ=DAILY;BYHOUR=8,20"), null, "several hours are not one time");
assert.equal(parseJournalRRule("FREQ=DAILY;BYHOUR=25"), null, "an out-of-range hour is rejected");
assert.equal(parseJournalRRule(""), null);
assert.equal(parseJournalRRule(null), null);

// ── Time formatting + validation ─────────────────────────────────────────────
assert.equal(formatRoutineTime({ hour: 9, minute: 0 }), "09:00");
assert.equal(typeof formatRoutineHour(21, "en-US"), "string");
assert.match(formatRoutineHour(21, "en-US"), /9\s?PM/, "the hour reads in the reader's locale");
assert.equal(isValidRoutineTime(23), true);
assert.equal(isValidRoutineTime(23, 0), true);
assert.equal(isValidRoutineTime(23, 59), false, "only on-the-hour times are schedulable");
assert.equal(isValidRoutineTime("9", 0), false, "strings are not times");

// ── The routine prompt is self-contained and bounded to ONE file ─────────────
{
  const prompt = buildJournalRoutinePrompt({
    familiarId: "astra",
    familiarName: "Astra",
    journalDir: "/Users/val/.coven/journal/familiars/astra/",
    workspaceDir: "/Users/val/.coven/workspaces/familiars/astra",
  });
  assert.match(prompt, /^You are Astra, writing today's entry in your own journal\./, "speaks as the familiar");
  assert.match(prompt, /LOCAL date \(YYYY-MM-DD/, "the entry is dated by the local day");
  assert.match(prompt, /`\/Users\/val\/\.coven\/journal\/familiars\/astra\/DATE\.md`/, "names the exact file (trailing slash trimmed)");
  assert.match(prompt, /no `generatedAt` value, a person wrote or edited it: stop now, change nothing/, "never overwrites a person's entry");
  assert.match(prompt, /`\/Users\/val\/\.coven\/workspaces\/familiars\/astra`\) modified today/, "looks back over its workspace memory for the day");
  assert.match(prompt, /your own sessions from today/, "and its own sessions");
  assert.ok(prompt.includes(JOURNAL_TONE_RULES), "reuses the in-app reflection tone rules");
  assert.match(prompt, /No heading, no preamble, no sign-off in the reflection\./, "keeps the no-heading/no-preamble rule");
  assert.ok(!prompt.includes(JOURNAL_FORMAT_RULES), "but not the chat-only 'return only the reflection text' ask, which contradicts writing a file");
  assert.match(
    prompt,
    /\n---\nreflectedBy: astra\ngeneratedAt: NOW\n---\n\n<the reflection>\n/,
    "writes the canonical journal entry layout the store parses",
  );
  assert.match(prompt, /Write no other file: do not create, edit, or delete anything else/, "never touches any other file");
  assert.match(prompt, /do not commit/, "never commits");
}
{
  const prompt = buildJournalRoutinePrompt({ familiarId: "nova", journalDir: "/j/familiars/nova" });
  assert.match(prompt, /^You are nova,/, "falls back to the id without a display name");
  assert.match(prompt, /files in your workspace memory modified today;/, "works without a known workspace path");
  assert.match(prompt, /reflectedBy: nova\n/, "attributes the entry to the familiar id, not the display name");
}

console.log("journal-automation.test.ts: ok");

// ── Failed-run diagnosis ─────────────────────────────────────────────────────

test("diagnoseJournalRunFailure names the real reason from the session log", async () => {
  const { diagnoseJournalRunFailure } = await import("./journal-automation.ts");
  const log = (...messages) => messages.map((message) => ({ level: "info", message: `${message}\n` }));
  const cases = [
    [log("Warning: no stdin data received in 3s", "You've hit your weekly limit · resets 1am (America/Chicago)", 'exit: {"exitCode":1,"status":"failed"}'), "quota", /weekly limit/],
    [log("[Bash...]", "Error: API error: [codex] Error: HTTP request failed: error sending request for url (https://chatgpt.com/backend-api/codex/responses)", 'exit: {"exitCode":1}'), "network", /HTTP request failed/],
    [log("[WebFetch...]", "Error: API error: Maximum turn limit (10) reached", 'exit: {"exitCode":1}'), "turns", /turn limit/],
    [log("Login expired. Run `coven-code login`."), "auth", /Login expired/],
    [log("Error: something odd happened", 'exit: {"exitCode":1}'), "other", /something odd/],
  ];
  for (const [entries, kind, message] of cases) {
    const diagnosis = diagnoseJournalRunFailure(entries);
    assert.equal(diagnosis.kind, kind, `kind for ${kind}`);
    assert.match(diagnosis.message, message);
    assert.ok(!/exit:/.test(diagnosis.message), "the exit bookkeeping line is never the reason");
    assert.ok(diagnosis.hint.length > 0, "every kind carries a next step");
  }
});

test("diagnoseJournalRunFailure returns null for an empty or unreadable log", async () => {
  const { diagnoseJournalRunFailure } = await import("./journal-automation.ts");
  assert.equal(diagnoseJournalRunFailure([]), null);
  assert.equal(diagnoseJournalRunFailure(null), null);
  assert.equal(diagnoseJournalRunFailure([{ message: 'exit: {"exitCode":1}' }]), null);
});
