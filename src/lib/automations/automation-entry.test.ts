// @ts-nocheck
import assert from "node:assert/strict";
import {
  AUTOMATION_TYPES,
  AUTOMATION_TYPE_META,
  buildAutomationEntries,
  countByType,
  filterEntries,
  flowTrigger,
  humanRecurrence,
} from "./automation-entry.ts";

// humanRecurrence covers every Recurrence shape.
assert.equal(humanRecurrence(undefined), "One-time");
assert.equal(humanRecurrence({ type: "none" }), "One-time");
assert.equal(humanRecurrence({ type: "interval", everyMs: 30 * 60000 }), "Every 30m");
assert.equal(humanRecurrence({ type: "interval", everyMs: 3 * 3600_000 }), "Every 3h");
assert.equal(humanRecurrence({ type: "daily", hour: 9, minute: 5 }), "Daily at 09:05");
assert.equal(humanRecurrence({ type: "weekly", days: [1, 3], hour: 14, minute: 0 }), "Mon/Wed at 14:00");
assert.equal(humanRecurrence({ type: "cron", expr: "0 9 * * 1" }), "Cron: 0 9 * * 1");
// An injected time formatter (e.g. the view's clock-pref-aware one) is used for
// the hour:minute, while the rest of the line stays identical.
const ampm = (h: number, m: number) => `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
assert.equal(humanRecurrence({ type: "daily", hour: 14, minute: 0 }, ampm), "Daily at 2:00 PM");
assert.equal(humanRecurrence({ type: "weekly", days: [1, 3], hour: 9, minute: 30 }, ampm), "Mon/Wed at 9:30 AM");

// flowTrigger picks schedule > webhook > chat > manual, ignoring disabled nodes.
const node = (type, extra = {}) => ({ id: type, type, name: type, position: { x: 0, y: 0 }, params: {}, ...extra });
assert.deepEqual(flowTrigger({ nodes: [node("familiar")] }), { trigger: "Manual", scheduled: false });
assert.deepEqual(flowTrigger({ nodes: [node("trigger.schedule"), node("trigger.chat")] }), {
  trigger: "On schedule",
  scheduled: true,
});
assert.deepEqual(flowTrigger({ nodes: [node("trigger.chat")] }), { trigger: "On chat", scheduled: false });
assert.deepEqual(
  flowTrigger({ nodes: [node("trigger.schedule", { disabled: true }), node("trigger.webhook")] }),
  { trigger: "On webhook", scheduled: false },
);

// buildAutomationEntries normalizes all three sources into one typed list.
const entries = buildAutomationEntries({
  reminders: [
    {
      id: "r1",
      kind: "reminder",
      title: "Stretch",
      status: "pending",
      recurrence: { type: "daily", hour: 9, minute: 0 },
      familiarId: "fam-a",
      fireAt: "2026-06-25T09:00:00.000Z",
      updatedAt: "2026-06-24T00:00:00.000Z",
      createdAt: "2026-06-24T00:00:00.000Z",
    },
  ],
  crons: [
    {
      id: "c1",
      name: "Daily digest",
      status: "PAUSED",
      scheduleHuman: "Every day at 7am",
      familiars: ["fam-b"],
      prompt: "Summarize my inbox\nand more",
      rrule: "FREQ=DAILY",
      kind: "", model: null, reasoningEffort: null, executionEnvironment: null,
      cwds: [], tags: [], skillPath: null,
    },
  ],
  flows: [
    {
      id: "f1",
      name: "Webhook flow",
      active: true,
      nodes: [node("trigger.webhook")],
      edges: [],
      createdAt: "2026-06-20T00:00:00.000Z",
      updatedAt: "2026-06-23T00:00:00.000Z",
      schema: 1,
    },
  ],
});

assert.equal(entries.length, 3);
const byType = Object.fromEntries(entries.map((e) => [e.type, e]));

assert.equal(byType.reminder.key, "reminder:r1");
assert.equal(byType.reminder.trigger, "Daily at 09:00");
assert.equal(byType.reminder.scheduled, true);
assert.equal(byType.reminder.familiarId, "fam-a");
// Active reminders expose their daemon-maintained next fire (fireAt); crons/flows
// compute next-fire server-side so they leave it undefined.
assert.equal(byType.reminder.nextFireAt, "2026-06-25T09:00:00.000Z");
assert.equal(byType.cron.nextFireAt, undefined);

assert.equal(byType.cron.key, "cron:c1");
assert.equal(byType.cron.state, "paused");
assert.equal(byType.cron.trigger, "Every day at 7am");
assert.equal(byType.cron.summary, "Summarize my inbox");
assert.equal(byType.cron.familiarId, "fam-b");

assert.equal(byType.flow.state, "active");
assert.equal(byType.flow.trigger, "On webhook");

// Dated entries (reminder, flow) sort ahead of undated (cron).
assert.ok(["reminder", "flow"].includes(entries[0].type));
assert.equal(entries[2].type, "cron");

// countByType + filterEntries.
assert.deepEqual(countByType(entries), { reminder: 1, cron: 1, flow: 1 });
assert.equal(filterEntries(entries, "digest").length, 1, "matches on name");
assert.equal(filterEntries(entries, "webhook").length, 1, "matches on trigger text");
assert.equal(filterEntries(entries, "").length, 3);

// Type metadata is complete and well-formed.
for (const t of AUTOMATION_TYPES) {
  const meta = AUTOMATION_TYPE_META[t];
  assert.ok(meta.label && meta.plural && meta.icon && meta.accent && meta.blurb, `meta complete for ${t}`);
  assert.ok(["inbox", "flow"].includes(meta.editorMode));
}

console.log("automation-entry.test.ts: ok");
