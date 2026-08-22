# Beads Dolt Sync Watchdog Design

## Problem

`pnpm beads:sync` currently expands to:

```bash
bd dolt pull && bd dolt push
```

That gives the Beads process an unbounded lifetime. A Git-over-HTTPS credential
wait can therefore leave `bd dolt push` alive without useful network activity
while it retains the shared Dolt store lock. Every other familiar using the
shared store then blocks behind a command that may never finish.

The raw shell chain also has no reliable way to terminate descendants. Node's
single-process timeout support is insufficient because Git and credential
helpers can be child processes of `bd`.

## Goals

- Bound both Dolt pull and push so neither phase can indefinitely retain the
  shared store lock.
- Terminate the complete owned process tree on timeout and wait for proof that
  cleanup completed before the wrapper exits.
- Keep `bd` launch shell-free and cross-platform by reusing Cave's existing
  Windows-safe Beads binary resolver.
- Disable terminal credential prompts while preserving configured credential
  helpers.
- Preserve useful diagnostics without retaining unbounded output or printing
  common credential material.
- Keep push failure honest: never report success and never automatically retry
  an operation whose remote outcome may be ambiguous.
- Give operators a safe one-retry procedure and a concrete
  `refs/dolt/data` verification check.

## Non-goals

- Replacing or patching Beads, Dolt, Git, or the user's credential helper.
- Editing global or repository Git configuration.
- Automatically retrying failed or timed-out pushes.
- Automatically killing unrelated Dolt or Git processes.
- Proving which actor advanced `refs/dolt/data` during concurrent pushes.

## Chosen architecture

Replace the package-level shell chain with a dedicated TypeScript orchestrator:

```text
pnpm beads:sync
  -> scripts/beads-sync.ts
     -> bd dolt pull
     -> bd dolt push
```

Each phase launches through `withBdLaunch`, which preserves argv boundaries and
resolves Windows npm shims without `shell: true`. The child receives ignored
stdin, piped stdout/stderr, `GIT_TERMINAL_PROMPT=0`, and
`GCM_INTERACTIVE=Never`. On POSIX the child is detached into its own process
group; on Windows it remains a normal child suitable for the existing
`taskkill.exe /T /F` cleanup path.

The orchestrator reuses `BoundedProcessOutput` and `terminateProcessTree` from
`src/lib/process-execution.ts`. This avoids a second, subtly different process
termination implementation.

## Command lifecycle

The wrapper runs pull and push sequentially.

1. Print the phase being started.
2. Spawn the resolved `bd` command with a 90-second phase timeout.
3. Capture stdout and stderr into separate redacted 64 KiB tails.
4. If the child exits successfully, print its retained output and continue.
5. If pull fails, print the retained diagnostics and exit without starting
   push.
6. If push fails, print the retained diagnostics and exit nonzero.
7. If either phase times out, call `terminateProcessTree`, wait for it to
   complete, and then exit `124`.
8. If tree termination cannot be proven, report that cleanup is unproven and
   exit `1`; do not shape that result as an ordinary timeout.

The direct command uses one timeout for each phase rather than one aggregate
deadline. A healthy pull does not consume the push's opportunity to finish, and
each individual lock-holding operation remains bounded.

## Timeout and process ownership

The production defaults are:

- Phase timeout: 90 seconds.
- Retained stdout tail: 64 KiB.
- Retained stderr tail: 64 KiB.
- Process-tree termination grace: the shared helper's existing default.

The implementation exports dependency-injected execution functions so tests can
use shorter deadlines without adding user-facing timeout flags. Runtime
configuration remains deliberately small: this is a safety boundary, not a
general command runner.

On POSIX, `detached: true` gives the spawned `bd` process a new process group.
`terminateProcessTree` sends `SIGTERM` to that group, waits, escalates to
`SIGKILL`, and confirms the group no longer exists. On Windows, the same helper
uses `taskkill.exe /PID <pid> /T /F`.

