# Unified Chat + Code Workspace — Design

**Status:** Approved (brainstorm) · **Date:** 2026-07-03

## Goal

Collapse the separate **Chat** and **Code** surfaces into one **morphing workspace**: a
chat-centered, minimal surface (ChatGPT-like) that quietly reshapes around what
you're doing. Code tooling lives in a right **code rail** that *smart-reveals* when
code is in play and *recedes* for plain chat. The result should feel seamless and
minimalist yet powerful — like it was made by OpenAI.

## Non-goals

- Rewriting the transcript, composer, or message rendering (already shared, untouched).
- Adding a **Live preview** tab (deferred; Files · Changes · Terminal only for now).
- A big-bang rebuild. This is an *evolve-in-place* arc of small PRs.

## Background: what's already shared (verified)

Chat and Code already share ~80% of their machinery:

- **`ChatView`** (`src/components/chat-view.tsx`) — transcript + the composer (with the
  gold control pills) — is rendered by **both** chat mode and code mode. The only
  surface difference today is the composer placeholder string.
- Chat mode = `ChatSurface` → `ChatRouter` → `ChatView`. Code mode = `CodeView` →
  `ComuxView` (a 3-column Codex shell: file tree · `centerSlot={ChatSurface surface="code"}` · Changes/preview).
- The two left navs — `chat-sidebar.tsx` and `code-sidebar.tsx` — are **near-duplicate**
  `.cnav` components with different data sources (`deriveChatProjectGroups` vs
  `deriveComuxProjects`) and small extras (code adds Scheduled/Plugins).

So the "combine" is mostly: **re-home code panels into one right rail, unify the two
sidebars, and retire the outer 3-column shell + the `code` mode as a destination.**

## The design

### Layout — one surface, two moods

- **Plain chat:** full conversation navigator (left) · centered chat + composer · **no rail**.
- **Code in play:** the code **rail** appears on the right (vertical tab strip: **Changes ·
  Files · Terminal**), the left nav **soft-collapses to an icon strip** so the conversation
  stays centered, and the rail can be **pinned** open or **collapsed** to a slim `</>` strip.

The composer, gold control pills, and conversation list are identical in both moods —
only the rail and the nav width change. The transition is automatic and reversible.

### Components (evolve in place)

| Component | Kind | Notes |
|---|---|---|
| `ChatView` | shared, untouched | Center in both moods (transcript + composer). |
| `WorkspaceRail` | **new** shell | Right rail: vertical tab strip + collapse/pin header; renders one panel. Hosts reused internals. |
| `useCodeRail()` | **new** hook | Owns `{ open, pinned, activeTab }`; subscribes to signals; persists `pinned` in `localStorage`. |
| `resolveRailState(signals, prev)` | **new** pure fn | Deterministic reveal/hide/tab decision. Unit-tested like `split-snap`. |
| `WorkspaceSidebar` | **new** (merge of 2) | One `.cnav` navigator listing all conversations; repo-linked ones get a glyph. Replaces `chat-sidebar` + `code-sidebar`. Soft-collapses when the rail opens. |
| Changes / Files / Terminal panels | reused | comux's diff+undo, file tree+preview, and pty terminal re-homed inside the rail. |
| `CodeView` + `ComuxView` 3-column shell + `code` `WorkspaceMode` | retired / folded | Outer wrapper removed; internals live on in the rail; "Code" is no longer a separate destination. |

Net-new code is small and well-bounded (rail shell + hook + pure resolver + merged
sidebar). Everything heavy (diff, tree, terminal, transcript, composer) is reused.

### Auto-reveal logic — `resolveRailState(signals, prev)`

**Signals:** `hasRepo` (active session's `project_root` set), `hasChanges` (AI touched
files / recent `cave:changes-refresh` with count > 0), `terminalActive` (a pty is
running for the session), `pinned`, `dismissed` (user collapsed it this session).

**Output:** `{ open: boolean, activeTab: "changes" | "files" | "terminal" }`.

1. **Availability gate:** the rail is *rendered* only when `hasRepo || hasChanges ||
   terminalActive`. Otherwise there is no rail (pure chat).
