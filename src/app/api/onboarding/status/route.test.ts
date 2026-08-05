// @ts-nocheck
// Onboarding status: when the daemon is offline the familiar count is
// unknown, so the binding step must point at the daemon rather than
// blaming the user's bindings. Source-pattern assertions (the route's
// checks call the live daemon socket, so we don't execute them here).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { onboardingStatusPayload } from "../../../../lib/onboarding-status-probes.ts";

const source = readFileSync(new URL("./route.ts", import.meta.url), "utf8");
const probesSource = readFileSync(
  new URL("../../../../lib/onboarding-status-probes.ts", import.meta.url),
  "utf8",
);

const partialCovenCliEvidence = [{
  id: "coven-cli",
  installed: false,
  current: null,
  compatible: false,
  discoveryError: "lookup-failed",
}];
for (const state of ["checking", "unavailable"] as const) {
  assert.equal(
    onboardingStatusPayload(
      { covenCli: { ok: false, state } },
      partialCovenCliEvidence,
    ).tools,
    null,
    `${state} Coven CLI evidence must not expose an actionable tool payload`,
  );
}
assert.equal(
  onboardingStatusPayload(
    { covenCli: { ok: false, state: "action-required" } },
    partialCovenCliEvidence,
  ).tools,
  partialCovenCliEvidence,
  "confirmed Coven CLI absence preserves the tool payload for remediation",
);

assert.match(
  source,
  /bindingReadinessStep\(\{[\s\S]{0,700}daemonState:[\s\S]{0,500}reports: adapters\.reports,[\s\S]{0,300}runtimeEvidenceState: adapters\.evidenceState/,
  "binding classification receives daemon health plus runtime evidence provenance",
);
assert.match(
  probesSource,
  /daemonState === "ready"[\s\S]{0,180}"Bindings set but no familiars to bind\."[\s\S]{0,120}"Waiting for the daemon — familiars load once it starts\."/,
  "binding hint defers to the daemon when it is offline",
);
assert.match(
  source,
  /openClawAgentCount: adapters\.openClawAgentCount/,
  "GET passes the bounded OpenClaw evidence into binding classification",
);
assert.match(
  probesSource,
  /function defaultHarnessAvailable\(/,
  "binding validates the configured default against installed runtimes / OpenClaw agents",
);
assert.match(
  probesSource,
  /harness === "openclaw" && openClawAgentCount > 0/,
  "OpenClaw counts as available only when a discoverable agent exists",
);
assert.match(source, /const ONBOARDING_STATUS_DEADLINE_MS = 4_000/);
assert.match(source, /const ONBOARDING_DISCOVERY_DEADLINE_MS = 2_000/);
assert.match(source, /covenSpawnEnv\(\{ discoveryDeadline \}\)/);
assert.match(
  source,
  /discoveryState = environmentDiscoveryState\(Date\.now\(\), discoveryDeadline\)/,
  "the request preserves whether environment discovery exhausted its budget",
);
assert.match(
  source,
  /classifyCommandPathFailure\(error, discoveryState\)/,
  "negative path probes retain incomplete environment evidence",
);
assert.match(
  source,
  /openCovenToolReadinessStatuses\(\{ env: readinessEnv \}\)/,
  "all local OpenCoven tool probes reuse the bounded readiness environment",
);
assert.match(
  source,
  /withinDeadline\(\s*\(\) => openCovenToolReadinessStatuses/,
  "deadline protection is installed before local tool discovery starts",
);
assert.match(
  source,
  /checkHarnessAdapters\(\s*openClawProbePromise,\s*readinessEnv,\s*requestDeadline,\s*discoveryState,\s*\)/,
  "adapter command and registry probes reuse the request-scoped environment",
);
assert.match(
  source,
  /execFileAsync\([\s\S]{0,320}\{[\s\S]{0,120}env,[\s\S]{0,120}signal,[\s\S]{0,120}timeout:/,
  "bounded command probes pass their abort signal to execFile",
);
assert.match(
  source,
  /configPromise = withinDeadline\(\(\) => loadConfig\(\), requestDeadline\)/,
  "binding config loads concurrently inside the remaining request budget",
);
assert.match(
  source,
  /configEvidencePromise = withinDeadline\([\s\S]{0,120}checkConfigEvidence/,
  "config parse and permission failures retain unavailable evidence",
);
assert.match(source, /const OPENCLAW_ONBOARDING_DEADLINE_MS = 750/);
assert.match(source, /state: "unavailable"/);
assert.match(probesSource, /onboardingContinuationDecision\(steps\)/);
assert.doesNotMatch(source, /readdir\([\s\S]*?\.openclaw[\s\S]*?agents/);
assert.match(probesSource, /has no installed runtime or OpenClaw agent/);
assert.match(source, /COVEN_CLI_INSTALL_GUIDANCE/);
assert.match(source, /openCovenToolReadinessStatuses/);
assert.match(
  source,
  /function checkCovenCli\(\s*tool: OpenCovenToolReadinessStatus \| undefined,\s*pathProbe: ProbeResult<string>,\s*\)/,
  "Coven CLI readiness distinguishes confirmed absence from unavailable lookup evidence",
);
assert.match(
  source,
  /if \(!tool\.compatible\)[\s\S]{0,320}ok: false[\s\S]{0,240}COVEN_CLI_INSTALL_GUIDANCE/,
  "startup requires a locally compatible Coven CLI without host npm guidance",
);
assert.doesNotMatch(
  source,
  /openCovenToolStatuses|checkNpmLatestVersion|npm view/,
  "the frequently-polled status route never invokes package-registry discovery",
);
assert.doesNotMatch(source, /cachedQueueProjectReadiness|checkQueueProject/);
assert.match(source, /openCovenTools\.find\(\(tool\) => tool\.id === "coven-cli"\)/);
assert.match(source, /onboardingStatusPayload\(steps, openCovenTools\)/);
assert.doesNotMatch(source, /Install the Coven CLI from OpenCoven\/coven/);
assert.match(
  source,
  /async function checkGit\(\s*env: NodeJS\.ProcessEnv,\s*deadline: number,\s*discoveryState: EnvironmentDiscoveryState,\s*\): Promise<Step>/,
  "preflight checks for git within the request-scoped environment and deadline",
);
assert.match(source, /Git is required to select and use a Queue project/);
assert.match(source, /git: classifyStep\(\{ \.\.\.git, optional: true \}\)/);
assert.match(source, /Summon your first familiar inside Cave/);
assert.match(source, /binding: classifyStep\(\{ \.\.\.binding, optional: true \}\)/);
assert.match(
  source,
  /async function checkFamiliars[\s\S]{0,700}optional: true[\s\S]{0,700}optional: true/,
);
assert.match(source, /xcode-select --install/);

const overlay = readFileSync(
  new URL("../../../../components/onboarding-overlay.tsx", import.meta.url),
  "utf8",
);
const onboardingModel = readFileSync(
  new URL("../../../../components/onboarding-model.ts", import.meta.url),
  "utf8",
);
assert.match(onboardingModel, /git\?: Step/);
assert.doesNotMatch(onboardingModel, /project: Step/);
assert.match(overlay, /title: "Find Git"/);
assert.doesNotMatch(overlay, /key: "project"|Choose your Queue project/);
assert.match(overlay, /Git is required before choosing a Queue project on\s+the Tasks page/);

const projectFiles = readFileSync(
  new URL("../../project/files/route.ts", import.meta.url),
  "utf8",
);
assert.match(projectFiles, /git unavailable — install Git to browse project files/);

console.log("onboarding-status route.test.ts: ok");