Only the process tree created by this wrapper is eligible for termination. The
wrapper never calls broad process-name cleanup such as `pkill`, `killall`, or
`bd dolt killall`.

## Output and error handling

Child output is captured rather than inherited so it can be bounded and passed
through the repository's existing ANSI stripping and credential redaction.
Retained output is emitted when a phase settles, preserving normal command
diagnostics without allowing a noisy or stuck process to grow memory
indefinitely.

Stable outcomes are:

- `0`: pull and push both completed successfully.
- Child exit code: a phase completed with a nonzero status.
- `124`: a phase timed out and its complete owned process tree was terminated.
- `1`: spawn failure, invalid internal configuration, or unproven process-tree
  cleanup.

The wrapper names the failed phase in every error. A spawn error uses
`safeProcessErrorMessage` so executable paths and raw platform errors are not
exposed unnecessarily.

## Retry and remote verification

The wrapper never retries automatically. A push can update the remote just
before its local process is killed, so an automatic retry would hide an
ambiguous result and can repeat the same credential hang while holding the lock
again.

Documentation instructs the operator to:

1. Retry `pnpm beads:sync` once.
2. Do not edit Git configuration or credential helpers after one transient 403;
   the known intermittent identity failure can succeed on the immediate retry.
3. When verifying a push that should contain pending Beads changes, compare the
   remote ref before and after:

   ```bash
   git ls-remote origin refs/dolt/data
   pnpm beads:sync
   git ls-remote origin refs/dolt/data
   ```

4. Treat an expected ref advancement as the remote success signal. If the ref
   does not advance after the retry, report the failure instead of changing
   credentials speculatively.

No advancement is required when there were no local Dolt changes to publish.

## Files and responsibilities

- `scripts/beads-sync.ts`
  - Owns sequential pull/push orchestration, timeout classification, bounded
    diagnostics, and process-tree cleanup.
- `scripts/beads-sync.test.mjs`
  - Covers success ordering, pull short-circuiting, nonzero push failures,
    timeout classification, and a POSIX integration fixture whose descendant
    ignores `SIGTERM`.
- `package.json`
  - Routes `beads:sync` through the new orchestrator.
- `scripts/run-tests.mjs`
  - Wires the new regression test into the app test suite.
- `scripts/beads-familiar-workflow.test.mjs`
  - Pins the stable package entrypoint and operator documentation contract.
- `docs/workflows/beads-familiars.md`
  - Makes the bounded package command canonical and documents safe retry and
    `refs/dolt/data` verification.
- `AGENTS.md` and `CLAUDE.md`
  - Replace the routine raw push in session-completion guidance with the
    bounded repository entrypoint.

## Test strategy

Unit-level orchestration tests inject a fake phase runner and assert:

- pull always precedes push;
- push is never called after pull failure;
- a push failure preserves its exit status and phase diagnostics;
- timeout with proven cleanup returns `124`;
- timeout with unproven cleanup returns `1`.

A POSIX-only integration test places a fake `bd` executable first on `PATH`.
For `dolt pull` it exits successfully. For `dolt push` it starts a descendant
that ignores `SIGTERM`, records the descendant PID, and then blocks. The wrapper
runs with a short injected timeout. The test asserts exit `124` and verifies
that neither the fake `bd` process group nor the recorded descendant remains.
This proves the sync entrypoint actually establishes the process ownership that
`terminateProcessTree` requires.

Source-contract assertions additionally prevent regression to:

- `bd dolt pull && bd dolt push`;
- `shell: true`;
- direct bare `spawn("bd", ...)` without `withBdLaunch`;
- broad name-based process termination.

## Rollout and compatibility

The command name remains `pnpm beads:sync`, so operator and automation entry
points do not change. Healthy sync behavior remains pull-then-push. The only
intentional behavior changes are bounded lifetime, noninteractive terminal
credentials, redacted bounded output, and explicit nonzero timeout semantics.

Direct manual `bd dolt pull` and `bd dolt push` commands still exist upstream,
but Cave's repository guidance uses the bounded package entrypoint for routine
work.
