# Runtime Availability Forward-Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the merged runtime-availability contract so passive, credential-free, bounded launch validation precedes every local capability or model subprocess and all consumers preserve truthful diagnostics.

**Architecture:** Strengthen the existing availability evaluator with executable-aware candidate inspection, thread a vault-free discovery environment and absolute deadline through canonical PATH discovery, and make Copilot capability routing consume one exact passive launch plan. Compute the first availability gate before capability probes, retain the immediate pre-model-spawn recheck, and propagate structured causes through chat, workflows, flows, and `/api/harnesses`.

**Tech Stack:** TypeScript, Node.js child processes and filesystem APIs, Next.js route handlers, Node test runner, pnpm.

---

### Task 1: Make passive availability executable-aware

**Files:**
- Modify: `src/lib/runtime-availability.ts`
- Modify: `src/lib/runtime-availability.test.ts`
- Modify: `src/app/api/chat/send/route-runtime-availability.integration.test.ts`

- [ ] **Step 1: Add failing POSIX permission tests**

Create a real temporary executable and a real mode-0644 file. Require the first
to be `ready` and the second to be `runtime_unlaunchable`:

```ts
const executable = join(temp, "runner-ready");
writeFileSync(executable, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
assert.equal(evaluateRuntimeAvailability({
  runner: "grok",
  command: executable,
  env: { PATH: temp },
  platform: "darwin",
}).state, "ready");

const nonExecutable = join(temp, "runner-no-exec");
writeFileSync(nonExecutable, "not executable\n", { mode: 0o644 });
const unavailable = evaluateRuntimeAvailability({
  runner: "grok",
  command: nonExecutable,
  env: { PATH: temp },
  platform: "darwin",
});
assert.equal(unavailable.state, "unlaunchable");
assert.equal(unavailable.code, "runtime_unlaunchable");
```

- [ ] **Step 2: Run the unit test and verify red**

```bash
node --experimental-strip-types src/lib/runtime-availability.test.ts
```

Expected: FAIL because the mode-0644 file is currently reported `ready`.

- [ ] **Step 3: Implement tri-state candidate inspection**

Use `statSync()` plus `accessSync(X_OK)`:

```ts
type CandidateInspection = "launchable" | "missing" | "unlaunchable";

function defaultInspectCandidate(
  candidate: string,
  platform: NodeJS.Platform,
): CandidateInspection {
  try {
    if (!statSync(candidate).isFile()) return "missing";
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return "missing";
    throw error;
  }
  if (platform !== "win32") {
    try {
      accessSync(candidate, constants.X_OK);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "EACCES" || code === "EPERM") return "unlaunchable";
      if (code === "ENOENT" || code === "ENOTDIR") return "missing";
      throw error;
    }
  }
  return "launchable";
}
```

Track whether resolution saw an unlaunchable candidate. Return the existing
runner-specific `runtime_unlaunchable` message when no launchable candidate
wins.

- [ ] **Step 4: Make the race fixture deterministic**

Replace the mode-0644 Grok fixture with an executable file whose shebang names
an isolated nonexistent interpreter:

```ts
await writeFile(
  broken,
  `#!${path.join(home, "missing-interpreter")}\nexit 0\n`,
  { mode: 0o755 },
);
```

Keep the Windows text `.exe` fixture. Isolate scenario one with an explicit
empty PATH instead of relying on the host not having Grok.

- [ ] **Step 5: Run both tests and verify green**

```bash
node --experimental-strip-types src/lib/runtime-availability.test.ts
node --experimental-strip-types --import ./scripts/test-alias-register.mjs src/app/api/chat/send/route-runtime-availability.integration.test.ts
```

Expected: both exit 0; the integration stream contains no fabricated
authentication or empty-output assistant text.

### Task 2: Make canonical discovery credential-free and deadline-aware

**Files:**
- Modify: `src/lib/coven-bin.ts`
- Modify: `src/lib/coven-bin.test.ts`
- Modify: `src/lib/harness-spawn-env.ts`
- Modify: `src/lib/harness-spawn-env.test.ts`
- Modify: `src/lib/server/copilot-capability-probe.ts`
- Modify: `src/lib/server/copilot-capability-probe.test.ts`

- [ ] **Step 1: Write failing discovery-environment tests**

Add a pure helper contract that deletes every mapped vault key without changing
PATH:

```ts
const discovery = vaultFreeDiscoveryEnv(
  { PATH: "/safe/bin", SECRET_ALPHA: "sentinel", SHARED_BETA: "sentinel" },
  { SECRET_ALPHA: { scope: ["opal"] }, SHARED_BETA: { scope: "shared" } },
);
assert.equal(discovery.PATH, "/safe/bin");
assert.equal(discovery.SECRET_ALPHA, undefined);
assert.equal(discovery.SHARED_BETA, undefined);
```

Extend `runnableNodeToolchainDirs()`' injected probe test to assert neither
sentinel reaches Node or npm. Add a Copilot test whose `spawnEnv` advances the
injected clock past the launcher deadline and assert the version spawn is never
called.

- [ ] **Step 2: Run the three focused tests and verify red**

```bash
node --experimental-strip-types src/lib/harness-spawn-env.test.ts
node --experimental-strip-types src/lib/coven-bin.test.ts
node --experimental-strip-types src/lib/server/copilot-capability-probe.test.ts
```

Expected: FAIL because discovery uses `process.env`, accepts no deadline, and
the Copilot deadline starts after environment construction.

- [ ] **Step 3: Add discovery options to `covenSpawnEnv()`**

Thread one options object through login-shell, registry, Node, and npm
discovery:

```ts
export type CovenSpawnEnvOptions = {
  discoveryEnv?: NodeJS.ProcessEnv;
  discoveryDeadline?: number;
  now?: () => number;
};

