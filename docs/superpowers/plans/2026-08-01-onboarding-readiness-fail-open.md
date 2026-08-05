# Onboarding Readiness Fail-Open Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users continue through onboarding when readiness evidence is pending or unavailable, while preserving a hard stop for confirmed required setup failures.

**Architecture:** Centralize readiness decisions in a four-state model shared by the status route and overlay. Collect local evidence concurrently behind request, discovery, and probe deadlines; preserve evidence completeness through CLI, runtime, daemon, and binding classification; and derive footer actions and install affordances from the shared decision instead of raw truthiness.

**Tech Stack:** Next.js 16 route handlers, React 19, TypeScript, Node assertion tests, Playwright, pnpm.

---

## File Map

- Create `src/lib/onboarding-readiness.ts` and
  `src/lib/onboarding-readiness.test.ts` for evidence states and continuation
  decisions.
- Create `src/lib/onboarding-status-probes.ts` and
  `src/lib/onboarding-status-probes.test.ts` for bounded probe execution,
  evidence classification, binding readiness, and response construction.
- Create `src/lib/onboarding-status-ui.ts` and
  `src/lib/onboarding-status-ui.test.ts` for request coordination, warnings,
  and live-region transition copy.
- Modify `src/app/api/onboarding/status/route.ts` and its `route.test.ts` to
  gather bounded request-scoped evidence and return `complete`, `mayContinue`,
  named step states, and nullable tool evidence.
- Modify `src/components/onboarding-model.ts`,
  `src/components/onboarding-overlay.tsx`,
  `src/components/onboarding-guided-steps.test.ts`, and
  `src/components/onboarding-polish.test.ts` to consume the shared decision and
  render truthful step, warning, focus, and footer behavior.
- Modify `src/lib/opencoven-tools-install.ts` and its test so `null` tool
  evidence produces no install target or invented Install action.
- Modify `tests/onboarding-wizard.spec.ts` to cover complete, fail-open, and
  confirmed-blocker footer states in the browser.
- Modify `scripts/run-tests.mjs` to register the three new focused suites.

### Task 1: Centralize the readiness decision

**Files:**
- Create: `src/lib/onboarding-readiness.ts`
- Create: `src/lib/onboarding-readiness.test.ts`
- Modify: `src/components/onboarding-model.ts`

- [ ] **Step 1: Write the decision tests**

Cover these exact rules:

- missing steps are `checking`;
- explicit states override the legacy `ok` field;
- only required `action-required` steps populate `blockingKeys` and set
  `mayContinue: false`;
- required `checking` and `unavailable` steps populate `unresolvedKeys` but
  keep `mayContinue: true`;
- optional steps never gate continuation; and
- `complete` requires at least one required step and all required steps ready.

- [ ] **Step 2: Run the focused test and confirm it fails**

```bash
node --experimental-strip-types src/lib/onboarding-readiness.test.ts
```

Expected: failure until the readiness module exists and implements the full
contract.

- [ ] **Step 3: Implement the four-state model**

Export `OnboardingReadinessState`, `OnboardingReadinessStep`,
`onboardingStepState`, and `onboardingContinuationDecision`. Add the state and
optional fields to the onboarding status model without changing existing step
keys.

- [ ] **Step 4: Re-run the focused test**

```bash
node --experimental-strip-types src/lib/onboarding-readiness.test.ts
```

Expected: `onboarding-readiness.test.ts: ok`.

### Task 2: Preserve evidence through bounded status probes

**Files:**
- Create: `src/lib/onboarding-status-probes.ts`
- Create: `src/lib/onboarding-status-probes.test.ts`
- Modify: `src/app/api/onboarding/status/route.ts`
- Modify: `src/app/api/onboarding/status/route.test.ts`

- [ ] **Step 1: Add probe-helper and route contract tests**

Pin successful cleanup, synchronous rejection, already-expired work, timeout
abort, observed late rejection, complete versus exhausted environment
discovery, confirmed command/path absence, honest binding classification,
nullable tools, request-scoped environment reuse, concurrent probes, and the
four-second/two-second/750 ms budgets.

- [ ] **Step 2: Run the focused tests and confirm the new contracts fail**

```bash
node --experimental-strip-types src/lib/onboarding-status-probes.test.ts
node --experimental-strip-types src/app/api/onboarding/status/route.test.ts
```

Expected: failures until deadline handling and route evidence states are wired.

- [ ] **Step 3: Add bounded probe primitives**

Implement `withinDeadline` so it installs the timer before work starts, skips
expired work, passes an `AbortSignal`, converts failures to `unavailable`,
clears timers, and observes late promise rejection. Add classifiers that accept
normal `which`/`where` exit 1 and `ENOENT` only when their surrounding evidence
is complete.

