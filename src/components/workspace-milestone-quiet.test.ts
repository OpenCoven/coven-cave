// @ts-nocheck
// Pins for the celebrations-off contract on milestone delivery: quieting is a
// presentation choice, never data loss. The inbox append is unconditional;
// only the toast + native ping consult the pref, and only for milestones.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

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

const watcher = readFileSync(
  new URL("../lib/use-milestone-watch.ts", import.meta.url),
  "utf8",
);
assert.match(
  watcher,
  /loadCanonicalMemoryList\(\)/,
  "milestone checks use the shared non-forced canonical list loader",
);
assert.match(
  watcher,
  /memoryCounts === null \? \[\] : dueTierMilestones/,
  "canonical unavailability suppresses memory-derived tier awards",
);

const memoryCountsUrl = new URL(
  "../lib/canonical-memory-milestones.ts",
  import.meta.url,
);
assert.ok(
  existsSync(fileURLToPath(memoryCountsUrl)),
  "canonical milestone count helper must exist",
);
const memoryCountsModule = "../lib/canonical-memory-milestones.ts";
const { canonicalMemoryCountsForMilestones } = await import(memoryCountsModule);

assert.equal(
  canonicalMemoryCountsForMilestones({
    state: "error",
    error: new Error("unavailable"),
  }),
  null,
  "an unavailable canonical list is unknown, not an empty count map",
);
assert.deepEqual(
  [
    ...canonicalMemoryCountsForMilestones({
      state: "ready",
      entries: [
        { familiarId: "cody" },
        { familiarId: "cody" },
        { familiarId: "salem" },
      ],
    }).entries(),
  ],
  [
    ["cody", 2],
    ["salem", 1],
  ],
  "ready summaries count by canonical familiarId",
);

console.log("workspace-milestone-quiet: all pins hold");