function remainingTimeout(
  maximum: number,
  options: CovenSpawnEnvOptions,
): number {
  if (options.discoveryDeadline === undefined) return maximum;
  return Math.max(1, Math.min(maximum, options.discoveryDeadline - (options.now ?? Date.now)()));
}
```

Every `execFileSync()` helper receives `env: options.discoveryEnv` and a timeout
capped by `remainingTimeout()`. Stop starting new helpers after the deadline.
Keep final `spawnEnv(cachedPath)` behavior unchanged so familiar-scoped secret
injection remains owned by `harnessSpawnEnv()`.

- [ ] **Step 4: Pass a vault-free environment from the harness boundary**

Add:

```ts
export function vaultFreeDiscoveryEnv(
  source: NodeJS.ProcessEnv,
  map: VaultMap,
): NodeJS.ProcessEnv {
  const env = scrubSidecarInternalEnv({ ...source });
  for (const key of Object.keys(map)) delete env[key];
  return env;
}
```

Extend `harnessSpawnEnv()` with an optional discovery deadline and call:

```ts
const map = loadVaultMap(true);
const env = subtractScopedVaultKeys(
  covenSpawnEnv({
    discoveryEnv: vaultFreeDiscoveryEnv(process.env, map),
    discoveryDeadline: options.discoveryDeadline,
  }),
  map,
  familiarId,
);
```

- [ ] **Step 5: Start the Copilot launcher deadline before discovery**

Create `resolutionDeadline` before requesting the environment and pass it into
the production callback:

```ts
const resolutionDeadline = Date.now() + RESOLUTION_TIMEOUT_MS;
const probeEnv = probeSpawnEnv(
  options.spawnEnv?.(resolutionDeadline) ??
    harnessSpawnEnv(null, { discoveryDeadline: resolutionDeadline }),
);
if (Date.now() >= resolutionDeadline) {
  return { version: null, diagnostic: "probe-timeout" };
}
```

Retain the independent 30-second version-process timer from #3900.

- [ ] **Step 6: Run the focused tests and verify green**

```bash
node --experimental-strip-types src/lib/harness-spawn-env.test.ts
node --experimental-strip-types src/lib/coven-bin.test.ts
node --experimental-strip-types src/lib/server/copilot-capability-probe.test.ts
```

Expected: all exit 0; sentinel values are absent and elapsed discovery consumes
the launcher budget.

### Task 3: Reuse one exact Copilot launch plan and preserve causes

**Files:**
- Create: `src/lib/server/copilot-runtime-launch.ts`
- Create: `src/lib/server/copilot-runtime-launch.test.ts`
- Modify: `src/lib/server/copilot-capability-probe.ts`
- Modify: `src/app/api/chat/send/copilot-routing.ts`
- Modify: `src/app/api/chat/send/harness-routing-copilot-jsonl.test.ts`
- Modify: `src/app/api/workflows/run/route.ts`
- Modify: `src/app/api/workflows/run/route.test.ts`
- Modify: `src/lib/server/flow-executor.ts`
- Modify: `src/lib/server/flow-executor.test.ts`
- Modify: `src/app/api/harnesses/route.ts`
- Modify: `src/app/api/harnesses/route.test.ts`
- Modify: `scripts/run-tests.mjs`

- [ ] **Step 1: Write failing passive-plan and diagnostic tests**

Define the wished-for passive result:

```ts
type CopilotRuntimeLaunch = {
  env: NodeJS.ProcessEnv;
  command: string;
  fixedArgs: string[];
  availability: RuntimeAvailability;
};
```

Require a resolved npm shim to return the transformed command and require
missing/unlaunchable plans to return without calling the injected version
spawn. In routing tests, require `probe-timeout`, `version-unparseable`, and
`version-unavailable` to produce different messages from an actually
unsupported `2.0.0` client.

- [ ] **Step 2: Run the focused tests and verify red**

```bash
node --experimental-strip-types src/lib/server/copilot-runtime-launch.test.ts
node --experimental-strip-types src/lib/server/copilot-capability-probe.test.ts
node --experimental-strip-types src/app/api/chat/send/harness-routing-copilot-jsonl.test.ts
```

Expected: FAIL because the passive resolver and cause-aware routing do not yet
exist.

- [ ] **Step 3: Implement the passive Copilot resolver**

Resolve the command once, evaluate it once, and return the exact values:

```ts
export async function resolveCopilotRuntimeLaunch(
  executable: string,
  options: CopilotRuntimeLaunchOptions = {},
): Promise<CopilotRuntimeLaunch> {
  const deadline = options.deadline ?? Date.now() + 2_500;
  const env = options.env ??
    harnessSpawnEnv(null, { discoveryDeadline: deadline });
  const launch = await resolveCopilotLaunchCommand(executable, {
    timeoutMs: Math.max(1, deadline - Date.now()),
    env,
  });
  const availability = evaluateRuntimeAvailability({
    runner: "copilot",
    command: launch.command,
    env,
    unresolvedWindowsShim: launch.unresolvedWindowsShim === true,
  });
  return {
    env,
    command: launch.command,
    fixedArgs: launch.fixedArgs,
    availability,
  };
}
```

The capability probe consumes this result. It runs `--version` only when
`availability.state === "ready"` and returns the exact command with its
diagnostic.

- [ ] **Step 4: Map capability causes explicitly**

Extend `prepareCopilotChatRouting()` to retain the probe diagnostic. Use
value-free copy:

```ts
const COPILOT_PROBE_MESSAGES = {
  "version-unavailable": "Cave could not read the Copilot CLI version. Run `copilot --version`, then try again.",
  "version-unparseable": "Copilot returned an unrecognized version. Update Copilot or the Cave runtime schema, then try again.",
  "probe-timeout": "The Copilot version check timed out. Retry after Copilot finishes starting.",
} as const;
```

Only a parsed version outside every accepted schema returns the existing
schema-incompatibility message. Apply the same mapper in local workflow and
flow execution before returning status 409.

- [ ] **Step 5: Reuse the plan in `/api/harnesses`**

Make Copilot availability asynchronous and derive it from
`resolveCopilotRuntimeLaunch()` rather than `copilotStreamSpec().executable`.
Return only `summarizeRuntimeAvailability()` so no path or environment reaches
the response.

- [ ] **Step 6: Wire and run all focused tests**

Add `copilot-runtime-launch.test.ts` to `scripts/run-tests.mjs`, then run:

```bash
node --experimental-strip-types src/lib/server/copilot-runtime-launch.test.ts
node --experimental-strip-types src/lib/server/copilot-capability-probe.test.ts
node --experimental-strip-types src/app/api/chat/send/harness-routing-copilot-jsonl.test.ts
node --experimental-strip-types src/app/api/workflows/run/route.test.ts
node --experimental-strip-types src/lib/server/flow-executor.test.ts
node --experimental-strip-types src/app/api/harnesses/route.test.ts
```

Expected: all exit 0 and no null-version cause is described as schema
incompatibility.

### Task 4: Move passive preflight ahead of every capability subprocess

**Files:**
- Modify: `src/app/api/chat/send/route.ts`
- Modify: `src/app/api/chat/send/route-runtime-availability.integration.test.ts`
- Modify: `src/app/api/chat/send/harness-routing-opencode.test.ts`
- Modify: `src/app/api/api-contracts.test.ts`

- [ ] **Step 1: Add failing ordering and no-spawn contracts**

Require the route to compute `earlyRuntimeAvailability` before these calls:

```ts
openCodeRunCapabilities(body.familiarId)
hermesChatSupportsModel()
covenRunSupportsModel()
covenRunSupportsPermission()
covenRunSupportsAddDir()
```

For a not-ready runner, assert every injected capability function has zero
calls and the route still emits the existing structured SSE error and `done`
event.

- [ ] **Step 2: Run the focused tests and verify red**

```bash
node --experimental-strip-types src/app/api/chat/send/harness-routing-opencode.test.ts
node --experimental-strip-types --import ./scripts/test-alias-register.mjs src/app/api/chat/send/route-runtime-availability.integration.test.ts
node --experimental-strip-types src/app/api/api-contracts.test.ts
```

Expected: FAIL because the current availability evaluation is below the
capability calls.

- [ ] **Step 3: Compute one passive early plan**

After runtime and permission routing is known, construct the runner's command,
environment, and availability without executing a capability probe. Return
early from capability setup when it is not ready. Carry the result into the
stream closure so the existing structured error/no-persistence path remains
the wire contract.

For Copilot, use the availability returned by its passive resolver. For
OpenCode, reuse the same outer host and inner command later given to
`openCodeLaunch()`. For generic adapters, reuse `covenLaunchCommand()` and
`harnessSpawnEnv()`.

- [ ] **Step 4: Keep the immediate spawn recheck**

Immediately before `spawn()`, call `evaluateRuntimeAvailability()` again with
the exact stored plan. Do not resolve a second Copilot command. Normalize the
post-spawn error once:

```ts
const message = err.code === "ENOENT"
  ? missingRunnerMessage(runner)
  : runtimeLaunchFailedMessage(runner);
