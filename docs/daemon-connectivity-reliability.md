# Daemon connectivity reliability

Status: implementation landed (`cave-58eoq`); release-host validation remains separate

Last reconciled: 2026-09-09

Implementation note: Windows supervision shipped in PR #4485 and authenticated
native readiness shipped in PR #4495. Correlated diagnostics shipped in
PR #4498, reliability measurement in PR #4509, and CLI process-boundary
hardening in PR #4528. These merge commits are on `main`; they do not prove
every hardware-only acceptance gate below.

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
| Rust shell -> Node sidecar | Exact owned-child ready log plus a bounded sidecar-token-authenticated API handshake that verifies service identity, native protocol v1, exact app version, bundle mode, and API dependency readiness | Extend the same correlation ID through later daemon and CLI work |
| Webview -> Node sidecar | Per-launch token passed in the native startup URL; ordinary app REST and PTY access also allow verified direct-loopback peers | Correlation and bounded diagnostics are shipped; direct loopback remains an explicit OS-user-isolation tradeoff |
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
evidence. PR #4498 added the shared correlation context and redacted diagnostic
bundle described below.

## Ranked issue inventory

| Rank | Severity | State | User impact | Root cause and evidence | Fix and coverage |
| --- | --- | --- | --- | --- | --- |
| 1 | High | Shipped in PR #4497 | A slow probe for an old hub URL could overwrite a newer choice and auto-save the wrong connection | `settings-daemon.tsx` had no abort/generation guard and saved current React state rather than the probed snapshot | Abort superseded probes, reject stale generations, then persist the exact URL/executor snapshot without reusing the probe signal; source contract tests pin cancellation, generation, and snapshot binding |
| 2 | High | Shipped in PR #4497 | Any local process could open the packaged sidecar's PTY WebSocket without the per-launch token and spawn or adopt a shell as the app user | The upgrade gate treated direct loopback as identity; allowlisted-tailnet handling also trusted forgeable forwarding headers as a PTY credential | PR #4497 required the sidecar token on loopback; the later `cave-99eon` policy explicitly allows verified direct-loopback access without a token. Forwarded or remote ingress remains subject to its access checks; direct loopback does not establish OS-user identity |
| 3 | High | Shipped in PR #4497 | An inherited non-loopback `HOSTNAME` could expose tokenless development APIs to remote callers who spoofed a loopback `Host` and omitted source headers | The listener trusted ambient `HOSTNAME`, while the final tokenless proxy path treated client-controlled authority as sufficient after host/CSRF checks | Restrict bind selection to validated loopback aliases, default invalid ambient values to `127.0.0.1`, and require the custom server's verified local-peer stamp or verified remote ingress before tokenless API access |
| 4 | High | Shipped in PR #4497 | Remote HTTP hubs could receive bearer credentials in plaintext, and ad-hoc HTTPS probes could forward the process-wide hub token to a caller-selected authority | Node and iOS attached stored credentials based on target mode/transport but did not consistently require secure transport plus exact credential origin; the probe route reused global custody for arbitrary URLs | Refuse remote plaintext bearer transport before networking, bind iOS credentials to exact normalized origins shared by HTTPS/WSS, probe sibling authorities without credentials, and limit ad-hoc Node probes to tokens embedded by the caller in that exact URL |
| 5 | High | Shipped in PR #4485: `cave-58eoq.1` | A packaged Windows sidecar that dies after startup previously remained dead until a later UI/manual recovery path acted | Windows had startup ownership but no post-ready observer | Windows now launches the shared bounded supervisor beside `SidecarStartupControl`; automatic/manual startup share atomic ownership, budget resets only after a finished startup with an observed live child, shutdown stops supervision first, and failed/cancelled/navigation-failed workers synchronously release the owned process job |
| 6 | High | Shipped in PR #4495: `cave-58eoq.2` | The window previously could open onto a sidecar that was listening but incompatible or only partially initialized | Rust readiness proved child log + TCP only | Native GUI and background-daemon startup now require the same bounded sidecar-token-authenticated identity/protocol/version/bundle/dependency handshake before navigation, publication, or retained daemon state |
| 7 | Medium | Shipped in PR #4497 | Incompatible, unauthorized, unhealthy, unreachable, misconfigured, and status-unavailable responses appeared as generic “Offline” | Settings ignored the route's machine-readable `availability`; the shared type omitted the route's `incompatible` value | Complete the shared taxonomy, fail closed on contradictory fields, render distinct labels/tones, and expose sanitized reason text |
| 8 | Medium | Shipped in PR #4498: `cave-58eoq.3` | Support cannot follow one startup/recovery across Rust, sidecar, daemon requests, and CLI children | The original audit found component-local logs without a shared export contract | Shared correlation contexts, structured lifecycle events, bounded native retention, and a redacted export manifest now exist; verify coverage when adding an execution boundary |
| 9 | Medium | Shipped in PR #4496: `cave-58eoq.4` | Green happy-path tests can miss races, stale endpoints, hangs, resets, and orphaned children | The bounded harness covers delayed readiness, crashes, hangs, stale ownership, permission ambiguity, version skew, duplicate starts, cancellation, sleep/wake, stale completions, unusual paths, and repeated lifecycle cleanup | Routine PR conformance runs these assertions on Ubuntu when path selection enables the conformance lane; full-validation and release platform validation run the same harness on Ubuntu, Windows, and macOS |
| 10 | Medium | Shipped in PR #4509: `cave-58eoq.5` | Startup/recovery improvements could not be compared rigorously | No shared definitions or retained distributions for authenticated time-to-ready and recovery success | Local privacy-safe metrics and reproducible baseline/fault runs establish the measurement contract and budgets |
| 11 | Medium | Shipped in PR #4528: `cave-58eoq.6` | An unreviewed CLI/socket path could inherit secrets, hang, overrun output, or mis-handle unusual paths | PR #4528 added process-tree ownership, bounded output, and timeout/termination contracts for the audited CLI paths; the current direct-loopback access policy is recorded separately in row 2 | Keep the execution inventory current; new spawn/socket boundaries require environment, quoting, timeout, size, cancellation, permission, and compatibility coverage |

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
| Daemon unhealthy | Endpoint answers but health is invalid/non-2xx | No verified daemon-running state | Retry health or restart exact owner | Sidecar readiness is now proven separately; downstream daemon correlation remains open |
| Runtime/API mismatch | Native sidecar handshake plus downstream daemon health compatibility check | Native adoption or daemon status refuses the incompatible layer | Update/repair then restart | Implemented sidecar check is exact-version by design for one packaged artifact |
| Cave state lock/permission busy | Structured status-unavailable/incompatible response | Status cannot be confirmed | Automatic later poll; show Status unavailable | Needs OS error evidence in diagnostics |
| Socket/pipe missing | Transport error normalization | Local daemon classified offline | Bounded start policy | Endpoint ownership/ACL audit remains open |
| Response reset/partial body | Response error handler | Request resolves as transport failure | GET may retry once; mutations do not | Cross-component partial-write tests remain open |
| Oversized response | `maxResponseBytes` where supplied | Request fails with size-limit diagnostic | No retry unless caller chooses | Call-site coverage of limits remains open |
| App exits during startup | Cleanup guard, cancellation, process job/watchdog | Owned tree is stopped/reaped | Relaunch cleanly | Cross-platform stress coverage remains open |

