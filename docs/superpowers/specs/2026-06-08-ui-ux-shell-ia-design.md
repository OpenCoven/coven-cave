# Cave shell + information architecture redesign

**Date:** 2026-06-08
**Status:** Approved (design); plan pending
**Scope:** App-frame only — sidebar, right rail, topbar, bottom slot, system banners, persistence, keyboard. Not surface-level redesign, design tokens, or onboarding.

## Why

Cave's shell currently exposes three overlapping "where work happens" surfaces:

1. **Sidebar modes** — 12+ entries (Home, Agents, Sessions, Tasks/Board, Library, Calendar, Inbox, Schedules, Browser, Terminal, Roles, GitHub).
2. **Right-side agent strip** — a dual-button chat/browser pair with a drag-lock between them, governing what shows in the slide-out agent pane.
3. **Floating affordances** — topbar "Chat with Nova" pill, ⌘K command palette, tray-driven openers.

This produces overlapping affordances (three ways to open chat, two ways to reach a browser, sub-tabs inside Agents that duplicate sidebar concepts), and no clear answer to "where am I?" or "who am I working with?" A new user has to learn five navigation paradigms in their first session.

The codebase has the underlying components — `FamiliarRail`, `FamiliarSwitcher`, `AgentPanel`, `InspectorPane`, `agents-memory-view`, the `react-resizable-panels` `Shell` chrome — but they are wired together in a way that grew organically rather than by intent.

This spec consolidates the shell around one clear pattern.

## Goals

- A single mental model: **the avatar rail is who you're with; the sidebar is where you are; the companion rail is about that familiar; the detail is the active surface.**
- One way to do each thing. No two affordances should do the same job.
- Reduce sidebar to a teachable list (≤10 entries, grouped).
- Persistent identity: the active familiar is always visible and switchable in one click.
- Per-familiar memory: switching restores that familiar's last surface and rail state.
- No behavior regressions: every flow possible today must remain possible (ideally faster).

## Non-goals

- Surface-level redesigns (Home composer, chat bubbles, board card density, calendar visuals).
- Design-token / typography / motion language refresh.
- Onboarding rewrite.
- Inspector & Memory tab content design — this spec picks where they live; what they show is a follow-up spec.
- Mobile/Tailscale shell adaptation — desktop-first; mobile follows once desktop lands.

## Design decisions (locked)

| Decision | Choice | Alternatives considered |
|---|---|---|
| Mental model | **Companion shell** — sidebar nav + persistent right rail bound to the active familiar | Strict mode shell (sidebar-only); Workspace shell (IDE-like splittable tabs) |
| Right rail composition | **Lean** — Chat / Inspector / Memory | Maximal (also Browser + Terminal); Split (Chat always on top + swappable tool below) |
| Active-familiar lock-on | **Avatar rail** — leftmost 52px strip, Slack-rooms-style | Topbar pill; sidebar header |
| Sidebar list | **Grouped** — 9 surfaces in Work / Knowledge / Tools, plus Settings | Streamlined (6 + Inbox/Settings) |
| Familiar switching | **Per-familiar last-surface memory** — switching restores that familiar's last view | Always jump to Chat; stay on current surface re-scoped |

## Detailed design

### Zones

The shell has four columns plus a topbar and an optional slide-up bottom slot:

```
┌─────────────────────────────────────────────────────────┐
│  TOPBAR  (brand · breadcrumb · ⌘K search · 🔔 · ⚙)     │
├──────┬───────────┬─────────────────────────┬────────────┤
│      │           │  BANNER STRIP (if any)  │            │
│ 1    │  2        ├─────────────────────────┤  4         │
│ FAM  │  SIDEBAR  │  3  DETAIL              │  COMPANION │
│ RAIL │  (9 in 3) │     (active surface)    │  RAIL      │
│ 52px │  232px    │     flex                │  296px     │
│      │           │                         │            │
│      │           │                         │            │
│      │           ├─────────────────────────┤            │
│      │           │  BOTTOM SLOT (⌃` on)    │            │
└──────┴───────────┴─────────────────────────┴────────────┘
```

Each zone has exactly one job:

1. **Familiar rail** — *who* you're with.
2. **Sidebar** — *where* you are.
3. **Detail** — the active surface.
4. **Companion rail** — *about* the active familiar (Chat / Inspector / Memory).

### Zone 1 — Familiar rail

- **Width:** 52px, always visible (never collapsed).
- **Content:** vertical stack of 32px round avatars, one per familiar in `~/.coven/familiars/`. Order = pinned first, then most-recently-active.
- **Active indicator:** 3px lavender bar at the avatar's left edge.
- **Presence dot** (bottom-right): green = live session, dim = idle, hollow = daemon offline.
- **Unread badge** (top-right, red): count of messages awaiting your reply. Replaces today's ephemeral `response-needed` inbox bridge (`workspace.tsx` lines 648–677) — surfaced where users can act on it.
- **`+` button:** opens onboarding directly to "create familiar". Replaces the chooser-modal indirection.
- **Overflow:** scroll vertically when >7 familiars; pinned ones stay sticky at the top.
- **`≡` at the bottom:** toggles the sidebar (the leftmost icon strip's role today; moves here so the avatar rail persists even when the sidebar is collapsed).
- **Keyboard:** `⌥1`–`⌥9` jumps to the Nth familiar; switching restores that familiar's last surface (per-familiar memory).

### Zone 2 — Sidebar

- **Width:** 232px expanded, 36px icon-only when collapsed (⌘B).
- **Layout:** rows are 28px tall — 12px icon + label + optional badge + optional ⌘N hint.
- **Grouping:** tiny uppercase section labels teach the IA.

```
WORK
  Home              ⌘1
  Chat        ●3    ⌘2
  Board             ⌘3
  Calendar          ⌘4
  Inbox       ●5    ⌘5

