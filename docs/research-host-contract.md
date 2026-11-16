# Research host contract

Research extraction was delivered in [#5997](https://github.com/OpenCoven/coven-cave/issues/5997) (PR #6025).
The dedicated package consumes named adapters under `src/lib/research-host/`
through `@opencoven/research-host/*`. Each adapter exports an explicit set of
values and types from a core-owned module; wildcard exports are intentionally
excluded. These adapters preserve existing authorization, session ownership,
storage, and Flow behavior. They do not grant an alternative access path.

The package must use Cave's React and Next peer instances. Its independent CI
pins an immutable Cave revision containing these adapters. Changing an adapter
requires verifying the consuming package against the proposed host revision;
removing an export requires a coordinated package release and Cave pin update.
The optional runtime entrypoint is guarded by
[`research-package.ts`](../src/lib/server/research-package.ts): request
authorization precedes loading, and host contract version 2 is required before
dispatching requests, starting workers or fetching optional repository snapshots.
Version 2 routes Research scheduling through typed Coven adapters with reviewed
revisions and stable adoption keys (#6196); an older package is refused as
`research-incompatible`.

Saved links belong to core. Chat uses `/api/links`, while the existing Research
endpoint delegates to the same handler and persisted store. Both endpoints
retain local-request authorization, validation, deduplication, X Article
handling, and GitHub enrichment. This prerequisite does not change ingestion
or worker activation. Shared schedule input types live in
`src/lib/research-automation-contract.ts`, without importing the mission runner.

The original extraction was delivered in #5997. Its
[verification report](research-extraction-verification.md) identifies the exact
historical build inputs and does not qualify every later revision.

## Runtime availability failures

Absent and disabled packages return `research-not-installed` and
`research-disabled`. Authorized requests whose import rejects return HTTP 503
with `research-runtime-unavailable` and guidance to repair or reinstall Research,
then restart Cave. An unsupported host contract returns HTTP 503 with
`research-incompatible` and guidance to update Cave and Research together. These
responses contain fixed messages, never arbitrary loader errors or private paths.

The same load/compatibility check serves all three consumers. Startup rejects
with the fixed error so instrumentation reports failure; optional GitHub snapshot
enrichment declines with `{ ok: false }`, preserving core saved-link storage.
After a compatible module loads, its operation errors and Responses pass through
unchanged. The host does not retry or replay a mutation whose outcome may be
unknown. Media and stream credentials retain their existing route/method scope.

This boundary does not cancel a never-settling module import, repair packages,
or establish general worker containment.

## Activation and hot disable

Cave owns one process-local activation owner for the runtime
([`research-activation.ts`](../src/lib/server/research-activation.ts), #6332)
with the states `inactive`, `starting`, `active`, `stopping` and `disabled`.
Installation is fixed at build time and `COVEN_RESEARCH_ENABLED` is read per
request; the owner is the third gate, the one that can change while the server
runs. Instrumentation starts it once; concurrent starts join that one start,
and a start that fails leaves the owner `inactive` so a deliberate retry may
try again.

`POST /api/research/capability` with `{ "active": false }` disables Research
now, behind the ordinary local-request guard. Admission closes first and
synchronously: every Research route and the optional GitHub snapshot refuse
with the existing 503 `research-disabled` before any implementation loads, and
`GET /api/research/capability` reports `enabled: false` with the activation
state, so the Research Desk shows its disabled state without a restart. Only
then does the owner ask the loaded package to stop. The retained outcome is:

| Outcome | Meaning |
| --- | --- |
| `inactive` | No runtime had been started; nothing to stop. |
| `drained` | The package's `stopResearchRuntime` completed. |
| `unsupported` | The package exports no `stopResearchRuntime`. Admitted media jobs continue until Cave restarts; their generation records stay durable and Cave neither cancels nor replays them. |
| `failed` | `stopResearchRuntime` rejected. Admission stays closed; the outcome is retained, not retried. |

A stop that arrives during a start waits for that start and then stops what it
started; a stop that lands before the package start fences it, so nothing is
started and nothing needs stopping. `{ "active": true }` reactivates one owner.
The build and environment gates keep their own codes (`research-not-installed`,
`research-disabled`); a refused activation does not move the owner.

`stopResearchRuntime` is optional under host contract 2. The shipped package
(`@opencoven/research` 0.2.0) does not export it, so its outcome today is
`unsupported`. Adding the export is the package owner's change: it must clear
the per-familiar runner leases, cancel retry timers and the active-job
cancellation monitors, and abort or kill in-flight render children without
rewriting their durable generation records. A later host contract can require
it.

Process shutdown registers Research with the
[startup-worker coordinator](../src/lib/server/startup-worker-shutdown.ts) as
a fourth worker. It drains beside inbox reminders, scheduled chat and backup
sync under the unchanged deadlines. `drained` there means the registered stop
completed: admission closed and the package's stop, when it has one, finished.
With a package that has no stop the quit is not failed for that limitation;
the server log records once that its media jobs were not drained, and the
process ends them. A package stop that rejects is reported `failed`. Research
cannot start after coordinated shutdown has begun.
