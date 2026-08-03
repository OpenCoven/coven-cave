# iOS chat IA: familiars-first home, one chat at a time

**Bead:** cave-ru7ay
**Scope:** `apps/ios/CovenCave` only. The web chat surface is untouched.

## Problem

The Chats home shows three competing things at once: a horizontal familiar
rail, a flat list of recent threads across every familiar, and the familiar
list itself. A thread is reachable two ways, the same familiar appears twice
on one screen, and nothing on the page says which conversation you are in.

iMessage answers this with one list of conversations and one focused thread.
This adopts that shape.

## What changes

**1. The Chats home lists familiars and nothing else.**

The familiar row becomes the conversation row: avatar, name, last-message
preview, relative timestamp, unread badge. The horizontal rail and the recent
threads section are removed. Search continues to filter familiars.

```
BEFORE                          AFTER
┌──────────────────────┐        ┌──────────────────────┐
│ (◆)(◆)(◆)(◆)  rail   │        │ Search               │
│ Recent threads       │        ├──────────────────────┤
│   Flow: Branch Pre…  │        │ ◆ Sage           2m  │
│   iteration 1        │        │   Reducing branch…   │
│ Familiars            │        │ ◆ Cody           1h  │
│   ◆ Sage   ◆ Cody    │        │   Ready when you are │
└──────────────────────┘        └──────────────────────┘
```

**2. Tapping a familiar opens its chat directly.**

It lands on that familiar's most recent unarchived session. If the familiar
has no session, it opens a new chat. One tap from list to thread, and exactly
one conversation is on screen.

**3. Session selection moves into the config popover.**

The popover behind the toolbar's sliders button (`ChatModelControl`) gains a
`Session` row beside `Model`, `Runtime` and `Inventory`. It shows the current
session's title and opens the session picker. This mirrors the existing
`Project` row, which already reads *"Start a new chat to use another
project."*

```
┌────────────────────────────────────────┐
│ ▣  Model      Claude Fable 5        ›  │
│ ▤  Runtime    local:/Users/buns/…      │
│ ⓘ  Inventory  Cached inventory         │
│ ✉  Session    Flow: Reducing Branch… › │  ← new
└────────────────────────────────────────┘
```

**4. `FamiliarThreadsView` becomes the session picker.**

It keeps every thread affordance it already owns — pin, mute, archive,
rename, duplicate, export, bulk delete, unread. It is no longer reached by
tapping a familiar; it is reached from the `Session` row. Selecting a thread
returns to the chat with that session active.

## Why this shape

Thread affordances stay in one place. Pin, mute and archive already live in
`FamiliarThreadsView`; the recents list was a second surface for reaching the
same threads without owning those actions. Deleting recents removes the
duplicate path rather than the capability.

Session selection has to live somewhere once the home stops listing sessions.
The config popover is where the other per-chat settings already are, and the
`Project` row establishes the pattern for a setting that is scoped to the
conversation you are in.

## What does not change

- `ChatView` itself. Message rendering, the composer and the toolbar are
  untouched apart from the added `Session` row.
- The familiars list ordering, reordering, presence dots, unread badges and
  search behaviour on the familiars list.
- The web chat surface (`chat-router.tsx`, `chat-list.tsx`). Its `View` state
  machine already focuses one chat; restructuring it needs a different design
  because there is no config popover to hold session selection.

## Files

| file | change |
|---|---|
| `Views/ChatsHomeView.swift` | drop the rail and the recents section; familiar row gains preview + timestamp; tap opens the chat |
| `Views/ChatModelControl.swift` | add the `Session` row |
| `Views/FamiliarThreadsView.swift` | reachable from the `Session` row; returns a selection |
| `State/AppModel.swift` | resolve "most recent unarchived session for familiar" |

## Testing

Swift is not compiled by CI, but web tests read these files as source text, so
they are the gate.

**Coupled to what is being removed — must be updated:**

- `scripts/ios-thread-search.test.mjs` — the only test referencing
  `RecentThreadRow` / `recentThreads` (3 references). Thread search moves to
  the session picker; the assertions move with it.

- `scripts/ios-ipad-split-chats.test.mjs` — two assertions:
  - `.tag(ChatRoute.thread(thread))`, whose only call site is inside
    `ForEach(recentThreads)` (line 299), so it dies with the recents section.
    Thread rows are still tagged in the session picker; the assertion moves
    there.
  - `case .familiar(let familiar): FamiliarThreadsView(familiar:path:)`,
    which asserts the old behaviour directly. On iPad the detail column now
    shows the **chat**, not the thread list — the same shape iMessage uses on
    iPad, and consistent with the iPhone tap.

  Its `open(.familiar(familiar))` assertion **survives**: the comment above it
  says "familiar rail items should drive the selection", but the only call
  site is inside `ForEach(filteredFamiliars)` (line 438) — the familiars list,
  which we keep. The comment is stale; correct it while touching the file so
  the next reader is not misled into thinking the rail is load-bearing.

**Verified not coupled** (they reference `ChatsHomeView` for the familiars
list, theme or presence, none of which change): `ios-archive-threads`,
`ios-chat-restyle`, `ios-chat-project-contract`, `ios-duplicate-thread`,
`ios-familiar-row-actions`, `ios-claude-design-fidelity`,
`ios-motion-polish`, `ios-operator-profile`, `ios-mute-threads`,
`ios-presence-dots`, `ios-pin-threads`, `ios-reorder-familiars`,
`ios-surface-load-discipline`, `ios-theme-list-background`, `ios-thread-rename`,
`ios-unread-badges`.

No test asserts `FamiliarRailItem`, so removing the rail breaks nothing.

**New coverage:**

- The Chats home renders no recents section and no rail.
- A familiar row exposes a last-message preview and timestamp.
- Tapping a familiar targets a session, not a thread list.
- The config popover exposes a `Session` row alongside `Model`, `Runtime`
  and `Inventory`.

Assertions check the behaviour by shape, not by pinned syntax — a regex that
pins a literal spelling breaks on a refactor that changes nothing, which is
how `ios-reconnect-pill.test.mjs` reddened `main` earlier today.

## Risks

**A familiar with no sessions.** Tapping opens a new chat rather than an empty
screen. Covered by a test.

**Losing cross-familiar recency.** The home no longer answers "what did I touch
last, anywhere". The familiar rows carry per-familiar timestamps, so the
information survives at familiar granularity. If a genuine cross-familiar
recency view is wanted later, it belongs behind search, not on the home.

**iPad split.** Checked rather than assumed: `ios-ipad-split-chats.test.mjs`
pins `case .familiar → FamiliarThreadsView` in the detail column, so the iPad
path is genuinely coupled to this change and its assertions move with it (see
Testing). The resulting shape — familiars in the sidebar, the chat in the
detail column — is what iMessage does on iPad, and the split itself,
`.balanced` style, `ContentUnavailableView` placeholder and detail-path reset
all survive untouched.