KNOWLEDGE
  Library           ⌘6

TOOLS
  Browser           ⌘7
  Terminal          ⌘8
  GitHub                 (gated: config.addons.github)

──────────────────
  Settings          ⌘,
```

- **GitHub** appears only when the existing `config.addons.github` flag is true.
- **No "Sessions" / "Schedules" / "Plugins" / "Agents" / "Tasks" rows** — folded per Section "Surface folds".
- **Collapsed state (⌘B):** sidebar mode list collapses to a 36px icon strip; click any icon expands the sidebar AND navigates.

### Zone 3 — Detail

- The active surface, full-bleed in the remaining width.
- A surface's own header lives inside the pane (e.g., `<h2>Board</h2><span class="sub">Nova · 14 cards</span>`). Nothing in the topbar duplicates it.
- **Banner strip** pins to the very top of the detail pane (above the surface's own header). See "System state" below.

### Zone 4 — Companion rail

- **Width:** 296px default, resizable. Toggle with `⌘J`. Open/closed state persisted **per-familiar**.
- **Header** (always visible at top of the rail):

  ```
  [avatar] Nova ▾                                    ●
           claude-code · ~/.coven/nova
  ```

  - The ▾ caret is an inline switcher (same list as the avatar rail).
  - Status dot mirrors the avatar rail.

- **Tab strip** (3 tabs):

  | Tab | Content | Replaces |
  |---|---|---|
  | **Chat** (default) | Active thread with this familiar + composer | Today's `AgentPanel` content |
  | **Inspector** | Active session's run timeline: tool calls, status, latency, last turn metadata | Today's `InspectorPane` content |
  | **Memory** | Latest 20 memory writes + link to open the full 3D constellation in the detail pane | Today's `agents-memory-view` content (slim variant — don't render 3D at 296px) |

  Tab scroll state preserves per-tab. Switching is instant (shared familiar context).

- **Empty / edge states:**

  | Condition | Behavior |
  |---|---|
  | No familiar exists | Header shows "No familiar yet" + `+ Create one` opening onboarding; tabs hidden. |
  | Daemon offline | Header keeps identity; tabs greyed; composer disabled with inline "Start daemon" CTA. |
  | Familiar exists, no threads yet | Chat tab shows composer with "Say hello to Nova" placeholder. No empty illustration. |

- **Switching familiar:** click an avatar (or use the header ▾) → rail re-binds; Chat tab shows that familiar's most recent thread (or empty composer if none); active tab choice (Chat/Inspector/Memory) is preserved cross-familiar.

### Topbar

```
[CovenCave]   Board › All cards          🔎 Search · jump…  ⌘K     🔔 5   ⚙
```

- **Brand** (left, lavender) → click returns to Home.
- **Breadcrumb** → first segment = surface name (matches sidebar); second segment = sub-context. Each segment clickable.
- **Search pill** (center-right) → `⌘K` opens `CommandPalette`; pill is also clickable.
- **Inbox bell** → badge count = unresolved escalations (already wired). Click = small popover with 5 latest items + "Open inbox" link.
- **Settings cog** → opens Settings in the detail pane (no route push — preserves rail/sidebar context).

What's **not** in the topbar: active familiar (in zone 1 + zone 4); daemon status (banner); "Chat with Nova" pill (removed); window controls (Tauri handles).

### System state — banner strip

Banners pin to the top of the detail pane (between topbar and the surface's own header). Dismissed only by resolving the underlying state.

| Severity | When | Visual | Inline CTA |
|---|---|---|---|
| **error** | Sidecar/daemon auth failed; config invalid | red 12% bar, red icon | "Open settings" |
| **warning** | Daemon offline; runtime not detected; sync stalled | amber 10% bar, amber icon | "Start daemon" / "Run setup" |
| **info** | Update available; demo mode active; first-run hints | lavender 8% bar | "Restart" / "Open onboarding" |

Multiple banners stack: error → warning → info. Each row is one line; long messages truncate.

A `useShellBanners()` context store backs the channel. Existing surfaces (`SidecarAuthBridge`, daemon-status polling in `workspace.tsx`) push banners through it. No new infra.

### Bottom slot

- Slide-up panel hosting a single PTY. Default collapsed. Drag handle on top edge; height persisted globally.
- `⌃\`` toggles from any surface.
- The Terminal sidebar surface is the multi-pane manager. Navigating to it auto-collapses the slide-up — no double terminal.
- Slot has no tabs, no list, no header beyond a 1-line strip (PTY name + size + ×).

