# Automated chat activity qualification implementation plan

> Execute sequentially in the issue-owned worktree. The maintainer's attached goal authorizes implementation and delivery; preserve all separately reserved human decisions.

**Goal:** Complete automatable qualification for #5766, #6069, #6066, #6064 and #6061, with tested repairs and reviewable evidence.

**Architecture:** Extend existing shared corpora and production native/web consumers. Keep lifecycle observations separate from authorization and effect authority. Reuse existing native transport and UI harnesses rather than replacing production boundaries with mocks.

**Tech stack:** Swift, XCTest, TypeScript, Playwright and the existing production Next/Tauri harnesses.

**Spec:** The original acceptance criteria and complete comments of issues #5766, #6069, #6066, #6064, #6061 and gate #5767, refreshed before execution; user attachment `pasted-text-1.txt` authorizes this run.

## Global constraints

- Preserve existing owners, separately owned #6090/#6107, user preferences, disclosure and authorization boundaries.
- Use synthetic profiles and an owned simulator; never touch real Coven state or credentials.
- No weakened assertions, hidden first failures, performance-budget increases or invented qualification.
- A development candidate is not a Val-nominated release candidate. Human VoiceOver, physical devices and provider canaries remain separate gates.
- One additional worktree is explicitly authorized and recorded on #5766; no retirement is authorized.

## Review focus

- Replayed requests must not revive terminal calls or erase cancellation requests.
- Pending approval and cancellation are active observations, never successful outcomes.
- Invalid provenance must be withheld without hiding readable tool state.
- Persisted active calls become unknown while rejected/cancelled outcomes retain their distinctions.
- Disconnect and stream completion must not create producer authority.

### Task 1: Native lifecycle parity (#5766)

**Files:** `Models/AgentActivity.swift`, `Models/Models.swift`, `Views/AgentActivityView.swift`, `Views/ToolOutputDetailView.swift`, `CovenCaveTests/AgentActivityTests.swift`, `CovenCaveTests/ActivityCorpusTests.swift`, shared `runtime-activity-v1.json`, and native preview/UI fixtures if required, all under `apps/ios/CovenCave/`.

**Interfaces:** Consume the existing stream ToolActivity schema and TypeScript `chat-tool-state.ts` semantics; produce identical native live/replay/history status, provenance and labels without adding authority.

- [ ] Run existing ActivityCorpusTests and AgentActivityTests on unchanged baseline; retain exact identities and first results.
- [ ] Add shared terminal/approval/cancel scenarios plus native provenance, replay, settlement and summary tests. Expect failure on missing statuses/provenance before changing implementation.
- [ ] Add the five lifecycle states, align replay retention and timestamp validation with TypeScript, and render exact state distinctions in summaries/detail/accessibility labels.
- [ ] Run native unit tests, shared TS corpus and mobile tests; add rendered UI coverage for newly visible states and run the existing Activity suite.
- [ ] Verify applicable repository gates; review and deliver a scoped PR with evidence, preserving the worktree.

### Task 2: Navigation and recovery (#6069)

**Files/harness:** `scripts/runtime-activity-native-transport.mjs`, existing `ActivityRecoveryUITests` and relevant navigation/shrinking selectors documented in `docs/design/evidence/native-recovery-2026-10-18/commands.txt`.

- [ ] Refresh nomination and owner constraints. If qualification is blocked, retain that blocker and run only permitted development checks.
- [ ] Run actual send/restart/history/output-dismiss/background/navigation/shrink lanes, retaining first attempts, stable IDs, one-effect counter and cleanup receipts.
- [ ] For any reproduced failure, capture contemporaneous hierarchy/screenshots, add a failing regression and fix the demonstrated cause before rerunning the whole affected lane.

### Task 3: Preference hydration (#6066)

**Files:** `tests/chat-activity-acceptance.spec.ts`, existing reasoning visibility/legacy split code, native `AgentActivityUITests` and preview fixtures.

- [ ] Extend absent/on/off/unrecognized × legacy/new transcript matrix using existing per-frame sampling; verify toggle persistence through reload.
- [ ] Exercise native and packaged desktop claims through their actual clients; record missing evidence rather than treating web emulation as native acceptance.
- [ ] Repair only demonstrated defects, verify meaningful regressions and publish matrix receipts.

### Task 4: Large traces and denial (#6064)

**Files:** existing 500-tool case in `tests/chat-activity-acceptance.spec.ts`, lazy-output cases in `tests/chat-tool-cards.spec.ts`, native performance fixtures.

- [ ] Extend large/deep/oversized and 401/403/404/409 scenarios without changing bounds.
- [ ] Run alternating production baseline/candidate render/open/scroll samples under equal conditions, retaining raw first-attempt values.
- [ ] Verify explicit truncation/withholding, bounded fetches, stable UI and native long-trace behavior; repair reproduced defects and retain omissions.

### Task 5: Privacy surfaces (#6061)

**Files:** existing shared privacy sentinels and per-surface tests; coordinate unmerged #6176/#6190 before implementation.

- [ ] Map split tool input/result sentinels and request-time revocation to copy/export/cache/log/notification surfaces.
- [ ] Extend existing fixtures and run actual production consumers; never claim a fixture-only result establishes packaged/native acceptance.
- [ ] Repair reproduced disclosures with failing-first checks and publish exact-candidate evidence with human/device/provider exclusions.

### Delivery and completion

- [ ] Run applicable targeted checks, typecheck, lint, test wiring, app/API/mobile/conformance, production build and real-client lanes.
- [ ] Open scoped PRs, inspect all current-head checks/review threads, and use protected exact-head delivery only where all required approvals are satisfied.
- [ ] Reconcile all five original issue criteria. Close only fully satisfied outcomes; retain explicit blockers and next actions for all missing gates.

## Execution ledger

- Baseline: `d90f1f3aea28f3fe0defea94badecd6de21094d3`; worktree `issue-5766-automated-qualification`; native simulator `A9D2A018-F86F-4609-9DAE-ABF4DEEAA50D` created solely for this run. Dependency restore and generated Markdown/Xcode project completed. Native baseline unit selection is running; evidence in ignored `.verification/5766/`.
