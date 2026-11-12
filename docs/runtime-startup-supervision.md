# Runtime startup supervision

How Cave supervises the local Coven daemon and its own startup workers.
Readiness is a contract, not a reachable socket; every mutation has one
admission point; every worker has one owner that drains on shutdown. The
owning documents hold the tables; this page says what exists and where to look.
Reconciled with `main` on 2026-10-30 (#6334, under #6119).

## Transport availability is not runtime readiness

Cave treats a reachable socket as transport availability, not as runtime
readiness. A local Coven daemon is adopted only after `/api/v1/health` reports:

- `ok: true`;
- a supported named API (`coven.daemon.v1`); and
- a valid Coven SemVer value.

`src/lib/daemon-startup-contract.ts` owns the supported contract set. Cave does
not require the CLI package version and daemon runtime version to match; their
release lines are independent. An unknown newer API contract is refused with
an instruction to update Cave. Other unsupported or missing API identities
direct the user to update Coven and restart it.

If that contract is not met, Cave returns `runtime_incompatible` from daemon
start and `incompatible` from daemon status. It does not restart an already
reachable incompatible daemon automatically; that could allow an older process
to open newer persisted state. The recovery action is to update or repair
Coven, then restart the daemon.

`config.json` and `state.json` are also fail-closed. A missing file starts with
the documented defaults, but malformed files and configuration versions newer
than Cave supports remain untouched and produce an actionable error. This keeps
a routine settings or session write from replacing migrated data with empty
defaults. Restore a backup for malformed data, or update Cave for a newer
configuration version.

## One projected lifecycle state

Since #6299, the status and connection routes publish one `lifecycle` state
projected from recorded evidence by `src/lib/daemon-lifecycle.ts`, read from
the process-global record in `src/lib/server/daemon-lifecycle-owner.ts`:
the start or recovery mutation in flight, whether this process has observed a
ready daemon, and the cached answer to whether the local runtime exists.
Nothing in the projection reads a PID, a socket file or an HTTP status on its
own, and `ready` needs the health probe to have succeeded.

The thirteen states are `missing`, `stopped`, `starting`, `recovering`,
`stopping`, `ready`, `unreachable`, `unauthorized`, `incompatible`,
`unhealthy`, `foreign-owned`, `misconfigured` and `unknown`. Ordering is fixed:
configuration and compatibility failures win over health, a deliberate stop
wins over a still-answering endpoint, confirmed health wins over an operation
in flight, and an operation in flight wins over an offline or unhealthy probe.
Every observation carries a monotonic generation, so a slower, older probe
cannot overwrite a newer state. The client treats `starting`, `recovering` and
`stopping` as transitioning: neither offline nor failure, no automatic start or
revive, no error banner. The evidence table for each state is in
[daemon connectivity](daemon-connectivity-reliability.md#projected-lifecycle-state-6298-slices-1-and-2).

## One mutation owner

Since #6301, every start, automatic recovery and restart is admitted by
`src/lib/server/daemon-mutation-owner.ts` before anything spawns, kicks
launchd or stops a daemon. A start or recovery that arrives while any mutation
runs joins it; a restart joins only another restart and is otherwise refused by
name (`mutation_in_flight`); the same kind within 30 s of a `readiness_timeout`
first asks health whether the earlier attempt finished late and is otherwise
refused with the time left (`duplicate_after_timeout`), so a slow service start
is never stopped and kicked again. The restart hand-back projects `stopping`
while it stops the displaced daemon. The decision table is in
[daemon connectivity](daemon-connectivity-reliability.md#one-mutation-owner-6298-slice-2).

An address someone else already holds is its own outcome rather than a generic
early exit. Once the health probe has failed, Cave connects to the daemon
address to learn whether anything is accepting there; a completed connection
means the occupant is something Cave cannot adopt, so the start is refused with
`address_in_use` and no launcher is spawned. Only a proven connection refuses —
a refused or absent socket launches, and an address that cannot be read at all
stays unknown and launches too, because a false refusal strands a user whose
socket is merely unreadable. A restart skips the check entirely: the occupant it
would find is the daemon the caller asked to replace. The launcher's own bind
failure is classified the same way, which closes the window between the check
and the bind. Cave never deletes a socket file to clear the address; removing
one a live owner still holds is how two daemons come to believe they own the
same home.

The daemon starter retains its bounded health deadline and owned-process-tree
cleanup. A launcher exit alone never means ready; the final readiness probe must
pass the runtime contract before Cave reports success. A spawn failure
(`ENOENT`, `EACCES`, `ENOEXEC`) ends readiness after one final probe rather
than after the deadline (#6302).

To prevent restart storms, concurrent ordinary start requests share one launch.
After three failed managed launches in one minute, Cave pauses new launches
until the rolling window expires and returns an actionable retry time. A healthy
readiness handshake clears that failure history. Backwards clock jumps re-stamp
these windows to now, so a refusal, wait or cooldown is at most one window
after the jump (#6302). Test seams bypass this process-wide guard so isolated
lifecycle tests cannot affect production state.

## Fault matrix and diagnostics

The supported fault matrix (missing or corrupt binary, stale or occupied
socket, child exits or hangs before ready, child dies after ready,
incompatible protocol, foreign owner, clock jump, concurrent recovery and the
rest) names a detection, an owner, a safe action, the bounded retry or
deadline, the verified postcondition and a deterministic test or real-process
probe receipt for every row, with Windows named pipes, physical sleep/wake,
migrated profiles and a foreign launchd owner listed as unverified rather than
omitted. It lives in
[daemon connectivity](daemon-connectivity-reliability.md#fault-matrix-6298-slice-3),
with the real-process receipts in
[daemon lifecycle](performance/daemon-lifecycle.md).

Settings → Daemon exports the redacted diagnostics bundle from
`GET /api/daemon/diagnostics` (#6304). The bundle carries the lifecycle
operation in progress and the mutation owner's in-flight and last-settled
records, read from the owners' own bookkeeping, so exporting runs no probe and
cannot change the state it describes. Maintenance and rollback guidance for the
lifecycle track is in
[daemon connectivity](daemon-connectivity-reliability.md#maintenance-and-rollback-6298).

## Status reads

The visible frontend bounds each connection-status read, including its response
body, to ten seconds. This leaves room beyond the server health probe's
three-second hard transport deadline. A stalled read is aborted, reports unknown
status, and releases waiting refresh callers before the existing jittered
five-to-thirty-second polling cadence resumes. It does not authorize a daemon
restart. Late results are ignored; a later healthy result restores the normal
cadence. Hiding or stopping the supervisor cancels the read and its deadline.
The separate thirty-second reconnect measurement episode remains unchanged.

## Startup workers

`src/instrumentation.ts` starts Cave's own background workers on every Node
start, and `src/lib/server/startup-worker-shutdown.ts` is their one shutdown
coordinator. Each worker registers a stop before it starts; the coordinator
drains every registered stop beside the HTTP close, observes for 3 s on
SIGINT/SIGTERM (within the background daemon's five-second stop limit) or for
the packaged parent lease (1,200 ms on Unix, 400 ms on Windows, beneath the
native kill and Job fallbacks), and reports each worker as `drained`,
`pending`, `failed` or `unavailable`. Expiry is a report, not a cancellation:
every stop promise is retained and finishes on its own, and a worker registered
after shutdown began drains and cannot start. Reading the report is described in
[core contract](core-contract-and-room-boundaries.md#startup-worker-maintenance-and-shutdown-reports).

| Worker | Owner and lifetime | Switch |
| --- | --- | --- |
| `inbox-reminders` | One 15-second timer, one pass in flight, catch-up on start; a delivery that outlives the deadline is reported `pending`, never cancelled or replayed (#6295) | `COVEN_CAVE_AUTOMATIONS_ENABLED=0` pauses the domain: no timer, no pass, records untouched and still served; read when the worker starts |
| `scheduled-chat` | One unreferenced 15-second timer, one pass in flight, production-build guard; admitted claims keep their state across stop (#6209) | the same automations switch |
| `backup-sync` | A 15-minute unreferenced tick only while configured enabled, one pass at a time, a bounded quit push when the coordinator asks (#6209) | backup settings; disabled owns no timer |
| `research` | The optional runtime's activation owner (#6332): started once, concurrent starts join, hot-disabled through `POST /api/research/capability` with admission closed before the package is asked to stop. The shipped package has no stop, so the server log records once at shutdown that its media jobs were not drained | `COVEN_RESEARCH_ENABLED`, the build-time install, and the activation owner; see the [host contract](research-host-contract.md#activation-and-hot-disable) |
| `github-watcher` | One unreferenced 60-second timer only for enabled subscriptions with repositories and events, one read in flight; the drain clears the timer, cancels the read and waits for an admitted inbox or cursor write, which is reported `pending` past the deadline, never cancelled or replayed (#6350). Every activation registers the drain, so the subscriptions route's module-load start and a settings change after shutdown began own no timer | subscription settings and the token; disabled, empty or no-event settings own no timer |

One more loop is not a startup worker but shares the same rule that a
disabled or idle feature owns no timer: device-access revalidation runs once a
second only while a remote connection is live (#6311,
[device access](device-access.md#policy-availability)). An idle
production server with automations and backup disabled owns only the heap
monitor's five-minute timer; that is the disabled-domain idle baseline recorded
on #6119.
