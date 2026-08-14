# Navigation history tracking — inventory and implementation prompt

**Status:** proposal / implementation brief
**Problem:** the shell's Back/Forward buttons (`DesktopHistoryNav`) only traverse
two of the app's navigation levels. Every in-surface tab strip, section picker,
and drill-down is invisible to them, so Back from a deep sub-tab throws the user
out of the whole surface instead of stepping back one level.

---

## 1. What is tracked today

Two levels, and only two:

| Level | What | Where | Mechanism |
| --- | --- | --- | --- |
| L1 | Workspace mode (`CaveMode` — Home, Chat, Board, Inbox, Browser, GitHub, Marketplace, Submissions, Grimoire, Salem, Agents) | `src/components/workspace.tsx` (`navigationHistoryRef`) | In-memory stack via `src/lib/workspace-navigation-history.ts` |
| L2 | Chat session id, within Chat only | `src/components/workspace.tsx` (`chatNavigationHistoryRef`) + `src/components/chat-router.tsx:334` | The **only** `history.pushState` in the app; `#chat-<id>` hash |

`DesktopHistoryNav` (`src/components/desktop-history-nav.tsx`) calls
`window.history.back()` / `.forward()`. `Workspace` owns the `popstate` listener
and decides whether the pop belongs to the chat stack or the mode stack
(`workspace.tsx:2283`), exposing `canGoBack` / `canGoForward` to `Shell` at
`workspace.tsx:3254`.

Everything else that writes the URL uses `history.replaceState` — deep-linkable,
but it deliberately creates **no** history entry:

- `settings-shell.tsx:159,165` — `/settings#<section>`
- `grimoire-nav-state.ts:51,56` and `lib/grimoire-link.ts:26` — `#grimoire-…`
- `lib/workspace-url-state.ts:16,31` — `?mode=` cleanup
- `board-view.tsx:315`, `code-view.tsx:105`, `chat-router.tsx:343` — deep-link cleanup

So the rule today is: **mode and chat session push; nothing else does.**

## 2. Hierarchical inventory of navigable levels

Legend: **[T]** tracked today · **[U]** untracked, *should* be tracked ·
**[X]** untracked and should stay that way (view filter, not navigation).

```
L0  Shell / route
    ├── / (workspace)                                          [T]
    ├── /settings                                              [T] (route change)
    ├── /familiars/[id], /familiars/growth                     [T] (route change)
    └── /dashboard, /profile, /proposals, /retro, /weaves,
        /daily-report, /quick-chat, /aesthetic                 [T] (route change)

L1  Workspace mode — sidebar nav rows + ⌘K palette + ?mode=    [T]
    agents · home · chat · board · inbox · browser · github ·
    marketplace · submissions · grimoire · salem
    (alias modes groupchat/journal/flow/calendar/
     familiar-work-queue/roles/capabilities/code resolve into a
     canonical mode *and a specific L2 tab* — see MODE_ALIASES
     in src/lib/workspace-mode.ts)

L2  Per-surface tab strip / section picker
    ├── Chat  → src/components/chat-surface.tsx:358 (FamiliarsScope)
    │   Sessions · Projects · Canvas · Familiar
    │   (+ non-visible scopes: coven, settings)                 [U]  ← the screenshot
    │   └── L3 Chat session id                                  [T]
    │       └── L4 Familiar capabilities sections
    │           src/components/chat-familiar-capabilities.tsx:508
    │           Identity · Skills · MCP · Analytics · Memory     [U]
    │           └── L5 capability detail (`detailId`, :659)      [U]
    ├── Board → src/components/board-view.tsx:1021
    │   Tasks · Queue  (alias `familiar-work-queue` → Queue)     [U]
    │   ├── L3 Card stack filter (board-card-stack.tsx:61)       [X] filter
    │   └── L3 Card detail / task-work cockpit                   [U]
    ├── Inbox (Rituals) → src/components/automations-view.tsx:83
    │   Overview · Calendar · Crons (alias `calendar` → Calendar) [U]
    │   └── L3 Overview pane (`overviewPane`, :142) log/…         [U]
    ├── Marketplace → src/components/marketplace-view.tsx:702
    │   browse · crafts · roles · skills · build · capabilities
    │   (aliases `roles`, `capabilities` land here)               [U]
    │   ├── L3 Selected plugin/craft (`selected`, :119)           [U]
    │   └── L3 Craft create drawer step
    │       marketplace/craft-create-drawer.tsx:83-84             [U]
    ├── Grimoire → GrimoireSelection (grimoire-nav-state.ts:4)
    │   view: docs · graph · journal                              [U]
    │   └── L3 open document / memory / journal date
    │       (own MRU tab strip, MAX_OPEN_TABS = 8, replaceState)  [U]
    ├── GitHub → github-view.tsx:2741
    │   all · pr · review_request · issue                         [X] filter
    │   └── L3 PR / issue detail, profile popover                 [U]
    ├── Browser → browser-tab-state.ts + browser-navigation-queue [U] own stack,
    │   (per-pane tab list and in-pane page history)                  not wired to L1
    ├── Salem / Submissions / Agents                              [U] check per-surface
    └── Role Surfaces (`surface:<id>` modes)
        ├── Researcher desk → role-surfaces/researcher-surface.tsx:101
        │   prompt · desk · library · studio · resources
        │   (localStorage-persisted, not history)                 [U]
        │   └── L3 Mission detail rail
        │       research-mission-detail.tsx:123
        │       artifacts · sources · …                           [U]
        └── Code workshop (alias `code`)                          [U]

L2' Settings sections → settings-shell.tsx:95 (replaceState only)
    Profile · General · Daemon · Familiars · Phone · Appearance · About  [U]
    ├── L3 SettingsTabbed sub-tabs (settings-section-tabs.tsx:40)
    │   e.g. Appearance and Add-ons split into tabs                      [U]
    ├── L3 Familiars → familiar studio tabs
    │   identity · look · brain · memory · projects
    │   (familiar-studio-*-tab.tsx, `familiarsTabTarget` :110)           [U]
    └── L3 Mobile drill-down (`pickerView`, :101) — list ⇄ section       [U]
        (has its own in-header Back button; should be the OS/shell Back)

L2'' Familiars view sections → familiars-view-sections.tsx:393
     Memory · Daily Notes · Files · Sessions · Feed                      [U]

Panes / inspectors (secondary axis, not the main stack)
    ├── Inspector pane → inspector-pane.tsx:312  coven · files           [U]
    │   └── selected canonical id / open file path                       [U]
    ├── Chat artifact viewer → chat-artifact-viewer.tsx:86 canvas · code [X] toggle
    ├── Canvas add-tile result tab → canvas-add-tile.tsx:65              [X] toggle
    └── Mobile bottom tabs (mobile-bottom-tabs.tsx) — L1 mirror          [T] via L1
```

