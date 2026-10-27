# Daemon connectivity reliability

Status: the `cave-58eoq` program's tracked work has merged (#4485, #4495, #4497, #4498, #4489/#4496/#4500/#4506, #4509, #4528); the residual risks below have no GitHub issue yet.

Last updated: 2026-10-20 (status lines reconciled with `main`, #6111)

Implementation note: Windows supervision shipped in PR #4485 and authenticated
native readiness shipped in PR #4495.

This document maps the current desktop connectivity stack, records verified
failure modes, and defines the target lifecycle contract. It separates facts
that are already enforced from follow-up work; a PID, socket, open port, or
successful TCP connection is never treated as proof of health.

## System and trust-boundary map

```text
Native desktop shell (Rust/Tauri)
  |
  | spawns, owns, stops, and sometimes revives
  v
Bundled Node sidecar (server.mjs + Next server)
  |  loopback HTTP/WebSocket, per-launch sidecar token
  |  mobile/tailnet access, separately persisted access token
  |
  +--> Next route handlers
         |
         +--> local Coven daemon
         |      Unix socket / Windows named pipe
         |
         +--> remote Coven hub
         |      HTTP(S) + bearer access token
         |
         +--> Coven and provider CLIs
                direct child processes with bounded output/cancellation policies
```

The desktop window does not talk directly to the Coven daemon. The Rust shell
first starts the bundled Node sidecar and navigates the webview to its loopback
URL. Next route handlers then resolve either the local daemon socket or the
configured remote hub and perform daemon health and API requests.

| Boundary | Existing proof | Remaining requirement |
| --- | --- | --- |
| Rust shell -> Node sidecar | Exact owned-child ready log plus a bounded sidecar-token-authenticated API handshake that verifies service identity, native protocol v1, exact app version, bundle mode, and API dependency readiness | Keep new daemon and CLI spawn paths on the correlation ID that #4498 threads through daemon starts and requests |
| Webview -> Node sidecar | Per-launch token passed in startup URL and enforced by the sidecar bridge | Correlated handshake evidence and bounded recovery transcript |
| Mobile/tailnet -> Node sidecar | Separate persisted access token and request classification | Continue validating forwarded-peer assumptions and token lifecycle |
| Next routes -> local daemon | Socket/named-pipe request with bounded timeout; health document and compatibility checks in status/start paths | Endpoint ownership/permission evidence and one shared handshake contract |
| Next routes -> remote hub | Normalized HTTP(S) URL and bearer token | Protocol negotiation, explicit certificate/trust diagnostics, replay-safe retry policy |
| Node sidecar -> CLI children | Direct spawn helpers, platform-aware executable discovery, output capture, and secret-scrubbing helpers in several paths | Prove every spawn path uses the safe environment, cancellation, and output limits |
| Runtime files/config -> processes | Bundled runtime closure and per-platform resource resolution | Diagnostic manifest, version provenance, corruption detection, and repair verification |

Primary implementation seams:

- `src-tauri/src/tauri_setup.rs`
- `src-tauri/src/sidecar_startup.rs`
- `src-tauri/src/sidecar_port_lock.rs`
- `src-tauri/src/sidecar_lifecycle.rs`
- `src-tauri/src/sidecar_supervisor.rs`
- `server.ts`
- `src/lib/coven-daemon.ts`
- `src/lib/daemon-start.ts`
- `src/lib/daemon-startup-contract.ts`
- `src/app/api/daemon/status/route.ts`
- `src/components/settings-daemon.tsx`

## Current launch-to-first-request flow

1. Tauri checks special daemon/Windows child modes before creating the GUI.
2. Desktop setup acquires the GUI reachability lease and installs cleanup
   guards before starting the sidecar.
3. Development uses a reachable configured dev origin. Packaged builds resolve
   bundled Node, server, speech runtimes, and the fixed Cave port, then *claim*
   that port before spawning anything. The claim is an advisory OS lock keyed on
   the resolved port and held for the life of the process, so a second copy
   loses it deterministically instead of racing the first into `EADDRINUSE`. A
   claim that cannot be evaluated never blocks a launch. Only once the claim is
   held is the port probed for identity, which answers *who* holds it rather
   than merely whether it is busy.
4. Windows renders `startup.html` and performs sidecar preparation on a worker.
   macOS/Linux block setup while starting the sidecar.
5. The implemented native readiness loop requires the launched child's exact
   ready line, then sends a bounded authenticated
   `GET /api/app/native-readiness` request with the per-launch sidecar token.
   It rejects non-200 responses, malformed or oversized HTTP/JSON, wrong
   service identity, unsupported protocol, app-version mismatch, release builds
   attached to a development runtime, and incomplete API dependencies.
6. The webview navigates to a token-bearing loopback URL.
7. The web application polls `/api/daemon/status`.
8. The status route resolves local socket versus remote hub, sends a bounded
   `/api/v1/health` request, validates the health document, and for local
   targets verifies Coven/API version compatibility.
9. Only the status route's `running: true` plus `availability: "online"`
   represents verified daemon readiness.

Steps 5 and 8 remain separate layers by design: step 5 now proves the owned
Node sidecar and its application API are authentic, compatible, and initialized
before navigation; step 8 proves the downstream Coven daemon or remote hub is
healthy and compatible. The shell no longer navigates on listening-only
evidence. Cross-layer correlation shipped in PR #4498 (`cave-58eoq.3`).

## Ranked issue inventory

| Rank | Severity | State | User impact | Root cause and evidence | Fix and coverage |
| --- | --- | --- | --- | --- | --- |
| 1 | High | Shipped in PR #4497 | A slow probe for an old hub URL could overwrite a newer choice and auto-save the wrong connection | `settings-daemon.tsx` had no abort/generation guard and saved current React state rather than the probed snapshot | Abort superseded probes, reject stale generations, then persist the exact URL/executor snapshot without reusing the probe signal; source contract tests pin cancellation, generation, and snapshot binding |
| 2 | High | Shipped in PR #4497 | Any local process could open the packaged sidecar's PTY WebSocket without the per-launch token and spawn or adopt a shell as the app user | The upgrade gate treated direct loopback as identity; allowlisted-tailnet handling also trusted forgeable forwarding headers as a PTY credential | Require the sidecar token even on loopback whenever it is configured, permit only cryptographically authenticated credentials to relax the PTY source gate, preserve tokenless development explicitly, and pin the decision matrix plus generated-server parity |
| 3 | High | Shipped in PR #4497 | An inherited non-loopback `HOSTNAME` could expose tokenless development APIs to remote callers who spoofed a loopback `Host` and omitted source headers | The listener trusted ambient `HOSTNAME`, while the final tokenless proxy path treated client-controlled authority as sufficient after host/CSRF checks | Restrict bind selection to validated loopback aliases, default invalid ambient values to `127.0.0.1`, and require the custom server's verified local-peer stamp or verified remote ingress before tokenless API access |
| 4 | High | Shipped in PR #4497 | Remote HTTP hubs could receive bearer credentials in plaintext, and ad-hoc HTTPS probes could forward the process-wide hub token to a caller-selected authority | Node and iOS attached stored credentials based on target mode/transport but did not consistently require secure transport plus exact credential origin; the probe route reused global custody for arbitrary URLs | Refuse remote plaintext bearer transport before networking, bind iOS credentials to exact normalized origins shared by HTTPS/WSS, probe sibling authorities without credentials, and limit ad-hoc Node probes to tokens embedded by the caller in that exact URL |
| 5 | High | Shipped in PR #4485: `cave-58eoq.1` | A packaged Windows sidecar that dies after startup previously remained dead until a later UI/manual recovery path acted | Windows had startup ownership but no post-ready observer | Windows now launches the shared bounded supervisor beside `SidecarStartupControl`; automatic/manual startup share atomic ownership, budget resets only after a finished startup with an observed live child, shutdown stops supervision first, and failed/cancelled/navigation-failed workers synchronously release the owned process job |
| 6 | High | Shipped in PR #4495: `cave-58eoq.2` | The window previously could open onto a sidecar that was listening but incompatible or only partially initialized | Rust readiness proved child log + TCP only | Native GUI and background-daemon startup now require the same bounded sidecar-token-authenticated identity/protocol/version/bundle/dependency handshake before navigation, publication, or retained daemon state |
| 7 | Medium | Shipped in PR #4497 | Incompatible, unauthorized, unhealthy, unreachable, misconfigured, and status-unavailable responses appeared as generic “Offline” | Settings ignored the route's machine-readable `availability`; the shared type omitted the route's `incompatible` value | Complete the shared taxonomy, fail closed on contradictory fields, render distinct labels/tones, and expose sanitized reason text |
| 8 | Medium | Shipped in PR #4498: `cave-58eoq.3` | Support cannot follow one startup/recovery across Rust, sidecar, daemon requests, and CLI children | Logs were component-local and no shared correlation/diagnostic-bundle contract was found | Correlation IDs, bounded structured lifecycle events, and a redacted bundle at `GET /api/daemon/diagnostics`; no in-app control exports it yet |
| 9 | Medium | Shipped in PR #4496: `cave-58eoq.4` | Green happy-path tests can miss races, stale endpoints, hangs, resets, and orphaned children | The bounded harness covers delayed readiness, crashes, hangs, stale ownership, permission ambiguity, version skew, duplicate starts, cancellation, sleep/wake, stale completions, unusual paths, and repeated lifecycle cleanup | Routine PR conformance runs these assertions on Ubuntu when path selection enables the conformance lane; full-validation and release platform validation run the same harness on Ubuntu, Windows, and macOS |
| 10 | Medium | Shipped in PR #4509: `cave-58eoq.5` | Startup/recovery improvements could not be compared rigorously | No shared definitions or retained distributions for authenticated time-to-ready and recovery success | Local privacy-safe metrics and reproducible baseline/fault runs establish the measurement contract and budgets |
| 11 | Medium | Shipped in PR #4528: `cave-58eoq.6`; exhaustiveness unproven, no open issue | An unreviewed CLI/socket path could inherit secrets, hang, overrun output, or mis-handle unusual paths | The high-impact PTY, remote tokenless-development, and bearer-transport bypasses are closed, but the remaining spawn and endpoint touch-set has not been proven exhaustive | Audit every remaining spawn/socket boundary and pin environment, quoting, timeout, size, cancellation, permission, and compatibility contracts |

## Lifecycle and connection state machine

The target state is one generation-safe machine. Every asynchronous transition
must carry an operation ID; results from an older operation cannot mutate a
newer state.

| State | Entry proof | Allowed next states | Timeout/retry policy | User message |
| --- | --- | --- | --- | --- |
| `NotInstalled` | Required bundled/system runtime is absent or corrupt | `Recovering`, `Failed` | No silent install; explicit repair consent | Required runtime is missing; reinstall or run Repair |
| `Stopped` | No verified owned process and no healthy adopted endpoint | `Starting` | User start or bounded automatic policy | Daemon is stopped |
| `Starting` | Single-instance/start gate acquired | `WaitingForEndpoint`, `Stopping`, `Failed` | Cancelable; one owner only | Starting daemon… |
| `WaitingForEndpoint` | Owned child exists; endpoint not yet ready | `Handshaking`, `Recovering`, `Stopping`, `Failed` | 60s macOS/Linux, 90s Windows today; condition polling, not sleeps | Waiting for local service… |
| `Handshaking` | Transport connected | `Ready`, `Incompatible`, `PermissionDenied`, `Recovering`, `Failed` | Bounded authenticated request; no mutation retry | Verifying daemon… |
| `Ready` | Correct process + endpoint + authenticated identity + compatible protocol/runtime + bounded health + dependencies | `Degraded`, `Recovering`, `Stopping` | Health cadence with stale-result guard | Running |
| `Degraded` | Verified endpoint answers but a dependency or noncritical capability is unavailable | `Ready`, `Recovering`, `Stopping`, `Failed` | Capability-specific retry; preserve usable work | Running with limited capabilities |
| `Recovering` | Previously ready instance failed or endpoint was recreated | `Starting`, `WaitingForEndpoint`, `Ready`, `Failed`, `Stopping` | Exponential/refillable budget with jitter and cancellation | Reconnecting… |
| `Stopping` | Deliberate stop/shutdown owns cancellation | `Stopped`, `Failed` | Graceful bounded stop, then exact owned-tree termination | Stopping daemon… |
| `Incompatible` | Authenticated identity succeeds but protocol/runtime is unsupported | `Recovering`, `Stopped` | Never retry blindly; update/restart action | Daemon version is incompatible |
| `PermissionDenied` | Verified OS permission/ownership refusal | `Recovering`, `Stopped` | No elevation without consent | CovenCave cannot access the local endpoint |
| `Failed` | Bounded attempt ended with classified evidence | `Recovering`, `Stopped` | Explicit Retry/Repair; circuit breaker after repeated failure | Specific failure plus primary action |

Illegal transitions:

- Any state -> `Ready` from PID existence, socket-file existence, port
  connection, or HTTP status alone.
- `Stopping` -> `Starting` from a stale supervisor result.
- Older operation generation -> any state mutation.
- `Incompatible`/`PermissionDenied` -> blind retry loop.
- Mutation timeout -> automatic duplicate mutation.

### Projected lifecycle state (#6298, slices 1 and 2)

`src/lib/daemon-lifecycle.ts` is the pure projection from recorded evidence
to one state, and `src/lib/server/daemon-lifecycle-owner.ts` is the one
process-global record it reads: the start or recovery mutation in flight
(recorded by `runLocalDaemonStart` for its whole duration), whether this
process has observed a ready daemon, and the cached answer to "does the
local Coven runtime exist" (probed at most once per 30 s, and only by the
status route for an offline local target, so hubs never spawn anything).
`/api/daemon/status` and `/api/daemon/connection` both publish the result as
`lifecycle: { state, generation, observedAt, evidence, reason? }`, and the
Settings daemon card prefers that label over the availability fallback.

