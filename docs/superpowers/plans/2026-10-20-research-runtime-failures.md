# Optional Research runtime failure handling

Issue [#6150](https://github.com/OpenCoven/coven-cave/issues/6150), under
[#6119](https://github.com/OpenCoven/coven-cave/issues/6119), owns this delivery.
Use inline executing-plans with one independent final review. The issue records
verification and delivery; this plan is not completion evidence.

## Contract

Keep absent, disabled, incompatible and failed-load Research states distinct.
Authorized API requests receive privacy-safe, actionable 503 JSON when the
optional implementation cannot be loaded or used with this host contract.
Authorization still precedes loading. Core saved links do not require optional
snapshot enrichment. Startup must not claim that a failed runtime started.

Consolidate the three existing import/version checks in one small helper. Do
not catch downstream request or worker failures as module unavailability, replay
mutations, add retries, change credentials, or initialize another lifecycle
owner. No UI, package release, dependency, data migration or hot-disable change.

## Task 1: Preserve useful errors at the existing host boundary

Files: `src/lib/server/research-package.ts`, its existing behavior tests, and
`docs/research-host-contract.md`.

1. Extend real dispatcher tests with rejected imports and incompatible versions,
   including a mutation request. Require stable 503 codes, repair guidance and
   no arbitrary error bytes or handler calls. Test startup rejection and
   optional enrichment fallback. Expected before repair: these cases fail.
2. Add the shared compatible-runtime loader and wire all three existing callers.
   Keep operation execution outside the load-error boundary. Expected: focused
   failure cases pass and the existing authority/absence cases still pass.
3. Verify response identity, operation-error identity and exactly one mutation
   call, plus native media and stream credentials. Expected: no replay or
   weakened authority; saved-link contracts remain green.
4. Document the exact failure boundary and unchanged limitations. Run focused
   tests, API contracts, typecheck, scoped lint, wiring, clock and diff guards.
   Review the committed exact diff once, fix substantive findings with a failing
   regression, and deliver through protected checks. Expected: all selected
   gates pass before merge; the worktree and evidence remain retained.

## Review focus

- An unauthorized request never imports the optional runtime, even when broken.
- Import failures and version mismatch cannot execute handlers or workers.
- A mutation handler that throws is neither retried nor mislabeled unavailable.
- Successful streaming/error Responses and original request/context pass through.
- Startup and enrichment retain different failure semantics without duplicating
  import/version policy or exposing arbitrary loader errors.
- This does not prove package removal/reinstallation, timed import cancellation,
  hot deactivation or general Research worker containment.