## Warning truthfulness audit

| Diagnostic | Before | Shipped contract |
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

The shared implementation lives in `src/lib/server/daemon-diagnostics.ts`,
`src-tauri/src/sidecar_diagnostics.rs`, and the
`/api/daemon/diagnostics` export route behind the normal app access gate. It carries `x-coven-correlation-id`,
retains at most 256 in-memory events and 256 KiB of native events, and builds a
redacted bundle. The list below is the coverage contract for integrations, not a
claim that every future operation automatically emits every field.

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

Historical implementation evidence (counts and timings describe those recorded
runs, not current release validation):

- `daemon-status-classification.test.ts`: complete availability-presentation
  taxonomy, legacy compatibility, and contradictory-evidence fail-closed cases.
- `settings-daemon-multihost.test.ts`: cancellation, abort signal, monotonic
  result guard, exact probed snapshot persistence, and availability wiring.
- Node transport tests prove remote HTTP bearer requests fail before networking
  and ad-hoc probes cannot forward process-wide credentials.
- The 85-file mobile contract suite passes. An isolated Swift typecheck covers
  secure transport and exact HTTPS/WSS origin matching; the focused Xcode test
  was blocked before compilation by the unresolved WebRTC package revision.
- TypeScript typecheck passes.
- Tauri lifecycle baseline: 24 targeted tests pass. A cold local compile took
  42.46 seconds; the tests themselves completed in 0.62 seconds.