| Projected state | Target-table state | Evidence required |
| --- | --- | --- |
| `missing` | `NotInstalled` | Local target offline and the runtime probe returned no version |
| `stopped` | `Stopped` | Target offline; runtime present or not yet probed (never guessed missing) |
| `starting` | `Starting`/`WaitingForEndpoint` | A start operation in flight and no ready instance observed before |
| `recovering` | `Recovering` | An automatic recovery in flight, or any start after a ready instance |
| `stopping` | `Stopping` | A restart is stopping the displaced daemon before the service relaunches it; wins over a still-answering endpoint |
| `ready` | `Ready` | Health probe succeeded, compatibility passed, no service conflict |
| `foreign-owned` | `Ready` with a `Degraded` note | Health succeeded but the system service does not own the daemon (#5730) |
| `unreachable` | `Failed` (transport) | Probe got no answer and the local target did not report "daemon offline" |
| `unauthorized` | `PermissionDenied` (hub) | Hub answered 401/403 |
| `incompatible` | `Incompatible` | Compatibility assessment failed, or Cave home is on an incompatible layout |
| `unhealthy` | `Failed` (endpoint) | Endpoint answered but not healthy, and no operation is in flight |
| `misconfigured` | `Stopped` (no target) | Selected hub configuration is missing or invalid |
| `unknown` | none | Cave home status could not be read; the daemon was not checked |

Ordering is fixed: configuration and compatibility failures win over health,
a deliberate stop wins over a still-answering endpoint, confirmed health wins
over a start or recovery in flight (so `ready` is never downgraded to
`starting` by a stale operation record), and an in-flight operation wins over
an offline or unhealthy probe (a daemon still booting answers unhealthy).
Each asynchronous probe reserves its lifecycle generation before awaiting
health (and before loading the status snapshot on the status route), rather
than when it completes. `mergeDaemonLifecycle` can therefore reject an older
probe even when it finishes last. Superseded probes also cannot update the
owner's remembered readiness. These generations are process-local; client
request guards still fence requests across server restarts.
`Handshaking` and `Degraded` are not projected: the handshake is folded into
`starting`, and capability degradation is still reported per surface.

The client reads the projection too. `classifyDaemonStatusPoll` returns
`transitioning` for a local `starting`, `recovering` or `stopping` state, and
every consumer treats that as neither offline nor failure: the Workspace keeps
its current banners, the desktop auto-start coordinator does not start or
revive, the familiar liveness verdict is `degraded` (no revive), the
connection supervisor keeps the 5 s cadence, and no reliability failure class
is recorded. The tests are `daemon-status-classification.test.ts`,
`workspace-daemon-connection.test.ts`, `daemon-desktop-auto-start.test.ts`,
`familiar-liveness.test.ts`, `daemon-connection-supervisor.test.ts` and
`daemon-reliability.test.ts`.

The ordering regression is covered by `daemon-lifecycle-owner.behavior.test.ts`
and the real-owner broker test in `daemon-connection-snapshot.test.ts`.

### One mutation owner (#6298, slice 2)

Timeout reconciliation rechecks the current mutation and outcome after its
health probe, for both positive and negative answers. A stale answer joins or
refuses the current mutation, or re-enters admission after that mutation has
settled; it cannot overwrite the newer result. The lane is installed before
invoking mutation code, so even a synchronous exception releases it. These
races are covered by `daemon-mutation-owner.behavior.test.ts`. Requests for
the same timed-out attempt share one reconciliation probe and result.

`src/lib/server/daemon-mutation-owner.ts` admits every start, automatic
recovery and restart before anything spawns, kicks launchd or stops a daemon;
`startLocalDaemonOperation` routes through it and the bounded restart lane
(`RuntimeStartupCoordinator`) runs inside it. Adopt is the owner's existing
pre-state reconciliation: a healthy daemon is reported `alreadyRunning`
without a spawn, with `serviceConflict` when the system service does not own
it (`foreign-owned`), and an incompatible daemon is refused as
`runtime_incompatible`; neither is retried by the owner or by the client's
automatic recovery (`runWorkspaceDaemonStart` reports `failed`, and the
coordinator only revives on a definitive `offline`). Stop is the restart
hand-back's stop step, projected as `stopping` while it runs.

| Situation | Owner decision | Result code | Test |
| --- | --- | --- | --- |
| Start or recovery while any mutation runs | Join: every one of them wants a running daemon | The in-flight result | `daemon-mutation-owner.behavior.test.ts` |
| Restart while a start or recovery runs | Refuse by name; joining would report "restarted" for a daemon nobody restarted | `mutation_in_flight` (409) | same |
| Restart while a restart runs | Join | The in-flight result | same |
| Same kind within 30 s of a `readiness_timeout` | Reconcile: health proves the late finish (`alreadyRunning`), otherwise refuse with the time left; never replay a stop-and-kick | `duplicate_after_timeout` (409) | same |
| Different kind after a timeout, or after the window | Admit | normal | same |
| Mutation throws | Lane released; recorded as `unexpected-error`, not a timeout | rethrown | same |
| Healthy daemon the service does not own | Adopt, report conflict, no spawn or kick | `ok` + `serviceConflict` | `daemon-start.test.ts` (#5730 cases) |
| Incompatible daemon | Refuse, no spawn, no retry | `runtime_incompatible` (409) | `daemon-start.test.ts` |
| Restart hand-back | `stopping` during the stop, then kickstart | `ok`, `launchMode: "service"` | `daemon-start.test.ts` |

Deferred to the fault-matrix slice: the real-process receipt for revive after
a post-ready kill, and `Stopping` as a user-initiated action (no stop route or
control exists; stop is only the restart hand-back today).

## Fault matrix (#6298, slice 3)

Every supported fault names its detection, its owner, the safe action, the
retry/backoff/deadline/escalation policy, the postcondition that proves the
action worked, and the deterministic test that enters it. Rows that involve
a real process also cite the real-process probe operation whose receipt is
recorded in `docs/performance/daemon-lifecycle.md`. Rows this host cannot
prove are listed as unverified, not omitted.

| Fault | Detection | Owner | Safe action | Retry / backoff / deadline / escalation | Verified postcondition | Deterministic test | Real-process receipt |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Missing or corrupt binary | Spawn error (`ENOENT`, `EACCES`, `ENOEXEC`) on the launcher | Mutation owner → `runLocalDaemonStart` | Report `spawn_failed` with the install diagnostic; no retry | Readiness ends after one final probe (`runnerFailed`), not after the deadline; the restart lane counts the failure toward its 3-in-60 s throttle | Result named within two probes; nothing to clean up | `daemon-start.test.ts` "a missing binary is a named spawn failure…", "a corrupt or non-executable binary…" | none (no process is created) |
| Stale or occupied socket | `inspectDaemonAddress` connects before a start; the launcher's own bind error afterwards | Mutation owner | Refuse `address_in_use` by name when something answers; a stale file never reads as occupied, so a start reclaims it | No automatic retry against a held address (`runWorkspaceDaemonStart` defers); a departed owner's endpoint is free at once | A held address is never raced; a stale endpoint is rebound by the next start | `daemon-endpoint-faults.test.ts` "a duplicate launch against a held address is refused, not raced", "the endpoint of a departed owner is free once its socket is gone", "a leftover file at the endpoint never reads as occupied"; `daemon-start.test.ts` "an already-bound address is refused by name…" | probe `revive-after-kill` (stale socket recorded, then rebound) |
| Child exits before ready | Launcher `close` before health | Mutation owner → readiness loop | Final probe, then terminate the owned tree; report `runner_exited` or the launcher's own `address_in_use` cause | Bounded supervisor grace, then cleanup; failure counts toward the restart throttle | No escaped descendant survives an unsuccessful launch | `daemon-start.test.ts` "an exited but unhealthy launcher is cleaned up before it is reported", "an occupied-address launcher failure is named…" | none (fake child) |
| Child hangs before ready | Health never succeeds within `startTimeoutMs` | Mutation owner → readiness loop | Terminate the owned tree; report `readiness_timeout` | 8 s default deadline (60/90 s native); a duplicate of the same kind inside 30 s reconciles through health or is refused | Owned tree gone; a late-ready daemon settles the mutation instead of being replayed | `daemon-fault-harness.test.ts` "readiness gives up on a permanently hung daemon instead of spinning"; `daemon-start.test.ts` "a readiness timeout terminates the Windows launch tree"; `daemon-mutation-owner.behavior.test.ts` "a duplicate of a timed-out mutation is refused…" | none |
| Child dies after ready | Health stops answering; status projects `stopped` | Lifecycle owner (projection) → desktop auto-start coordinator → mutation owner (`recovery`) | Automatic recovery when the preference allows; otherwise the Start banner | Liveness burst of 4 with 15 s base backoff, 5 min ceiling, 15 min cooldown then refill; recovery joins any mutation already running | A new instance answers with a new pid; data intact | `daemon-fault-harness.test.ts` "a daemon that dies mid-session stops answering rather than resetting forever"; `daemon-desktop-auto-start.test.ts` "a daemon that dies mid-session is restarted"; `daemon-lifecycle.test.ts` offline → `stopped` | probe `revive-after-kill` |
| Endpoint recreated | Socket released and rebound by a new instance | Connection supervisor (generation guard) and snapshot broker (1 s TTL, generation) | Accept only the latest probe; a restart reports the new pid | Churn never leaks sockets; an older completion never overwrites a newer cache entry | Probes agree with the endpoint's real state; no connection left behind | `daemon-endpoint-churn.test.ts` "concurrent probes during churn never disagree…", "churn leaves no connection behind…"; `daemon-connection-snapshot.test.ts` "fresh probes outrank older pending work…" | probe `restart` (new pid, marker intact) |
| Unauthorized | Hub answers 401/403 | Status route classification → lifecycle `unauthorized` | Show Authorization required; never restart for a credential | No mutation retry; GET polling continues on the failure cadence | Local 401/403 is `unhealthy`, hub is `unauthorized`; liveness verdict `degraded` | `daemon-fault-harness.test.ts` "401 and 403 classify as unauthorized on a hub, unhealthy locally"; `daemon-lifecycle.test.ts` "hub rejects credentials" | none (hub) |
| Incompatible protocol or runtime | `assessDaemonStartupCompatibility` on the health document | Mutation owner and status route → lifecycle `incompatible` | Refuse `runtime_incompatible`; adopt an independent release line only when its API is supported | Never retried blindly: automatic recovery reports `failed`, the coordinator revives only on a definitive `offline` | Status says `incompatible` with the diagnostic; no spawn | `daemon-endpoint-faults.test.ts` "an unsupported API version is refused rather than adopted"; `daemon-start.test.ts` "a daemon runtime on an independent release line is adopted after launch"; `daemon-lifecycle.test.ts` "incompatibility is never retried blindly, even mid-start" | probe `ready()` validates compatibility on every sample |
| Unhealthy health | Endpoint answers but `ok` is false or the body is not a health document | Snapshot broker and status route → lifecycle `unhealthy` | Show Unhealthy; a start in flight owns the window as `starting` | Failure cadence 5/10/20/30 s with jitter; no mutation retry | `running` is never derived from a 200 alone | `daemon-connection-snapshot.test.ts` "classifies local and hub outcomes…"; `daemon-status-classification.test.ts` contradictory evidence cases | none |
| Foreign owner | Health succeeds while launchd's job is not running (#5730) | Mutation owner (`alreadyRunning` + `serviceConflict`) → lifecycle `foreign-owned` | Report, offer Restart as the hand-back; no spawn, no kick | No automatic retry; the hand-back is `stopping` then kickstart | Service owns the daemon after Restart | `daemon-start.test.ts` "a healthy daemon serving while its service is not running is reported as a conflict", "restart hands a displaced daemon back…", "the restart hand-back projects stopping…" | unverified on this host without a launchd job for the synthetic home |
| Clock jump (sleep/wake stand-in) | A timestamp from the future: `now < settledAt`, `now < lastAttemptAt`, `now < checkedAt` | Mutation owner, liveness policy, lifecycle owner; the supervisor's timers use `performance.now()` | Re-stamp the window to now | A refusal, wait or cooldown is at most one window after the jump; cached runtime evidence stamped in the future is re-probed | Recovery resumes one window after the jump, not when the clock catches up | `daemon-mutation-owner.behavior.test.ts` "a backwards clock jump after a timeout refuses for at most one window…"; `familiar-liveness.test.ts` backwards-jump block; `daemon-lifecycle-owner.behavior.test.ts` "a backwards clock jump makes runtime evidence stale…" | unverified: physical sleep/wake is not reproducible here |
| Concurrent recovery | Second mutation request while one runs | Mutation owner | Start and recovery join; restart is refused by name | No duplicate spawn; the joined result is the one outcome | One ready pid under concurrent starts | `daemon-mutation-owner.behavior.test.ts` "a start, recovery or restart that arrives during a compatible mutation joins it", "a restart never joins a start or recovery…" | probe `concurrent-start` (three starts, one pid) |
| Migrated or large profile | not detected by any automated path | unowned | n/a | n/a | n/a | none | unverified: no migrated-profile fixture exists; the maintainer's own profile readiness timeout stays with #6119 |
| Windows named-pipe faults | Shared native liveness poll and `SidecarStartupControl` | Native Windows supervision (#4485) | Bounded refillable recovery | As documented in the FMEA | n/a on this host | `windows-startup.yml` PR lane | unverified: release-host crash injection remains required |

## Failure-mode and effects analysis

| Failure mode | Detection | Current effect | Safe recovery | Residual risk |
| --- | --- | --- | --- | --- |
| Duplicate GUI | Pre-spawn advisory claim on the resolved port, then the macOS GUI lease | Second instance names the owning process and exits before touching shared state | Switch to the running copy, or set `COVEN_CAVE_PORT` | The claim now runs first on every desktop platform; the macOS lease remains as a second, later gate |
| Fixed port occupied by another copy | Pre-spawn advisory claim on the resolved port | Startup refuses and names the owning process | Switch to the running copy, quit it, or set `COVEN_CAVE_PORT` | The claim covers the GUI sidecar only; the macOS background daemon still binds by scan |
| Fixed port occupied by something else | Unauthenticated `/api/app/build-info` probe, classified `Cave`/`Gated`/`Stranger` | Startup refuses and names what kind of occupant it found | Stop the named occupant, or set `COVEN_CAVE_PORT` | A second packaged copy at v0.3.9 or earlier answers 401 and lands in `Gated`, not `Cave`, and those builds take no claim either; from v0.3.10 on, `Cave` covers both a second copy and a dev server without separating them, so the claim is what identifies a second copy |
| Child exits before ready | Owned-child `try_wait` during readiness | Startup fails and cleanup runs | Retry after classified evidence | Tail is bounded but not correlated across components |
| Child hangs before ready | Condition timeout | Fails after 60/90 seconds | Cancel or retry; preserve bounded output tail | Timeout budget is not yet measured by platform |
| Child dies after ready, macOS/Linux | Native liveness poll | Bounded refillable revive and webview re-navigation | Automatic | Full end-to-end revive test is still missing |
| Child dies after ready, Windows | Shared native liveness poll using `SidecarStartupControl` and the owned process job | Bounded refillable recovery without concurrent startup | Automatic | Windows release-host crash injection remains required |
| Stale hub probe | Superseding input/mode/device choice | Previously could repaint/save old endpoint | Abort + generation guard + exact snapshot | Shipped in PR #4497 |
| Hub unauthorized | Authenticated HTTP response 401/403 | Previously generic Offline | Show Authorization required and reason | One-click credential repair remains future work |
| Hub unreachable | Transport failure, no HTTP answer | Configured target unavailable | Bounded GET retry; travel/replay policy | Network classification still needs correlated timing |
| Sidecar readiness unauthorized/malformed | Authenticated native readiness returns non-200, malformed HTTP/chunks/JSON, or exceeds 64 KiB | Native startup refuses navigation and preserves a bounded output/error chain | Retry exact owned startup; do not adopt the endpoint | Shipped in PR #4495 |
| Daemon unhealthy | Endpoint answers but health is invalid/non-2xx | No verified daemon-running state | Retry health or restart exact owner | Sidecar readiness is proven separately; daemon requests carry the #4498 correlation ID |
| Runtime/API mismatch | Native sidecar handshake plus downstream daemon health compatibility check | Native adoption or daemon status refuses the incompatible layer | Update/repair then restart | Implemented sidecar check is exact-version by design for one packaged artifact |
| Cave state lock/permission busy | Structured status-unavailable/incompatible response | Status cannot be confirmed | Automatic later poll; show Status unavailable | Needs OS error evidence in diagnostics |
| Socket/pipe missing | Transport error normalization | Local daemon classified offline | Bounded start policy | Endpoint ownership/ACL audit remains open |
| Response reset/partial body | Response error handler | Request resolves as transport failure | GET may retry once; mutations do not | Cross-component partial-write tests remain open |
| Oversized response | `maxResponseBytes` where supplied | Request fails with size-limit diagnostic | No retry unless caller chooses | Call-site coverage of limits remains open |
| App exits during startup | Cleanup guard, cancellation, process job/watchdog | Owned tree is stopped/reaped | Relaunch cleanly | Cross-platform stress coverage remains open |
| Concurrent start/restart requests | Mutation owner admission (`daemon-mutation-owner.ts`) | Start and recovery join the running mutation; restart is refused by name | None needed; the client polls at the healthy cadence until the owner settles | Only this Next process is coordinated; a second Cave process is the duplicate-GUI row |
| Duplicate mutation after a timeout | Owner remembers the last `readiness_timeout` for 30 s | Same kind reconciles through health or is refused with the time left | Wait out the window, or Retry after health answers | A service that takes longer than the window to come up is still kicked again on the next request |
| Foreign-owned instance | Health succeeds while launchd's job is not running (#5730) | Reported `foreign-owned`/`serviceConflict`; no spawn, no automatic retry | Settings Restart hands the daemon back to the service | Ownership is inferred from the service's running state, not from the serving PID |

## Warning truthfulness audit

| Diagnostic | Before | Contract after PR #4497 |
| --- | --- | --- |
| Checking… | Accurate while a status request is pending | Unchanged |
| Running | Derived from `running` only | Requires `running` plus `online` or a legacy payload with no availability field; contradictory payloads fail closed as Unhealthy |
| Offline | Included most failure classes | Reserved for verified/legacy offline only |
| Unreachable | Hidden inside generic Offline | Shown for transport-unreachable classification |
| Unhealthy | Hidden inside generic Offline | Shown when endpoint answers but health fails, and for contradictory “running/online” evidence |
| Authorization required | Hidden inside generic Offline | Shown for verified unauthorized classification |
| Configuration required | Hidden inside generic Offline | Shown for missing/invalid selected hub configuration |
| Status unavailable | Hidden inside generic Offline | Shown as warning because daemon state was not proven |
| Incompatible | Type omitted despite route emission | Shared taxonomy and danger state now include it |
| Probe Reachable/Unreachable | Could describe an older URL and save newer state | Only the latest request may publish; successful auto-save uses the exact probed snapshot |
| Fixed/repair succeeded | No new claim added here | Future repair actions must re-run the authenticated end-to-end health contract before success |

## Diagnostics and observability specification

Each startup, connection, request, recovery, and repair operation should emit a
local structured event with:

- correlation ID and operation generation;
- timestamp, component, severity, operation, phase, and legal state transition;
- attempt number, planned backoff, elapsed duration, and timeout budget;
- process identity (PID plus platform birth identity where available);
- sanitized endpoint kind and status, never raw access tokens;
- client, sidecar, daemon, CLI, API, and protocol versions;
- health/compatibility outcome and required-dependency readiness;
- sanitized error chain, stable classification, and OS error code;
- cancellation source and whether cleanup was graceful or forced.

The user-exportable bundle should contain a manifest, bounded relevant logs,
state-transition timeline, version/platform metadata, health snapshots,
configuration metadata with values redacted, reproduction timestamps, and
repair results. It must exclude credentials, query tokens, private keys,
personal paths, conversation content, and unrelated environment variables.
Local diagnostics and opt-in telemetry remain separate systems.

## User recovery matrix

| Verified condition | Automatic action | Primary user action | Fallback |
| --- | --- | --- | --- |
| Temporary transport loss | Bounded reconnect/read retry | None while recovering | Retry |
| Sidecar crash on macOS/Linux | Native bounded revive | None | Restart daemon/app |
| Sidecar crash on Windows | Bounded native supervisor revival | None | Restart app if the recovery budget/cooldown cannot restore readiness |
| Port conflict | Refuse duplicate start, naming the owning process where the claim identifies it | Switch to the running copy, or quit the named occupant | Set an explicit free Cave port with `COVEN_CAVE_PORT` |
| Unauthorized hub | Do not retry credentials | Reconnect/repair authorization | Re-enter verified hub invite/token |
| Incompatible runtime | Refuse adoption | Update Coven, then restart | Repair/reinstall Coven |
| Missing bundled runtime | Refuse partial startup | Repair/reinstall CovenCave | Copy redacted diagnostics for support |
| Permission denial | Do not weaken ACLs or elevate silently | Open the relevant OS settings/repair action | Manual documented command with consent |
| Corrupt/stale endpoint state | Verify process identity before cleanup | Repair | Preserve data and export diagnostics before manual cleanup |
| Failed automatic repair | Keep failure evidence and stop retry storm | Retry repair | Manual copy-and-run command, then re-verify |

## Validation and measurements

Coverage PR #4497 added or extended:

- `daemon-status-classification.test.ts`: complete availability-presentation
  taxonomy, legacy compatibility, and contradictory-evidence fail-closed cases.
- `settings-daemon-multihost.test.ts`: cancellation, abort signal, monotonic
  result guard, exact probed snapshot persistence, and availability wiring.
- Node transport tests prove remote HTTP bearer requests fail before networking
  and ad-hoc probes cannot forward process-wide credentials.
- The 85-file mobile contract suite passes. An isolated Swift typecheck covers
  secure transport and exact HTTPS/WSS origin matching; the focused Xcode test
  remains blocked before compilation by the unresolved WebRTC package revision.
- TypeScript typecheck passes.
- Tauri lifecycle baseline: 24 targeted tests pass. A cold local compile took
  42.46 seconds; the tests themselves completed in 0.62 seconds.

Completed follow-up subsets:

- `cave-58eoq.1` Windows supervision: 95 native Rust library tests, 9 focused
  supervisor tests, and 24 release-runtime contracts pass. Independent review
  found and the implementation fixed premature recovery while startup still
  owned a live child and best-effort cleanup that could leave a failed process
  job retaining the port. Local Windows cross-compilation remains blocked
  before project Rust by missing Windows C headers/toolchains, so repository
  Windows CI remains mandatory.
- `cave-58eoq.2` authenticated readiness: 94 native Rust library tests, all
  1,151 app test files, all 363 API test files, TypeScript typecheck, 1,592-file
  test-wiring validation, and 24 release-runtime contracts pass. The real Next
  custom server returned authenticated chunked readiness JSON in approximately
  216 ms and returned 401 without the token. The parser handles bounded chunked
  framing and rejects malformed, oversized, unauthorized, wrong-service,
  unsupported-protocol, incompatible-version, non-bundled release, and
  dependency-not-ready responses. Independent security and correctness reviews
  reported no significant issues.

The attempted native startup measurement encountered an already-running GUI
and active development origin. It is recorded as contention, not as startup
success or failure, and no unrelated process was terminated. PR #4509 added
the reproducible authenticated time-to-ready and recovery-rate measurement
contract (`cave-58eoq.5`).

Behavioral delta in PR #4497:

- Before: any completed probe could publish; after: only the latest generation.
- Before: auto-save mixed the probed URL with mutable current state; after: the
  exact URL/executor snapshot is persisted after the probe succeeds. Only the
  read-only probe is abortable; the subsequent PATCH is allowed to reconcile
  the UI with a server write that may already have committed.
- Before: seven distinct route outcomes collapsed mostly to Offline; after:
  each verified outcome has distinct state copy and severity.
- Before: a paired token could cross remote plaintext transport or sibling
  authorities; after: every Node/iOS sink requires secure transport and exact
  origin, while speculative iOS discovery probes remain credential-free.

No claim is made yet that native startup time or cross-platform recovery rate
improved; that needs representative per-platform baselines collected with the
shipped measurement contract.

## Residual risk register

| Risk | Owner |
| --- | --- |
| Windows post-ready supervision and cross-platform fault injection are shipped; release-host validation remains a release gate | Release platform validation |
| No in-app control exports the `GET /api/daemon/diagnostics` bundle that #4498 shipped | Unowned; open a GitHub issue |
| Routine pull-request fault coverage is path-gated; documentation-only changes do not run the bounded harness | Accepted coverage boundary (#4896, closed; recorded in #5199) |
| Migrated/large-profile readiness has no fixture and no automated detection; the maintainer's own profile produced a readiness timeout the empty-profile probe does not explain | #6119 retains it; a fixture needs a consented copy of a real profile |
| Exhaustive CLI spawn and socket/pipe security proof is incomplete; #4528 pinned the harness, Terminal, SSH-probe and installer boundaries | Unowned; open a GitHub issue |
| Direct loopback is intentionally sufficient for prompt-free browser REST and PTY access; this does not distinguish OS users on shared machines | Accepted product tradeoff in `cave-99eon` |
| One-click repairs are not yet implemented for every classified failure | Follow from the issue whose evidence identifies the repair boundary |
| Hardware-only Windows installer/Defender and macOS signing/quarantine behavior still require release-host validation | Release validation checklist |

## Daemon fault-injection CI coverage decision

Routine pull-request validation is path-aware. When changed paths select the
Ubuntu frontend/conformance lane, that lane runs the bounded daemon
fault-injection suite as part of cross-environment conformance; documentation-
only changes do not run it. The routine pull-request workflow does not
provision a Windows or macOS fault-injection runner for every pull request.
Release-candidate and release platform validation run the same bounded fault
harness on `ubuntu-24.04`, `windows-latest`, and `macos-15`, so Windows and
macOS host behavior is exercised before release without restoring the costly
three-OS matrix to routine pull requests. This is an explicit coverage boundary
for `cave-58eoq.4`, not a claim that Windows or macOS is unsupported or
untested.

## Reliability measurement contract
This contract measures local reliability without turning diagnostics into an
activity log. It covers packaged sidecar startup, frontend reconnection, and
supervised sidecar recovery. It does not create a broad diagnostics export or
cross-component correlation system.

## Measurement definitions

Every record uses schema version `1` and one stable operation:

- `native_startup`: elapsed time from the packaged sidecar start call until it
  reaches a terminal startup result.
- `frontend_reconnect`: elapsed time from the first visible connection poll in
  an initial, fresh, or failed episode until one terminal result. Failed polls
  remain inside the episode; a later authenticated response emits one success
  record with cumulative attempts and backoff for retry timers that were
  actually armed while the episode remained active. Contention emits one
  blocked record with no speculative post-terminal backoff. An unrecovered
  episode closes as one timeout failure after **30 seconds**, then measurement
  resets while operational polling continues. Routine healthy cadence is
  omitted so it cannot crowd recovery history out of bounded retention.
- `supervised_recovery`: elapsed time from observing an unexpected sidecar exit
  until one terminal recovery result. Failed revives remain inside the episode;
  later authenticated readiness plus a confirming liveness probe emits one
  success record. Transport-only evidence remains unverified. An unrecovered
  episode closes as one timeout failure after **90 seconds**, then measurement
  resets while supervision, cooldowns, and retries continue.

Outcomes are:

- `success`: counted only when `readiness=authenticated`.
- `unverified`: transport/process liveness was observed, but authenticated
  readiness was not. It is eligible in the success-rate denominator and is not
  success.
- `failure`: an eligible operation failed.
- `blocked`: the operation could not start because of contention, such as a
  program this app does not own holding the dedicated port. Blocked records are
  reported separately and excluded from both success and failure rates. Note a
  second copy refused by the port claim records nothing at all: it exits from
  the setup hook, deliberately before the reliability store is configured, so
  that a copy which may not run never mutates the running copy's state.
- `cancelled`: shutdown or explicit cancellation ended the operation. It is
  reported separately and excluded from the success-rate denominator.

Failure classes are `contention`, `compatibility`, `permissions`, `transport`,
`authentication`, `timeout`, `process_exit`, `cancellation`, and `unknown`.
Records also contain bounded numeric fields for duration, attempts, scheduled
backoff, timeout budget, crash count, and restart count.
`backoffMs` is the cumulative backoff scheduled during the episode.
`attempts` counts scheduled retry attempts. `restartCount` counts only confirmed
completed sidecar restarts: a non-Windows synchronous revival increments after
the live child and window navigation succeed, while Windows increments only
after a later supervisor liveness observation confirms the scheduled startup
produced a recovered child. Worker scheduling, calling a start function, waits,
cooldown checks, failed starts, and cancellations do not increment it.

Native sidecar startup records authenticated success only after the owned
child's ready line and the bounded token-authenticated native-readiness
handshake both pass. Non-Windows startup keeps that evidence pending until the
main window builds; a window construction failure emits one failure terminal
before fatal exit. Windows remains terminal after startup navigation or
cancellation. Native lifecycle code calls `record_native_startup_terminal`
exactly once.

## Privacy and retention

The native recorder stores `daemon-reliability-v1.json` under the Tauri app
data directory. Records can contain only the enums and bounded integers defined
above. The IPC input rejects unknown fields. URLs, tokens, local paths, process
output, arbitrary error strings, request payloads, and user identifiers are
never accepted or persisted. Browser and Tauri-mobile workspaces use a no-op
observer because the desktop-local recorder is not available there.

Retention is enforced when the recorder is configured at startup and on every
append:

- maximum age: **30 days**;
- maximum records: **512**;
- maximum serialized file size: **256 KiB**;
- maximum duration: **7 days**;
- maximum backoff or timeout value: **24 hours**;
- maximum attempts, crashes, or restarts per record: **1,000**.

Only a missing file is treated as an empty store. Oversized files are rejected
before reading; read, parse, and schema errors preserve the existing file and
surface through the same warn-once path. Writes use a unique `create_new`
staging file plus replacement, clean staging files after failure, and create
and reassert Unix mode `0600`. Windows moves the existing file aside and
restores it if replacement fails. Stale backup and crash-left staging siblings
are age- and count-bounded without touching files young enough to belong to an
active writer. Persistence is best-effort: startup and
reconnection continue if the record cannot be written, and the process emits
at most one generic warning.

## Automated benchmark and fault baseline

Run:

```bash
pnpm --silent bench:daemon-reliability
```

The command emits machine-readable JSON and exits nonzero when a budget fails.
It reports, per operation:

- total, eligible, success, failure, unverified, blocked, and cancelled counts;
- authenticated success rate;
- duration and authenticated-success duration distributions (`count`, nearest
  rank `p50`, nearest-rank `p95`, and `max`);
- failure-class counts;
- budget checks and aggregate pass/fail.

The default run generates deterministic terminal startup, reconnect, and
recovery episodes with the same 30-second reconnect and 90-second recovery
timeouts as production. It includes contention, compatibility, permissions,
authentication, transport-only readiness, process exit, cumulative retries,
confirmed completed restarts, and cumulative actually-armed backoff. A JSON
array can be supplied with:

```bash
pnpm --silent bench:daemon-reliability --fixture path/to/records.json
```

These deterministic fault baselines establish contract behavior and regression
comparability. They are not measured macOS, Windows, or Linux production
baselines. Representative platform baselines remain future collection work.

## Acceptance budgets

Budgets apply to authenticated successes. Blocked and cancelled records remain
visible but are excluded from the success-rate denominator; unverified
transport readiness remains eligible and therefore lowers the rate.

| Operation | Minimum authenticated success rate | Maximum authenticated-success p95 |
| --- | ---: | ---: |
| Native startup | 95% | 60 seconds |
| Frontend reconnect | 99% | 30 seconds |
| Supervised recovery | 90% | 90 seconds |

An operation with no authenticated successes fails its latency check. Do not
raise a budget from deterministic data alone. Collect representative,
privacy-safe local records on each supported platform now that authenticated
native readiness has shipped (#4495), then compare the same benchmark output before and after
a change.
