// @ts-nocheck
// Onboarding status: when the daemon is offline the familiar count is
// unknown, so the binding step must point at the daemon rather than
// blaming the user's bindings. Source-pattern assertions (the route's
// checks call the live daemon socket, so we don't execute them here).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./route.ts", import.meta.url), "utf8");

assert.match(
  source,
  /checkBinding\(\s*familiarsAvailable: boolean,\s*daemonOk: boolean,\s*reports: AdapterReport\[\],\s*openclawAgentCount: number,\s*\)/,
  "checkBinding receives daemon health and live runtime detection so it can attribute the blocker correctly",
);

assert.match(
  source,
  /daemonOk\s*\?\s*"Bindings set but no familiars to bind\."\s*:\s*"Waiting for the daemon — familiars load once it starts\."/,
  "binding hint defers to the daemon when it is offline",
);

assert.match(
  source,
  /checkBinding\(\s*familiarsRes\.count > 0,\s*daemon\.ok,\s*adapters\.reports,\s*openclawAgentCount,\s*\)/,
  "GET passes the daemon step result and live adapter reports into checkBinding",
);

// A stale default harness (e.g. "openclaw") must not advertise a confident
// binding when neither its runtime nor any agent actually exists.
assert.match(
  source,
  /function defaultHarnessAvailable\(/,
  "binding validates the configured default against installed runtimes / OpenClaw agents",
);

assert.match(
  source,
  /harness === "openclaw" && openclawAgentCount > 0/,
  "OpenClaw counts as available only when a discoverable agent exists",
);

assert.match(
  source,
  /has no installed runtime or OpenClaw agent/,
  "binding hint is honest when the default harness has no live backing",
);

assert.match(
  source,
  /npm i -g @opencoven\/cli@latest/,
  "onboarding status should return the npm-published Coven CLI install command",
);

assert.match(
  source,
  /openCovenToolStatuses/,
  "onboarding status uses the shared OpenCoven tool detector",
);

assert.match(
  source,
  /checkCovenCli\(tool: OpenCovenToolStatus \| undefined\)/,
  "coven CLI status is derived from the shared coven-cli tool result",
);

assert.match(
  source,
  /openCovenTools\.find\(\(tool\) => tool\.id === "coven-cli"\)/,
  "startup identifies the coven CLI by the shared tool id",
);

assert.match(
  source,
  /steps, tools: openCovenTools/,
  "startup returns OpenCoven tool statuses for the install screen",
);

assert.doesNotMatch(
  source,
  /Install the coven CLI from OpenCoven\/coven/,
  "onboarding status should not return stale repo-source CLI install guidance",
);

// Dependency coverage: machines without git still complete onboarding, but
// the checklist must surface git as a recommended install with a hint.
assert.match(source, /async function checkGit\(\): Promise<Step>/, "preflight checks for git");
assert.match(
  source,
  /optional: true/,
  "git is an advisory step — its absence must not gate onboarding",
);
assert.match(
  source,
  /s\.ok \|\| s\.optional/,
  "complete treats optional steps as non-blocking",
);
assert.match(
  source,
  /changes panel, project files, and checkpoints need Git/,
  "git hint names the features that need it",
);
assert.match(
  source,
  /xcode-select --install/,
  "git hint is platform-aware (macOS path present)",
);

const overlay = readFileSync(
  new URL("../../../../components/onboarding-overlay.tsx", import.meta.url),
  "utf8",
);
assert.match(overlay, /git\?: Step/, "overlay accepts the git step");
assert.match(overlay, /Find Git \(recommended\)/, "overlay renders the git checklist row");

const projectFiles = readFileSync(
  new URL("../../project/files/route.ts", import.meta.url),
  "utf8",
);
assert.match(
  projectFiles,
  /git unavailable — install Git to browse project files/,
  "missing git must not masquerade as 'not a git repository'",
);

console.log("onboarding-status route.test.ts: ok");
