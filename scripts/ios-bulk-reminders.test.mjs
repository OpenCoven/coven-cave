// cave-ioswipe.2: bulk reminder actions must not be N sequential round trips,
// and a partial failure must not revert the whole batch.
//
// iOS Swift is NOT compiled by CI, so this source-text contract is the only
// gate these properties have. Each assertion below is checked to FAIL against
// its specific regression, not merely to pass.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (p) => readFile(new URL(`../${p}`, import.meta.url), "utf8");
const model = await read("apps/ios/CovenCave/CovenCave/State/AppModel.swift");
const client = await read("apps/ios/CovenCave/CovenCave/Networking/CaveClient.swift");

// --- One round trip, not N -------------------------------------------------
assert.match(
  client,
  /func bulkInboxAction\(_ action: String, ids: \[String\]\) async throws -> BulkInboxOutcome/,
  "the client needs a bulk entry point or AppModel has nothing to batch against",
);
assert.match(
  client,
  /request\("api\/inbox\/bulk", method: "POST"/,
  "bulk actions must hit the existing /api/inbox/bulk endpoint",
);
assert.match(
  model,
  /client\.bulkInboxAction\("delete", ids: Array\(ids\)\)/,
  "deleteReminders must delete in one round trip",
);
assert.match(
  model,
  /private func bulkServerAction\([\s\S]*?client\.bulkInboxAction\(action, ids: Array\(ids\)\)/,
  "done/dismiss must go through the bulk endpoint",
);

// The old shape: a per-id loop awaiting inside. Its return would silently
// reinstate N round trips while every other assertion here still passed.
assert.doesNotMatch(
  model,
  /for id in ids \{\s*\n\s*try await client\.deleteReminder\(id: id\)/,
  "no per-id delete loop may come back",
);

// --- Partial failure must not revert the whole batch -----------------------
// This is the more serious half: the old code reverted `previous` wholesale, so
// one late failure undid the optimistic state of items the server HAD already
// changed, leaving the UI disagreeing with the server.
assert.match(
  model,
  /private func revert\(_ ids: Set<String>, to previous: \[Reminder\]\)/,
  "there must be a targeted revert that restores only the named ids",
);
assert.match(
  model,
  /let missed = ids\.subtracting\(confirmed\)[\s\S]*?revert\(missed, to: previous\)/,
  "only ids the server did not confirm may be reverted",
);
assert.match(
  model,
  /func reportPartial\(_ failed: Int, of total: Int, verb: String\)/,
  "a partly-applied batch needs its own message — 'reverted' alone is misleading",
);

// --- Snooze: bounded concurrency, and NOT smuggled into the bulk endpoint ---
// The endpoint has no `snooze` action and no slot for `minutes`; routing it
// there would 400 at best and silently no-op at worst.
assert.doesNotMatch(
  model,
  /bulkInboxAction\("snooze"/,
  "snooze has no bulk action server-side — it must not be routed there",
);
assert.match(
  model,
  /private static let reminderFanOutWidth = \d+/,
  "the fan-out must be bounded, or a large selection opens one socket per item",
);
assert.match(
  model,
  /for _ in 0\.\.<width \{ addTask\(\) \}[\s\S]*?while let finished = await group\.next\(\)[\s\S]*?addTask\(\)/,
  "the fan-out must refill to keep exactly `width` in flight, not launch all at once",
);
assert.match(
  model,
  /func snoozeReminders\(_ ids: Set<String>, minutes: Int\) async \{\s*\n\s*await boundedReminderFanOut/,
  "snoozeReminders must use the bounded fan-out",
);

console.log("ios-bulk-reminders: OK");
