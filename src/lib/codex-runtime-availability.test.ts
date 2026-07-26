import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  classifyCodexAdapterFailure,
  probeCodexRuntimeAvailability,
} from "./codex-runtime-availability.ts";

const launch = { command: "/opt/coven", fixedArgs: ["/opt/coven.js"] };
const env = { PATH: "/opt" } as unknown as NodeJS.ProcessEnv;
const covenProbe = {
  platform: "linux" as const,
  statFile: (candidate: string) => candidate === "/opt/coven",
};

// The adapter inspection receives the exact resolved command, fixed arguments,
// and scoped spawn environment that chat will later use.
{
  let received: unknown = null;
  const availability = await probeCodexRuntimeAvailability({
    launch,
    env,
    covenProbe,
    adapterList: async (actualLaunch, actualEnv) => {
      received = { actualLaunch, actualEnv };
      return {
        exitCode: 0,
        stdout: JSON.stringify([{ id: "codex", available: true }]),
        stderr: "",
      };
    },
  });
  assert.deepEqual(received, { actualLaunch: launch, actualEnv: env });
  assert.deepEqual(availability, {
    state: "ready",
    runner: "codex",
    resolvedPath: "/opt/coven",
  });
}

// A missing Coven launcher short-circuits before adapter inspection and names
// Coven rather than blaming Codex.
{
  let inspected = false;
  const availability = await probeCodexRuntimeAvailability({
    launch,
    env,
    covenProbe: { platform: "linux", statFile: () => false },
    adapterList: async () => {
      inspected = true;
      throw new Error("must not run when Coven is missing");
    },
  });
  assert.equal(inspected, false);
  assert.equal(availability.state, "missing");
  assert.equal(availability.state === "missing" && availability.component, "coven");
  assert.match(availability.state === "missing" ? availability.message : "", /Coven CLI not found on PATH/);
}

// Coven has started, but its own scoped environment cannot resolve Codex.
{
  const availability = await probeCodexRuntimeAvailability({
    launch,
    env,
    covenProbe,
    adapterList: async () => ({
      exitCode: 0,
      stdout: JSON.stringify([{ id: "codex", available: false }]),
      stderr: "",
    }),
  });
  assert.equal(availability.state, "missing");
  assert.equal(availability.state === "missing" && availability.component, "adapter");
  assert.match(availability.state === "missing" ? availability.message : "", /Codex CLI is unavailable to Coven/);
  assert.doesNotMatch(availability.state === "missing" ? availability.message : "", /authenticat|provider|no output/i);
}

// Adapter-level errors emitted by a started Coven process retain a distinct
// misconfiguration state rather than falling through to auth/no-output copy.
{
  const availability = await probeCodexRuntimeAvailability({
    launch,
    env,
    covenProbe,
    adapterList: async () => ({
      exitCode: 1,
      stdout: "",
      stderr: "unsupported harness `codex`. Configured harnesses: claude.",
    }),
  });
  assert.equal(availability.state, "unlaunchable");
  assert.equal(availability.state === "unlaunchable" && availability.component, "adapter");
  assert.match(availability.state === "unlaunchable" ? availability.message : "", /misconfigured/i);
}

// A Coven build that does not support `adapter list` is a known unsupported
// Codex adapter preflight, not an uncertain probe or generic auth failure.
{
  const availability = await probeCodexRuntimeAvailability({
    launch,
    env,
    covenProbe,
    adapterList: async () => ({
      exitCode: 2,
      stdout: "",
      stderr: "error: unrecognized subcommand 'adapter'",
    }),
  });
  assert.equal(availability.state, "unlaunchable");
  assert.equal(availability.state === "unlaunchable" && availability.component, "adapter");
  assert.match(availability.state === "unlaunchable" ? availability.message : "", /update Coven/i);
}

{
  const availability = await probeCodexRuntimeAvailability({
    launch,
    env,
    covenProbe,
    adapterList: async () => ({ exitCode: null, stdout: "", stderr: "", timedOut: true }),
  });
  assert.equal(availability.state, "probe_failed");
  assert.equal(availability.state === "probe_failed" && availability.component, "adapter");
  assert.doesNotMatch(availability.state === "probe_failed" ? availability.message : "", /not found|not installed/i);
}

// A malformed or future adapter-list row cannot prove that Codex is absent.
// Preserve uncertainty as probe_failed rather than sending a false install
// remediation.
{
  const availability = await probeCodexRuntimeAvailability({
    launch,
    env,
    covenProbe,
    adapterList: async () => ({
      exitCode: 0,
      stdout: JSON.stringify([{ id: "codex", available: "unknown" }]),
      stderr: "",
    }),
  });
  assert.equal(availability.state, "probe_failed");
  assert.equal(availability.state === "probe_failed" && availability.component, "adapter");
  assert.doesNotMatch(availability.state === "probe_failed" ? availability.message : "", /not found|not installed/i);
}

assert.equal(classifyCodexAdapterFailure("harness `codex` is not available"), "missing");
assert.equal(classifyCodexAdapterFailure("Codex adapter is not installed"), "missing");
assert.equal(classifyCodexAdapterFailure("unsupported adapter codex"), "unlaunchable");
assert.equal(classifyCodexAdapterFailure("unknown subcommand `adapter`"), "unlaunchable");
assert.equal(classifyCodexAdapterFailure("codex adapter is not configured"), "unlaunchable");
assert.equal(classifyCodexAdapterFailure("authentication required"), null);

// Production execution remains direct argv: it runs only `adapter list --json`
// and never routes user prompt text through a shell.
const source = readFileSync(new URL("./codex-runtime-availability.ts", import.meta.url), "utf8");
assert.match(source, /\[\.\.\.launch\.fixedArgs, "adapter", "list", "--json"\]/);
assert.doesNotMatch(source, /shell\s*:/);

console.log("codex-runtime-availability.test.ts: ok");
