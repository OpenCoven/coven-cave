# E2E load-flake repair design

## Scope

Repair the confirmed `chat-boot-landing.spec.ts` fixture race tracked by
`cave-9ta9k`, then use CI-shaped stress runs to decide whether the Task Work
and Reader symptoms require separate repairs. Do not change product behavior
or globally increase Playwright timeouts without a reproduced root cause.

## Evidence

The no-active-familiar test supplies two familiars in this order: Aster, then
Nova. With no active familiar, Workspace correctly evaluates project readiness
for the first visible familiar, Aster. The shared Playwright seed grants the
E2E project only to Nova.

An isolated `origin/main` run using the CI configuration, two workers, and
eight repetitions produced two hard failures, two flaky retries, and 23
passes across the three selected scenarios. Every failed chat snapshot showed
the correct First Project access gate for Aster. The test had briefly observed
`NewChatLaunch` before scoped project hydration replaced it with the gate, so
the failure was fixture drift rather than a slow heading or product regression.

The same run did not reproduce the Task Work duplicate-send or Reader menu
stall. Those remain evidence-backed CI symptoms, but they do not yet justify
speculative production changes.

## Design

Make `seedWithoutActiveFamiliar` own its project-access premise. Mock the
projects endpoint so the registered E2E project is accessible to the familiar
Workspace must evaluate while no active familiar is selected. Keep the two
familiar choices and the existing assertions that neither is selected and no
composer is pre-bound.

Do not modify the global Playwright permission seed: other tests deliberately
rely on Nova-only access. Do not loosen the assertion timeout: the heading is
absent because the product has transitioned to a different valid surface, not
because it needs more time.

## Verification

1. Preserve a red run from current `origin/main` under the CI-shaped repeated
   selected-spec command.
2. Apply only the fixture repair.
3. Re-run the no-active-familiar test repeatedly with two CI workers.
4. Re-run all three named scenarios repeatedly to detect Task Work or Reader
   recurrence.
5. Run the complete `chat-boot-landing.spec.ts` file and the repository's
   relevant static/type gates.
6. If Task Work or Reader reproduces, stop and trace that symptom separately;
   do not add a shared timeout workaround.

## Delivery boundary

This design authorizes a test-fixture-only patch. Any production-code change,
global E2E configuration change, or broader CI architecture change requires
new evidence and a revised design.
