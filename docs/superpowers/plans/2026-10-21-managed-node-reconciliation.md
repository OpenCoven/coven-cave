# Managed Node verification reconciliation implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Checkboxes are not evidence of completion; consult code, merged PRs and the execution ledger.

**Goal:** Continue setup when its fresh inspection verifies a runtime whose installer reported a stale verification failure.

**Architecture:** Reuse `ensureOnboardingCoreTools`' existing post-failure inspection. Only a managed-node `verification_failed` result with `runtimeReady: true` may continue through the existing CLI install and final verification. No new retry, timer, deadline, dependency or installer replay.

**Tech Stack:** TypeScript server orchestration, existing canonical Node tests, isolated production browser and real managed installer.

**Spec:** [Issue #6170](https://github.com/OpenCoven/coven-cave/issues/6170), under [#6119](https://github.com/OpenCoven/coven-cave/issues/6119).

## Global constraints

- Keep reviewed artifact, version, executable identity, ownership, cancellation and serialized installer contracts.
- Preserve non-verification failures even when an older runtime is usable.
- Preserve failed runtime reinspection and every CLI installation failure.
- Keep Node/npm probe deadlines at 1,500/15,000 ms and the current final readiness check.
- Keep all failed samples, source branches, ledgers and owned worktrees; no release or real-profile fault injection.

## Review focus

1. A recovered runtime must still install and verify a missing CLI.
2. A failed fresh runtime inspection must retain the actionable failure.
3. Integrity, archive, permission, cancellation and unknown failures must not become success because a runtime happens to work.
4. CLI verification failure remains a failure, and a failed final inspection after recovery must stop setup.
5. Runtime recovery must not re-run the installer or add unbounded polling, and successful output must not retain stale failure diagnostics.

### Task 1: Reconcile the verified runtime

**Files:** modify `src/lib/server/onboarding-core-tools.ts` and `src/lib/server/onboarding-core-tools.test.ts`; retain this plan.

**Interfaces:** unchanged `ensureOnboardingCoreTools(onProgress, dependencies): Promise<OnboardingBootstrapStageResult>` and its existing `inspect`, `startInstall`, `readInstall` dependencies. Consume `ReviewedInstallResult.code` and `OnboardingCoreToolsInspection.runtimeReady`; produce the existing successful or failed stage result.

- [ ] Add a regression where managed-node installation ends with `verification_failed`, its fresh inspection is ready, the missing CLI is installed once, final inspection passes, and the stage returns success without stale diagnostics. The unchanged implementation must fail on `result.ok`.
- [ ] Cover unusable reinspection, all other installer failure codes despite a ready runtime, CLI verification failure, and final inspection becoming unusable. Assert installer targets/order and no replay.
- [ ] Run the canonical core-tools selector and preserve the expected failure. Inject one real-child timeout into the first managed Node version probe of an isolated production setup and preserve the unchanged-build failure with `managedNode: ready` in diagnostics.
- [ ] Continue only the recovered managed-node verification result through the existing orchestration; use the same verified inspection and retain ordinary final verification. Do not change the managed toolchain implementation.
- [ ] Run canonical related toolchain/install/bootstrap/diagnostic/API tests, full typecheck, scoped lint, test wiring and plan/docs gates. Expected: all selected tests and checks pass.
- [ ] Rebuild production with existing budgets. Repeat the controlled failure and actual fresh CLI 0.4.10 setup, checking one fresh daemon reconciliation, PID/socket/start identity, readable synthetic memory and both markers, then independently verify owned cleanup. Expected: recovered setup succeeds without an installer retry; all failed reports stay retained.
- [ ] Commit and push explicit files with hooks, obtain one independent whole-branch review, verify any accepted fix once, then merge through protected exact-head checks. Record retained unit disposition and remaining platform/native/provider/migration/soak limits on the issue.