launchFailure ??= { code: err.code === "ENOENT" ? "ENOENT" : "runtime_launch_failed", message };
pushProgress("harness-start", `${binding.harness} failed to start`, "error", message);
push({ kind: "error", code: launchFailure.code, message });
```

- [ ] **Step 5: Run the focused route suites and verify green**

```bash
node --experimental-strip-types src/app/api/chat/send/harness-routing-opencode.test.ts
node --experimental-strip-types --import ./scripts/test-alias-register.mjs src/app/api/chat/send/route-runtime-availability.integration.test.ts
node --experimental-strip-types src/app/api/api-contracts.test.ts
node --experimental-strip-types src/app/api/chat/send/harness-routing-copilot-jsonl.test.ts
```

Expected: all exit 0; no capability or prompt subprocess starts for a
not-ready launch plan.

### Task 5: Verify, publish, review, and land the forward fix

**Files:**
- Verify: `docs/superpowers/specs/2026-07-26-runtime-availability-followup-design.md`
- Verify: `docs/superpowers/plans/2026-07-26-runtime-availability-followup.md`
- Verify: all modified runtime and route files

- [ ] **Step 1: Run the complete local gate**

```bash
pnpm test:app
pnpm test:api
pnpm lint
pnpm typecheck
pnpm check:tests-wired
pnpm build
git diff --check origin/main...HEAD
```

Expected: every command exits 0. If `test:api` reproduces an unchanged
main-branch failure, prove it in a detached current-main worktree and record the
exact failure in Beads before proceeding.

- [ ] **Step 2: Commit and push signed, scoped changes**

```bash
git add docs/superpowers/specs/2026-07-26-runtime-availability-followup-design.md \
  docs/superpowers/plans/2026-07-26-runtime-availability-followup.md \
  scripts/run-tests.mjs src
