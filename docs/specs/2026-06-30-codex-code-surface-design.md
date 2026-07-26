# Codex Code Surface — Design

**Date:** 2026-06-30
**Surface:** `mode === "code"`
**Goal:** Recreate the Code page layout to comprehensively emulate the OpenAI Codex cloud experience (reference screenshots: project→thread sidebar with nav + Pinned + user footer; single active task/conversation center with "Worked for Xs", code blocks, inline file-edit cards, and a Codex composer with permission + model chips).

## Decisions (locked with user)

1. **Center engine:** Restyle the existing chat thread components (`ChatView`, `ReasoningBlock`, `ToolBlock`, `MessageBubble`). Do **not** build a parallel renderer — reuse the streaming/resume/markdown logic that already works.
2. **Wiring fidelity:** Wire to real data where it exists; render-but-inert (clearly non-broken) where the backing data is thin, filed as follow-up.
3. **Sidebar nav targets:** Deep-link to existing surfaces via the `cave:navigate-mode` bus.

## What already exists (reuse, do not rebuild)

| Piece | Location | Notes |
|---|---|---|
| Code shell (3-col) | `code-view.tsx`, `comux-view.tsx view="projects"` | `.cave-code-page--codex`; `centerSlot` = `ChatSurface surface="code"` |
| Left rail | `code-sidebar.tsx` | Already does project→thread expansion + delete + new-chat |
| Composer | `chat-view.tsx` footer `cave-composer-*` | attach, enhance, Thinking + Speed selects, Send/Cancel; `ComposerControlSelect<T>` generic |
| Model state | `lib/chat-model-state.ts` (`effectiveModel`) | scope precedence next>session>familiar>global; `/api/chat/model-state` |
| Thinking effort | `lib/command-controls.ts` (`high` default) | persisted via `readComposerPrefs`/`writeComposerPrefs` |
| Duration | `chat-view.tsx` `turn.durationMs` + `fmtDuration`/`DurationText` | settled-turn elapsed |
| Reasoning block | `chat-view.tsx:5294` `ReasoningBlock` | collapsible `<details>`, shows word count today |
| Live elapsed | `ui/thinking-indicator.tsx` | live ticking `Worked for Xs` while streaming |
| Action row | `message-bubble.tsx:1158` | Reply/Regenerate/Branch/Expand/Copy (no thumbs/share) |
| Tool/edit render | `chat-view.tsx` `ToolBlock`/`ToolGroup`; `lib/tool-input-diff.ts` | `toolInputAsDiff`, `toolTargetFile`; edit click → `cave:open-file-diff` |
| Diff stats | `session-changes-panel.tsx` (`+N −M`); `/api/changes` | revert via `POST /api/changes` |
| Familiar pins | `lib/familiar-quick-switch.ts` | localStorage + `storage` sync — **template for session pins** |
| Nav bus | `cave:navigate-mode` → `workspace.tsx:521` | `inbox` = Automations, `roles` = Plugins (marketplace tab) |
| Codex prototype | `familiar-chatout-codex/` (flagged) | borrow CSS/markup cues only |

## Net-new (does not exist today)

- **Session pins** (`lib/session-pins.ts`) — clone of the familiar-pin pattern.
- **Permission mode** control — no permission/approval/plan mode exists anywhere. Built as a persisted composer control (UI-real); backend enforcement is out of scope and noted as advisory.
- **Thumbs-up/down + share** on assistant action row — thumbs persist locally.
- **Automations count** for the "Scheduled N" badge — derive from `/api/codex-automations`.

---

## Decomposition — 3-PR arc

Each PR is independently green against `main`'s 3 required checks (Frontend build, Rust check, CodeQL, E2E) and updates its source-text tests in the same commit.

### PR1 — Left rail (Codex sidebar)

**File:** `src/components/code-sidebar.tsx` (+ new `src/lib/session-pins.ts`, `src/lib/use-session-pins.ts`).

**Layout (top→bottom):**
1. **Nav block** (above search): `New chat` (`ph:pencil-simple`), `Search` (`ph:magnifying-glass`), `Scheduled` + count badge (`ph:clock`), `Plugins` (`ph:plugs` / `@`). Rows styled like Codex left nav.
2. **Pinned** section header + pinned thread rows (only when pins exist), driven by `session-pins.ts`.
3. **Projects** section header + existing project→thread tree, with:
   - **Show more**: cap visible threads per project (default 5); "Show more" expands.
   - **Thread leading icon**: PR/branch glyph (`ph:git-pull-request` / `ph:git-branch`) when the title matches PR/branch heuristics (`/^(resolve )?pr #?\d+/i`, `/\bPR\b/`, `branch`), else the status dot.
   - **Pin affordance**: hover action to pin/unpin a thread.
4. **User footer**: avatar initials + display name + plan label (`Pro`), pinned to the bottom. Data from existing session/user context (fallback to a static label if unavailable — render-but-inert per decision 2).

