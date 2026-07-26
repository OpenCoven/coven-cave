// @ts-nocheck
// Pins for the celebrations-off contract on milestone delivery: quieting is a
// presentation choice, never data loss. The inbox append is unconditional;
// only the toast + native ping consult the pref, and only for milestones.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./workspace.tsx", import.meta.url), "utf8");
const created = source.match(/if \(e\.type === "created"\) \{[\s\S]*?return;\n\s*\}/)?.[0] ?? "";

assert.ok(created.length > 0, "created-event handler present");
assert.match(
  created,
  /setInboxItems\(\(prev\) => \[\.\.\.prev, e\.item\]\)/,
  "inbox append is unconditional — quieting never drops the item",
);
assert.match(
  created,
  /e\.item\.kind === "milestone" && !readCelebrationsEnabled\(\)/,
  "only milestone kind consults the celebrations pref",
);
assert.match(
  created,
  /!isMuted\(e\.item\) && !quietedMilestone/,
  "quieted milestones skip the toast alongside the existing mute gate",
);

console.log("workspace-milestone-quiet: all pins hold");
