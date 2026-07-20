# Chat Contextual Sidebar

## Goal

Remove Chat's separate persistent list column and make the primary left
sidepanel contextual: normal app navigation outside Chat, chat organization and
threads inside Chat.

## Desktop behavior

When the workspace enters Chat, `WorkspaceSidebar` replaces `SidebarMinimal` in
the Shell's `nav` slot. The Shell receives no `list` content, so Chat renders as
two panes: one contextual left panel and the conversation surface.

The Chat panel opens at 260px on entry, can be resized within the existing
sidepanel range, and collapses completely rather than becoming an icon rail.
The top-left sidebar toggle and Command-B restore it. The panel's Home control
exits Chat, after which `SidebarMinimal` returns with the normal app
destinations.

The contextual panel keeps the existing Chat capabilities:

- familiar scope
- New chat
- Recent / By project organization
- search
- pinned chats
- project registration
- session open, split, pin, PR, and delete actions
- shared footer

Chat's in-surface thread rail remains hidden, preserving exactly one thread
list.

## Mobile behavior

The Shell's left drawer hosts the same contextual `WorkspaceSidebar` while Chat
is active. There is no separate list drawer or list toggle. Leaving Chat
restores the normal navigation drawer.

## Shell policy

Add a Chat-specific nav policy rather than overloading the global remembered
navigation policy:

- use a separate persisted layout key so normal navigation widths do not
  overwrite Chat's width
- default the Chat panel to 260px
- open it when entering Chat
- use a collapsed size of zero
- retain the existing normal navigation rail behavior on other surfaces

The policy is owned by `Shell`; `Workspace` only selects contextual content and
the policy.

## Accessibility and keyboard behavior

- The panel remains the Shell's `nav` landmark.
- The existing "Chat threads" nested navigation remains unchanged.
- The top-left sidebar toggle accurately announces expand/collapse state.
- Command-B toggles the contextual Chat panel.
- Mobile drawer focus and dismissal continue through the existing Shell
  controls.
- The removed list toggle is not rendered or announced in Chat.

## Tests

Update source-contract tests to prove:

1. Chat passes `WorkspaceSidebar` as `nav` and passes no separate `list`.
2. Non-Chat modes still pass `SidebarMinimal` as `nav`.
3. Chat uses the dedicated open-on-entry, collapse-to-zero Shell policy.
4. The mobile top bar exposes only the nav drawer control in Chat.
5. `hideThreadRail` remains set so no duplicate thread list returns.
6. Existing Chat sidebar organization, session actions, and accessibility
   contracts remain intact.

Run the targeted app tests, typecheck, and the smallest existing suite covering
Shell and Chat wiring.
