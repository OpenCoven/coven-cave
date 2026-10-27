# Find Navigation Commit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep Find's selected transcript window when a queued bottom-scroll event arrives before navigation commits.

**Architecture:** Commit automatic query navigation in the existing layout phase, before queued browser events can observe released following with the old tail window. Reuse the existing bounded window, jump callback, layout scroll and follow controls; add no ref, retry, timer or supervisor.

**Tech Stack:** React, TypeScript, Next.js production build, Playwright.

**Spec:** [#6173](https://github.com/OpenCoven/coven-cave/issues/6173), under [#6119](https://github.com/OpenCoven/coven-cave/issues/6119).

## Global Constraints

- Preserve bounded 60-turn mounting, explicit user follow/release behavior, composer draft/focus, and the post-Escape reading position.
- Do not weaken/remove the final assertion or add sleeps/retries.
- Preserve all failed samples; synthetic homes only, with owned process/port/socket cleanup.
- Keep #5840's human screen-reader acceptance separate. No native/device acceptance claim.
- One whole-branch review, one substantive fix pass if needed, then protected exact-head delivery. Retain ledgers and worktrees under parent authority.

## Review Focus

1. A hit in the last mounted page must release follow without losing explicit Latest rejoin.
2. Query/filter changes while streaming must jump only for the changed query, never for an unchanged result refresh.
3. An empty or unmatched query must not move the transcript or disturb focus.
4. Switching chats during pending navigation must not scroll the new conversation using the old turn identity.
5. A synchronous layout jump must retain the mounting budget and avoid a render/effect loop or unnecessary blocking work.

### Task 1: Commit automatic Find navigation before scroll rearm

**Files:** Modify `src/components/chat-view.tsx`; extend `tests/chat-context-performance.spec.ts`; retain existing scroll, Find and transcript-window contracts.

**Interfaces:** Consumes existing `jumpToFindMatch`, `pendingFindJump`, query key, bounded window and follow controls. Produces unchanged public component/API signatures, with atomic query-result/navigation publication before queued scroll processing.

- [ ] Add a browser regression that queues one bottom-scroll event at the real anchor measurement before navigation commits. Keep real DOM geometry and component code; assert oldest-turn mount, 60-turn bound, post-Escape reading position/draft/focus and explicit Latest rejoin. Confirm the injected boundary was exercised. Add focused query/filter/no-match and thread-switch cases where existing cases do not already protect Review Focus.
- [ ] Run the new case against the unchanged production build. Expected: the oldest-turn assertion fails with the tail window; retain trace and independently verify cleanup.
- [ ] Change only automatic query navigation to the layout phase, documenting why it must commit before queued scroll events. Expected: no extra state, timers, dependency or query policy changes.
- [ ] Run canonical Find, transcript window/fold/groups, scroll-pin and history contracts; full typecheck, scoped lint, docs/plan/wiring and design gates. Expected: all pass. Build production with existing budgets and run the full context spec plus queued-scroll repetitions and relevant transcript/scroll browser cases. Expected: all pass, no unowned resources, no performance-gain claim from this fix.
- [ ] Walk design section 9: existing controls/copy/tokens remain; verify focus, reduced motion and dark/light/non-default appearance as appropriate. Commit and push explicit scoped paths with existing hooks. Expected: clean issue-owned branch, exact build binding, one whole-branch review followed by protected checks and merge.