git commit -S -m "fix(chat): complete runtime launch preflight"
git push -u origin fix/runtime-availability-followup
```

- [ ] **Step 3: Open the follow-up PR**

Open a PR against `main` that links #3856 and #3857, explains that #3891 and
#3900 remain intact, lists the six repaired gaps, and includes exact local
verification evidence.

- [ ] **Step 4: Run independent review and resolve conversations**

Review the full diff against current `origin/main`. Address every actionable
finding with a red-green cycle, reply in the inline thread, and resolve only
after the pushed code and tests prove it fixed. Confirm zero unresolved
threads through the GitHub review-thread API.

- [ ] **Step 5: Wait for required CI and squash-merge**

Require `Frontend build`, `Rust check`, `E2E (Playwright)`,
`Cross-environment required`, `Sidecar runtime required`, and live CodeQL
status. Squash-merge with an explicit subject/body, then verify inline:

```bash
git fetch origin main
git log origin/main --oneline -5
```

Expected: the squash subject contains the new PR number and REST reports
`merged: true`.

- [ ] **Step 6: Close Beads and clean the worktree**

Close only the completed runtime/Copilot and PR-tracking Beads. Confirm the
remote branch is gone, then remove
`.worktrees/runtime-availability-followup` and its local branch. Preserve the
primary checkout's `.beads/interactions.jsonl`.
