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

console.log("root-shell-startup.test.ts: ok");