- [ ] **Step 4: Refactor the status route around one evidence snapshot**

Create one request-scoped spawn environment, retain whether discovery completed
inside its two-second budget, and launch tool, command-path, home, Git, adapter,
OpenClaw, daemon, familiar, config, and binding probes concurrently under the
four-second request deadline. Keep OpenClaw bounded to 750 ms, preserve
`unavailable` on timeouts and malformed or permission-denied evidence, and
return `tools: null` when CLI status is unknown.

Mark Git, familiar count, and binding details optional. Use the shared
continuation decision to return `complete` and `mayContinue`; do not perform a
network latest-version lookup.

- [ ] **Step 5: Re-run the focused route tests**

```bash
node --experimental-strip-types src/lib/onboarding-status-probes.test.ts
node --experimental-strip-types src/app/api/onboarding/status/route.test.ts
```

Expected: both suites print `ok`.

### Task 3: Make overlay behavior match readiness evidence

**Files:**
- Create: `src/lib/onboarding-status-ui.ts`
- Create: `src/lib/onboarding-status-ui.test.ts`
- Modify: `src/components/onboarding-overlay.tsx`
- Modify: `src/components/onboarding-guided-steps.test.ts`
- Modify: `src/components/onboarding-polish.test.ts`
- Modify: `src/lib/opencoven-tools-install.ts`
- Modify: `src/lib/opencoven-tools-install.test.ts`
- Modify: `tests/onboarding-wizard.spec.ts`

- [ ] **Step 1: Add UI-state tests**

Cover request coalescing and cancellation, stale-response rejection,
transition announcements, fail-open warning copy, active remediation only for
required `action-required` steps, and all three footer outcomes:

- complete: **Open Cave** or summon-your-familiar copy;
- incomplete and fail-open: **Continue to Cave**;
- confirmed required blocker: **Finish required setup**.

Also assert that `tools: null` yields no install targets and the neutral
**Checking local installation…** action label.

- [ ] **Step 2: Run the UI tests and confirm they fail**

```bash
node --experimental-strip-types src/lib/onboarding-status-ui.test.ts
node --experimental-strip-types src/lib/opencoven-tools-install.test.ts
node --experimental-strip-types src/components/onboarding-guided-steps.test.ts
node --experimental-strip-types src/components/onboarding-polish.test.ts
```

Expected: the new fail-open, action-honesty, and footer contracts fail before
the overlay uses the shared model.

- [ ] **Step 3: Implement request and rendering behavior**

Coalesce status requests, abort obsolete work, ignore stale responses, and
derive completion and continuation from the shared decision. Keep checking and
unavailable steps quiet; focus and announce only confirmed required
remediation. Render retryable uncertainty copy without claiming completion or
offering an install for unknown CLI evidence.

- [ ] **Step 4: Re-run component and browser contracts**

```bash
node --experimental-strip-types src/lib/onboarding-status-ui.test.ts
node --experimental-strip-types src/lib/opencoven-tools-install.test.ts
node --experimental-strip-types src/components/onboarding-guided-steps.test.ts
node --experimental-strip-types src/components/onboarding-polish.test.ts
pnpm exec playwright test tests/onboarding-wizard.spec.ts
```

Expected: focused library and component tests pass, and the browser suite shows
the correct footer for complete, uncertain, and blocked payloads.

### Task 4: Register and verify the complete change

**Files:**
- Modify: `scripts/run-tests.mjs`
- Verify: all files listed above

- [ ] **Step 1: Register the new suites**

Add the readiness, probe, and UI test files to the app suite in
`scripts/run-tests.mjs`.

- [ ] **Step 2: Run focused syntax and behavior checks**

```bash
node --experimental-strip-types src/lib/onboarding-readiness.test.ts
node --experimental-strip-types src/lib/onboarding-status-probes.test.ts
node --experimental-strip-types src/lib/onboarding-status-ui.test.ts
node --experimental-strip-types src/app/api/onboarding/status/route.test.ts
node --experimental-strip-types --check src/lib/onboarding-readiness.ts
node --experimental-strip-types --check src/lib/onboarding-status-probes.ts
node --experimental-strip-types --check src/lib/onboarding-status-ui.ts
node --experimental-strip-types --check src/app/api/onboarding/status/route.ts
```

Expected: every test prints `ok` and every syntax check exits zero.

- [ ] **Step 3: Run repository gates**

```bash
pnpm check:tests-wired
pnpm typecheck
git diff --check
```

Expected: every new test is registered, TypeScript reports no errors, and the
diff has no whitespace failures. If the worktree does not have the TypeScript
toolchain installed, record `pnpm typecheck` as unavailable rather than
claiming it passed.
