# Hosted pan diagnostic implementation plan

> **For agentic workers:** Use superpowers:executing-plans for the owned implementation and a fresh read-only review before publication. No extra worktree or delegated source editing.

Checkbox state is not evidence of completion. Code, verification receipts and merged PRs establish delivered behavior; #6064 is the durable work record. This plan grants no execution or publication authority.

**Goal:** Collect bounded native recognizer/routing evidence and independent write-error receipts on the failing hosted runtime without changing the original strict matrix.

**Architecture:** Reuse the existing reviewed DEBUG observer at the trace-file boundary. Add simulator-scoped marker collection to the current workflow; preserve diagnostic and acceptance boundaries.

**Tech Stack:** Swift/UIKit, existing XCTest methods, GitHub Actions, Python native-command wrapper and Node contracts.

**Spec:** `docs/superpowers/specs/2026-11-16-hosted-pan-diagnostic-design.md`. Execution authority comes from the active unattended #6064 goal, not this file.

## Global constraints

- Keep all original UI-test bytes, gestures, assertions, selectors and retry policy.
- Keep Debug 1080 seconds, strict 3600 seconds, per-test 180/300 seconds, job 108 minutes and one minute of resource reserve.
- Keep 240 seconds, 1600 pan reservations, 2097152 bytes and class/state metadata only; no routing, delegate, recognizer enablement, gesture or offset changes.
- Preserve #6482, foreign units, installed user apps, normal hooks/signatures and all first failures; no merge, release, deployment or closure.

## Review focus

- Passing runs also lack outer phases; neither counts nor hit testing prove touch delivery.
- Write failure must remain observable outside the file after strict failure or missing traces.
- A 70-minute window can include earlier processes; require timestamp/PID attribution before a causal claim.
- Observer overhead, caps, unavailable traces and attachment replacement cannot yield false acceptance.
- Count the marker wrapper in the unchanged job budget without weakening the one-minute reserve.

### Task 1: Preserve and prove the hosted observation boundary

**Files:** Modify `apps/ios/CovenCave/CovenCave/Views/ChatScrollTrace.swift`, `apps/ios/CovenCave/CovenCave/Views/ChatScrollAnchor.swift`, `.github/workflows/ios-transcript-regression.yml` and `scripts/ios-native-command.test.mjs`. Retain this design/plan and experiment evidence on #6064.

**Interfaces:** Existing `ChatScrollTrace.note` and `chatScrollAnchorContent` remain compatible. Observer attachment tokens and `stop(reason:)` stay inside DEBUG. Marker outputs reuse the existing `scroll-*.log` and `scroll-*.receipt.json` artifact contract.

- [ ] Add a failing workflow contract requiring post-strict marker collection after failure, destination admission, fixed process/marker predicate, 70-minute lookback, independent retention and a total wrapper bound no greater than 30 seconds.
- [ ] Run `node --test scripts/ios-native-command.test.mjs`; retain the expected missing-collector failure before workflow changes.
- [ ] Verify canonical source/UI-test hashes, then apply only the exact reviewed two-file observer. Add the marker step with 15/5/5/5-second bounds. Count every bounded owned command in resource accounting while preserving the original ceilings and reserve.
- [ ] Run focused native-command contracts, relevant mobile source contracts, whitespace and wiring checks. Preserve first failures and repair actual defects without relaxing assertions.
- [ ] Run one normal-signature bounded build and the original small-drag three-iteration diagnostic on the already-owned simulator. Retain source/binary identities and stop only owned processes/simulator.
- [ ] Obtain fresh review of the concrete diff and resource calculation. Repair important findings before any normal hooked signed publication on the owned branch.
- [ ] Observe one exact-head hosted diagnostic, preserving all 21 strict executions and raw/marker artifacts. Keep original e946 failures and final uninstrumented acceptance separate.

## Self-review

The plan adds observation at the unresolved boundary and independently verifies writer integrity. It preserves the product goal and every functional gate. An empty marker result, missing phase, hit test or passing instrumented run cannot establish actual delivery, frame/device acceptance or goal completion.
