# Setup status reconciliation implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Checkboxes are not evidence of completion; consult code, merged PRs and the execution ledger.

**Goal:** A completed local setup immediately triggers a fresh authoritative daemon read, so stale offline notices and dependent views reconcile promptly.

**Architecture:** Add a completion subscription beside the existing bootstrap store and use it within Workspace's existing daemon-supervisor effect. Consume a transition into complete before requesting `supervisor.refresh({ fresh: true })`; duplicate snapshots and dialog visibility changes do nothing. Unsubscribe with the supervisor. Existing health classification, cancellation, backoff and readiness remain authoritative.

**Tech Stack:** React client subscriptions, existing TypeScript supervisor, Playwright production browser verification.

**Spec:** [Issue #6166](https://github.com/OpenCoven/coven-cave/issues/6166), under [#6119](https://github.com/OpenCoven/coven-cave/issues/6119).

## Global constraints

- No daemon launch, new timer, retry loop, watcher, readiness shortcut or dependency.
- Keep existing bounded health reads, remote/local identity, authorization and retained data contracts.
- A setup report is a trigger to verify, never proof that the daemon is ready.
- One issue-owned unit; preserve previous #6144 source/branch/evidence; use protected delivery.
- Checkboxes below are a plan, not evidence of completion; implementation state is recorded on the issue and execution ledger.

## Review focus

1. Repeated complete snapshots and opening/closing the dialog must not repeatedly refresh or spend recovery budget.
2. A new explicit setup run must be able to reconcile again after its running transition.
3. Failed or incomplete setup must not turn an offline daemon green.
4. A failed authoritative refresh after setup must retain the accurate recovery state.
5. Background completion and supervisor unmount/remount must not retain stale subscriptions or lose ordinary status polling.

### Task 1: Reconcile setup through the existing supervisor

**Files:** modify `src/components/workspace.tsx` and `src/lib/onboarding-bootstrap-status.ts`; extend `src/lib/onboarding-bootstrap-status.test.ts` and `tests/onboarding-wizard.spec.ts`; retain this plan and issue evidence.

**Interfaces:** add `subscribeOnboardingBootstrapCompletion(listener: () => void): () => void` to the existing client store. Consume that completion subscription and `DaemonConnectionSupervisor.refresh({ fresh: true })` in Workspace; the returned function unsubscribes. No new file, timer or runtime service.

- [ ] Extend existing browser setup fixtures with controlled daemon connection replies. Foreground and background completion must request exactly one fresh read immediately; hold ordinary replies offline to make a missing completion bridge fail deterministically.
- [ ] Assert incomplete/failed setup emits no fresh readiness read, repeated completion/visibility changes do not duplicate it, a subsequent explicit run can refresh again, and a failed fresh read keeps recovery visible. Real-store tests verify unsubscribe and subscription after an already completed snapshot; existing supervisor cancellation tests cover stopped requests. Browser tests prove the actual Workspace wiring.
- [ ] Run the new selector on the unchanged production build; retain the expected missing-fresh-read failure.
- [ ] Add the completion subscription inside the existing supervisor effect, track only the complete transition without adding Workspace renders for each progress update, and unsubscribe in that effect's cleanup.
- [ ] Run the same browser cases, existing onboarding wizard and daemon banner regressions, canonical bootstrap/store/supervisor/start/classification tests, typecheck, scoped lint, plan/docs/wiring checks and production build budgets.
- [ ] Exercise actual production setup with isolated homes and the real reviewed installer. Record completion-to-fresh-read/banner-clear timing, intended PID/socket/start identity, dependent-view recovery, marker preservation and independent owned cleanup. Preserve all failed samples and platform limits.
- [ ] Commit/push explicit files with existing hooks, obtain one fresh whole-branch review, rule on every finding/declined behavior, then merge only with complete current-head checks and feedback. Retain the clean unit and evidence afterward.
