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
  JOURNAL_ROUTINE_PROMPT_MARKER,
  JOURNAL_ROUTINE_PROMPT_VERSION,
  JOURNAL_STAGGER_HOURS,
  journalRoutineId,
  parseJournalRRule,
  suggestedJournalHour,
} from "./journal-automation.ts";
import { JOURNAL_FORMAT_RULES } from "./journal-prompt.ts";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// ── Routine identity: one daily reflection routine per familiar ──────────────
assert.equal(journalRoutineId("astra"), "journal-reflection-astra");
assert.notEqual(journalRoutineId("astra"), journalRoutineId("nova"), "each familiar owns its own routine");

// ── Daily RRULE round-trip (hour-only: the native scheduler's vocabulary) ───
// The daemon refuses BYMINUTE ("rrule key `BYMINUTE` is not supported" —
// coven crates/coven-cli/src/automations/rrule.rs), so a reflection time is an
// hour and every rule this module writes must be one the daemon accepts.
assert.deepEqual(DEFAULT_JOURNAL_ROUTINE_TIME, { hour: 8, minute: 0 }, "the default reflection time is a morning hour: the routine reflects on the previous day");
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

// ── Staggered morning defaults ───────────────────────────────────────────────
for (const id of ["astra", "cody", "nova", "echo", "a", "x".repeat(200)]) {
  const hour = suggestedJournalHour(id);
  assert.ok(JOURNAL_STAGGER_HOURS.includes(hour), `${id} gets a morning hour`);
  assert.equal(suggestedJournalHour(id), hour, `${id}'s suggestion is stable`);
}
assert.ok(
  new Set(["astra", "cody", "nova", "echo", "sage", "salem", "kitty", "charm", "thoth"].map(suggestedJournalHour)).size > 1,
  "a coven's familiars don't all land on the same hour",
);

