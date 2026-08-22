# Beads Dolt Sync Watchdog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Cave's unbounded `bd dolt pull && bd dolt push` shell chain with a cross-platform watchdog that bounds both phases, terminates the complete owned process tree, and documents an honest retry and remote-ref verification procedure.

**Architecture:** Add one TypeScript CLI orchestrator under `scripts/` that launches `bd` through the existing Windows-safe resolver and reuses Cave's bounded-output and process-tree termination helpers. Exercise it through a fake `bd` executable, including a POSIX descendant that ignores `SIGTERM`, then route the stable `pnpm beads:sync` entrypoint and repository guidance through the wrapper.

**Tech Stack:** Node.js 24, TypeScript strip-types execution, `node:test`, Node child processes, pnpm, Cave `withBdLaunch`, Cave `BoundedProcessOutput`, Cave `terminateProcessTree`.

---

## File structure

- Create `scripts/beads-sync.ts`
  - Own sequential pull/push orchestration, credential-prompt suppression,
    bounded diagnostics, timeout classification, and exact process-tree cleanup.
- Create `scripts/beads-sync.test.mjs`
  - Exercise healthy ordering, pull short-circuiting, push failure, timeout
    cleanup, and cleanup-proof failure.
- Modify `src/lib/bd-bin.test.ts`
  - Add the new script to the source guard that requires shell-free
    `withBdLaunch` routing.
- Modify `scripts/run-tests.mjs`
  - Wire the new script test into the app test suite.
- Modify `package.json`
  - Keep the public command name `beads:sync`, but route it through the new
    TypeScript entrypoint.
- Modify `scripts/beads-familiar-workflow.test.mjs`
  - Pin the new package command and safe operator guidance.
- Modify `docs/workflows/beads-familiars.md`
  - Make `pnpm beads:sync` canonical and document one retry plus
    `refs/dolt/data` verification.
- Modify `AGENTS.md`
  - Replace the raw session-completion push with the bounded entrypoint.
- Modify `CLAUDE.md`
  - Replace the raw session-completion push with the bounded entrypoint.

### Task 1: Add failing sync orchestration contracts

**Files:**
- Create: `scripts/beads-sync.test.mjs`
- Modify: `scripts/run-tests.mjs:80-100`
- Modify: `src/lib/bd-bin.test.ts:202-215`

- [ ] **Step 1: Create the fake-CLI test harness and healthy ordering test**

Create `scripts/beads-sync.test.mjs` with:

```js
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";

import { runBeadsSync } from "./beads-sync.ts";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "beads-sync-"));
  const bin = join(root, "bin");
  const log = join(root, "bd-log.jsonl");
  const descendantPid = join(root, "descendant.pid");
  mkdirSync(bin, { recursive: true });
  writeFileSync(
    join(bin, "bd"),
    `#!/usr/bin/env node
import { appendFileSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";

const args = process.argv.slice(2);
const phase = args[1];
appendFileSync(
  process.env.BD_FAKE_LOG,
  JSON.stringify({
    args,
    gitTerminalPrompt: process.env.GIT_TERMINAL_PROMPT,
    gcmInteractive: process.env.GCM_INTERACTIVE,
  }) + "\\n",
);

if (phase === "pull") {
  process.stdout.write("pull ok\\n");
  process.stderr.write("pull note\\n");
  process.exit(Number(process.env.BD_FAKE_PULL_EXIT ?? "0"));
}

if (process.env.BD_FAKE_PUSH_HANG === "1") {
  const descendant = spawn(
    process.execPath,
    ["-e", "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"],
    { stdio: "ignore" },
  );
  writeFileSync(process.env.BD_FAKE_DESCENDANT_PID, String(descendant.pid));
  process.on("SIGTERM", () => {});
  await new Promise(() => {});
}

process.stdout.write("push ok\\n");
process.stderr.write("push note\\n");
process.exit(Number(process.env.BD_FAKE_PUSH_EXIT ?? "0"));
`,
    "utf8",
  );
  chmodSync(join(bin, "bd"), 0o755);
  return {
    root,
    log,
    descendantPid,
    env: {
      ...process.env,
      PATH: `${bin}${process.env.PATH ? `${delimiter}${process.env.PATH}` : ""}`,
      BD_FAKE_LOG: log,
      BD_FAKE_DESCENDANT_PID: descendantPid,
    },
  };
}

function readLog(path) {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function outputSink() {
  let value = "";
  return {
    write(chunk) {
      value += chunk;
    },
    text() {
      return value;
    },
  };
}

test("sync runs pull before push with noninteractive credential settings", async () => {
  const current = fixture();
  const stdout = outputSink();
  const stderr = outputSink();
  try {
    const status = await runBeadsSync({
      env: current.env,
      writeStdout: (value) => stdout.write(value),
      writeStderr: (value) => stderr.write(value),
    });

    assert.equal(status, 0, stderr.text());
    assert.deepEqual(
      readLog(current.log),
      [
        {
          args: ["dolt", "pull"],
          gitTerminalPrompt: "0",
          gcmInteractive: "Never",
        },
        {
          args: ["dolt", "push"],
          gitTerminalPrompt: "0",
          gcmInteractive: "Never",
        },
      ],
    );
    assert.match(stdout.text(), /\[beads:sync\] pull/);
    assert.match(stdout.text(), /pull ok/);
    assert.match(stdout.text(), /\[beads:sync\] push/);
    assert.match(stdout.text(), /push ok/);
    assert.match(stderr.text(), /pull note/);
    assert.match(stderr.text(), /push note/);
  } finally {
    rmSync(current.root, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Add pull and push failure contracts**

Append to `scripts/beads-sync.test.mjs`:

```js
test("pull failure preserves its status and never starts push", async () => {
  const current = fixture();
  const stderr = outputSink();
  try {
    const status = await runBeadsSync({
      env: { ...current.env, BD_FAKE_PULL_EXIT: "7" },
      writeStdout: () => {},
      writeStderr: (value) => stderr.write(value),
    });

    assert.equal(status, 7);
    assert.deepEqual(
      readLog(current.log).map((entry) => entry.args),
      [["dolt", "pull"]],
    );
    assert.match(stderr.text(), /pull exited with status 7/);
  } finally {
    rmSync(current.root, { recursive: true, force: true });
  }
});

test("push failure preserves its status and prints safe retry guidance", async () => {
  const current = fixture();
  const stderr = outputSink();
  try {
    const status = await runBeadsSync({
      env: { ...current.env, BD_FAKE_PUSH_EXIT: "9" },
      writeStdout: () => {},
      writeStderr: (value) => stderr.write(value),
    });

    assert.equal(status, 9);
    assert.deepEqual(
      readLog(current.log).map((entry) => entry.args),
      [["dolt", "pull"], ["dolt", "push"]],
    );
    assert.match(stderr.text(), /push exited with status 9/);
    assert.match(stderr.text(), /Retry `pnpm beads:sync` once/);
    assert.match(stderr.text(), /refs\/dolt\/data/);
    assert.match(stderr.text(), /Do not edit Git configuration or credential helpers/);
  } finally {
    rmSync(current.root, { recursive: true, force: true });
  }
});
```

- [ ] **Step 3: Add timeout and cleanup-proof contracts**

Append to `scripts/beads-sync.test.mjs`:

```js
async function waitForMissingProcess(pid, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
    } catch (error) {
      if (error?.code === "ESRCH") return true;
      throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return false;
}

test("push timeout kills a descendant that ignores SIGTERM", {
  skip: process.platform === "win32",
}, async () => {
  const current = fixture();
  const stderr = outputSink();
  try {
    const status = await runBeadsSync({
      env: { ...current.env, BD_FAKE_PUSH_HANG: "1" },
      timeoutMs: 1_000,
      terminationGraceMs: 200,
      writeStdout: () => {},
      writeStderr: (value) => stderr.write(value),
    });

    assert.equal(status, 124, stderr.text());
    const pid = Number(readFileSync(current.descendantPid, "utf8"));
    assert.equal(await waitForMissingProcess(pid), true, `descendant ${pid} survived timeout`);
    assert.match(stderr.text(), /push timed out after 1000ms/);
    assert.match(stderr.text(), /owned process tree terminated/);
    assert.match(stderr.text(), /Retry `pnpm beads:sync` once/);
  } finally {
    rmSync(current.root, { recursive: true, force: true });
  }
});

test("unproven tree cleanup is a hard error, not an ordinary timeout", async () => {
  const stderr = outputSink();
  const fakeChild = new EventEmitter();
  fakeChild.pid = 424242;
  fakeChild.exitCode = null;
  fakeChild.signalCode = null;
  fakeChild.stdout = new PassThrough();
  fakeChild.stderr = new PassThrough();

  const status = await runBeadsSync({
    timeoutMs: 1,
    spawnProcess: () => fakeChild,
    terminateTree: async () => false,
    writeStdout: () => {},
    writeStderr: (value) => stderr.write(value),
  });

  assert.equal(status, 1);
  assert.match(stderr.text(), /could not prove process-tree cleanup/);
  assert.doesNotMatch(stderr.text(), /owned process tree terminated/);
});
```

- [ ] **Step 4: Wire the test into the app suite**

Add `"scripts/beads-sync.test.mjs",` immediately after
`"scripts/beads-create.test.mjs",` in the first `SUITES.app.files` group in
`scripts/run-tests.mjs`.

Update `src/lib/bd-bin.test.ts`:

```ts
const ROUTED_SCRIPTS = [
  "scripts/beads-create.ts",
  "scripts/beads-pr-shared.ts",
  "scripts/beads-surface-audit.ts",
  "scripts/beads-sync.ts",
  "scripts/worktree-lifecycle-create.ts",
  "scripts/worktree-lifecycle-inventory.ts",
  "scripts/worktree-lifecycle-metadata-repair.ts",
];
```

- [ ] **Step 5: Run the new test and verify the expected failure**

Run:

```bash
node scripts/beads-sync.test.mjs
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `scripts/beads-sync.ts`.

- [ ] **Step 6: Commit the failing contracts**

```bash
git add scripts/beads-sync.test.mjs scripts/run-tests.mjs src/lib/bd-bin.test.ts
git commit -m "test: define bounded Beads sync contract"
```

### Task 2: Implement bounded pull and push orchestration

**Files:**
- Create: `scripts/beads-sync.ts`
- Test: `scripts/beads-sync.test.mjs`
- Test: `src/lib/bd-bin.test.ts`

- [ ] **Step 1: Implement the complete sync entrypoint**

Create `scripts/beads-sync.ts`:

```ts
#!/usr/bin/env node

import {
  spawn,
  type ChildProcess,
  type SpawnOptions,
} from "node:child_process";

import { withBdLaunch } from "../src/lib/bd-bin.ts";
import {
  BoundedProcessOutput,
  safeProcessErrorMessage,
  terminateProcessTree,
} from "../src/lib/process-execution.ts";
import { isDirectRun } from "./direct-run.mjs";

const DEFAULT_PHASE_TIMEOUT_MS = 90_000;
const OUTPUT_BYTES = 64 * 1024;

type SyncPhase = "pull" | "push";

type SpawnProcess = (
  command: string,
  args: string[],
  options: SpawnOptions,
) => ChildProcess;

type TerminateTree = (
  child: ChildProcess,
  options?: { platform?: NodeJS.Platform; graceMs?: number },
) => Promise<boolean>;

export type BeadsSyncOptions = {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  timeoutMs?: number;
  terminationGraceMs?: number;
  spawnProcess?: SpawnProcess;
  terminateTree?: TerminateTree;
  writeStdout?: (value: string) => void;
  writeStderr?: (value: string) => void;
};

type PhaseResult = {
  status: number;
  stdout: string;
  stderr: string;
  kind: "completed" | "timed-out" | "cleanup-unproven" | "spawn-failed";
  error?: string;
};

function positiveFiniteTimeout(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new TypeError("Beads sync timeout must be a positive finite number");
  }
  return Math.ceil(value);
}

function writeRetained(write: (value: string) => void, value: string): void {
  if (!value) return;
  write(value.endsWith("\n") ? value : `${value}\n`);
}

function retryGuidance(write: (value: string) => void): void {
  write("[beads:sync] Retry `pnpm beads:sync` once.\n");
  write(
    "[beads:sync] Do not edit Git configuration or credential helpers after one transient 403.\n",
  );
  write(
    "[beads:sync] For pending Beads changes, compare `git ls-remote origin refs/dolt/data` before and after the retry.\n",
  );
}

async function runPhase(
  phase: SyncPhase,
  options: Required<
    Pick<
      BeadsSyncOptions,
      | "env"
      | "platform"
      | "timeoutMs"
      | "spawnProcess"
      | "terminateTree"
      | "writeStdout"
      | "writeStderr"
    >
  > & Pick<BeadsSyncOptions, "terminationGraceMs">,
): Promise<PhaseResult> {
  const launch = withBdLaunch("bd", ["dolt", phase]);
  const stdout = new BoundedProcessOutput(OUTPUT_BYTES);
  const stderr = new BoundedProcessOutput(OUTPUT_BYTES);
  let child: ChildProcess;

  try {
    child = options.spawnProcess(launch.command, launch.args, {
      env: {
        ...options.env,
        GIT_TERMINAL_PROMPT: "0",
        GCM_INTERACTIVE: "Never",
      },
      windowsHide: true,
      shell: false,
      detached: options.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    return {
      status: 1,
      stdout: "",
      stderr: "",
      kind: "spawn-failed",
      error: safeProcessErrorMessage(error, "Beads CLI"),
    };
  }

  child.stdout?.on("data", (chunk) => stdout.append(chunk));
  child.stderr?.on("data", (chunk) => stderr.append(chunk));

  return new Promise((resolve) => {
    let settled = false;
    let timedOut = false;
    const finish = (result: PhaseResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const retained = () => ({
      stdout: stdout.text(),
      stderr: stderr.text(),
    });
    const timer = setTimeout(() => {
      timedOut = true;
      void options
        .terminateTree(child, {
          platform: options.platform,
          graceMs: options.terminationGraceMs,
        })
        .then((cleanupProven) => {
          finish({
            status: cleanupProven ? 124 : 1,
            ...retained(),
            kind: cleanupProven ? "timed-out" : "cleanup-unproven",
          });
        })
        .catch(() => {
          finish({
            status: 1,
            ...retained(),
            kind: "cleanup-unproven",
          });
        });
    }, options.timeoutMs);

    child.once("error", (error) => {
      finish({
        status: 1,
        ...retained(),
        kind: "spawn-failed",
        error: safeProcessErrorMessage(error, "Beads CLI"),
      });
    });
    child.once("close", (code) => {
      if (timedOut) return;
      finish({
        status: code ?? 1,
        ...retained(),
        kind: "completed",
      });
    });
  });
}

export async function runBeadsSync(options: BeadsSyncOptions = {}): Promise<number> {
  const timeoutMs = positiveFiniteTimeout(
    options.timeoutMs ?? DEFAULT_PHASE_TIMEOUT_MS,
  );
  const writeStdout = options.writeStdout ?? ((value) => process.stdout.write(value));
  const writeStderr = options.writeStderr ?? ((value) => process.stderr.write(value));
  const resolved = {
    env: options.env ?? process.env,
    platform: options.platform ?? process.platform,
    timeoutMs,
    terminationGraceMs: options.terminationGraceMs,
    spawnProcess: options.spawnProcess ?? spawn,
    terminateTree: options.terminateTree ?? terminateProcessTree,
    writeStdout,
    writeStderr,
  };

  for (const phase of ["pull", "push"] as const) {
    writeStdout(`[beads:sync] ${phase}\n`);
    const result = await runPhase(phase, resolved);
    writeRetained(writeStdout, result.stdout);
    writeRetained(writeStderr, result.stderr);

    if (result.kind === "spawn-failed") {
      writeStderr(`[beads:sync] ${phase} failed: ${result.error}\n`);
      if (phase === "push") retryGuidance(writeStderr);
      return 1;
    }
    if (result.kind === "timed-out") {
      writeStderr(
        `[beads:sync] ${phase} timed out after ${timeoutMs}ms; owned process tree terminated.\n`,
      );
      if (phase === "push") retryGuidance(writeStderr);
      return 124;
    }
    if (result.kind === "cleanup-unproven") {
      writeStderr(
        `[beads:sync] ${phase} timed out after ${timeoutMs}ms and could not prove process-tree cleanup.\n`,
      );
      if (phase === "push") retryGuidance(writeStderr);
      return 1;
    }
    if (result.status !== 0) {
      writeStderr(
        `[beads:sync] ${phase} exited with status ${result.status}.\n`,
      );
      if (phase === "push") retryGuidance(writeStderr);
      return result.status;
    }
  }

  return 0;
}

async function main(): Promise<void> {
  process.exitCode = await runBeadsSync();
}

if (isDirectRun(import.meta.url)) {
  void main().catch((error) => {
    process.stderr.write(
      `[beads:sync] ${safeProcessErrorMessage(error, "Beads sync")}\n`,
    );
    process.exitCode = 1;
  });
}
```

- [ ] **Step 2: Run the focused tests**

Run:

```bash
node scripts/beads-sync.test.mjs
node --experimental-strip-types src/lib/bd-bin.test.ts
```

Expected:

```text
... all five beads-sync subtests pass ...
bd-bin.test.ts ok
```

- [ ] **Step 3: Run typecheck and lint on the implementation**

Run:

```bash
pnpm typecheck
pnpm lint
```

Expected: both commands exit `0`.

- [ ] **Step 4: Commit the watchdog implementation**

```bash
git add scripts/beads-sync.ts
git commit -m "fix: bound Beads Dolt sync processes"
```

### Task 3: Route the stable command and operator guidance

**Files:**
- Modify: `package.json:101`
- Modify: `scripts/beads-familiar-workflow.test.mjs:10-85`
- Modify: `docs/workflows/beads-familiars.md:65-95`
- Modify: `AGENTS.md` in the managed Beads session-completion block
- Modify: `CLAUDE.md` in the managed Beads session-completion block

- [ ] **Step 1: Change the workflow contract test first**

In `scripts/beads-familiar-workflow.test.mjs`, replace:

```js
sync: "bd dolt pull && bd dolt push",
```

with:

```js
sync: "node --experimental-strip-types scripts/beads-sync.ts",
```

Replace:

```js
assert.match(claude, /bd dolt push[\s\S]*git push/, "Claude session close guidance should include Beads Dolt sync before git push");
```

with:

```js
assert.match(
  claude,
  /pnpm beads:sync[\s\S]*git push/,
  "Claude session close guidance should use bounded Beads sync before git push",
);
assert.match(
  agents,
  /pnpm beads:sync[\s\S]*git push/,
  "agent session close guidance should use bounded Beads sync before git push",
);
```

After the existing Dolt workflow assertion, add:

```js
assert.match(
  workflow,
  /Retry `pnpm beads:sync` once[\s\S]*Do not edit Git configuration or credential helpers[\s\S]*refs\/dolt\/data/,
  "workflow docs should explain bounded retry and remote-ref verification",
);
```

- [ ] **Step 2: Run the workflow contract and verify it fails**

Run:

```bash
node scripts/beads-familiar-workflow.test.mjs
```

Expected: FAIL because `package.json`, `AGENTS.md`, `CLAUDE.md`, and the workflow
doc still contain the raw Dolt push contract.

- [ ] **Step 3: Route `pnpm beads:sync` through the watchdog**

In `package.json`, replace:

```json
"beads:sync": "bd dolt pull && bd dolt push",
```

with:

```json
"beads:sync": "node --experimental-strip-types scripts/beads-sync.ts",
```

- [ ] **Step 4: Document the bounded command and retry procedure**

Replace the raw sync block in `docs/workflows/beads-familiars.md`:

```markdown
Use Dolt sync when a bead graph needs to move between machines:

```bash
bd dolt pull
bd dolt push
```
```

with:

````markdown
Use the bounded repository entrypoint when a bead graph needs to move between
machines:

```bash
pnpm beads:sync
```

It runs `bd dolt pull` and then `bd dolt push`, but bounds each phase and
terminates the complete owned process tree if Git or a credential helper stops
making progress. Do not use the raw commands for routine sync in this
repository.

If push fails or times out, Retry `pnpm beads:sync` once. Do not edit Git
configuration or credential helpers after one transient 403; the known
intermittent identity failure can succeed without any configuration change.
For pending Beads changes, verify the remote ref actually advanced:

```bash
git ls-remote origin refs/dolt/data
pnpm beads:sync
git ls-remote origin refs/dolt/data
```

Compare the before and after OIDs. An expected advancement proves the remote
accepted pending changes. No advancement is required when there were no local
Dolt changes to publish.
````

- [ ] **Step 5: Update both session-completion command sequences**

In `AGENTS.md` and `CLAUDE.md`, replace the managed Beads block sequence:

```bash
git pull --rebase
bd dolt push
git push
git status
```

with:

```bash
git pull --rebase
pnpm beads:sync
git push
git status
```

Do not change the generated block markers, profile metadata, or unrelated
Beads guidance.

- [ ] **Step 6: Run the focused workflow contracts**

Run:

```bash
node scripts/beads-familiar-workflow.test.mjs
node scripts/beads-sync.test.mjs
node --experimental-strip-types src/lib/bd-bin.test.ts
```

Expected: all three commands exit `0`.

- [ ] **Step 7: Commit the package and operator migration**

```bash
git add package.json scripts/beads-familiar-workflow.test.mjs docs/workflows/beads-familiars.md AGENTS.md CLAUDE.md
git commit -m "docs: route Beads sync through watchdog"
```

### Task 4: Validate the complete change

**Files:**
- Verify all files changed in Tasks 1-3

- [ ] **Step 1: Run the exact regression tests**

Run:

```bash
node scripts/beads-sync.test.mjs
node scripts/beads-familiar-workflow.test.mjs
node --experimental-strip-types src/lib/bd-bin.test.ts
```

Expected: all commands exit `0`; the timeout fixture reports no surviving
descendant.

- [ ] **Step 2: Run the repository test wiring guard**

Run:

```bash
pnpm check:tests-wired
```

Expected: exit `0`; `scripts/beads-sync.test.mjs` is recognized as wired.

- [ ] **Step 3: Run static validation**

Run:

```bash
pnpm lint
pnpm typecheck
```

Expected: both commands exit `0`.

- [ ] **Step 4: Run the app suite containing the new tests**

Run:

```bash
pnpm test:app
```

Expected: exit `0`.

- [ ] **Step 5: Inspect the final scoped diff**

Run:

```bash
git diff --check origin/main...HEAD
git status --short --branch
git diff --stat origin/main...HEAD
git log --oneline origin/main..HEAD
```

Expected:

- no whitespace errors;
- only the design, plan, watchdog, tests, package entrypoint, and directly
  related Beads guidance are changed;
- the branch contains the design commit plus the implementation commits;
- the worktree is clean after committing the plan and any final corrections.

- [ ] **Step 6: Commit any final test-only correction**

If validation required a correction, stage only the files in this plan and
commit when the index is nonempty:

```bash
git add \
  scripts/beads-sync.ts \
  scripts/beads-sync.test.mjs \
  scripts/run-tests.mjs \
  src/lib/bd-bin.test.ts \
  package.json \
  scripts/beads-familiar-workflow.test.mjs \
  docs/workflows/beads-familiars.md \
  AGENTS.md \
  CLAUDE.md
git diff --cached --quiet || git commit -m "test: harden Beads sync watchdog coverage"
```

If no correction was needed, do not create an empty commit.

### Task 5: Open, verify, and merge the PR

**Files:**
- No additional source changes expected

- [ ] **Step 1: Push the branch**

```bash
git push -u origin fix/cave-hg7qb-dolt-push-watchdog
```

Expected: the exact local head is retained on `origin`.

- [ ] **Step 2: Open the pull request**

```bash
pr_url=$(gh pr create \
  --repo OpenCoven/coven-cave \
  --base main \
  --head fix/cave-hg7qb-dolt-push-watchdog \
  --title "Bound Beads Dolt sync credential hangs" \
  --body "$(cat <<'EOF'
## Summary
- route `pnpm beads:sync` through a shell-free Node watchdog
- bound pull and push, terminate the complete owned process tree, and preserve redacted diagnostics
- document one safe retry and `refs/dolt/data` verification

## Validation
- `node scripts/beads-sync.test.mjs`
- `node scripts/beads-familiar-workflow.test.mjs`
- `node --experimental-strip-types src/lib/bd-bin.test.ts`
- `pnpm check:tests-wired`
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test:app`

Bead: `cave-hg7qb`
EOF
)")
printf '%s\n' "$pr_url"
```

Expected: a PR URL with no AI attribution footer.

- [ ] **Step 3: Record the PR on the Bead**

```bash
pr_url=$(gh pr view fix/cave-hg7qb-dolt-push-watchdog \
  --repo OpenCoven/coven-cave \
  --json url \
  --jq .url)
