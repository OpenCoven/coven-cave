# Guided first-use implementation plan

> For agentic workers: use superpowers:executing-plans to implement this plan task by task. The current brief supplies implementation authority; execute inline.

**Goal:** Deliver one resumable methodology introduction and persisted concrete launch defaults in issue #6458’s implementation unit.

**Architecture:** A host-owned first-use store and API own progress/default identities. A shared client provider gates execution and renders the guide; existing workspace and chat launch paths retain their own access, runtime and conversation authority.

**Tech stack:** TypeScript, Next.js route handlers, React, existing Cave stores/primitives, Node behavior tests and Playwright.

**Spec:** `docs/superpowers/specs/2026-11-11-guided-first-use-design.md`.

## Global constraints

- Selecting a project grants no access. Real-account grant changes, merge, release and unrelated cleanup require separate authority.
- Preserve explicit context, conversation bindings and drafts. Never broaden missing/revoked defaults into all projects/familiars or an arbitrary actor/directory.
- Keep existing owners of #6450 and #6443; use isolated synthetic homes for verification.
- Read the installed Next.js route/client guides before code changes. Use semantic tokens, shared primitives, focus trapping/return and announcements.

## Review focus

- A stale tab must not undo another tab’s defaults or completion.
- Partial revocation must retain the configured scope for repair rather than silently selecting a remaining actor.
- Opening the guide during send must preserve attachments, draft and initial prompt without automatically executing after dismissal.
- A deep-linked existing chat must keep its original actor and project even when saved defaults differ or are broken.
- An unavailable runtime or failed context read must not look like an empty roster or successful onboarding.

## Task 1: Durable journey and strict default resolution

Files: create `src/lib/first-use.ts`, `src/lib/first-use.test.ts`, `src/lib/server/first-use-store.ts`, `src/lib/server/first-use-store.test.ts`, `src/app/api/onboarding/journey/route.ts` and behavioral route tests. Wire new tests into the existing runner.

Interfaces: client-safe `FirstUseState`, `FirstUseDefaults`, step validation and `resolveFirstUseContext`; store `readFirstUseState` and revision-checked `updateFirstUseState`; route GET state/default validation and POST explicit progress/default/starter actions. Use existing roster, project, access, path and atomic-write helpers.

- [x] Write behavior tests for missing state, sequential practice completion, interruption, revision conflicts, explicit precedence, missing identities and partial revocation; watch the feature assertions fail.
- [x] Implement strict state parsing, step transitions, durable atomic mutation and concrete-context validation without grants or broad fallbacks.
- [x] Implement local-only mutation route with bounded validation and dedicated starter creation; test real persistence and refused/relayed requests in a synthetic home.
- [x] Run the focused first-use/store/route tests, inspect output, then commit the coherent state/API slice with provenance.

## Task 2: Guide and launch integration

Files: create `src/components/first-use-provider.tsx`, `src/components/first-use-guide.tsx`, component behavior tests and `src/styles/first-use-guide.css`; modify `workspace-app.tsx`, `workspace.tsx` and the minimal gates in `chat-view.tsx`. Add reachable guide actions through existing Home/Chat affordances.

Interfaces: `useFirstUse()` exposes loaded/error/state, explicit guide open/close, context refresh and execution guard. The provider consumes Task 1 state/API; workspace consumes validated defaults and guide completion, while Chat checks introduction before consuming outgoing drafts.

- [x] Write failing component/browser tests for meaningful choices, incomplete dismissal, resume, no grant from selection, revoked/default repair, runtime recovery and retained draft/attachments.
- [x] Implement the short guided example with actual context/access review and labeled practice approval/progress/Stop/verification.
- [x] Integrate default restoration and launch/send gates for first launch, restart, Home, New Chat, keyboard, deep links, project/familiar launch, right panel and voice. Preserve recorded conversations and browse scope.
- [x] Replace stale-project and revoked-scope broadening with visible repair; verify explicit valid selection wins.
- [x] Run focused behavior and existing launch/draft/access tests, typecheck and design checks; inspect output and commit the integrated journey.

## Task 3: Qualification and draft delivery

Files: add `tests/first-use-journey.spec.ts`, update test wiring/mobile surface roster as needed, and retain an evidence matrix in `delivery-receipts/issue-6458/README.md`.

Interfaces: uses Tasks 1–2’s public API and UI; produces exact candidate identity, tested acceptance matrix and one draft PR.

- [x] Run fresh/existing/interrupted/restored/default-switch/revoked/runtime/deep-link/draft scenarios using synthetic state, preserving first failures and controls.
- [x] Inspect the rendered journey in the default browser with keyboard and narrow layouts, dark/light and an alternate theme; classify browser/native/human evidence separately.
- [ ] Run appropriate full app/API/mobile suites, typecheck, lint, token/UI/test-wiring checks and production build. Address failures at their cause and record environment limits precisely.
- [ ] Review the full branch against the spec and explicit brief, repair important findings, commit and push the exact candidate, then open one draft PR with evidence and remaining acceptance gaps.
- [ ] Refresh PR head/check state, read back published issue/PR payloads, record intentionally preserved worktree ownership and give one next action. Do not merge or close the issue.