### Keyboard shortcut map

| Chord | Action |
|---|---|
| `⌘K` | Command palette |
| `⌘B` | Toggle sidebar |
| `⌘J` | Toggle companion rail |
| `⌃\`` | Toggle bottom terminal |
| `⌘,` | Open Settings |
| `⌘N` | New chat (when Chat surface or rail Chat tab is focused) |
| `⌘1`…`⌘8` | Jump to sidebar surface (Home / Chat / Board / Calendar / Inbox / Library / Browser / Terminal) |
| `⌥1`…`⌥9` | Jump to Nth familiar in the avatar rail |
| `⌘↑` / `⌘↓` | Cycle familiars up/down |
| `⌘↩` | Send message in any composer |
| `Esc` | Close palette/popover; clear focus from composer |

Existing chords (`⌘B`, `⌘J`, `⌃\``, `⌘K`) keep their bindings. New additions: `⌘1`–`⌘8`, `⌥1`–`⌥9`, `⌘↑/↓`, `⌘N`.

### Persistence model

| State | Scope | Storage key |
|---|---|---|
| Active familiar | global | `cave:active-familiar` |
| Per-familiar last surface | per-familiar | `cave:familiar:{id}:last-surface` |
| Sidebar collapsed | global | `cave:shell.sidebar.collapsed` |
| Companion rail open/closed | per-familiar | `cave:familiar:{id}:rail.open` |
| Companion rail active tab | global | `cave:rail.tab` |
| Pane widths | global | existing `cave.shell.widths.v1` |
| Bottom slot height & open | global | existing `cave.shell.bottom.v1` |
| Avatar rail pin order | global | `cave:familiar-rail.order` |

All new keys use the `cave:` prefix. Reads tolerate corrupted JSON the way `shellStorage` in `shell.tsx` already does.

## Migration

Five phases, each independently shippable.

### Phase 1 — Avatar rail + sidebar reorg

- Promote `FamiliarRail` (`src/components/familiar-rail.tsx`) into the leftmost 52px strip. The existing `IconNavStrip` in `workspace.tsx` is replaced.
- Reorganize `SidebarMinimal` into Work / Knowledge / Tools / Settings.
- Renames: **"Tasks" → "Board"**, **"Agents" → "Chat"**, **"Roles" → moved into Settings**.
- Move the sidebar-toggle button from the left-edge icon strip to the avatar rail's `≡` at bottom.
- Add persistence: `cave:active-familiar`, `cave:familiar:{id}:last-surface`.

### Phase 2 — Companion rail unification

- Remove dual chat/browser strip from `shell.tsx` (`agentExtra` prop) and the drag-lock pointer logic in `workspace.tsx` (lines ~922-969).
- Companion rail becomes one component with three tabs (Chat / Inspector / Memory).
- Chat tab keeps `AgentPanel`. Inspector tab lifts `InspectorPane` content. Memory tab lifts the slim variant of `agents-memory-view`.
- Browser is no longer a rail target. Drop `shellAgentPane` and `stripLock` state.
- `⌘J` toggles the unified rail; per-familiar open/closed persisted.

### Phase 3 — Surface folds

