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

// The canonical vault supplied per-familiar memory counts and is now in the
// dedicated memory application. What it left behind is a trap worth pinning.
//
// The watcher used to gate tier milestones on `memoryCounts === null`, meaning
// "unknown". Carrying that forward past the vault's removal would have made it
// permanently null and killed tier milestones outright, silently. An EMPTY map
// is the honest reading — zero, not unknown — and it preserves the hook's own
// rule that a milestone may pay out late but never early.
assert.doesNotMatch(
  watcher,
  /loadCanonicalMemoryList|canonicalMemoryCountsForMilestones/,
  "the watcher no longer reads the retired vault",
);
assert.doesNotMatch(
  watcher,
  /memoryCounts === null/,
  "an unknown-memory gate would now be permanently true and would disable tier milestones",
);
assert.match(
  watcher,
  /const memoryCounts = new Map<string, number>\(\);/,
  "memory counts read as an honest zero rather than as unknown",
);
assert.match(
  watcher,
  /\.\.\.dueTierMilestones\(tierRows, awarded\),/,
  "tier milestones are still evaluated",
);

console.log("workspace-milestone-quiet: all pins hold");
