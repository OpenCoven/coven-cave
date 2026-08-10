import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type {
  DaemonRequest,
  DaemonResponse,
  DaemonTarget,
} from "../coven-daemon.ts";
import {
  INVALID_RESEARCH_WRITE_GRANT_DIAGNOSTIC,
  isOwnerLocalResearchDaemonTarget,
  OWNER_LOCAL_RESEARCH_DAEMON_REQUIRED_DIAGNOSTIC,
  dispatchResearchDaemonRequest,
  researchSessionLaunchPolicy,
  SESSION_LAUNCH_POLICY_REQUIRED_DIAGNOSTIC,
  shouldRequestResearchSessionLaunchPolicy,
  supportsSessionLaunchPolicy,
  validatedResearchLaunchAddDirs,
} from "./research-launch-policy.ts";

const source = readFileSync(new URL("./flow-executor.ts", import.meta.url), "utf8");
const researchRunner = readFileSync(new URL("./research-mission-runner.ts", import.meta.url), "utf8");

// A flow runs as a plain harness session. Passing `familiarId` natively to the
// daemon makes some setups try to run the session *as* that familiar and reject
// it with "no familiar configured for this harness". The familiar is carried in
// the compiled prompt and mirrored into cave-state via recordSessionFamiliar, so
// the daemon body must NOT include familiarId.
assert.match(
  source,
  /body: \{\s*projectRoot,\s*harness: binding\.harness,\s*prompt,\s*launchMode: "nonInteractive",\s*\.\.\.\(launchPolicy \? \{ launchPolicy \} : \{\}\),\s*\},/,
  "flow session spawn must not pass familiarId natively to the daemon",
);
assert.match(source, /launchMode: "nonInteractive"/, "flow session output should be plain assistant text, not harness TUI output");
assert.match(source, /recordSessionFamiliar\(sessionId, familiarId\)/, "familiar is still mirrored into cave-state");
assert.match(
  source,
  /function initialFlowRunStepStatus/,
  "flow runs should seed local trigger/input step status immediately",
);
assert.match(
  source,
  /def\?\.isTrigger[\s\S]*"succeeded"/,
  "trigger nodes should start as succeeded so runs visibly move past Start",
);
assert.match(
  source,
  /node\?\.type\.startsWith\("input\."\)[\s\S]*"succeeded"/,
  "input nodes should start as succeeded because required inputs were already collected",
);
assert.match(
  source,
  /seenActiveAgentStep[\s\S]*"running"/,
  "first non-local executable node should start as running until live markers arrive",
);

