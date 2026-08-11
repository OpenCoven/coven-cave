# iOS familiar-scoped New Chat design

## Problem

Starting a new chat from a familiar's thread list opens the general New Chat
sheet. The familiar is preselected, but the full familiar roster remains
visible, forcing a redundant selection step. If the familiar has no project
returned by the scoped project lookup, the sheet shows a dead-end message and
the user cannot repair access without leaving the flow.

## Goals

- Treat the familiar chosen before opening New Chat as fixed for that launch.
- Skip the familiar roster when the launch is familiar-scoped.
- Load only projects the fixed familiar is authorized to use.
- Preserve recent-project selection and first-turn project provenance.
- Provide an in-flow path to repair project access and retry the lookup.
- Keep the existing general New Chat flow capable of selecting one or more
  familiars.

## Design

`NewChatView` gains an explicit selection mode:

- General mode starts with an optional preselection and renders the familiar
  roster exactly as it does today.
- Fixed mode receives one familiar ID, initializes selection from it, hides the
  familiar roster, and does not expose controls that can change the selected
  familiar.

`FamiliarThreadsView` and familiar-specific launch actions use fixed mode.
Global compose actions resolve the visible Chats route before presenting:

- a selected familiar fixes that familiar;
- a selected direct thread fixes its sole familiar;
- a direct thread pushed within a familiar's history fixes its sole familiar;
- a group thread or no visible route keeps general mode.

This makes compose contextual without silently choosing a "most recent"
familiar the user is not currently viewing. The empty-state action remains an
explicit general-mode escape hatch for choosing one or more familiars.

`ChatProjectPicker` continues querying `/api/projects?familiarId=...` through
the existing `CaveClient.projects(familiarIds:)` path. It does not fall back to
unscoped projects, because doing so would weaken the project authorization
contract. When the scoped response is empty, the picker offers a `Project
access` action supplied by its parent. New Chat presents the existing
`FamiliarPermissionsSheet` for the fixed familiar. Dismissing that sheet
increments the picker's reload token so newly granted access appears without
closing New Chat.

The Start action remains disabled until the picker resolves a valid project
root. A successful launch persists that root on the new thread, preserving the
existing first-turn request contract.

Project discovery must use `CaveClient.data(for:)`, the same request boundary
as the rest of the REST client. The projects extension must not create its own
URL session because that bypasses injected test transports and the bounded GET
retry policy. The picker still performs one higher-level connection recovery
after those request retries are exhausted, so endpoint relocation and ordinary
transient transport recovery remain separate and bounded.

## Error handling

- Connection and request failures retain the existing retry behavior.
- An empty authorized-project response is distinct from a transport failure and
  offers `Project access` plus retry.
- If the fixed familiar no longer exists in the hydrated roster, the sheet
  remains non-launchable and displays the existing no-familiar state rather
  than silently selecting another familiar.
- Returning from Project access always retries the scoped lookup; it does not
  assume a grant mutation succeeded.

## Testing

- Verify fixed mode hides the familiar roster and keeps exactly one familiar.
- Verify general mode still renders editable familiar selection.
- Verify familiar-specific entry points pass fixed mode.
- Verify global compose resolves a visible direct-chat familiar but preserves
  general mode for group or absent context.
- Verify an empty project response exposes Project access and reloads after the
  permissions sheet closes.
- Verify project discovery uses the injected client transport and survives one
  transient request failure without requiring endpoint relocation.
- Drive a simulator fixture that opens contextual New Chat with no familiar
  roster, surfaces a project load failure, and resolves the project after Retry.
- Preserve the existing project-selection unit and first-turn provenance tests.
- Run the repository's wired iOS source-contract tests and an iOS app build.