Historical follow-up verification:

- `cave-58eoq.1` Windows supervision: 95 native Rust library tests, 9 focused
  supervisor tests, and 24 release-runtime contracts pass. Independent review
  found and the implementation fixed premature recovery while startup still
  owned a live child and best-effort cleanup that could leave a failed process
  job retaining the port. Local Windows cross-compilation was blocked
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
contract tracked by `cave-58eoq.5`.

Behavioral delta shipped in PR #4497:

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

The merged supervision, handshake, fault, and measurement work does not by
itself establish a measured improvement in native startup time or cross-platform
recovery rate. That conclusion requires representative release-host measurements.

## Residual risk register

| Risk | Owner |
| --- | --- |
| Windows post-ready supervision and cross-platform fault injection are shipped; release-host validation remains a release gate | Release platform validation |
| Correlation and redacted export are shipped; new execution boundaries can still omit their diagnostic context | Diagnostic integration tests and review of each new boundary |
| Routine pull-request fault coverage is path-gated; documentation-only changes do not run the bounded harness | Explicit coverage boundary in `cave-5tpxy` |
| CLI boundary hardening is shipped for the audited paths; future spawn and socket/pipe paths must preserve its contracts | Process-boundary tests and an updated execution inventory |
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
privacy-safe local records on each supported platform using authenticated
native readiness, then compare the same benchmark output before and after
a change.

## Historical baseline disposition

The 2026-08-10 execution baseline, formerly
`docs/daemon-connectivity-program-completion.md`, is retained at
`archive/fix-cave-58eoq-daemon-connectivity-audit-2026-08-14`
(commit `e999e4d4457dd89b3979c901f397e152a1b168d6`). Its pending PRs, active
session ownership, and uncommitted-work instructions are historical and must
not be replayed. This document is the maintained reliability reference.

The baseline's twelve completion requirements remain evidence obligations.
The references below identify their contracts, not proof that every release-host
gate has passed.

| Required outcome | Contract or remaining disposition |
| --- | --- |
| Normal startup reaches authenticated sidecar readiness without user action | Native startup sequence and lifecycle state machine |
| Concurrent launches cannot create conflicting owned sidecars or daemons | Single-owner launch contract and fault matrix |
| Post-ready crashes recover through bounded, cancelable, observable policy on macOS, Linux, and Windows | Lifecycle state machine, fault matrix, and supported-platform validation |
| Credentials never travel over unsafe transport or to a different origin | Trust-boundary inventory and credential-origin contracts |
| Armed authentication binds loopback access to the OS user | Not satisfied by the accepted prompt-free direct-loopback policy in `cave-99eon`; retain this explicit tradeoff |
| Every CLI/socket boundary defines timeout, size, cancellation, compatibility, redaction, and process ownership | Execution-boundary inventory; verify each new boundary |
| One correlation ID spans native startup/recovery, sidecar API work, daemon requests, and CLI execution | Diagnostics contract; shared context alone does not prove complete propagation |
| Exported diagnostics are bounded and redact credentials, personal paths, conversation content, and unrelated environment values | Diagnostics and observability specification |
| Fault injection covers refusal, timeout, reset, malformed/partial data, crashes, hangs, stale endpoints, cancellation, and repeated lifecycle stress on supported operating systems | Fault matrix and platform validation; deterministic fixtures do not replace release-host evidence |
| Startup/recovery budgets define distributions, retention limits, and reproducible benchmark commands | Reliability measurement contract and baseline commands |
| UI and diagnostics report connected, healthy, recovered, or fixed only after authenticated end-to-end success | Warning truthfulness audit |
| Required PR checks pass on exact heads and final verification runs from clean current `main` | Delivery evidence; historical counts above are not current verification |

Signing, quarantine, sleep/wake, and abrupt-power-loss validation still require
supported release hosts. Archive retention preserves the historical baseline;
this document carries its maintained requirements on `main` after landing.