### Should-be-tracked, ranked

1. **Chat L2 scope** (`Sessions / Projects / Canvas / Familiar`) — the reported
   case. Highest traffic tab strip in the app.
2. **Settings sections** — already hash-addressable; only needs `pushState`
   instead of `replaceState`, plus a `hashchange`/`popstate` restore path (the
   listener already exists at `settings-shell.tsx:192`).
3. **Marketplace sections** and **Board Tasks/Queue** — both already have alias
   modes pointing at specific tabs, so a user can arrive by deep link and then
   has no way back.
4. **Grimoire selection** — has a hash and an MRU tab strip; `writeGrimoireHash`
   just needs a push variant.
5. **Familiar capability sections**, **Researcher desk tabs**, **Familiars view
   sections** — deeper, lower traffic, same pattern.

### Explicitly out of scope

Filter chips and A/B toggles (`[X]` above) are view state, not navigation.
Pushing history for them makes Back feel broken in the other direction.

## 3. Implementation prompt

> Wire the workspace Back/Forward controls to the app's sub-surface navigation
> so that Back steps *up one level* rather than out of the whole surface.
>
> **Read first:** `src/lib/workspace-navigation-history.ts`,
> `src/components/workspace.tsx` (search `navigationHistoryRef`,
> `chatNavigationHistoryRef`, the `popstate` listener near line 2283, and the
> `historyNavigation` prop passed to `Shell` near line 3254),
> `src/components/chat-router.tsx:320-350` (the app's only `pushState`),
> `src/components/desktop-history-nav.tsx`, and §2 of this document.
>
> **Design constraint that already exists and must be preserved:** the workspace
> only asks the browser to traverse entries *it recorded* — a direct `#chat-…`
> launch must never walk out into unrelated webview history (see the comment at
> `workspace.tsx:360`). Any new level has to keep that property.
>
> **Do this:**
>
> 1. Generalize the two ad-hoc stacks into one ordered navigation stack whose
>    entries are a discriminated union describing a *location*, not a mode:
>    `{ mode: CanonicalWorkspaceMode; tab?: string; detail?: string }`. Keep
>    `workspace-navigation-history.ts`'s push/move/restore/replace algebra —
>    it is already generic over `T` — but replace its identity comparison
>    (`===`) with a key function, since entries become objects.
> 2. Add a small hook (`useSurfaceHistory` or similar) that a surface calls to
>    register its tab strip: it takes the current tab, a setter, and a
>    serializer, pushes an entry on user-initiated changes, and restores on
>    traversal. Programmatic/deep-link-driven tab changes must `replace`, not
>    `push` — mirror `suppressInitialChatHistoryPushRef`.
> 3. Convert surfaces in the ranked order above. Start with **Chat's
>    `FamiliarsScope`** (`chat-surface.tsx:138`) as the reference
>    implementation, then **Settings sections** (`settings-shell.tsx:95`;
>    switch line 159 from `replaceState` to `pushState` and make the existing
>    `hashchange` listener at line 192 restore without re-pushing).
> 4. Make alias modes land on the right entry: `MODE_ALIASES` in
>    `src/lib/workspace-mode.ts` already maps `groupchat`→Chat Group tab,
>    `calendar`→Rituals Calendar, `familiar-work-queue`→Board Queue,
>    `roles`/`capabilities`→Marketplace sections. Those should produce a
>    `{ mode, tab }` entry directly instead of a mode entry plus a silent tab
>    set.
> 5. Do **not** push history for the `[X]` items in §2 (filters and toggles).
> 6. Update `canGoBack` / `canGoForward` so the buttons disable correctly at the
>    ends of the unified stack, and keep the mobile bottom tabs and ⌘K palette
>    routing through the same entry-point.
>
> **Tests.** Extend `src/lib/workspace-navigation-history.test.ts` for the
> object-entry key function. Add unit coverage next to each converted surface
> (`chat-surface-*.test.ts`, `settings-*.test.ts` conventions already exist).
> Add a Playwright spec asserting: open Chat → Projects tab → Canvas tab → Back
> returns to Projects, Back again to Sessions, Back again leaves Chat; Forward
> retraces. Remember `E2E (Playwright)` runs daemon-less (`COVEN_CAVE_E2E=1`) —
> dismiss onboarding via `cave:onboarding:dismissed=1` and drive the surface
> with `page.route(...)` API mocks, not a live daemon.
>
> **Ship in slices.** One PR per level is fine and preferred: the stack
> generalization + Chat scope first, then Settings, then the rest. Each PR must
> keep `Frontend build`, `Rust check`, `E2E (Playwright)`,
> `Cross-environment required`, `Sidecar runtime required`, and `CodeQL` green.
