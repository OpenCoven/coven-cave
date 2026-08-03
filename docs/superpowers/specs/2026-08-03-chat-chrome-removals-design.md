# Redundant Chat chrome removals

## Context

Two Chat surfaces expose persistent context controls that no longer earn their
space:

- Web solo chats render a `ChatParticipants` cluster containing the active
  familiar avatar, a `Solo` label, and a dashed add-familiar button.
- iOS started chats can render a read-only Project band above the composer,
  including the current project and “Start a new chat to use another project.”

Both elements repeat context already established elsewhere. The web Chat
surface has a dedicated Group path for coven conversations, while iOS selects
project provenance during New Chat and must only reopen selection when an
unsent thread can still change it.

## Decision

Remove the complete web solo-participants cluster from the Chat title row.
Delete the unused component and its dedicated styling instead of hiding it.
Keep coven creation and participant management on the existing Group chat
surface.

On iOS, remove only the read-only locked Project presentation from started
chats. Keep `ChatProjectPicker` for New Chat and for mutable recovery when an
unsent or stale thread requires an explicit project. A started thread’s server
session remains authoritative; this change removes its redundant presentation,
not its stored project provenance.

## Web implementation boundary

- Remove the `ChatParticipants` import and render call from `ChatView`.
- Remove participant-cluster-only promotion plumbing from `ChatView` when it
  has no remaining consumer.
- Delete `chat-participants.tsx` and the corresponding participant-cluster CSS.
- Replace the former positive source pins with focused absence coverage that
  protects the quieter title row and confirms Group chat remains the coven
  entry point.
- Leave the remaining session actions, title, search, familiar switching, and
  Group chat implementation unchanged.

## iOS implementation boundary

- Render Chat project recovery only when the thread’s project is still mutable.
- Remove `ChatProjectPicker`’s locked presentation and `locked` state if no
  caller needs it after the Chat change.
- Preserve New Chat’s project requirement, scoped project loading, explicit
  recovery after project errors, persisted `projectRoot`, and send guards.
- Update the wired iOS source contract to assert that started chats do not
  render a locked Project band while mutable recovery remains available.
- Do not change project selection in New Chat, session provenance, API bodies,
  or project access rules.

## Accessibility and behavior

No interactive control is moved to an inaccessible location. Web coven
creation remains available through Group chat. iOS project choice remains in
New Chat and reappears only when the current thread can act on it. Removing the
two passive chrome regions also removes their focus and accessibility nodes;
the surrounding title row and composer retain their existing semantics.

## Verification

- Run the focused web Chat source-contract test with Node’s TypeScript strip
  support.
- Run `scripts/ios-chat-project-contract.test.mjs`.
- Run `pnpm lint`, `pnpm typecheck`, and `git diff --check`.
- Run the app test suite if focused changes expose additional wired coverage.
- Verify the web title row and iOS composer region visually when the native
  development surfaces are available.

## Non-goals

- Redesigning the web Chat title row or Group chat.
- Removing project selection or project provenance from iOS.
- Changing how a solo thread becomes a coven outside the removed web shortcut.
- Altering message routing, session creation, access control, or persistence.
