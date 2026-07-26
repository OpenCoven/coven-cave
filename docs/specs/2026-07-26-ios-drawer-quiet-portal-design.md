# iOS Drawer Shell and Quiet Portal

Date: 2026-07-26
Status: Approved
Scope: Coven Cave native iOS app

## Context

The Claude Design fidelity pass introduced a global Cave navigation drawer, but
the connected app still mounts a native `TabView` with a bottom tab bar. That
duplicates primary navigation and weakens the authored mobile composition.

The cold connection state also remains a generic spinner with one line of text.
It does not carry the visual quality or identity of the new start page.

## Goals

- Make the custom drawer the sole primary navigation surface on iPhone.
- Keep Chats, Tasks, Terminal, and Settings reachable alongside Projects,
  Familiars, project shortcuts, and recent chats.
- Preserve existing command routing, deep links, keyboard shortcuts, and
  selected-destination state.
- Replace the generic cold-connection spinner with the user-selected
  **Quiet Portal** direction.
- Keep connection status honest: indeterminate progress, the real saved host,
  and no fabricated stages or completion percentage.

## Non-goals

- No connection lifecycle, retry, discovery, or authentication changes.
- No redesign of the explicit Connect screen or the reconnect pill.
- No new top-level destinations.
- No persistent hidden copies of every destination view.

## Navigation design

`MainShellView` replaces the stale `MainTabView` name and no longer contains a
SwiftUI `TabView`. A private selected-destination builder switches over the
existing `AppTab` value and mounts exactly one of:

- Chats
- Tasks
- Terminal
- Settings

The shared `CaveNavigationDrawer` stays above that selected destination. Its
existing rows become the complete primary navigation contract. Every selected
surface retains its current menu button, so the drawer remains reachable
without a bottom bar.

`AppTab` remains the routing value because slash commands, task/chat handoffs,
debug launch arguments, and keyboard shortcuts already use it. The semantically
stale `barTabs` collection becomes `drawerDestinations`; shortcut order derives
from the same list. Tests describe drawer placement rather than tab placement.

Using a selected destination is preferred over hiding a system tab bar because
toolbar visibility can be overridden by descendants and behave differently
across compact and regular size classes. Keeping all destinations alive in a
layered stack is rejected because hidden views would continue running their
tasks and network work.

## Quiet Portal design

The cold connection state is a full-screen, centered composition on the active
theme background:

1. A small Cave moon mark sits inside a restrained radial accent glow.
2. The serif, italic headline reads **Opening the Cave**.
3. Supporting copy reads **Connecting to your desktop**.
4. An indeterminate three-dot signal follows.
5. The real saved desktop host appears below in monospaced secondary text.

The composition deliberately stays sparse. It carries the visual language of
the empty-chat sigil without repeating that larger surface or showing controls
that cannot affect an in-flight connection.

The dots advance with a soft opacity emphasis when Reduce Motion is off. With
Reduce Motion enabled, they render as a static center-accented signal. The
entire state exposes one accessibility label and the saved host as its value;
decorative marks and dots stay hidden from assistive technology.

The host truncates in the middle and never substitutes fictional device data.
`ConnectingView` is only mounted when a saved `CaveConnection` exists, but the
layout still handles an absent host without leaving a dangling status line.

## State and failure behavior

No new state machine is introduced:

- `.checking` with a saved connection and no loaded surfaces shows Quiet Portal.
- `.connected` transitions into the selected drawer destination.
- `.unreachable` before surfaces load returns to the actionable Connect screen.
- Transient drops after content loads continue using the existing reconnect
  pill and cached surfaces.

Slow connections remain indeterminate. The page does not claim encryption,
pairing, workspace sync, or staged progress the runtime cannot currently prove.

## Verification

Source-contract coverage will pin:

- no `TabView` or `Tab` declarations in the connected shell;
- all `AppTab` values appear exactly once in `drawerDestinations`;
- the drawer contains Chats, Tasks, Terminal, and Settings;
- selected-destination routing covers every `AppTab`;
- Quiet Portal copy, live host rendering, reduced-motion branch, and
  accessibility semantics.

A deterministic debug launch fixture will render the connecting state without
network access for simulator inspection. Final validation includes:

- `pnpm lint`
- `pnpm test:mobile`
- full `CovenCaveTests`
- `git diff --check`
- iPhone simulator screenshots of Quiet Portal and the tab-free start page
- an independent source and generated-Xcode review before PR delivery

## Acceptance criteria

- No bottom mobile tab bar is visible.
- Every former bottom-tab destination opens from the custom drawer.
- Drawer-driven routing continues to work from slash commands, shortcuts, and
  cross-surface handoffs.
- The cold connection screen matches Quiet Portal, displays the saved host,
  remains honest during arbitrary connection time, and respects Reduce Motion.
- Existing composer drafts survive marketplace handoff.
- All required local and PR checks pass with zero unresolved review
  conversations before squash merge.
