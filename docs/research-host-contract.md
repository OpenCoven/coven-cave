# Research host contract

Research extraction is tracked in [#5997](https://github.com/OpenCoven/coven-cave/issues/5997).
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
authorization precedes loading, and host contract version 1 is required before
dispatching requests, starting workers or fetching optional repository snapshots.

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
hot-disable workers, or establish general worker containment. Those lifecycle
operations require separate implementation and evidence under #6119.