**Wiring:**
- New chat → existing `onNewChat(activeProjectRoot ?? null)`.
- Search → focus the existing in-rail search input (scroll into view + `.focus()`); no new route.
- Scheduled → `dispatch cave:navigate-mode {mode:"inbox"}`. Badge count: fetch `/api/codex-automations`, show `.length` (omit when 0/loading).
- Plugins → `dispatch cave:navigate-mode {mode:"roles"}`. (Landing tab: a tiny `workspace.tsx` tweak lets `roles` honor an initial `marketplace` tab when entered from Code; if that proves load-bearing for other tests, fall back to default `roles` tab — non-blocking.)

**Session pins lib** (`lib/session-pins.ts`): mirror `familiar-quick-switch` — `cave:session-pins:v1` localStorage key, `getPins/togglePin/isPinned/subscribe`, cross-tab `storage` sync; `use-session-pins.ts` hook. Pure module → unit-tested.

**Tests:** extend `code-view.test.ts` (sidebar wiring) + new `session-pins.test.ts` (wire into `run-tests.mjs`).

### PR2 — Center conversation + composer

**Files:** `src/components/chat-view.tsx`, `src/components/message-bubble.tsx`, `src/app/globals.css`.

1. **Composer card (Codex look):** when `surface === "code"` and a thread is active, restyle the `cave-composer-*` footer into a single rounded card; placeholder `Ask for follow-up changes`. Keep attach/enhance/send.
2. **Model chip:** new `ComposerControlSelect`-style chip showing `⚡ {modelLabel} {EffortLabel}` (compose `chatModelState.effectiveModel` + thinking effort). Opening it reuses the existing `/model` option source (`modelSlashOptions`) for the model list and the existing thinking-effort options for the effort sub-control. Selecting persists via the existing model-state + composer-prefs paths.
3. **Permission chip (net-new):** `⚠ {label} ⌄` with options `Full access` / `Read only` / `Ask first`. Persisted as a new composer pref (`cave:chat-composer-controls:v1` extended). Passed in `/api/chat/send` body as `permissionMode` (advisory — daemon enforcement out of scope). Default `Full access` to match reference.
4. **Desktop mic:** add the voice button (`ph:microphone` / `ph:phone`) to the desktop composer control row, reusing the existing `VoiceCallOverlay` path (currently mobile-only).
5. **"Worked for Xs" summary:** when a settled turn has reasoning, render the `ReasoningBlock` summary as `Worked for {fmtDuration(turn.durationMs)} ›` (collapsible) instead of the bare word-count; live turns keep `ThinkingIndicator`.
6. **Action row additions:** add `thumbs-up`, `thumbs-down`, `share` to the assistant action row in `message-bubble.tsx`. Thumbs persist locally (`cave:msg-feedback:v1`, keyed by message id) and toggle; share copies a deep link / dispatches the existing share/open path. Copy already exists.

**Tests:** `chat-view-polish` / `chat-header-row` / `chat-view-lifecycle` source-text tests + `message-bubble` tests updated same commit; new pref keys covered.

### PR3 — Inline file-edit cards

**Files:** `src/components/chat-view.tsx` (`ToolBlock` / segment rendering), `src/app/globals.css`.

- Detect mutation tool calls (`MUTATION_TOOLS` from `tool-input-diff.ts`) and render them as a **Codex file-edit card** instead of (or above) the default collapsed `ToolBlock`:
  `[icon] Edited {basename(toolTargetFile)}   +{ins} −{del}   · Undo ↩  · Review`
  - `+ins/−del` computed by counting `+`/`-` hunk lines from `toolInputAsDiff(name, input)`.
  - **Review** → existing `cave:open-file-diff` dispatch (opens the comux diff pane).
  - **Undo** → `POST /api/changes` revert for that file path, behind a confirm-guard; if the change isn't revertable (no `/api/changes` entry), the button is disabled with a tooltip (render-but-inert).
- Non-mutation tools keep the existing `ToolBlock`/`ToolGroup` rollup.

**Tests:** comux/chat tool source-text tests updated; card markup asserted.

---

## Cross-cutting constraints

- **Branch protection:** every PR lands via worktree → `gh pr create` → squash-merge; no direct push to `main`. Commits signed with `-S`.
- **Bundle budget:** no new static imports into `workspace.tsx`; chat/comux already lazy. New libs are small pure modules.
- **a11y:** nav rows and chips are real `<button>`s with `aria-label`; action-row stays always-in-DOM CSS-gated (existing pattern).
- **E2E:** Code surface specs are daemon-less (`COVEN_CAVE_E2E`); new affordances must render from route-mocked data, no live daemon.
- **iOS mirror:** none of these touch Swift slash-command surfaces; no `test:mobile` impact expected (verify `code-sidebar`/composer aren't referenced by Swift source-text tests before merge).

## Out of scope / follow-ups

- Backend enforcement of permission mode.
- Server-side persistence of message feedback (thumbs) — local-only for now.
- A dedicated Automations sub-tab deep-link from "Scheduled" (lands on Automations root).
- Replacing `ChatView` with the `familiar-chatout-codex` prototype renderer.
