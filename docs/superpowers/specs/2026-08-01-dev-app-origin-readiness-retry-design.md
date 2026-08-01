# Dev App Origin Readiness Retry Design

## Goal

Make the desktop development launcher tolerate the short interval where Next.js
has been started but its loopback HTTP origin is not listening yet, without
leaking response bodies or relying on a racy real-port test.

## Scope

- Keep PR #4184 focused by reverting the unrelated startup-readiness commit.
- Preserve the startup change on a separate branch and PR.
- Retry refused connections and non-success HTTP responses until the existing
  bounded deadline.
- Cancel every non-success response body before retrying.
- Keep a hung HTTP request bounded by the remaining deadline.
- Test retry behavior with an injected deterministic fetch implementation rather
  than releasing and reclaiming an ephemeral port.

## Design

`loopbackOriginResponds` retains one absolute deadline. Each attempt receives an
abort timeout equal to the remaining budget. A 2xx or 3xx response returns
success. Any other response has its body cancelled before the fixed short retry
delay. Connection failures retry until the deadline; a request that consumes the
remaining budget returns failure.

The retry test injects a fetch function that rejects once and then returns a
successful response. A second injected response verifies that a non-success body
is cancelled before the next attempt. Existing live-server tests continue to
cover ready, redirect, hung, and absent origins.

## Verification

- `node scripts/dev-app-origin-health.test.mjs`
- `pnpm lint`
- `pnpm typecheck`
- Required GitHub checks on the separate pull request

## Rollout

The launcher interface and timeout arguments remain unchanged. The only behavior
change is that transient startup failures are retried within the existing bound.
