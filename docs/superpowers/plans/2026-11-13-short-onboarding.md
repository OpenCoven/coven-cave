# Shorter onboarding implementation plan

> For agentic workers: use superpowers:executing-plans to implement this plan task by task. The user already approved the visual direction and instructed implementation through protected merge. This plan does not request renewed design or merge approval.

**Goal:** Deliver the approved assistant → project/access → real-chat flow in #6485.

**Architecture:** Preserve existing production creation, grant and chat boundaries. Replace compulsory methodology progress with a versioned short-setup state and a dedicated responsive guide; keep tutorial content optional. Use focused presentation components and the existing workspace/chat handoff, rather than adding a second execution or authority path.

**Tech stack:** Existing React/Next client components, TypeScript, component-imported CSS, current Cave primitives, Node/Vitest behavior tests, existing Playwright fixtures and production server.

**Spec:** [Approved design](../specs/2026-11-13-short-onboarding-design.md).

## Global constraints

- Preserve exact identities, existing context, grants, drafts and session bindings.
- Full access requires an explicit local human action through the existing grant endpoint; a card selection is not a grant.
- Passive runtime checks do not prove authentication, provider health or first response.
- Use existing tokens/primitives and the local Next.js documentation; no new UI dependency is needed.
- Keep the shared checkout, uncertain worktrees, active installed sessions and real-account grants untouched.
- The 45-worktree inventory exceeds the 28-worktree contract; obtain the scoped exception before allocation, refresh the count, record starting OID, and create with `--no-track` from current origin/main.

## Review focus

1. A delayed runtime or grant response for actor/project A must never enable or mutate actor/project B.
2. A grant can succeed before a later setup persistence request fails; Retry must re-read the grant and retain the registered project rather than silently widening or repeating consent.
3. A legacy completed guide must preserve actual completion without inventing practice completion for new users.
4. Closing setup or opening a deep link must preserve the exact draft and existing conversation context.
5. Selecting Full must update both persisted composer mode and visible effective access; inherited access cannot be misrepresented as read-only.

## Task 1: Versioned short-setup progress and admission

**Files:** `src/lib/first-use.ts`, `src/lib/server/first-use-store.ts`, `src/app/api/onboarding/journey/route.ts`, their existing tests, `src/components/first-use-provider.tsx` and its behavior tests, `src/lib/first-use-execution.ts` and its tests.

- [x] Add failing cases for a new short flow, strict legacy state parsing, interrupted legacy choices, explicit assistant/context completion, Full without write authority, malformed state, revision conflict and grant success followed by persistence failure.
- [x] Add a version-two initial state and typed short-setup actions; preserve version-one parsing and historical practice data without marking unperformed exercises verified.
- [x] Validate assistant identity and live context at the route, persist revisions atomically through the existing store, and revalidate Full against write access.
- [x] Update provider/admission copy and transitions so real setup requirements remain enforced while practice no longer blocks useful work.
- [x] Run the affected model/store/route/provider/admission tests and retain the first failures and final results.

## Task 2: Assistant and project interface

**Files:** `src/components/first-use-guide.tsx`, focused new assistant/project presentation modules as needed, `src/styles/first-use-guide.css`, existing guide behavior tests, `src/components/onboarding-runtime-step.tsx`, `src/components/onboarding-bootstrap-overlay.tsx` and their existing tests.

- [x] Add failing behavior tests for existing and newly created familiars, missing runtimes, duplicate creation recovery, actor changes during probes, explicit Read/Full, inherited access, stale direct-grant snapshots, project-switch consent reset and re-opening repair.
- [x] Implement the approved viewport, horizontal progress, creative assistant chooser and truthful runtime states through existing APIs. Keep custom/remote configuration reachable.
- [x] Implement existing-project, native folder-picker/fallback and dedicated-starter choices. Reuse current registration and root-pinning behavior. Display actual scope before granting, with exact compare-and-set access and visible recovery.
- [x] Remove the duplicated runtime stage from local bootstrap while retaining its actual installation consent, status and failure diagnostics.
- [x] Keep optional methodology help and advanced multi-familiar scope reachable. Preserve focus trapping/return, live announcements, narrow layout and reduced motion.
- [x] Run guide/bootstrap/runtime behavior tests and token/style checks.

## Task 3: Polished real first chat

**Files:** `src/components/workspace.tsx`, `src/components/chat-new-dashboard.tsx`, `src/components/chat-view.tsx` only as needed, focused component-imported CSS, existing chat/first-use test fixtures.

- [x] Add failing tests for editable starter selection without dispatch, setup-to-chat handoff, preserved drafts/attachments/deep links, visible Read/Full state, failed-send recovery and Stop.
- [x] Connect the guide to the current workspace chat launcher with explicit familiar/project context and draft, and re-read readiness after acknowledged setup persistence. Do not overwrite an existing conversation or send automatically.
- [x] Add the approved first-chat hierarchy, richer starter cards and project summary through the real empty-chat/composer path. Keep existing task/thread bands and controls reachable for established users.
- [x] Verify a completed real response remains distinct from setup readiness, including first-send failure and Stop recovery.

## Task 4: Qualification and protected delivery

**Files:** `tests/first-use-journey.spec.ts`, affected fixtures, `docs/desktop-onboarding.md`, design/plan and issue-owned delivery receipts.

- [x] Replace obsolete compulsory-practice browser expectations with the approved short flow; preserve security, binding, failure and draft coverage.
- [x] Run selected tests grouped by runner, `pnpm check:tests-wired`, `pnpm typecheck`, affected lint/token/UI checks and `pnpm build`; broaden only for actual failures or unresolved concerns.
- [x] Inspect production-rendered desktop/narrow, keyboard, dark/light and reduced-motion paths in isolated synthetic state. Retain screenshots and clearly separate simulated provider, live provider, browser, native and physical-device evidence.
- [x] Update the canonical onboarding documentation and capture exact source head, results, first failures and remaining acceptance limits.
- [ ] Review the complete scoped diff, commit with proper human attribution, push the owned branch, create/reuse one PR, review all feedback and current exact-head checks, then protected squash-merge via REST with the expected head guard.
- [ ] Record the merge receipt and intentionally preserved worktree disposition on #6485; close the issue and mark its existing Project item Done after merge.

The final protected-delivery and worktree-disposition receipt is recorded on [#6485](https://github.com/OpenCoven/coven-cave/issues/6485). Installed native, physical-device, real-account/provider and human accessibility acceptance remain separate.
