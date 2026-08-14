# Daemon connectivity reliability

Status: active reliability program (`cave-58eoq`)

Last updated: 2026-08-10

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
| Rust shell -> Node sidecar | Exact owned-child ready log plus a bounded sidecar-token-authenticated API handshake that verifies service identity, native protocol v1, exact app version, bundle mode, and API dependency readiness | Extend the same correlation ID through later daemon and CLI work |
| Webview -> Node sidecar | Per-launch token passed in startup URL and enforced by the sidecar bridge | Correlated handshake evidence and bounded recovery transcript |
| Mobile/tailnet -> Node sidecar | Separate persisted access token and request classification | Continue validating forwarded-peer assumptions and token lifecycle |
| Next routes -> local daemon | Socket/named-pipe request with bounded timeout; health document and compatibility checks in status/start paths | Endpoint ownership/permission evidence and one shared handshake contract |
| Next routes -> remote hub | Normalized HTTP(S) URL and bearer token | Protocol negotiation, explicit certificate/trust diagnostics, replay-safe retry policy |
| Node sidecar -> CLI children | Direct spawn helpers, platform-aware executable discovery, output capture, and secret-scrubbing helpers in several paths | Prove every spawn path uses the safe environment, cancellation, and output limits |
| Runtime files/config -> processes | Bundled runtime closure and per-platform resource resolution | Diagnostic manifest, version provenance, corruption detection, and repair verification |

Primary implementation seams:

- `src-tauri/src/tauri_setup.rs`
- `src-tauri/src/sidecar_startup.rs`
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
   bundled Node, server, speech runtimes, and the fixed Cave port.
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
evidence. Full cross-layer correlation remains `cave-58eoq.3`.

## Ranked issue inventory

| Rank | Severity | State | User impact | Root cause and evidence | Fix and coverage |
| --- | --- | --- | --- | --- | --- |
| 1 | High | Fixed in this branch | A slow probe for an old hub URL could overwrite a newer choice and auto-save the wrong connection | `settings-daemon.tsx` had no abort/generation guard and saved current React state rather than the probed snapshot | Abort superseded probes, reject stale generations, then persist the exact URL/executor snapshot without reusing the probe signal; source contract tests pin cancellation, generation, and snapshot binding |
| 2 | High | Fixed in this branch | Any local process could open the packaged sidecar's PTY WebSocket without the per-launch token and spawn or adopt a shell as the app user | The upgrade gate treated direct loopback as identity; allowlisted-tailnet handling also trusted forgeable forwarding headers as a PTY credential | Require the sidecar token even on loopback whenever it is configured, permit only cryptographically authenticated credentials to relax the PTY source gate, preserve tokenless development explicitly, and pin the decision matrix plus generated-server parity |
| 3 | High | Fixed in this branch | An inherited non-loopback `HOSTNAME` could expose tokenless development APIs to remote callers who spoofed a loopback `Host` and omitted source headers | The listener trusted ambient `HOSTNAME`, while the final tokenless proxy path treated client-controlled authority as sufficient after host/CSRF checks | Restrict bind selection to validated loopback aliases, default invalid ambient values to `127.0.0.1`, and require the custom server's verified local-peer stamp or verified remote ingress before tokenless API access |
| 4 | High | Fixed in this branch | Remote HTTP hubs could receive bearer credentials in plaintext, and ad-hoc HTTPS probes could forward the process-wide hub token to a caller-selected authority | Node and iOS attached stored credentials based on target mode/transport but did not consistently require secure transport plus exact credential origin; the probe route reused global custody for arbitrary URLs | Refuse remote plaintext bearer transport before networking, bind iOS credentials to exact normalized origins shared by HTTPS/WSS, probe sibling authorities without credentials, and limit ad-hoc Node probes to tokens embedded by the caller in that exact URL |
| 5 | High | Shipped in PR #4485: `cave-58eoq.1` | A packaged Windows sidecar that dies after startup previously remained dead until a later UI/manual recovery path acted | Windows had startup ownership but no post-ready observer | Windows now launches the shared bounded supervisor beside `SidecarStartupControl`; automatic/manual startup share atomic ownership, budget resets only after a finished startup with an observed live child, shutdown stops supervision first, and failed/cancelled/navigation-failed workers synchronously release the owned process job |
| 6 | High | Shipped in PR #4495: `cave-58eoq.2` | The window previously could open onto a sidecar that was listening but incompatible or only partially initialized | Rust readiness proved child log + TCP only | Native GUI and background-daemon startup now require the same bounded sidecar-token-authenticated identity/protocol/version/bundle/dependency handshake before navigation, publication, or retained daemon state |
| 7 | Medium | Fixed in this branch | Incompatible, unauthorized, unhealthy, unreachable, misconfigured, and status-unavailable responses appeared as generic “Offline” | Settings ignored the route's machine-readable `availability`; the shared type omitted the route's `incompatible` value | Complete the shared taxonomy, fail closed on contradictory fields, render distinct labels/tones, and expose sanitized reason text |
| 8 | Medium | Open: `cave-58eoq.3` | Support cannot follow one startup/recovery across Rust, sidecar, daemon requests, and CLI children | Logs are component-local and no shared correlation/diagnostic-bundle contract was found | Add correlation IDs, structured lifecycle events, bounded retention, and a redacted export manifest |
| 9 | Medium | Open: `cave-58eoq.4` | Green happy-path tests can miss races, stale endpoints, hangs, resets, and orphaned children | Coverage is strong for helpers but sparse for full post-ready crash/revive and cross-component fault sequences | Add deterministic OS-matrix fault injection and repeated lifecycle stress |
| 10 | Medium | Implemented in this branch: `cave-58eoq.5` | Startup/recovery improvements could not be compared rigorously | No shared definitions or retained distributions for authenticated time-to-ready and recovery success | Local privacy-safe metrics and reproducible baseline/fault runs establish the measurement contract and budgets |
| 11 | Medium | Open: `cave-58eoq.6` | An unreviewed CLI/socket path could inherit secrets, hang, overrun output, or mis-handle unusual paths | The high-impact PTY, remote tokenless-development, and bearer-transport bypasses are closed, but the remaining spawn and endpoint touch-set has not been proven exhaustive | Audit every remaining spawn/socket boundary and pin environment, quoting, timeout, size, cancellation, permission, and compatibility contracts |

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
| Duplicate GUI | PID/birth identity and GUI lease | Second instance exits with owner evidence | Focus existing owner where supported | Cross-platform UX differs |
| Fixed port occupied | Pre-spawn port check | Startup fails with named port guidance | Quit verified owner or choose explicit free port | Port owner is not yet included in one diagnostic bundle |
| Child exits before ready | Owned-child `try_wait` during readiness | Startup fails and cleanup runs | Retry after classified evidence | Tail is bounded but not correlated across components |
| Child hangs before ready | Condition timeout | Fails after 60/90 seconds | Cancel or retry; preserve bounded output tail | Timeout budget is not yet measured by platform |
| Child dies after ready, macOS/Linux | Native liveness poll | Bounded refillable revive and webview re-navigation | Automatic | Full end-to-end revive test is still missing |
| Child dies after ready, Windows | Shared native liveness poll using `SidecarStartupControl` and the owned process job | Bounded refillable recovery without concurrent startup | Automatic | Windows release-host crash injection remains required |
| Stale hub probe | Superseding input/mode/device choice | Previously could repaint/save old endpoint | Abort + generation guard + exact snapshot | Fixed in this branch |
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

