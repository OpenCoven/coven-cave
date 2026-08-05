# Onboarding Readiness Fail-Open Design

## Goal

Keep onboarding usable when a local readiness probe is slow, unavailable, or
inconclusive, while still stopping normal continuation for a confirmed missing
required prerequisite.

## Readiness Contract

Every onboarding step has one explicit evidence state:

- `checking`: the probe has not produced evidence yet.
- `ready`: the prerequisite is confirmed usable.
- `action-required`: complete evidence confirms that the user must act.
- `unavailable`: Cave could not establish the prerequisite's state.

Only `action-required` on a required step blocks normal continuation.
`checking`, `unavailable`, and every optional or advisory step fail open. They
keep setup incomplete, but they do not turn uncertainty into a blocker.
Onboarding is complete only when at least one required step exists and every
required step is `ready`.

Legacy steps without an explicit state remain compatible: `ok: true` maps to
`ready`, while `ok: false` maps to `action-required`. New probes must use
`unavailable` whenever their evidence is incomplete.

## Bounded Status Collection

`GET /api/onboarding/status` uses a four-second request deadline, a two-second
environment-discovery budget, and a 750 ms OpenClaw probe budget. Command,
filesystem, config, daemon, familiar, runtime, and OpenClaw checks run
concurrently against one request-scoped environment.

The deadline wrapper installs its timer before invoking probe work, does not
start already-expired work, passes an abort signal to command probes, clears its
timer on every outcome, and observes late rejections. A rejection, timeout, or
expired budget produces `unavailable` rather than a fabricated negative result.

Negative evidence is actionable only when its source completed normally. For
example, a normal `which`/`where` miss after successful environment discovery,
an `ENOENT` Coven home, or a definite daemon-offline response can become
`action-required`. Permission failures, parse failures, aborted discovery, and
timeouts remain `unavailable`.

Runtime and binding checks follow the same rule. Cave claims that a configured
runtime or OpenClaw agent is missing only when adapter discovery, local command
checks, and OpenClaw evidence are complete. Otherwise the binding is
`unavailable` and the user may retry later.

Git, familiar count, and existing binding details are advisory. They remain in
the response for diagnostics and feature guidance, but do not gate basic Cave
onboarding.

## Truthful UI and Actions

The overlay uses the same readiness decision as the server and opens
remediation only for a confirmed required `action-required` step. Checking and
unavailable steps stay visible without stealing focus or presenting a false
fix.

If Coven CLI discovery is unavailable, the tools payload is `null`. The UI
shows that local installation is still being checked and exposes no install
target; it must not invent an **Install** action from missing evidence.

The footer reflects the decision directly:

- complete: **Open Cave**, with summon-your-familiar copy when the roster is
  empty;
- incomplete but fail-open: **Continue to Cave**;
- confirmed required blocker: **Finish required setup**.

Unavailable-check warnings explicitly say that the user can continue and retry
later. Completion copy is reserved for fully ready required steps.

## Verification Contract

Focused tests cover readiness decisions, deadline cleanup and late rejection,
environment-evidence classification, runtime binding honesty, status-request
coordination, unknown CLI install behavior, route source contracts, overlay
copy and focus behavior, and the browser-level footer states. The new tests are
registered in `scripts/run-tests.mjs` and remain subject to the repository's
test-wiring and diff checks.

## Exclusions

- No network freshness lookup is added to the onboarding status route.
- No unavailable or advisory result becomes a required blocker.
- No Queue-project step returns to onboarding; Git remains capability guidance.
- No automatic install begins from unknown tool evidence.