bd update cave-hg7qb --external-ref "$pr_url"
bd comments add cave-hg7qb \
  "Implemented bounded pull/push orchestration with verified process-tree cleanup; PR: $pr_url."
```

Expected: `bd show cave-hg7qb --json` reports the PR URL and implementation
evidence.

- [ ] **Step 4: Read every review thread and required check**

```bash
pr_number=$(gh pr view fix/cave-hg7qb-dolt-push-watchdog \
  --repo OpenCoven/coven-cave \
  --json number \
  --jq .number)
gh pr view "$pr_number" \
  --repo OpenCoven/coven-cave \
  --json headRefOid,mergeable,mergeStateStatus,statusCheckRollup
gh api graphql --paginate --slurp \
  -F pr="$pr_number" \
  -f query='
    query($pr: Int!, $endCursor: String) {
      repository(owner: "OpenCoven", name: "coven-cave") {
        pullRequest(number: $pr) {
          reviewThreads(first: 100, after: $endCursor) {
            pageInfo { hasNextPage endCursor }
            nodes {
              id
              isResolved
              path
              comments(first: 100) {
                pageInfo { hasNextPage endCursor }
                nodes { author { login } body url }
              }
            }
          }
        }
      }
    }
  '
gh pr checks "$pr_number" --repo OpenCoven/coven-cave --required
```

Expected:

- `headRefOid` equals the pushed local head;
- all review threads and their returned comments have been read and any real
  defect is fixed;
- required `Frontend build` reports success on that exact head.

The paginated query must report `hasNextPage: false` for every review-thread
page. If any thread's nested `comments.pageInfo.hasNextPage` is true, query that
thread node by its returned `id` with the same `--paginate` pattern before
merging.

- [ ] **Step 5: Verify the exact head and squash-merge**

```bash
set -euo pipefail
pr_number=$(gh pr view fix/cave-hg7qb-dolt-push-watchdog \
  --repo OpenCoven/coven-cave \
  --json number \
  --jq .number)