// ── The routine prompt (v3): yesterday, grounded, bounded to entry files ─────
{
  const prompt = buildJournalRoutinePrompt({
    familiarId: "astra",
    familiarName: "Astra",
    journalDir: "/Users/val/.coven/journal/familiars/astra/",
    workspaceDir: "/Users/val/.coven/workspaces/familiars/astra",
    boardPath: "/Users/val/.coven/cave/board.json",
  });
  assert.match(prompt, /^You are Astra, writing yesterday's entry in your own journal\./, "speaks as the familiar, about yesterday");
  assert.match(prompt, /JD='\/Users\/val\/\.coven\/journal\/familiars\/astra';/, "names the exact journal dir (trailing slash trimmed, shell-quoted)");
  assert.match(prompt, /`\/Users\/val\/\.coven\/journal\/familiars\/astra\/<day>\.md`/, "names the exact entry path");
  assert.match(prompt, /"HUMAN" means a person wrote it: never touch it/, "never overwrites a person's entry");
  assert.match(prompt, /coven sessions --all --json \| jq -r --arg fid 'astra'/, "reads its own sessions from the ledger");
  assert.match(prompt, /'\/Users\/val\/\.coven\/cave\/board\.json'/, "reads the board cards it touched");
  assert.match(prompt, /find '\/Users\/val\/\.coven\/workspaces\/familiars\/astra' -type f -newermt/, "reads its workspace changes");
  assert.equal(prompt.match(/\nJD=/g)?.length, 3, "every shell block sets its own variables (each call starts a fresh shell)");
  assert.match(prompt, /Never invent activity\./, "claims must trace to the commands' output");
  assert.match(prompt, /At most one backfill per run\./, "heals at most one missed day per run");
  assert.match(prompt, /A quiet day: no sessions, board cards, or workspace changes\./, "an empty day still gets a one-line entry");
  assert.match(prompt, /Never call a day with activity quiet\./);
  assert.match(prompt, /begins "Carrying forward:"/, "ends with the next concrete step");
  assert.match(prompt, /no heading, bullet list, preamble, or sign-off/, "keeps the no-heading/no-preamble rule");
  assert.ok(!prompt.includes(JOURNAL_FORMAT_RULES), "not the chat-only 'return only the reflection text' ask, which contradicts writing a file");
  assert.match(
    prompt,
    /\n---\nreflectedBy: astra\ngeneratedAt: NOW\n---\n\n<the reflection>\n/,
    "writes the canonical journal entry layout the store parses",
  );
  assert.match(prompt, /Write no other file: do not create, edit, or delete anything else/, "never touches any other file");
  assert.match(prompt, /do not commit/, "never commits");
  assert.ok(prompt.endsWith(JOURNAL_ROUTINE_PROMPT_MARKER), "carries the version marker");
  assert.equal(JOURNAL_ROUTINE_PROMPT_VERSION, 3);
}
{
  const prompt = buildJournalRoutinePrompt({ familiarId: "nova", journalDir: "/j/familiars/nova" });
  assert.match(prompt, /^You are nova,/, "falls back to the id without a display name");
  assert.match(prompt, /echo 'no board'/, "works without a known board");
  assert.match(prompt, /echo 'no workspace'/, "works without a known workspace path");
  assert.match(prompt, /reflectedBy: nova\n/, "attributes the entry to the familiar id, not the display name");
}
{
  const prompt = buildJournalRoutinePrompt({ familiarId: "o'brien", journalDir: "/j/it's" });
  assert.match(prompt, /JD='\/j\/it'\\''s';/, "quotes are escaped for the shell");
  assert.match(prompt, /--arg fid 'o'\\''brien'/);
}

// ── The prompt's shell steps run, and print what the model needs ─────────────
// Executes each ```sh block exactly as the routine will, against a scratch
// journal, a fake `coven` on PATH, and a board file.
test("the prompt's shell steps run in bash and zsh against fixtures", () => {
  const jq = spawnSync("jq", ["--version"]);
  if (jq.status !== 0) return; // jq is a documented prerequisite of the routine
  const root = mkdtempSync(path.join(tmpdir(), "journal-prompt-"));
  try {
    const journal = path.join(root, "journal");
    const workspace = path.join(root, "workspace");
    const bin = path.join(root, "bin");
    for (const dir of [journal, workspace, bin]) mkdirSync(dir, { recursive: true });
    const day = (n) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
    const at = (n, hm) => `${day(n)}T${hm}:00.123Z`;
    writeFileSync(path.join(journal, `${day(2)}.md`), "---\nreflectedBy: astra\ngeneratedAt: 2026-01-01T00:00:00Z\n---\n\nTwo days ago, generated.\n");
    writeFileSync(path.join(journal, `${day(3)}.md`), "---\nreflectedBy: astra\n---\n\nWritten by a person.\n");
    writeFileSync(path.join(workspace, "notes.md"), "touched yesterday");
    const yesterdayNoon = new Date(`${day(1)}T12:00:00Z`);
    utimesSync(path.join(workspace, "notes.md"), yesterdayNoon, yesterdayNoon);
    writeFileSync(path.join(workspace, "today.md"), "touched today: after the reflected day");
    const sessions = {
      sessions: [
        { familiar_id: "astra", project_root: "/repo/a", created_at: at(1, "10:00"), title: "Fix the flaky test", status: "completed", exit_code: 0 },
        { familiar_id: "astra", project_root: "/repo/a", created_at: at(1, "11:00"), title: "Runtime filesystem boundary:\n- stuff", status: "failed", exit_code: 1 },
        { familiar_id: "astra", project_root: journal, created_at: at(1, "08:00"), title: "routine run", status: "completed" },
        { familiar_id: "nova", project_root: "/repo/b", created_at: at(1, "12:00"), title: "Not mine", status: "completed" },
        { familiar_id: "astra", project_root: "/repo/a", created_at: at(9, "12:00"), title: "Too old", status: "completed" },
      ],
    };
    writeFileSync(path.join(root, "sessions.json"), JSON.stringify(sessions));
    writeFileSync(path.join(bin, "coven"), `#!/bin/sh\ncat ${JSON.stringify(path.join(root, "sessions.json"))}\n`, { mode: 0o755 });
    const board = path.join(root, "board.json");
    writeFileSync(board, JSON.stringify({
      cards: [
        { familiarId: "astra", updatedAt: at(1, "13:00"), status: "blocked", needsHuman: true, title: "Ship the journal fix", nextStep: { summary: "Val reviews the PR" }, primaryBlockerId: "card-9" },
        { familiarId: "nova", updatedAt: at(1, "13:00"), status: "doing", title: "Not mine" },
      ],
    }));
    const prompt = buildJournalRoutinePrompt({ familiarId: "astra", journalDir: journal, workspaceDir: workspace, boardPath: board });
    const blocks = [...prompt.matchAll(/```sh\n([\s\S]*?)\n```/g)].map((m) => m[1]);
    assert.equal(blocks.length, 3, "three shell steps");
    for (const shell of ["bash", "zsh"]) {
      if (spawnSync(shell, ["-c", "true"]).status !== 0) continue;
      const run = (script) => {
        const res = spawnSync(shell, ["-c", script], { encoding: "utf8", env: { ...process.env, TZ: "UTC", PATH: `${bin}:${process.env.PATH}` } });
        assert.equal(res.stderr, "", `${shell}: no errors`);
        return res.stdout;
      };
      const [dates, ledger, activity] = blocks.map(run);
      assert.match(dates, new RegExp(`DATE=${day(1)} FROM=${day(4)} NOW=\\d{4}-`), `${shell}: DATE is yesterday`);
      assert.match(dates, new RegExp(`${day(1)}: missing`), `${shell}: yesterday is writable`);
      assert.match(dates, new RegExp(`${day(2)}: generated`), `${shell}: a generated entry is recognised`);
      assert.match(dates, new RegExp(`${day(3)}: HUMAN`), `${shell}: a person's entry is recognised`);
      assert.match(dates, new RegExp(`${day(4)}: missing`));
      assert.match(dates, new RegExp(`PREV=.*${day(2)}\\.md\\n+Two days ago, generated\\.`), `${shell}: the previous entry's body is shown`);
      assert.match(ledger, new RegExp(`== ${day(1)}: 2 sessions, 1 failed`), `${shell}: own sessions counted, the routine's own runs excluded`);
      assert.match(ledger, /1x \d\d:\d\d \(untitled run\) \[failed\]/, `${shell}: boilerplate titles are labelled`);
      assert.match(ledger, /Fix the flaky test \[completed\]/);
      assert.doesNotMatch(ledger, /Not mine|Too old|routine run/, `${shell}: other familiars and old days are left out`);
      assert.match(activity, new RegExp(`== ${day(1)}: 1 board cards touched`), `${shell}: board cards counted`);
      assert.match(activity, /\[blocked\] NEEDS-HUMAN Ship the journal fix -> Val reviews the PR BLOCKED-BY card-9/);
      assert.match(activity, /workspace\/notes\.md/, `${shell}: workspace changes listed`);
      assert.doesNotMatch(activity, /today\.md/, `${shell}: today's changes wait for tomorrow's run`);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

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
