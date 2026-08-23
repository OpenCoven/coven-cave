// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const layout = await readFile(new URL("./layout.tsx", import.meta.url), "utf8");
const instrumentation = await readFile(
  new URL("../../instrumentation.ts", import.meta.url),
  "utf8",
);

assert.match(
  layout,
  /export default function RootLayout/,
  "root shell rendering is synchronous",
);
assert.match(
  layout,
  /createDefaultPreferences\(false\)[\s\S]*authoritative=\{false\}/,
  "the shell uses an explicitly non-authoritative paint snapshot",
);
assert.doesNotMatch(
  layout,
  /loadPreferences|withCaveHomeReconciledStore|migrateCaveHomeOnce|await /,
  "the root response cannot enter any reconciled store or migration lock",
);
assert.match(
  instrumentation,
  /void migration\.migrateCaveHomeOnce\(\)\.catch/,
  "startup reconciliation begins in the background",
);
assert.doesNotMatch(
  instrumentation,
  /await migration\.migrateCaveHomeOnce/,
  "Next route registration never waits for reconciliation",
);
assert.match(
  instrumentation,
  /void mediaJobs\.startResearchMediaJobs\(\)\.catch/,
  "persisted research-media recovery begins in the background",
);
assert.doesNotMatch(
  instrumentation,
  /await mediaJobs\.startResearchMediaJobs\(\)/,
  "Next route registration never waits for media renders",
);
// cave-1tu16: the X post cache is bounded by a 24h expiry, but expiry was
// enforced only when someone read the same post again, so an abandoned entry
// kept its text, author id and handle on disk indefinitely. The startup sweep
// is one of the two places that reaches such an entry (the other is the
// Research Desk load).
assert.match(
  instrumentation,
  /void xSources\.sweepExpiredXCache\(\)\.catch/,
  "expired X post content is swept at startup, in the background",
);
assert.doesNotMatch(
  instrumentation,
  /await xSources\.sweepExpiredXCache\(\)/,
  "Next route registration never waits for the X cache sweep",
);

console.log("root-shell-startup.test.ts: ok");