expected_head=$(git rev-parse HEAD)
actual_head=$(gh pr view "$pr_number" --repo OpenCoven/coven-cave --json headRefOid --jq .headRefOid)
test "$actual_head" = "$expected_head"
gh pr checks "$pr_number" --repo OpenCoven/coven-cave --required
gh pr merge "$pr_number" \
  --repo OpenCoven/coven-cave \
  --squash \
  --match-head-commit "$expected_head"
```

Expected: merge succeeds without `--admin` and without direct push to `main`.

- [ ] **Step 6: Verify `origin/main` and close the Bead**

```bash
pr_number=$(gh pr view fix/cave-hg7qb-dolt-push-watchdog \
  --repo OpenCoven/coven-cave \
  --json number \
  --jq .number)
git fetch origin main
gh pr view "$pr_number" --repo OpenCoven/coven-cave --json state,mergedAt,mergeCommit
git show origin/main:scripts/beads-sync.ts >/dev/null
git show origin/main:package.json | grep 'scripts/beads-sync.ts'
bd close cave-hg7qb --reason "Merged in PR #$pr_number. pnpm beads:sync now bounds pull and push, verifies owned process-tree cleanup on timeout, and documents safe retry plus refs/dolt/data verification."
```

Expected: PR state `MERGED`, merged files present on `origin/main`, and Bead
status `closed`.

- [ ] **Step 7: Record worktree disposition**

```bash
pnpm beads:worktrees
```

Expected: the merged `cave-hg7qb` unit has a visible post-merge disposition.
If it is not cleanup-ready, preserve it and record the owner/reason on the
Bead. If it is cleanup-ready, prove the exact head is retained by a remote
branch or pushed archive tag before using the repository's sanctioned
retirement path.
