# Bounded inbox scheduler admission implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan inline. Checkbox state is not evidence of completion; code, tests and merged PRs are authoritative.

**Goal:** Keep a stalled reminder pass from accumulating more inbox transactions.

**Architecture:** Keep the existing singleton scheduler, 15-second interval and store lock. A closure-local in-flight guard admits one pass and releases after success or failure. Catch-up reads authoritative current data; skipped timer events need no replay.

**Tech Stack:** TypeScript, Node test runner, existing inbox store and alias loader.

**Spec:** [Issue #6160](https://github.com/OpenCoven/coven-cave/issues/6160), a scoped outcome of [#6119](https://github.com/OpenCoven/coven-cave/issues/6119).

## Global constraints

- Preserve boot catch-up, recurrence, read/unread semantics, metadata and broadcasts.
- Keep reminders independent of whether their room is visible.
- No new framework, dependencies, global state, timer, public lifecycle API or data migration.
- Never cancel an admitted write, delete state or replay ambiguous mutations.
- Only isolated homes and controlled callbacks; no real-user fault injection.
- Retain existing budgets and cadence; source fault tests are not production latency or soak evidence.

## Review focus

- A rejected read must release admission for a later interval; exercise invalid bytes followed by explicit restoration.
- A due recurring item must fire once and produce one pending sibling and broadcast after the stall.
- Duplicate starts must retain one timer and one boot pass.
- A later due item must still be picked up after an earlier pass completes.
- Queue serialization must remain intact and unknown envelope/item fields must survive the eventual save.

### Task 1: Bound scheduler admission and prove recovery

**Files:** Modify `src/lib/inbox-scheduler.ts`, `scripts/run-tests.mjs`, `docs/core-contract-and-room-boundaries.md`; create `src/lib/inbox-scheduler.test.ts`.

**Interfaces:** Consume existing `withInboxLock`, `loadInbox`, recurrence and broadcasts; preserve `startScheduler(): void` and all existing exports. No new production interface.

- [ ] Write a real-filesystem test suite with an isolated Cave home, captured interval callback and a held real inbox transaction. Count actual inbox reads while preserving the real read operation. Assert 60 callbacks during one pending pass result in one read after release; assert restored operation, recurrence, metadata and broadcast count. Register in both SUITES and ALIAS_LOADER.
- [ ] Run the new test through canonical `nodeArgsFor`; expect the bounded-read regression to fail with61 instead of1 before source edits. Retain original output.
- [ ] Implement closure-local admission in `startScheduler`; release in `finally`, preserving existing best-effort error behavior and 15-second interval.
- [ ] Run canonical new and related inbox/store/API tests; expect all pass. Re-run the original source fault probe with equivalent controlled callbacks; expect0 extra queued transactions and1 read with identical bytes.
- [ ] Update the inventory's reminder entry to describe bounded admission and its remaining shutdown/optional-domain limitations.
- [ ] Run full typecheck, scoped ESLint, test wiring, plan hygiene and diff checks; expect exit0. Existing repository scope rules select related suites, not unrelated full application/native runs.
- [ ] Commit/push explicit paths, perform one independent whole-branch review, address substantive findings with RED/GREEN, and deliver through exact-head protected checks. Keep the issue open until merged and disposition recorded.

Rollback is an ordinary code revert; no stored format or migration changes. Cross-process scheduler ownership, indefinitely hung filesystem operations, teardown and room optionality remain separate outcomes.
