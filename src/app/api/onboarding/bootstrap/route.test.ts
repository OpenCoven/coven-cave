// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./route.ts", import.meta.url), "utf8");
const runner = await readFile(
  new URL("../../../../lib/server/onboarding-bootstrap.ts", import.meta.url),
  "utf8",
);
const coreTools = await readFile(
  new URL("../../../../lib/server/onboarding-core-tools.ts", import.meta.url),
  "utf8",
);

assert.equal(
  source.match(/rejectNonLocalRequest\(req\)/g)?.length,
  2,
  "bootstrap status and mutation routes are local-only",
);
assert.match(
  source,
  /readJsonBody<BootstrapBody>\(req, 1_024\)/,
  "bootstrap mutation uses bounded JSON parsing",
);
assert.match(
  source,
  /parsed\.body\.confirm !== true && parsed\.body\.resume !== true/,
  "a new bootstrap requires one explicit setup confirmation",
);
assert.match(
  runner,
  /bootstrapStatePath\(\)[\s\S]*onboarding-bootstrap\.json/,
  "bootstrap progress persists under Cave state for crash-safe resume",
);
assert.match(
  runner,
  /startSerializedOnboardingBootstrapRun\([\s\S]*runOnboardingBootstrapStages/,
  "one process-wide promise serializes bootstrap jobs",
);
assert.match(
  runner,
  /const existingSetupReady =[\s\S]*daemon: daemonReady \|\| existingSetupReady/,
  "a transient daemon outage does not relaunch first-run setup",
);
assert.match(
  runner,
  /mkdir\(path\.join\(covenHome\(\), "defaults"\)/,
  "bootstrap creates the approved ~/.coven/defaults location",
);
assert.match(
  runner,
  /startLocalDaemon\(\{ automatic: true \}\)/,
  "bootstrap uses the shared idempotent local daemon starter",
);
assert.match(
  coreTools,
  /runReviewedInstall\("managed-node"\)[\s\S]*runReviewedInstall\("coven-cli"\)/,
  "core setup reuses the reviewed legacy installers in dependency order",
);
assert.doesNotMatch(
  coreTools,
  /runtime-(?:codex|claude|copilot|openclaw)|sudo|runas/i,
  "bootstrap neither installs provider tools nor requests elevation",
);

console.log("onboarding bootstrap route.test.ts: ok");