| Diagnostic | Before | Contract after this branch |
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
| Port conflict | Refuse duplicate start | Quit the named/verified owner | Set an explicit free Cave port |
| Unauthorized hub | Do not retry credentials | Reconnect/repair authorization | Re-enter verified hub invite/token |
| Incompatible runtime | Refuse adoption | Update Coven, then restart | Repair/reinstall Coven |
| Missing bundled runtime | Refuse partial startup | Repair/reinstall CovenCave | Copy redacted diagnostics for support |
| Permission denial | Do not weaken ACLs or elevate silently | Open the relevant OS settings/repair action | Manual documented command with consent |
| Corrupt/stale endpoint state | Verify process identity before cleanup | Repair | Preserve data and export diagnostics before manual cleanup |
| Failed automatic repair | Keep failure evidence and stop retry storm | Retry repair | Manual copy-and-run command, then re-verify |

## Validation and measurements

Current branch:

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
success or failure, and no unrelated process was terminated. This branch adds
the reproducible authenticated time-to-ready and recovery-rate measurement
contract tracked by `cave-58eoq.5`.

Behavioral delta in this branch:

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
improved; those require the open supervision, handshake, fault, and measurement
work.

## Residual risk register

| Risk | Owner |
| --- | --- |
| Windows post-ready supervision is shipped; release-host fault injection is still required | `cave-58eoq.4` |
| No cross-component correlation/export contract | `cave-58eoq.3` |
| Full OS fault-injection and lifecycle stress matrix is incomplete | `cave-58eoq.4` |
| Exhaustive remaining CLI spawn and socket/pipe security proof is incomplete after closing the PTY and remote tokenless-development authentication bypasses | `cave-58eoq.6` |
| Access-token-only loopback mode still treats a verified local TCP peer as sufficient for REST and PTY, which does not distinguish OS users on shared machines | `cave-ruw4z` |
| One-click repairs are not yet implemented for every classified failure | Follow from the issue whose evidence identifies the repair boundary |
| Hardware-only Windows installer/Defender and macOS signing/quarantine behavior still require release-host validation | Release validation checklist |
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
- `blocked`: the operation could not start because of contention, such as the
  dedicated port already being occupied. Blocked records are reported
  separately and excluded from both success and failure rates.
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
privacy-safe local records on each supported platform after authenticated
native readiness lands, then compare the same benchmark output before and after
a change.