2. **If available, open when:** (priority order)
   1. `pinned` → open, keep last tab. (User intent always wins.)
   2. **New AI edits** (`changes` transitions `0 → N`) → open → **Changes**, badge `N` —
      **even if previously collapsed** (a new edit batch overrides a manual dismiss).
   3. Repo session just opened, no edits → open → **Files**.
   4. User collapsed it (`dismissed`) → stays closed for that reason; a slim `</>` strip
      remains to reopen. (Rule 2 overrides this.)
   5. Reason clears (no repo, no changes) and not pinned → auto-hide.
3. **Active tab default:** edits → Changes · repo-only → Files · last-picked tab
   remembered while open.
4. **Nav coupling:** when the rail opens the left nav soft-collapses to icons *unless the
   user explicitly expanded it* — keeping chat centered without fighting a manual choice.

Signals come from existing plumbing: `session.project_root`, `cave:changes-refresh`,
`cave:open-file-diff`, `cave:code-select-project`. `pinned` persists in `localStorage`
(a global "keep the code rail open when code is available" preference).

### States & edge cases

- **Plain chat** → no rail; full nav; minimal.
- **Repo session, idle** → rail opens to Files (or pinned); collapsible to the slim strip.
- **AI editing** → auto-opens to Changes with a live count badge; per-file diff + accept /
  undo / revise (reuses today's `POST /api/changes` revert).
- **Collapse → new edits** → re-reveals to Changes.
- **Pinned + plain chat** → still nothing (nothing to pin); Pinned + repo → always open.
- **Switching conversations** → rail recomputes for the newly-active session.
- **Narrow / mobile** → no cramped 3rd column: the rail becomes a **slide-over sheet** over
  full-screen chat, toggled by a button (the nav already collapses on mobile).
- **Terminal tab** → **lazy-mounted**: the pty spins up only when Terminal is first opened,
  not merely because the rail is available.
- **No daemon / offline** → Terminal shows an offline state; Files/Changes degrade to empty.
- **Deep-link compat** → old `cave:navigate-mode { mode: "code" }` / `code`-mode links
  resolve to opening the relevant conversation with the rail revealed. No dead links.

### Incremental PR plan

Each PR is independently shippable with all six required checks green.

1. **Rail + Changes.** `resolveRailState()` + `useCodeRail()` + `WorkspaceRail` shell with
   the **Changes** tab (reuse diff/undo). Auto-reveal on `cave:changes-refresh`, wired into
   the chat surface as `<ChatView> + optional <WorkspaceRail>`. `code` mode left intact.
2. **Files + Terminal tabs.** Add Files (tree + preview) and Terminal (lazy pty), reusing
   comux internals. Pin / collapse + slim reopen strip.
3. **Nav coupling + polish.** Soft nav-collapse when the rail opens, hover-to-peek,
   transitions, mobile slide-over sheet.
4. **Unify sidebars.** Merge `chat-sidebar` + `code-sidebar` → `WorkspaceSidebar` (repo
   glyph on repo conversations; keep the Scheduled/Plugins shortcuts).
5. **Retire `code` mode.** Fold the `CodeView`/`ComuxView` 3-column wrapper away; repo
   conversations open in the unified surface with the rail; deep-link compat; delete the
   now-dead shell.

### Testing

- **Unit:** `resolveRailState` — a table of signal combinations → expected
  `{ open, activeTab }` (the `split-snap` pattern): availability gate, pin precedence,
  edit-reveal-after-collapse, repo-only → Files, auto-hide.
- **Source-text wiring:** `WorkspaceRail` mounts beside `ChatView`; `useCodeRail` subscribes
  to the events; the sidebar merge; the retired `code`-mode fold + deep-link resolution.
- **E2E (daemon-less, mocked `/api/sessions/list`):** plain chat → no rail; repo session →
  rail opens to Files; a mocked `cave:changes-refresh` → rail opens to Changes with a badge;
  collapse → slim strip; a new edit batch → re-reveal; pin persists across reload.
- All new test files wired into `scripts/run-tests.mjs`.

## Open questions

None blocking. **Live preview** is intentionally deferred; the pin's persistence scope
(global preference vs per-session) is settled as **global** but is a one-line change if it
should become per-session.
