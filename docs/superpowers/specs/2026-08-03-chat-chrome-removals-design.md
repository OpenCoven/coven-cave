# Redundant Chat chrome removals

## Context

Two Chat surfaces expose persistent context controls that no longer earn their
space:

- Web solo chats render a `ChatParticipants` cluster containing the active
  familiar avatar, a `Solo` label, and a dashed add-familiar button.
- iOS started chats can render a read-only Project band above the composer,
  including the current project and “Start a new chat to use another project.”

Both elements repeat context already established elsewhere. The web Chat
surface has a dedicated Group path for existing coven conversations, while iOS
selects project provenance during New Chat and must only reopen selection when
an unsent thread can still change it.

The first implementation removed more than presentation: the deleted web `+`
was the only keyboard-reachable action that promoted the current solo thread
into a coven. Rail drag/drop preserved the mutation for pointer users, but the
Group surface cannot carry a solo thread until that coven already exists. The
follow-up must restore that capability without restoring the redundant header
cluster.

## Decision

Remove the complete web solo-participants cluster from the Chat title row.
Delete the unused component and its dedicated styling instead of hiding it.
Keep participant management on the existing Group chat surface. Relocate solo
thread promotion into the existing Session options overflow: when another
familiar is eligible, list each candidate under `Start a coven with` and invoke
the existing promotion callback when one is selected. Opening Session options
and selecting a familiar completes the action in two interactions, with native
menu keyboard semantics and no new persistent header chrome.

On iOS, remove only the read-only locked Project presentation from started
chats. Keep `ChatProjectPicker` for New Chat and for mutable recovery when an
unsent or stale thread requires an explicit project. A started thread’s server
session remains authoritative; this change removes its redundant presentation,
not its stored project provenance.

## Web implementation boundary

- Remove the `ChatParticipants` import and render call from `ChatView`.
- Preserve `ChatView`'s promotion plumbing for both rail drag/drop and the
  accessible Session options action.
- Delete `chat-participants.tsx` and the corresponding participant-cluster CSS.
- Replace the former positive source pins with focused absence coverage that
  protects the quieter title row, the two-interaction Session options path,
  rail drag/drop, and Group participant management.
- Compute eligible promotion candidates with the existing
  `addableFamiliars` rule and pass only those candidates plus the promotion
  callback into `SessionOverflowMenu`.
- Render no coven-promotion section when there are no eligible candidates.
- Render each candidate as an enabled `PopoverItem` in the existing menu so
  Enter, Space, pointer selection, Escape, and focus return remain owned by the
  shared popover primitives.
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

The removed participant identity and `Solo` label remain absent. The unique
solo-thread promotion capability moves to Session options rather than being
removed: its candidates are ordinary menu items reachable in two interactions
by keyboard, pointer, or assistive technology. Selection closes the menu,
promotes the current thread through the existing persistence and handoff path,
and uses the existing live-region announcement. Rail drag/drop remains an
optional pointer shortcut, not the sole affordance. iOS project choice remains
in New Chat and reappears only when the current thread can act on it.

## Verification

- Run the focused web Chat source-contract test with Node’s TypeScript strip
  support, first proving the accessibility assertion fails and then passes.
- Run `scripts/ios-chat-project-contract.test.mjs`.
- Run `pnpm lint`, `pnpm typecheck`, `pnpm check:tests-wired`, and
  `git diff --check`.
- Run the complete app and API suites required by the branch-to-merge gate.
- Verify the web title row and iOS composer region visually when the native
  development surfaces are available.

## Non-goals

- Redesigning the web Chat title row or Group chat.
- Removing project selection or project provenance from iOS.
- Changing coven promotion eligibility, persistence, handoff, or announcement
  semantics.
- Altering message routing, session creation, access control, or persistence.
