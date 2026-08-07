# Full navigation history tracking — implementation prompt

**Goal:** the shell's Back/Forward controls traverse **every** navigable level of
the app, not just two. Back steps up exactly one level from wherever the user
is; Forward retraces. No level is exempt.

Companion to `docs/nav-history-tracking.md` (PR #4407), which is the read-only
inventory. That document marked filter/toggle axes as deliberately untracked.
**This document supersedes that judgement:** every axis listed below is tracked,
including filters and A/B toggles.

---

## 1. Current state

Two levels are tracked, and only two:

| Level | Where | Mechanism |
| --- | --- | --- |
| Workspace mode (`CaveMode`) | `src/components/workspace.tsx` — `navigationHistoryRef` (:358) | in-memory stack, `src/lib/workspace-navigation-history.ts` |
| Chat session id (Chat only) | `workspace.tsx` — `chatNavigationHistoryRef` (:363) + `src/components/chat-router.tsx:334` | the app's **only** `history.pushState`; `#chat-<id>` hash |

`DesktopHistoryNav` (`src/components/desktop-history-nav.tsx`) calls
`window.history.back()` / `.forward()`. `Workspace` owns the `popstate` listener
(`workspace.tsx:2283`) and routes each pop to either the chat stack or the mode
stack, then feeds `canGoBack` / `canGoForward` to `Shell` (`workspace.tsx:3254`).

Every other URL write is `history.replaceState` — addressable but creating no
history entry: `settings-shell.tsx:159,165`, `grimoire-nav-state.ts:51,56`,
`lib/grimoire-link.ts:26`, `lib/workspace-url-state.ts:16,31`,
`board-view.tsx:315`, `code-view.tsx:105`, `chat-router.tsx:343`.

Everything else — every tab strip, section picker, filter chip, drill-down, and
overlay — is component-local `useState` (some `localStorage`-persisted) and is
invisible to Back/Forward.

## 2. Design constraints that must survive

1. **No escaping into foreign history.** The workspace only asks the browser to
   traverse entries *it recorded* — a direct `#chat-…` launch must never walk
   out into unrelated webview history (comment at `workspace.tsx:360`,
   `suppressInitialChatHistoryPushRef` at :357). Every new level inherits this.
2. **Deep-link arrival replaces, it never pushes.** Landing on
   `?mode=calendar`, `/settings#familiars`, or `#grimoire-memory:…` must not
   synthesize a fake "previous" entry.
3. **Alias modes resolve to a location, not a side effect.** `MODE_ALIASES`
   (`src/lib/workspace-mode.ts:80`) already maps `groupchat`→Chat Group tab,
   `journal`→Memories Journal, `calendar`→Rituals Calendar,
   `familiar-work-queue`→Board Queue, `roles`/`capabilities`→Marketplace
   sections, `code`→`surface:code`. These must produce a `{ mode, tab }` entry
   directly rather than a mode entry plus a silent tab set.
4. **Existing persistence stays.** Surfaces that remember their last tab in
   `localStorage` (`researcher-surface.tsx:87`, `chat-surface.tsx:41`,
   `grimoire-nav-state.ts:59-60`, `craft-create-drawer.tsx:53`,
   `useSurfacePreference`) keep doing so. Restore-on-mount is a **replace**.

### One flagged concern, and the mitigation to implement

Tracking filter chips and A/B toggles means a user who taps through four
filters needs four Back presses to leave the surface. Ship it as asked, but
implement **same-axis coalescing**: consecutive changes on the same axis with no
intervening navigation on another axis, occurring within `HISTORY_COALESCE_MS`
(default 700 ms), collapse into one entry (`replace`, not `push`). Deliberate,
spaced-out filter changes still each get an entry. Expose the window as a
per-axis option (`coalesceMs: 0` disables) so an axis can opt out.

## 3. The model to build

### 3.1 Location entry

Replace the two ad-hoc stacks with one ordered stack of *locations*:

```ts
// src/lib/workspace-location.ts (new)
export type WorkspaceLocation = {
  mode: CanonicalWorkspaceMode | `surface:${string}`;
  /** Ordered sub-levels below the mode, outermost first.
   *  e.g. Chat → ["scope:projects"]
   *       Chat → ["scope:familiar", "session:abc", "cap:skills", "detail:xyz"]
   *       Settings → ["section:appearance", "tab:typography"]  */
  path: readonly string[];
  /** Non-hierarchical view axes at this location (filters, toggles, panes). */
  axes?: Readonly<Record<string, string>>;
  /** A transient overlay stacked on top (modal/drawer/palette/lightbox). */
  overlay?: string;
};

export function locationKey(loc: WorkspaceLocation): string;
export function parseLocation(url: string): WorkspaceLocation | null;
export function serializeLocation(loc: WorkspaceLocation): string;
```

`src/lib/workspace-navigation-history.ts` is already generic over `T` and its
push/move/restore/replace algebra is sound. Keep it. The only change: its
identity comparisons (`===` at :14, :26, :36, :46, :60, :62, :66) must go
through an injected `keyOf: (entry: T) => string`, since entries become objects.
Add the `keyOf` parameter with a default of `String` so existing call sites and
`workspace-navigation-history.test.ts` keep passing while conversion is in
flight.

### 3.2 URL serialization

One canonical shape so every level is deep-linkable and restorable:

```
/?mode=<mode>#<path segment>/<path segment>?<axis>=<value>&…
```

Reuse the existing hash idioms where they exist rather than inventing new ones:
`#chat-<id>` (`lib/workspace-url-state.ts`) and `#grimoire-<kind>:<id>`
(`lib/grimoire-link.ts`) must keep working as input and should keep being
emitted for those levels — `parseLocation` normalizes them into `path`.

### 3.3 Registration hook

```ts
// src/lib/use-surface-history.ts (new)
useSurfaceHistory({
  level: "scope",             // path segment prefix, or axis name
  kind: "path" | "axis" | "overlay",
  value: scope,               // current value
  onRestore: setScope,        // called on traversal — must NOT re-push
  values?: readonly string[], // for validation of inbound deep links
  coalesceMs?: number,        // default 700 for kind:"axis", 0 for kind:"path"
  order?: number,             // depth within the surface, default = mount order
});
```

Contract:

- A **user-initiated** change (the hook sees `value` change while the surface is
  focused and no restore is in flight) **pushes**.
- A change during traversal, deep-link hydration, or `localStorage` restore
  **replaces**. Guard with a ref, mirroring `navigationRestoreRef`
  (`workspace.tsx:356`) and `suppressInitialChatHistoryPushRef` (:357).
- Unmounting a level truncates the path below it — leaving Chat drops
  `session:`/`cap:`/`detail:` segments, matching the existing cleanup at
  `workspace.tsx:2290-2296`.

### 3.4 Overlays

Modals, drawers, sheets, the command palette, and the lightbox become
`overlay` entries: opening pushes, Back closes the overlay **instead of**
navigating, Escape does a `history.back()` so the two paths cannot desync.
Never push more than one overlay entry deep — a modal opening a second modal
replaces. Suppress for overlays with unsaved destructive state (the confirm
dialog, `ui/confirm-dialog.tsx`), which should stay non-navigable.

## 4. Complete conversion table

Every row gets tracked. `kind` picks the semantics from §3.3.

### L1 — mode (already tracked; migrate onto `WorkspaceLocation`)

| Surface | Anchor | Values |
| --- | --- | --- |
| Workspace mode | `workspace.tsx:358` | agents, home, chat, board, inbox, browser, github, marketplace, submissions, grimoire, salem, `surface:<id>` |
| Mobile bottom tabs | `mobile-bottom-tabs.tsx:28` | mirror of L1 — route through the same entry point, do not double-push |

### L2+ — path levels (`kind: "path"`)

| Surface | Anchor | Level / values |
| --- | --- | --- |
| **Chat scope** | `chat-surface.tsx:138`, strip at :358 | `scope:` conversation, projects, canvas, familiar, coven, settings |
| Chat session | `chat-router.tsx:334`, `workspace.tsx:363` | `session:<id>` — already tracked, migrate |
| Familiar capabilities | `chat-familiar-capabilities.tsx:464`, strip :508 | `cap:` identity, skills, mcp, analytics, memory |
| Capability detail | `chat-familiar-capabilities.tsx:659` | `detail:<id>` |
| **Settings section** | `settings-shell.tsx:95`; switch :159 `replaceState`→`pushState`; existing `hashchange` listener :192 restores | `section:` profile, general, daemon, familiars, mobile, appearance, about |
| Settings sub-tabs | `settings-section-tabs.tsx:40` (`SettingsTabbed`) | `tab:<id>` — Appearance, Add-ons |
| Familiar studio tabs | `settings-shell.tsx:110` (`familiarsTabTarget`), `familiar-studio-*-tab.tsx` | `studio:` identity, look, brain, memory, projects |
| Settings mobile drill-down | `settings-shell.tsx:101` (`pickerView`) | list ⇄ section; the in-header Back button must delegate to shell Back |
| **Board** | `board-view.tsx:88` deep link, strip :1021 | `tab:` tasks, queue |
| Board card detail | `board-view.tsx` card open → `task-work-cockpit.tsx` | `card:<id>` |
| **Inbox / Rituals** | `automations-view.tsx:83,130` | `tab:` overview, calendar, crons |
| Rituals overview pane | `automations-view.tsx:142` | `pane:<id>` |
| **Marketplace** | `marketplace-view.tsx:97,702`; `marketplace/marketplace-view-model.ts:11` | `section:` browse, crafts, roles, skills, build, capabilities |
| Marketplace selection | `marketplace-view.tsx:119` (`selected`) | `item:<id>` |
| Craft create drawer | `marketplace/craft-create-drawer.tsx:83,84` | `mode:` describe/extract, `step:` select/… |
| **Grimoire view** | `workspace.tsx:387,462` (`useSurfacePreference`) | `view:` docs, graph, journal |
| Grimoire selection | `grimoire-nav-state.ts:4,46`; add a push variant of `writeGrimoireHash` (:56 is `replaceState`) | `knowledge:<id>` / `memory:<path>` / `journal:<date>`; MRU strip `MAX_OPEN_TABS = 8` (:61) |
| **GitHub detail** | `github-view.tsx:692` (`DetailState`), :798 profile | `item:<id>` |
| **Browser tabs** | `browser-tab-state.ts`, `browser-pane.tsx:95,98` | `btab:<id>` — active tab selection |
| Browser page history | `browser-navigation-queue.ts`, `browser-pane.tsx` | in-pane history; Back should pop the **pane's** stack first, then fall through to the shell stack when the pane is at its root |
| **Researcher desk** | `role-surfaces/researcher-surface.tsx:101` (localStorage `TAB_STORAGE_KEY` :87) | `tab:` prompt, desk, library, studio, resources |
| Research mission rail | `role-surfaces/research-mission-detail.tsx:123` | `rail:` artifacts, sources, … |
| **Familiars view sections** | `familiars-view-sections.tsx:393-397`, strip :566 | `section:` memory, daily-notes, files, sessions, feed |
| **Submissions** | `opencoven-submission-panel.tsx:161` | `type:` runtime, … |
| **Inspector pane** | `inspector-pane.tsx:312` | `ipane:` coven, files |
| Inspector selection | `inspector-pane.tsx:323,326` | `canonical:<id>` / `file:<path>` |

### Axes — previously excluded, now tracked (`kind: "axis"`, coalescing on)

| Surface | Anchor | Axis / values |
| --- | --- | --- |
| Board card-stack filter | `board-card-stack.tsx:61` | `filter=all\|…` |
| GitHub activity filter | `github-view.tsx:2741` | `filter=all\|pr\|review_request\|issue` |
| Marketplace topic filter | `marketplace-view.tsx:374` | `topic=all\|<topic>` |
| Chat artifact viewer | `chat-artifact-viewer.tsx:85,86` | `kind=<ArtifactKind>`, `view=canvas\|code` |
| Canvas add-tile result | `canvas-add-tile.tsx:65` | `result=canvas\|…` |
| Settings search target | `settings-shell.tsx:106,107` | `q=<query>` — coalesce at 1200 ms so typing leaves one entry |

### Overlays (`kind: "overlay"` — Back closes)

`command-palette.tsx` · `directory-picker-modal.tsx` ·
`github-subscriptions-modal.tsx` · `mobile-drawer.tsx` ·
`mobile-handoff-modal.tsx` · `new-card-modal.tsx` · `new-reminder-modal.tsx` ·
`project-settings-modal.tsx` · `project-setup-modal.tsx` ·
`prompt-snippets-modal.tsx` · `save-template-modal.tsx` ·
`session-trace-overlay.tsx` · `shortcuts-sheet.tsx` ·
`skill-detail-drawer.tsx` · `workspace-rail-sheet.tsx` ·
`ui/avatar-lightbox.tsx` · `running-sessions-popover.tsx`

**Excluded by design:** `onboarding-overlay.tsx` (gated first-run flow, owns its
own stepper), `voice-call-overlay.tsx` (live session — Back must not drop a
call), `ui/confirm-dialog.tsx` (destructive confirmation).

## 5. Phasing

Ship one PR per phase; each must keep `Frontend build`, `Rust check`,
`E2E (Playwright)`, `Cross-environment required`, `Sidecar runtime required`,
and `CodeQL` green.

1. ✅ **Foundation.** *Shipped in this PR.* `keyOf` on
   `workspace-navigation-history.ts` (default returns the entry, so the
   comparison stays `===` and no existing call site changes),
   `src/lib/surface-history.ts` as the registry of in-surface levels, and
   `src/lib/use-surface-history.ts` as the hook a strip registers through.
   `goBack`/`goForward` traverse deepest-first — chat session, then registered
   levels, then mode — and `canGoBack`/`canGoForward` subscribe to the registry
   via `useSyncExternalStore` rather than deriving from Workspace state.

   The `WorkspaceLocation` entry model and URL serialization described in §3.1
   and §3.2 are **not** built yet: the registry reaches the levels the
   Workspace could not otherwise see, which is what phases 2–9 need. Adopt the
   location model when a level first has to be addressable by URL — Settings
   (phase 3) is the natural forcing function, since its sections already carry
   a hash.
2. ✅ **Chat scope** (`chat-surface.tsx`) — *shipped in this PR.* The reference
   conversion, and the originally reported bug. `select` records an entry (the
   tab strip, and `cave:inspector-open`, which moves only this level); `show`
   lands without one, which is what every `CHAT_OPEN_*` handoff and
   pending-action latch uses, since those already push on a level the Workspace
   tracks.
3. **Settings** — section, sub-tabs, studio tabs, mobile drill-down.
4. **Board, Inbox/Rituals, Marketplace** — the three surfaces reachable by alias
   deep link, so users currently arrive with no way back.
5. **Grimoire** (view + selection + MRU strip).
6. **Familiar capabilities, Familiars view sections, Researcher desk,
   Submissions, Inspector, GitHub detail.**
7. **Browser pane** — pane-first Back with fall-through.
8. **Axes** (filters, toggles, search) with coalescing.
9. **Overlays.**

## 6. Tests

- **Unit.** Extend `src/lib/workspace-navigation-history.test.ts` for `keyOf`
  and object entries. New `workspace-location.test.ts` covering
  `parseLocation`/`serializeLocation` round-trips, legacy `#chat-<id>` and
  `#grimoire-…` normalization, and truncation when a level unmounts. New
  `use-surface-history.test.ts` covering push-vs-replace, coalescing windows,
  and restore-without-re-push.
- **Per-surface.** Each conversion adds coverage alongside the existing
  convention (`chat-surface-projects-tab.test.ts`,
  `settings-section-tabs.test.ts`, `research-desk-tabs.test.ts`,
  `workspace-sessions-navigation.test.ts`, `familiar-analytics-navigation.test.ts`).
- **E2E.** `E2E (Playwright)` runs daemon-less (`COVEN_CAVE_E2E=1`), so specs
  must be self-contained: dismiss onboarding with `cave:onboarding:dismissed=1`
  and drive surfaces via `page.route(...)` API mocks rather than a live daemon.
  Cover at minimum:
  - Chat → Projects → Canvas → Back → Projects → Back → Sessions → Back → exits Chat; Forward retraces the whole path.
  - Settings → Appearance → a sub-tab → Back twice returns to the section list.
  - Deep link to `?mode=calendar` → Back does **not** land on a synthesized entry and does not leave the app.
  - Open a modal → Back closes it and leaves the underlying location untouched.
  - Tap four filter chips quickly → one or two entries, not four (coalescing).

## 7. Acceptance criteria

- Back from any level in §4 moves up exactly one level; Forward retraces.
- `canGoBack` / `canGoForward` disable correctly at both ends of the stack.
- No traversal ever leaves the app into unrelated webview history.
- Deep links and `localStorage`-restored tabs never synthesize a phantom
  previous entry.
- Every level in §4 is addressable by URL and restores on reload.
- ⌘K palette, mobile bottom tabs, sidebar rows, and `cave:navigate-mode` events
  all route through one entry point and never double-push.
