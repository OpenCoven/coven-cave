# Automation history metadata export implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. **Checkbox state in this document is not evidence of completion. Verify what has shipped against code and merged PRs.**

**Goal:** Download a bounded diagnostic packet from the canonical history page already read by Cave.

**Architecture:** Validate through the existing browser history parser and reconstruct only closed metadata fields in a pure serializer. A user-triggered component action prepares that packet without further daemon reads or mutations. Existing privacy filtering and stale-page ownership remain intact.

**Tech Stack:** TypeScript, React, Node test runner, shared Button/announcer, released Coven canary.

**Spec:** `docs/superpowers/specs/2026-10-24-issue-6213-history-export-design.md` and GitHub #6213.

## Global constraints

- Maximum 100 entries and 65,536 UTF-8 bytes; fixed filename coven-automation-history-metadata.json; schema cave.automation-history-metadata.v1.
- Only current-page closed metadata; no free-text, cursor, paths, host identity, extra reads or mutations.
- Scope single-page, completeHistory false, freshness read/stale, original readAt normalized to UTC; no authority or authenticated-receipt claim.
- Preserve #6212's exact source branch and all worktrees; integrate delivered main before UI/canary completion.

## Review focus

- Initial unavailable history must not export an empty success: serializer refusal and disabled component action.
- Retained stale history must preserve its original readAt and stale flag: serializer and failed-refresh component tests.
- Credential/private text in labels, details, cursors and unknown properties must not leak: sentinel tests against serialized JSON.
- Download failure must remove anchors/revoke object URLs and preserve focus: component browser-boundary tests.
- Late responses after selection changes/unmount must not export the wrong page: component correlation/abort tests.

## Task 1: Closed metadata serializer

**Files:** Create src/lib/automations/history-export.ts and history-export.test.ts; modify scripts/run-tests.mjs.

**Interfaces:** Consume parseAutomationHistory(value: unknown). Produce serializeAutomationHistoryMetadata(value: unknown, freshness: "read" | "stale"): string, AUTOMATION_HISTORY_METADATA_FILENAME and AUTOMATION_HISTORY_METADATA_MAX_BYTES.

- [x] Add failing tests for valid empty versus unavailable history, 100-entry maximum, >100 refusal, maximum valid byte bound, malformed/duplicate/out-of-order input, normalized UTC, stale/readAt/withheld/incomplete scope, unknown fields and private-text sentinels.
- [x] Run node --experimental-strip-types --test src/lib/automations/history-export.test.ts and preserve the first failure.
- [x] Implement closed reconstruction, known-label mapping, fixed generic refusal and the UTF-8 byte ceiling. Catch hostile getter/parser failures without reflecting input.
- [x] Run focused serializer tests, register them in the app runner, and commit the tested pure subset with the design/plan.

## Task 2: Accessible download and released-daemon coverage

**Files:** Modify src/components/automations/canonical-history.tsx and canonical-history.test.ts; scripts/coven-automations-release-canary.ts and its test.

**Interfaces:** Keep CanonicalAutomationHistory({ automationId }) unchanged; consume Task 1's serializer/constants and only the currently validated page.

- [x] Add failing component tests for initial/loading disablement, current-page download without another fetch/mutation, stale metadata, fixed filename, generic failure, anchor/object URL cleanup, focus and abort/correlation on selection changes.
- [x] Implement Export metadata with the shared Button/announcer and existing browser download pattern. Announce preparation truthfully and retain clear diagnostic-only scope copy.
- [x] Extend the real released-daemon canary through readAutomationHistory plus the serializer; retain existing Research/privacy checks and assert closed bounded output.
- [ ] Run focused tests, typecheck, lint, wiring, required app/API verification, guarded production build and released-daemon canary. Inspect dark/light/default-browser keyboard behavior and record evidence limits.
- [ ] Request fresh whole-branch review, repair actionable findings, commit/push a scoped PR, then verify exact-head hosted checks/review threads before authorized protected merge. Intentionally preserve the owned branch/worktree and keep #5217 open.

Task 1 verification: ten focused tests pass after the initial missing-module failure and two reproduced changing-getter failures. The final serializer copies only own data descriptors before validation; independent review repeated the tests and hostile Proxy/scalar probes with no remaining findings. Typecheck, focused ESLint and the 2,136-file wiring gate pass. The first typecheck failure was a narrow inferred test-fixture type and is preserved in /tmp/issue-6213-typecheck-serializer.log. UI, released-daemon and whole-branch delivery remain incomplete.

Task 2 local checkpoint: three new component regressions failed before the action existed, then all sixteen serializer/component tests passed. Typecheck and focused ESLint pass. Independent UI review found no actionable issues; mocked focus/cleanup tests do not establish native keyboard, screen-reader or Safari behavior. The canary, broader integrated gates and browser evidence remain pending #6212 integration.
