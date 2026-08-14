// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("./chat-familiar-capabilities.tsx", import.meta.url),
  "utf8",
);

assert.match(
  source,
  /const harnessId = canonicalHarnessId\(familiar\.harness \?\? "codex"\);[\s\S]*canonicalHarnessId\(item\.harness_id\) === harnessId[\s\S]*canonicalHarnessId\(item\.id\) === harnessId/,
  "Familiar capability summaries should match legacy harness aliases to canonical manifests and reports",
);

assert.match(
  source,
  /const availability = h\.availability;[\s\S]{0,100}if \(availability && availability\.state !== "ready"\)[\s\S]{0,240}label: `\$\{h\.label\}\$\{availability\.state === "missing" \? " \(not installed\)" : " \(unavailable\)"\}`,[\s\S]{0,100}detail: availability\.message/,
  "the Familiar capability runtime picker must distinguish an unlaunchable runtime and show the shared remediation",
);
assert.match(
  source,
  /label: h\.label,[\s\S]{0,180}h\.installed \? null : "not installed"/,
  "legacy reports without availability keep their existing installed/not-installed treatment",
);

console.log("chat-familiar-capabilities.test.ts: ok");
