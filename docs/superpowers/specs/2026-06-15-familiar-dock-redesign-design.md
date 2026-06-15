# Familiar Dock — Selection Operations Redesign

**Date:** 2026-06-15
**Status:** Approved design, pending implementation plan
**Surface:** The familiar selection strip at the top of the chat rail (above "Search chats…")

## Problem

The familiar selection strip is a row of circular avatars whose operations are
nearly all hidden. Adding, managing, customizing, reordering, and archiving
familiars are buried behind hover-only pencils and right-click context menus.
Presence and unread indicators only appear on hover. There are also two
divergent implementations of the same UI: a rich but *vertical* rail
(`src/components/familiar-avatar-rail.tsx`, 52px column with drag/presence/
unread/add-menu/customize) and a lighter *horizontal* strip
(`RailFamiliarStrip` in `src/components/chat-project-sidebar.tsx`, ~lines
367–418). The horizontal strip in the current UI is the lighter one and lacks
most operations.

This redesign unifies the UI into one **horizontal familiar dock** with
discoverable operations and an overflow popover.

## Goals

- One source of truth for the familiar selection UI (no duplicate strip/rail).
- All selection operations discoverable without hover-hunting or guessing
  right-click: select, create, search, customize, reorder, manage, archive.
- Status (presence, unread) visible at a glance.
- Scales to many familiars via responsive overflow.

## Non-goals

- Changing the Familiar Studio (manage/customize editor) itself — we link to it.
- Changing how familiars are fetched/resolved (`familiar-resolve.ts`,
  `ResolvedFamiliar`) or the daemon data model.
- Persisting the selection filter across reloads (explicitly resets to All).

## Interaction model

**Selecting a familiar = filtering the chat list.** This replaces today's
behavior where clicking an avatar immediately starts a new chat.

- Click an avatar → toggle a filter; the chat list below shows only that
  familiar's chats. The avatar gets the accent ring and a lit label.
- Click the active avatar again, or click the **All** chip → clears the filter.
- The filter is in-memory session state. It **resets to All on reload** (not
  persisted).
- Starting a new chat becomes a separate, explicit action (the **+ New** entry
  in the overflow popover, plus any existing new-chat affordance in the rail).

## Layout — the dock

Horizontal, replacing the current strip, in document order:

```
[ ✦ All ] │ 👑 📚 ✨ 🎚️ ⚙️ … │ [ ··· +N ] [ + ]
```

- **All chip** — leads the dock; represents the no-filter state, highlighted
  when no familiar filter is active.
- **Avatar run** — fills available width **responsively**. As many avatars as
  fit are shown inline; the remainder collapse into the overflow button. Width
  is measured (e.g. `ResizeObserver`) so the inline count adapts to the rail
  width. No fixed inline count.
- **Overflow button `···`** — shows a **+N badge** with the count of familiars
  not currently shown inline. Opens the overflow + operations popover.
- **Add button `+`** — quick-creates a new familiar (existing `onAddFamiliar`).

### Per-avatar appearance

- **Presence dot** (online) and **unread dot** are always visible (subtle), not
  hover-gated. Reuse the existing presence computation (`computePresence`).
- **Name label**: lit for the active (filtered) familiar, dim for others.
  Always rendered — no hover requirement.
- **Active state**: accent ring using the familiar's `color`
  (`--familiar-accent`).

## The overflow + operations popover (`···`)

A popover anchored to the overflow button. Reuses the Command Picker design
from brainstorming direction C.

- **Search field** — filters all familiars by name/role.
- **Grouped rows**:
  - **"Not shown in dock"** — the overflowed familiars (so the popover is the
    way to reach them).
  - **"In dock"** — the inline ones, for completeness/search.
  - Each row: avatar, name, role, unread count, and a per-row **⚙ customize**
    control.
- **Selecting a row** applies the same filter as clicking a dock avatar, then
  closes the popover.
- **Footer actions**:
  - **+ New** — create familiar (same as dock `+`).
  - **⚙ Manage** — opens Familiar Studio list view
    (`openFamiliarStudioListView()`).
  - **⇅ Reorder** — discoverable entry into reorder (see below).

## Operations summary

| Operation | Dock | Popover |
| --- | --- | --- |
| Select (filter) | click avatar | click row |
| Clear filter | click All / active avatar | — |
| Create | `+` button | + New |
| Search | — | search field |
| Customize | right-click avatar | per-row ⚙ |
| Reorder | drag (existing @dnd-kit) | ⇅ Reorder |
| Manage / Archive | right-click → Manage | ⚙ Manage → Studio |

Reorder remains drag-based in the dock (existing @dnd-kit `SortableAvatarItem`).
The popover's **Reorder** is the discoverable path — it surfaces the same
drag-reorder affordance (e.g. enters a reorder mode or focuses the dock for
dragging). Exact reorder UX in the popover is an implementation detail for the
plan; the requirement is that it be discoverable, not hover/guess-only.

## Component plan

- Build a single horizontal **familiar dock** component as the source of truth,
  carrying over the rich logic already in `familiar-avatar-rail.tsx`
  (drag-to-reorder, presence, unread, add-menu, customize, roving tabindex /
  keyboard nav).
- Remove the duplicate `RailFamiliarStrip` path in `chat-project-sidebar.tsx`
  and point the rail at the new dock.
- Keep the existing prop contract shape where possible: `familiars:
  ResolvedFamiliar[]`, `activeId`, `onSelect`, `onAddFamiliar`, plus selection
  now meaning "filter". The chat list consumes the active filter id to filter
  its sessions.
- Styling: extend the existing `.familiar-avatar-rail__*` CSS in
  `src/app/globals.css` (or a renamed dock class set) for the horizontal layout,
  All chip, overflow button, and popover. Reuse `FamiliarAvatar`, `Icon`
  (Phosphor names from the `ICON_NAMES` whitelist).

## Accessibility & keyboard

- Roving tabindex across All chip + avatars + overflow + add (carry over
  existing keyboard nav).
- Avatars: `aria-pressed` reflects active filter; `aria-label` includes the
  familiar name and "filter chats by".
- Popover: focus moves to the search field on open; Escape closes; arrow keys
  move between rows.
- All status conveyed by dots also has text equivalents in labels/aria (unread
  count, online).

## Testing

- Unit test the responsive overflow split (given a container width and avatar
  count, compute inline vs overflow counts) — pure helper, node-testable, wired
  into `test:app` per the repo's `check:tests-wired` guard.
- Component/source-text tests: All chip present, overflow badge count, popover
  groups, footer actions, filter toggle clears on All.
- Live verify in the dev app (desktop chat rail recipe): select filters the
  list, All clears, overflow popover opens and selects, + creates, right-click
  customize works, drag reorder persists.

## Risks

- **Filter vs new-chat behavior change** is a real UX shift — existing muscle
  memory expects click = new chat. Mitigation: the explicit + New action stays
  one click away; the change is intentional and approved.
- **Consolidating two components** risks regressions in whichever surface
  currently renders each. Verify both the rail and any other consumer of
  `RailFamiliarStrip` after consolidation.
