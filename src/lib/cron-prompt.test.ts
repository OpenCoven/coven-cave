// @ts-nocheck
import assert from "node:assert/strict";
import { parseCronPrompt, describeCronPromptUpdate } from "./cron-prompt.ts";

// ── Full generate: cadence + time + task prose ───────────────────────────────
{
  const u = parseCronPrompt("every weekday at 9am check open PRs and post a summary to the board");
  assert.ok(u);
  assert.deepEqual(u.schedule, { mode: "weekly", time: "09:00", days: ["MO", "TU", "WE", "TH", "FR"] });
  assert.equal(u.goalsOp, "append");
  assert.match(u.goals, /check open PRs/i, "leftover prose becomes the goal");
  assert.ok(!/9am|weekday/i.test(u.goals), "schedule words are consumed out of the goal text");
  assert.deepEqual(u.applied, ["schedule", "goals"]);
}

// ── Daily + explicit minutes + pm ────────────────────────────────────────────
{
  const u = parseCronPrompt("run it daily at 6:30 pm");
  assert.ok(u);
  assert.deepEqual(u.schedule, { mode: "daily", time: "18:30", days: [] });
  assert.equal(u.goals, undefined, "connectives alone never become a goal");
}

// ── Specific days ────────────────────────────────────────────────────────────
{
  const u = parseCronPrompt("every monday and thursday at noon");
  assert.ok(u);
  assert.deepEqual(u.schedule, { mode: "weekly", time: "12:00", days: ["MO", "TH"] });
}

// ── Weekends + midnight ──────────────────────────────────────────────────────
{
  const u = parseCronPrompt("weekends at midnight");
  assert.ok(u);
  assert.deepEqual(u.schedule, { mode: "weekly", time: "00:00", days: ["SU", "SA"] });
}

// ── Time-only prompts stay partial (don't clobber mode/days) ─────────────────
{
  const u = parseCronPrompt("at 7:15am");
  assert.ok(u);
  assert.deepEqual(u.schedule, { time: "07:15" });
  assert.equal(u.schedule.mode, undefined, "time-only must not flip the schedule mode");
}

// ── "weekly" alone keeps current day picks ───────────────────────────────────
{
  const u = parseCronPrompt("make it weekly");
  assert.ok(u);
  assert.deepEqual(u.schedule, { mode: "weekly" }, "no days key — the form keeps its picks");
}

// ── Classic cron expressions ─────────────────────────────────────────────────
{
  const u = parseCronPrompt("0 9 * * 1-5");
  assert.ok(u, "a five-field cron line is actionable");
  assert.deepEqual(u.schedule, { mode: "weekly", time: "09:00", days: ["MO", "TU", "WE", "TH", "FR"] });
}
{
  const u = parseCronPrompt("30 17 * * *");
  assert.ok(u);
  assert.deepEqual(u.schedule, { mode: "daily", time: "17:30", days: [] });
}
{
  const u = parseCronPrompt("15 8 * * mon,wed,fri");
  assert.ok(u);
  assert.deepEqual(u.schedule, { mode: "weekly", time: "08:15", days: ["MO", "WE", "FR"] });
}
{
  // Day-of-month restrictions can't map to the daily/weekly presets.
  assert.equal(parseCronPrompt("0 9 1 * *"), null, "unsupported cron shapes are not half-applied");
}

// ── Name extraction ──────────────────────────────────────────────────────────
{
  const u = parseCronPrompt('name it "Nightly triage" and run it daily at 22:00');
  assert.ok(u);
  assert.equal(u.name, "Nightly triage");
  assert.deepEqual(u.schedule, { mode: "daily", time: "22:00", days: [] });
  assert.ok(u.applied.includes("name"));
}
{
  const u = parseCronPrompt("rename to Morning digest");
  assert.ok(u);
  assert.equal(u.name, "Morning digest");
  assert.equal(u.schedule, undefined);
}

// ── Labeled goals/deliverables replace (explicit intent) ─────────────────────
{
  const u = parseCronPrompt("goals: triage new issues\ndeliverables: a ranked list in the journal");
  assert.ok(u);
  assert.equal(u.goals, "triage new issues");
  assert.equal(u.goalsOp, "replace");
  assert.equal(u.deliverables, "a ranked list in the journal");
  assert.equal(u.deliverablesOp, "replace");
}

// ── Prose-only updates append to goals ───────────────────────────────────────
{
  const u = parseCronPrompt("also archive stale branches older than 30 days");
  assert.ok(u);
  assert.equal(u.goalsOp, "append");
  assert.match(u.goals, /archive stale branches/);
  assert.deepEqual(u.applied, ["goals"]);
}

// ── Nothing actionable ───────────────────────────────────────────────────────
{
  assert.equal(parseCronPrompt(""), null);
  assert.equal(parseCronPrompt(null), null);
  assert.equal(parseCronPrompt("ok"), null, "trivial fragments are not a goal");
}

// ── Feedback line ────────────────────────────────────────────────────────────
{
  const u = parseCronPrompt("every weekday at 9am check the inbox");
  assert.equal(describeCronPromptUpdate(u), "schedule, goals");
}

console.log("cron-prompt.test.ts: ok");