| Today's mode | Becomes |
|---|---|
| `agents` (Chats/Floor/Memory sub-tabs) | `chat` surface (chats list only); Memory → rail; Floor → ambient widget in Home |
| `sessions` | Sub-view of `chat` (shown when no thread is open) |
| `schedules` (Automations) | Tab inside `inbox` surface |
| `plugins` (Roles) | Settings · Plugins |
| `projects` | Sub-tab of `library` |
| `tasks` (Board) | Renamed `board` surface |
| `home`, `library`, `calendar`, `inbox`, `browser`, `terminal`, `github`, `settings` | Unchanged (modulo Inbox/Library gaining sub-tabs) |

The router in `workspace.tsx` shrinks from 12+ branches to 9. Underlying view components (`SessionsView`, `AutomationsView`, `PluginsView`) are kept and re-imported by their new homes.

### Phase 4 — Topbar + banners + shortcuts

- New topbar layout per "Topbar" above; remove the `⌘J` "Chat with Nova" pill.
- Introduce `useShellBanners()`; migrate the daemon-offline banner from `agents-view` into it so it pins across all surfaces.
- `SidecarAuthBridge` pushes auth-error banners into the same channel.
- Add keybindings: `⌘1`–`⌘8`, `⌥1`–`⌥9`, `⌘↑/⌘↓`, `⌘N`.

### Phase 5 — Polish & cleanup

- Avatar rail overflow (>7 familiars: scrollable, pinned sticky).
- Rail empty state ("Create one" CTA).
- Bottom slot auto-collapse when navigating to Terminal surface.
- One-time localStorage migration: rename pre-existing keys, sweep orphans.
- Delete: `IconNavStrip`, `stripLock` state, `shellAgentPane` state; `agentLabel` / `agentIcon` / `agentExtra` props on `Shell`; topbar `⌘J` pill; any code in `workspace.tsx` whose sole purpose was the dual right-strip.

## Tests to preserve

Each phase must keep these passing:

- `familiar-switcher.test.ts`
- `agents-view.test.ts`, `agents-chat-switching.test.ts`, `agents-memory-graph.test.ts`
- `chat-list-panel.test.ts`, `chat-router-switching.test.ts`, `chat-send-routes-links.test.ts`
- `sidebar-minimal.test.ts`
- `workspace-inspector-mount.test.ts`, `workspace-sessions-navigation.test.ts`
- `mobile-shell-smoke.test.ts`
- `home-composer.test.ts`
- `inspector-inbox.test.ts`

New tests to add per phase are covered in the implementation plan.

## Open questions

- **Avatar rail width on dense familiar lists.** 52px works for ≤7. Beyond that, scroll is the answer, but we may want a denser 40px variant once we see real user counts. Decision deferred to Phase 5 polish based on user telemetry / feedback.
- **Settings as a surface vs a route.** Today it's a Next route (`/settings`). Spec proposes it stays a surface in the detail pane to preserve rail/sidebar context. If there are deep-link reasons to keep the route, surface-mode can be additive (route opens the surface). Confirm during Phase 4.
- **Floor as a Home widget.** Tonally the right call (ambient presence on cold start), but visual size is unspecified. Belongs to the future Home surface redesign spec, not this one.

## Reference: file impact at a glance

| File | Change |
|---|---|
| `src/components/shell.tsx` | Add fifth zone slot for the avatar rail; remove `agentExtra` / `agentLabel` / `agentIcon` props |
| `src/components/workspace.tsx` | Major: mode router shrinks; remove `IconNavStrip`, `stripLock`, `shellAgentPane`; wire avatar rail; new keybindings |
| `src/components/sidebar-minimal.tsx` | Regroup mode list (Work / Knowledge / Tools); rename items; move Settings to bottom |
| `src/components/familiar-rail.tsx` | Promote to leftmost 52px zone; add presence/unread badges; `+` and `≡` buttons; overflow handling |
| `src/components/agent-panel.tsx` | Becomes Chat-tab content of unified companion rail |
| `src/components/inspector-pane.tsx` | Becomes Inspector-tab content |
| `src/components/agents-memory-view.tsx` | Slim variant becomes Memory-tab content |
| `src/components/agents-view.tsx` | Strip Floor + Memory sub-tabs; remaining content becomes the Chat surface |
| `src/components/sessions-view.tsx` | Used as Chat surface's "History" sub-view (no route entry) |
| `src/components/automations-view.tsx` | Used as Inbox surface's "Schedules" tab (no route entry) |
| `src/components/plugins-view.tsx` | Used inside Settings (no route entry) |
| `src/components/coven-floor-mini.tsx` | Embedded in Home surface as ambient widget |
| New: `src/lib/shell-banners.ts` | `useShellBanners()` channel for system state |
| New: `src/lib/familiar-memory.ts` | Per-familiar last-surface + rail state persistence helpers |
