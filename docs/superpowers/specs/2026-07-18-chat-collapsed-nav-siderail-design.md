# Chat collapsed navigation and persistent siderail design

**Date:** 2026-07-18
**Status:** Approved specification; implementation planned
**Bead:** `cave-0oqu`

## Goal

Make Chat preserve conversation context without requiring the full application
navigation panel. On desktop, Chat should open with the global navigation in its
collapsed icon-rail state while a separate Chats siderail remains visible.
Hovering the collapsed navigation or chat rows must not reveal or trigger
actions.

Users must still be able to reopen the global navigation explicitly, and every
chat or project action that previously appeared on hover must remain available
through a durable overflow or context menu.

## Chosen approach

Use an **independent Chat siderail beside route-scoped global navigation**.

The shell continues to own global navigation. Chat receives its own desktop
siderail inside the Chat layout instead of replacing the shell navigation
contents. This produces three stable desktop regions:

1. the collapsed or explicitly opened global navigation;
2. the always-visible Chats siderail;
3. the active conversation.

Rejected alternatives:

- **Reuse the shell panel for Chats:** the application navigation and the Chats
  list cannot both remain visible in the requested collapsed-global/full-chat
  arrangement.
- **Overlay the Chats siderail:** this obscures conversation content and creates
  unstable pointer and keyboard behavior.

## Navigation behavior

- Chat uses route-scoped global-navigation state that defaults to collapsed.
- Entering Chat starts a new Chat visit in collapsed mode.
- The user may explicitly reopen or close global navigation while remaining in
  Chat.
- Leaving Chat preserves the normal non-Chat navigation preference; Chat must
  not overwrite it.
- Returning to Chat starts collapsed again.
- Hovering the collapsed icon rail never peeks or expands it on Chat.
- Normal hover feedback and icon tooltips remain because they explain clickable
  destinations without changing layout or exposing hidden actions.

## Chats siderail

The desktop Chat layout mounts `WorkspaceSidebar` as a dedicated sibling of the
conversation region. It remains visible whether global navigation is collapsed
or open.

- The siderail keeps the current Chats heading, search/filter controls, project
  grouping, selection state, new-chat entry point, and empty/loading states.
- The conversation region shrinks when global navigation is explicitly opened;
  the Chats siderail does not disappear or overlay the transcript.
- Existing sidepanel sizing tokens and compact surface chrome should be reused.
- The narrow `WorkspaceSidebar` reopen rail is not shown in this desktop layout,
  because the full Chats siderail is already persistent.
- Mobile and narrow-window behavior keeps the existing drawer/sheet interaction;
  two permanent left rails are a desktop-only composition.

## Actions and menus

Chat rows and project headers use one quiet, persistent ellipsis button instead
of hover-only controls.

- Clicking the ellipsis opens the row or project action menu.
- Right-clicking the row or project header opens the same menu with the same
  action ordering and disabled states.
- Keyboard activation of the ellipsis opens the menu.
- The menu retains every applicable existing action, including pin/unpin,
  archive/restore, debug/open details, delete, project new-chat, and any existing
  project-management action.
- Destructive actions keep their existing confirmation flow.
- Hidden drag handles are removed. If manual reordering remains supported, the
  persistent overflow menu provides accessible move commands; no second
  hover-only or pointer-only affordance is introduced.
- Age labels, status indicators, and row geometry remain stable while hovering.

The menu implementation should reuse the repository's existing popover/context
menu primitives and action handlers rather than duplicating mutations.

## Component boundaries

### `Shell`

- Separates normal navigation preference from Chat's route-scoped open state.
- Disables hover-to-peek when the active workspace is Chat.
- Continues to expose the explicit navigation toggle.
- Renders the global navigation only; it no longer treats the Chats list as
  replacement global-navigation content on desktop.

### `ChatSurface` / Chat layout

- Owns the desktop composition of Chats siderail plus conversation.
- Keeps mobile drawer behavior behind the existing responsive boundary.
- Does not take ownership of global navigation state.

### `WorkspaceSidebar`

- Renders the persistent desktop Chats siderail.
- Replaces hover-revealed row and project controls with shared overflow/context
  menus.
- Keeps data loading, grouping, selection, and action callbacks unchanged.

If `ChatProjectSidebar` remains mounted for any Chat path, it must use the same
menu contract so the interaction does not vary by route.

## Accessibility

- Overflow buttons have stable accessible names such as
  `Chat actions for <title>` and `Project actions for <name>`.
- Menus support Enter/Space to open, arrow-key navigation, Escape to close, and
  focus restoration to the invoking row or button.
- Right-click is an additional path, never the only path.
- Touch users can open the same actions without hover or long-press.
- Opening or closing global navigation must not move focus unexpectedly.
- The persistent Chats siderail retains its navigation landmark/label and clear
  selected-chat semantics.

## Error handling

- Action failures continue through the existing visible error or toast paths.
- A failed row action leaves the menu or row in an honest recoverable state; it
  must not optimistically remove the only route back to the chat unless the
  existing mutation contract already restores it on failure.
- Layout state must not reset because a chat-list fetch fails. The siderail
  should show its current error state while global navigation remains collapsed
  or explicitly open as selected.

## Testing

Add focused source/behavior tests that pin:

- a Chat visit defaults global navigation to collapsed;
- explicitly reopening navigation works while remaining in Chat;
- leaving Chat preserves the non-Chat navigation preference;
- returning to Chat starts collapsed again;
- hover does not expand the collapsed global navigation on Chat;
- the desktop Chats siderail remains rendered in both collapsed and opened
  global-navigation states;
- narrow/mobile layouts retain the existing drawer behavior;
- chat rows and project headers expose persistent overflow buttons;
- pointer hover does not reveal additional action controls or replace stable row
  content;
- click, keyboard activation, and context-menu invocation use the same action
  definitions;
- all existing row/project actions remain represented, including destructive
  confirmation paths.

Run the smallest existing app test set that covers the changed shell, Chat
layout, and sidebar contracts, followed by typecheck and the repository's test
wiring check.

## Non-goals

- Redesigning the visual language of global navigation.
- Changing Chat search, grouping, sorting, or project ownership semantics.
- Replacing the mobile Chat drawer with permanent rails.
- Refactoring unrelated hover behavior outside global navigation and the Chat
  siderail.
- Adding new chat or project actions.

## Acceptance criteria

1. Desktop Chat opens with a collapsed global icon rail and a visible Chats
   siderail.
2. Global navigation expands only through explicit user action on Chat.
3. Reopening global navigation does not hide or overlay the Chats siderail.
4. No chat-row or project-header action is available only through hover.
5. One persistent overflow per actionable row/header and the matching
   right-click menu expose the same complete action set.
6. Keyboard, touch, and mobile users retain access to all supported actions.
