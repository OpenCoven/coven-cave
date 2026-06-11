// @ts-nocheck
import assert from "node:assert/strict";
import { draftReminderFromText } from "./reminder-draft.ts";

const now = new Date("2026-06-11T14:00:00.000Z");

{
  const draft = draftReminderFromText("review PRs @ tomorrow 10am", now);

  assert.equal(draft.ok, true);
  assert.equal(draft.title, "review PRs");
  assert.equal(draft.whenText, "tomorrow 10am");
  assert.equal(draft.fireAt, "2026-06-12T15:00:00.000Z");
  assert.deepEqual(draft.recurrence, { type: "none" });
}

{
  const draft = draftReminderFromText("check deploy @ 5pm", now);

  assert.equal(draft.ok, true);
  assert.equal(draft.title, "check deploy");
  assert.equal(draft.whenText, "5pm");
  assert.equal(draft.fireAt, "2026-06-11T22:00:00.000Z");
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

console.log("reminder-draft.test.ts: reminder draft parsing passed");