assert.match(
  source,
  /const hubAuthority = config\.multiHost\?\.mode === "hub";[\s\S]*binding\.harness === "copilot" && !sshBound && !hubAuthority/,
  "direct copilot flow spawn must not bypass configured hub authority",
);
assert.match(
  source,
  /Promise\.all\(\[\s*probeCopilotCapability\(\),\s*resolveRuntimeCompatibility\("copilot"\),[\s\S]*copilotStreamSpec\(\s*capability\.version,\s*compatibility\?\.eventProtocols,/,
  "direct Copilot flow runs consume versioned protocol metadata without allowing it to alter argv",
);
assert.match(
  source,
  /if \(binding\.harness === "copilot" && !sshBound && !hubAuthority\)[\s\S]*?if \(spec\)[\s\S]*?return \{\s*ok: false,\s*status: 409,/,
  "an unsupported local Copilot flow fails explicitly instead of falling through to the known prompt-mangling daemon path",
);
assert.match(
  source,
  /const capabilityFailure = copilotCapabilityFailureMessage\(capability\);[\s\S]*?if \(capabilityFailure\)[\s\S]*?status: 409[\s\S]*?const spec = copilotStreamSpec\(/,
  "a direct Copilot flow returns the shared truthful capability cause before checking schema compatibility",
);
assert.match(
  source,
  /if \(capabilityFailure\)[\s\S]*?return \{[\s\S]*?status: 409[\s\S]*?startCopilotFlowRun\(/,
  "a failed capability gate cannot start a direct flow session",
);

// Flow prompts direct familiars to write memory/self-reports into their own
// workspace, but the spawn cwd is the project root and a non-interactive run
// can't prompt for permission — the workspace must ride as a harness-level
// trust grant or every such write hard-fails. Callers (e.g. research
// missions) can grant additional roots such as the mission workspace.
assert.match(
  source,
  /startCopilotFlowRun\(\{[\s\S]*?addDirs: \[[\s\S]*?\.\.\.\(options\.addDirs \?\? \[\]\),[\s\S]*?\.\.\.await flowFamiliarAddDirs\(familiarId, projectRoot\),[\s\S]*?\],[\s\S]*?\}\);/,
  "direct copilot flow spawn must trust caller grants and the familiar's own workspace via addDirs",
);
assert.match(
  source,
  /function flowFamiliarAddDirs[\s\S]*?isValidFamiliarId\(familiarId\)[\s\S]*?realpath\(await familiarWorkspace\(familiarId\)\)/,
  "the workspace grant must be slug-validated and canonicalized before trusting",
);

assert.equal(
  supportsSessionLaunchPolicy({
    ok: true,
    apiVersion: "coven.daemon.v1",
    capabilities: { sessionLaunchPolicy: true },
  }),
  true,
  "the exact named Coven contract and capability admit the coordinated launch-policy contract",
);
for (const health of [
  null,
  {},
  { ok: true, apiVersion: "coven.daemon.v1", capabilities: { sessionLaunchPolicy: false } },
  { ok: true, apiVersion: "coven.daemon.v1", capabilities: { sessionUnattendedWorkspaceWrite: true } },
  { ok: true, apiVersion: "v1", capabilities: { sessionLaunchPolicy: true } },
  { ok: true, apiVersion: "coven.daemon.v2", capabilities: { sessionLaunchPolicy: true } },
  { ok: false, apiVersion: "coven.daemon.v1", capabilities: { sessionLaunchPolicy: true } },
]) {
  assert.equal(
    supportsSessionLaunchPolicy(health),
    false,
    "missing, failed, legacy, future, and stale health contracts fail closed",
  );
}
assert.deepEqual(
  researchSessionLaunchPolicy(["/canonical/research-mission"]),
  { approval: "never", sandbox: "workspace-write", addDirs: ["/canonical/research-mission"] },
  "Research receives only the canonical artifact workspace as a secondary write grant",
);
assert.match(SESSION_LAUNCH_POLICY_REQUIRED_DIAGNOSTIC, /Update Coven, restart the daemon/i);
assert.match(INVALID_RESEARCH_WRITE_GRANT_DIAGNOSTIC, /verify the Research artifact workspace/i);
assert.match(OWNER_LOCAL_RESEARCH_DAEMON_REQUIRED_DIAGNOSTIC, /owner-local Coven daemon socket/i);
for (const [socketPath, platform, expected] of [
  ["\\\\.\\pipe\\coven-daemon-local", "win32", true],
  ["\\\\remote-host\\pipe\\coven-daemon", "win32", false],
  ["\\\\localhost\\pipe\\coven-daemon", "win32", false],
  ["coven-daemon-relative", "win32", false],
  ["/tmp/coven.sock", "linux", true],
  ["relative/coven.sock", "linux", false],
] as const) {
  assert.equal(
    isOwnerLocalResearchDaemonTarget(
      { mode: "local", label: "Local daemon", socketPath },
      platform,
    ),
    expected,
    `${platform} owner-local classification for ${socketPath}`,
  );
}
assert.match(
  source,
  /shouldRequestResearchSessionLaunchPolicy\(\{[\s\S]*trustedLocalResearch: options\.trustedLocalResearch === true,[\s\S]*harness: binding\.harness,[\s\S]*pinnedResearchDaemonTarget = localDaemonTarget\(\);[\s\S]*isOwnerLocalResearchDaemonTarget\(pinnedResearchDaemonTarget\)[\s\S]*OWNER_LOCAL_RESEARCH_DAEMON_REQUIRED_DIAGNOSTIC[\s\S]*callDaemonTarget<Record<string, unknown>>\(\s*pinnedResearchDaemonTarget,\s*daemonHealthRequest\(\),[\s\S]*supportsSessionLaunchPolicy\(health\.data\)[\s\S]*SESSION_LAUNCH_POLICY_REQUIRED_DIAGNOSTIC/,
  "only trusted local Research probes one pinned local daemon target and old daemons fail closed",
);
assert.equal(
  shouldRequestResearchSessionLaunchPolicy({
    trustedLocalResearch: true,
    harness: "codex",
    sshBound: false,
    hubAuthority: false,
  }),
  true,
  "the observed local Codex Research path requests the policy",
);
for (const harness of ["claude", "opencode", "grok", "hermes", "copilot"]) {
  assert.equal(
    shouldRequestResearchSessionLaunchPolicy({
      trustedLocalResearch: true,
      harness,
      sshBound: false,
      hubAuthority: false,
    }),
    false,
    `${harness} Research preserves its existing no-policy daemon route`,
  );
}
for (const boundary of [
  { trustedLocalResearch: false, harness: "codex", sshBound: false, hubAuthority: false },
  { trustedLocalResearch: true, harness: "codex", sshBound: true, hubAuthority: false },
  { trustedLocalResearch: true, harness: "codex", sshBound: false, hubAuthority: true },
]) {
  assert.equal(
    shouldRequestResearchSessionLaunchPolicy(boundary),
    false,
    "manual, SSH, and hub Codex flows preserve their existing no-policy routing",
  );
}
assert.match(
  source,
  /validatedResearchLaunchAddDirs\(options\.addDirs \?\? \[\], projectRoot\)[\s\S]*researchSessionLaunchPolicy\(addDirs\)/,
  "only validated Research directories enter launchPolicy",
);

{
  const localTarget = {
    mode: "local" as const,
    label: "Local daemon" as const,
    socketPath: "/tmp/coven-before.sock",
  };
  const hubTarget = {
    mode: "hub" as const,
    label: "Server hub" as const,
    url: "https://hub.invalid",
  };
  let configuredTarget: DaemonTarget = localTarget;
  const seen: DaemonTarget[] = [];
  const launchPolicy = researchSessionLaunchPolicy(["/canonical/research-mission"]);
  const request = {
    method: "POST" as const,
    path: "/api/v1/sessions",
    body: { launchPolicy },
  };
  const dependencies = {
    callDaemon: async <T>(_request: DaemonRequest): Promise<DaemonResponse<T>> => {
      seen.push(configuredTarget);
      return { ok: true, status: 200, data: { id: "dynamic" } as T };
    },
    callDaemonTarget: async <T>(
      target: DaemonTarget,
      _request: DaemonRequest,
    ): Promise<DaemonResponse<T>> => {
      seen.push(target);
      return { ok: true, status: 200, data: { id: "pinned" } as T };
    },
  };

  // Simulate config changing to hub after the local health response but
  // before session creation. The policy-bearing POST must stay on the exact
  // local socket whose capability was probed.
  configuredTarget = hubTarget;
  await dispatchResearchDaemonRequest(
    request,
    { launchPolicy, pinnedTarget: localTarget },
    dependencies,
  );
  assert.deepEqual(seen, [localTarget], "a config race cannot move a policy-bearing POST to a hub");

  seen.length = 0;
  await dispatchResearchDaemonRequest(request, undefined, dependencies);
  assert.deepEqual(seen, [hubTarget], "non-policy sessions retain config-aware daemon routing");
}

const grantRoot = await mkdtemp(path.join(os.tmpdir(), "cave-research-policy-"));
try {
  const projectRoot = path.join(grantRoot, "project");
  const missionWorkspace = path.join(grantRoot, "mission");
  const notDirectory = path.join(grantRoot, "artifact.txt");
  await Promise.all([
    mkdir(projectRoot),
    mkdir(missionWorkspace),
    writeFile(notDirectory, "not a directory"),
  ]);
  assert.deepEqual(
    await validatedResearchLaunchAddDirs(
      [missionWorkspace, missionWorkspace, projectRoot],
      projectRoot,
    ),
    [await realpath(missionWorkspace)],
    "grants are canonical, deduplicated, and omit projectRoot itself",
  );
  assert.equal(await validatedResearchLaunchAddDirs(["relative/path"], projectRoot), null);
  assert.equal(await validatedResearchLaunchAddDirs([notDirectory], projectRoot), null);
} finally {
  await rm(grantRoot, { recursive: true, force: true });
}
assert.match(
  researchRunner,
  /startFlowSession\(flow, \{\s*projectRoot: options\.projectRoot,\s*addDirs: options\.addDirs,\s*trustedLocalResearch: true,\s*\}\)/,
  "only the production Research mission adapter requests the internal trusted launch policy",
);

console.log("flow-executor.test.ts: ok");

// Travel-queued flows: the placeholder run is recorded BEFORE enqueueing so
// its id rides in the payload — replay then updates that run in place instead
// of recording a second one, keeping research mission iterations (which store
// the id) pointed at the run that actually executes (cave-qdf2).
assert.match(
  source,
  /const run = await recordFlowRun\(\{[\s\S]*?status: "queued",[\s\S]*?\}\);[\s\S]*?await enqueueOfflineTravelItem\(/,
  "queued placeholder run must exist before the travel item that references it",
);
assert.match(
  source,
  /placeholderRunId: run\.id,/,
  "queued travel payload must carry the placeholder run id",
);
assert.match(
  source,
  /status: "failed",[\s\S]*?summary: "offline enqueue failed",/,
  "an enqueue failure must not leave an un-replayable queued run behind",
);
