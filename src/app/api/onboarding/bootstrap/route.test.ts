// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createOnboardingBootstrapState } from "../../../../lib/onboarding-bootstrap.ts";
import { createOnboardingBootstrapHandlers } from "../../../../lib/server/onboarding-bootstrap-route.ts";

const source = await readFile(new URL("./route.ts", import.meta.url), "utf8");
const handlerSource = await readFile(
  new URL("../../../../lib/server/onboarding-bootstrap-route.ts", import.meta.url),
  "utf8",
);
const runner = await readFile(
  new URL("../../../../lib/server/onboarding-bootstrap.ts", import.meta.url),
  "utf8",
);
const coreTools = await readFile(
  new URL("../../../../lib/server/onboarding-core-tools.ts", import.meta.url),
  "utf8",
);

assert.equal(
  handlerSource.match(/rejectNonLocalRequest\(req\)/g)?.length,
  2,
  "bootstrap status and mutation routes are local-only",
);
assert.match(
  handlerSource,
  /readJsonBody<BootstrapBody>\(req, 1_024\)/,
  "bootstrap mutation uses bounded JSON parsing",
);
assert.match(
  handlerSource,
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
  /path\.join\(covenHome\(\), "defaults"\)/,
  "bootstrap creates the approved ~/.coven/defaults location",
);
assert.match(
  runner,
  /startLocalDaemon\(\{ automatic: true \}\)/,
  "bootstrap uses the shared idempotent local daemon starter",
);
assert.match(
  coreTools,
  /runReviewedInstall\("managed-node", dependencies\)[\s\S]*runReviewedInstall\("coven-cli", dependencies\)/,
  "core setup reuses the reviewed legacy installers in dependency order",
);
assert.match(
  handlerSource,
  /async GET\(req: Request\)[\s\S]*dependencies\.status\(\)[\s\S]*async POST/,
  "diagnostic status reads remain read-only",
);
assert.doesNotMatch(
  handlerSource.match(/async GET\(req: Request\)[\s\S]*?\n    \},/)?.[0] ?? "",
  /startOrResume/,
  "reading setup diagnostics cannot start or resume installation",
);
assert.match(
  source,
  /const handlers = createOnboardingBootstrapHandlers\(\)[\s\S]*export const GET = handlers\.GET;[\s\S]*export const POST = handlers\.POST;/,
  "the App Router module exports only the configured HTTP handlers",
);
assert.match(
  runner,
  /normalizePersistedOnboardingSetupDiagnostics/,
  "persisted diagnostic snapshots are allowlisted before the status API returns them",
);
const persistedNormalizer =
  runner.match(/function safePersistedState[\s\S]*?\n\}/)?.[0] ?? "";
assert.doesNotMatch(
  persistedNormalizer,
  /\.\.\.state/,
  "persisted bootstrap state is rebuilt instead of spreading unknown raw fields",
);
assert.match(
  persistedNormalizer,
  /version: 1,[\s\S]*stages: stages\.map\([\s\S]*failure,[\s\S]*updatedAt:/,
  "only the versioned bootstrap contract survives persistence normalization and failed-stage copy is rebuilt",
);
assert.doesNotMatch(
  coreTools,
  /runtime-(?:codex|claude|copilot|openclaw)|sudo|runas/i,
  "bootstrap neither installs provider tools nor requests elevation",
);

test("GET reads status without starting or resuming setup", async () => {
  let statusReads = 0;
  let starts = 0;
  const current = createOnboardingBootstrapState(true);
  current.status = "failed";
  const route = createOnboardingBootstrapHandlers({
    status: async () => {
      statusReads += 1;
      return current;
    },
    startOrResume: async () => {
      starts += 1;
      return current;
    },
  });

  const result = await route.GET(
    new Request("http://127.0.0.1/api/onboarding/bootstrap", {
      headers: { host: "127.0.0.1" },
    }),
  );
  assert.equal(result.status, 200);
  assert.equal(statusReads, 1);
  assert.equal(starts, 0);
});

console.log("onboarding bootstrap route.test.ts: ok");
