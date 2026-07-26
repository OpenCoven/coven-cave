# Runtime Availability Forward-Fix Design

## Goal

Complete the native-chat runtime availability contract after PRs #3900 and
#3891 landed, without reverting either valid change. Every local runner must be
proven launchable before any capability subprocess or model request starts,
and every failure must retain its truthful, value-free classification.

## Confirmed Gaps

The merged implementation has six correctness gaps:

1. The chat route evaluates availability only at the final model spawn.
   OpenCode, Hermes, Coven, and Copilot capability probes may already have
   started subprocesses.
2. POSIX files are considered ready when `stat().isFile()` succeeds, even when
   the current process cannot execute them.
3. Copilot calls `covenSpawnEnv()` before removing vault-managed values.
   Canonical PATH discovery can therefore pass cached vault values to its
   login-shell and Node/npm helper subprocesses.
4. Copilot's 2.5-second launcher deadline starts after synchronous PATH
   discovery, so the phase described as bounded is not bounded end to end.
5. `/api/harnesses` checks Copilot's raw manifest executable instead of the
   resolved command that direct chat will launch.
6. Copilot probe failures and timeouts are rendered as schema incompatibility,
   and the route's launch-error progress can still expose a raw OS error.

## Chosen Approach

Use a forward-only shared launch-plan seam.

- Keep #3900's separate launcher and version budgets.
- Keep #3891's availability states, structured SSE error, no-fabricated-turn
  behavior, and post-spawn race fallback.
- Strengthen those contracts at their owning seams instead of adding
  call-site-specific exceptions.

Rejected alternatives:

- Reverting #3891 or #3900 would discard valid behavior and create another
  branch-order race.
- Patching each route independently would preserve the divergence that caused
  `/api/harnesses` and chat to disagree.
- Treating capability probes as harmless would violate the no-spawn contract
  and the vault scoping boundary.

## Architecture

### Candidate inspection

`runtime-availability.ts` will inspect a candidate as one of:

- `launchable`
- `missing`
- `unlaunchable`

On POSIX, a regular file must also pass `access(X_OK)`. `EACCES` means
`unlaunchable`; missing-path errors mean `missing`; unexpected I/O errors mean
`probe_failed`. Windows native executable and shim rules remain unchanged.

### Safe canonical environment discovery

`harness-spawn-env.ts` will create a discovery-only environment by copying the
server environment and removing every key declared in the vault map before
calling `covenSpawnEnv()`.

`coven-bin.ts` will accept that discovery environment and an absolute
deadline. Every login-shell, registry, Node, and npm helper receives the
discovery environment and a timeout capped by the remaining budget. The final
harness environment continues to apply the existing familiar-scoped secret
rules; only discovery is made credential-free.

### Exact Copilot launch plan

A passive Copilot launch resolver will own:

- the canonical spawn environment;
- the resolved command and fixed arguments;
- the shared availability result;
- the remaining launcher deadline.

The capability probe consumes that plan and starts `--version` only when it is
ready. Direct chat and `/api/harnesses` reuse the returned command rather than
resolving or reporting a different executable.

### Early and final gates

The chat route computes a passive preflight before runner-specific capability
work:

- OpenCode preflight precedes `openCodeRunCapabilities()`;
- Hermes preflight precedes `hermesChatSupportsModel()`;
- Coven preflight precedes the Coven flag probes;
- Copilot availability is the first phase of its capability probe.

The exact plan is checked again immediately before the model spawn to preserve
TOCTOU protection. SSH behavior remains unchanged.

### Diagnostics

Capability results preserve distinct value-free causes:

- runtime missing;
- runtime unlaunchable;
- launch discovery/probe failed;
- version probe timed out;
- version output unparseable;
- installed version genuinely unsupported by the schema.

Chat, workflows, and flows map those causes directly. Only a proven,
successfully parsed but unsupported client version may use schema
incompatibility copy. Post-spawn launch failures use one normalized runner
message in progress, error, and stored launch-failure state.

## Testing

- Unit-test POSIX executable permissions, Windows shim behavior, and I/O
  failures.
- Prove vault-managed sentinels are absent from every discovery helper.
- Prove the launcher deadline begins before canonical environment discovery.
- Prove Copilot missing, unlaunchable, timeout, unparseable, and unsupported
  cases remain distinct across chat, workflow, and flow routing.
- Replace the host-dependent Grok fixture with an isolated PATH and replace the
  mode-0644 race fixture with an executable carrying a missing interpreter.
- Pin that capability subprocesses are unreachable when passive preflight is
  not ready.
- Run focused suites, the app/API suites, lint, typecheck, test wiring, build,
  and required PR CI.

## Exclusions

- No network health check on every chat turn.
- No change to SSH runtime semantics.
- No provider/authentication detection before a process actually starts.
- No unrelated refactor of onboarding, daemon, or terminal spawn behavior.
