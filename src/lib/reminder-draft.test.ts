// @ts-nocheck
import assert from "node:assert/strict";
import { draftReminderFromText } from "./reminder-draft.ts";

const now = new Date("2026-06-11T14:00:00.000Z");

// parseWhen resolves wall-clock phrases ("10am", "5pm") in the process
// timezone, so expected instants must be derived the same way — hard-coded
// UTC strings only hold in the timezone they were written in (this one
// failed on UTC CI runners after passing in UTC-5).
const localISO = (dayOffset, hour) =>
  new Date(now.getFullYear(), now.getMonth(), now.getDate() + dayOffset, hour, 0).toISOString();

// Bare times roll to the next day once passed (parse-when.ts), so the
// expectation has to apply the same rule.
const nextLocalISO = (hour) => {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, 0);
  if (d.getTime() <= now.getTime()) d.setDate(d.getDate() + 1);
  return d.toISOString();
};

{
  const draft = draftReminderFromText("review PRs @ tomorrow 10am", now);

  assert.equal(draft.ok, true);
  assert.equal(draft.title, "review PRs");
  assert.equal(draft.whenText, "tomorrow 10am");
  assert.equal(draft.fireAt, localISO(1, 10));
  assert.deepEqual(draft.recurrence, { type: "none" });
}

{
  const draft = draftReminderFromText("check deploy @ 5pm", now);

  assert.equal(draft.ok, true);
  assert.equal(draft.title, "check deploy");
  assert.equal(draft.whenText, "5pm");
  assert.equal(draft.fireAt, nextLocalISO(17));
}

{
  const draft = draftReminderFromText("in 30m check the build", now);

  assert.equal(draft.ok, true);
  assert.equal(draft.title, "check the build");
  assert.equal(draft.whenText, "in 30m");
  assert.equal(draft.fireAt, "2026-06-11T14:30:00.000Z");
}

{
  const draft = draftReminderFromText("review the queue", now);

  assert.equal(draft.ok, false);
  assert.equal(draft.title, "review the queue");
}

// Extended grammar (cave-rdfc): "at"-joined phrases and phrase-carried
// recurrences split cleanly into when + title.
{
  const draft = draftReminderFromText("tomorrow at 9am review PRs", now);

  assert.equal(draft.ok, true);
  assert.equal(draft.title, "review PRs");
  assert.equal(draft.whenText, "tomorrow at 9am");
}

{
  const draft = draftReminderFromText("every tuesday 4pm triage the inbox", now);

  assert.equal(draft.ok, true);
  assert.equal(draft.title, "triage the inbox");
  assert.equal(draft.whenText, "every tuesday 4pm");
  assert.equal(draft.recurrence.type, "weekly");
  assert.deepEqual(draft.recurrence.days, [2]);
}

console.log("reminder-draft.test.ts: reminder draft parsing passed");
