# Adaptive chat context controls

**Bead:** `cave-qvh18`  
**Status:** Approved design  
**Scope:** Chat project, worktree, branch, and model controls

## Problem

Chat currently repeats project, branch, and model context in the composer even
after a session is active. This gives configuration controls too much visual
weight, crowds the writing surface, and duplicates context already associated
with the active session.

The controls still need to remain visible and directly editable. Project access,
model switching, branch changes, and worktree creation are consequential actions,
so hiding them in a generic overflow menu would make the interface cleaner at
the cost of discoverability.

## Decision

Use adaptive placement:

- **Active chat:** render context directly below the title in the top chat row.
- **New chat:** render the same context controls in a footer attached below the
  composer, outside the text-entry area.
- Remove project, worktree, branch, and model controls from the active-chat
  composer.

The visible order is:

`Project › Worktree · Branch · Model`

Worktree is conditional, but it does not replace branch. When a session is
rooted in a worktree, both values remain visible because they answer different
questions: the worktree identifies the checkout and the branch identifies its
Git ref.

## Interaction model

Each value remains an independent control rather than becoming one combined
context menu:

- **Project** opens the existing searchable project picker and add-project flow.
- **Worktree** opens the existing worktree or Git context action appropriate to
  the current checkout.
- **Branch** opens the existing branch picker, branch switching, worktree
  creation, pull-request, and Git-changes actions.
- **Model** opens the existing runtime and model picker.

The implementation must reuse the existing picker components and handlers.
Placement changes must not create a second source of truth for selected values
or duplicate project, model, or Git mutation logic.

Controls with no truthful value are omitted. In particular, worktree is absent
for a normal checkout and Git controls are absent for a non-repository project.

## Layout

### Active chat

The context row sits below the title and primary session actions, inside the
existing sticky header. It uses quiet, compact controls so the title remains the
header's strongest element. The row may share established context-row chrome,
but interactive values must retain distinct focus and hover states.

The composer contains only message composition and message-adjacent actions. It
does not render project, worktree, branch, or model controls, and it does not
reserve empty space for the removed footer cluster.

### New chat

Before a session exists, context remains adjacent to the action it configures.
The controls render in a true footer below the composer panel, separated from
the writing area by a hairline. This preserves configuration visibility without
making the controls appear to be part of the message.

### Narrow screens

The context row stays available on narrow screens. It uses a single-line,
horizontally scrollable control strip rather than wrapping into a tall header
or hiding lower-priority values. Keyboard focus must scroll the focused control
into view through normal browser behavior.

## State and safeguards

Existing safeguards remain authoritative:

- Model switching is disabled while a response is streaming.
- Project changes continue through the current project-access validation and
  authorization flow.
- Branch and worktree actions retain existing Git validation, error reporting,
  mutation announcements, and worktree handoff behavior.
- Popover failures remain visible in the popover that initiated the action.
- Successful mutations continue to use the existing announcer behavior and
  state refresh paths.

Moving controls must not make a session appear to change context before the
underlying operation succeeds.

## Accessibility

Every control must:

- expose an accessible name containing its kind and current value;
- preserve `aria-expanded` and the appropriate popup relationship;
- use the shared visible focus-ring treatment;
- return focus to its trigger when its popover closes;
- retain a text or icon-plus-text distinction so color is never the only
  channel.

The context strip has a group label such as `Session context` for active chats
and `New chat context` before launch. Horizontal overflow must remain operable
with keyboard, pointer, and touch input.

## Error handling

This change introduces no new fallback behavior. Missing context is represented
by an omitted control, while failed fetches or mutations use the existing
explicit error surfaces. The UI must not silently substitute the first project,
a default branch, or a default model when the selected value cannot be
resolved.

## Testing

Targeted tests must cover:

- active chats render the controls in the top context row and not in the
  composer;
- new chats render the controls in the composer footer;
- controls appear in project, worktree, branch, model order;
- worktree and branch both render for worktree-backed sessions;
- each value opens its own existing picker;
- model switching remains unavailable while streaming;
- absent worktree and Git values omit only their corresponding controls;
- accessible names, popup state, and focus-return wiring remain intact;
- narrow layouts retain every available control in a horizontal strip.

Existing project, runtime/model, branch, worktree, composer, and chat-header
tests should be updated rather than replaced by broad snapshots.

## Out of scope

- Changing how projects, worktrees, branches, or models are selected or stored.
- Combining all context into one menu.
- Changing session launch defaults.
- Redesigning linked tasks, pull-request affiliation, usage statistics, or
  other header metadata.
- Changing the native iOS chat layout.

## Acceptance criteria

1. An active chat shows independently clickable project, worktree when present,
   branch when present, and model controls in its top context row.
2. Those controls do not render in the active-chat composer.
3. A new chat shows the same available controls in a footer outside the text
   input.
4. Worktree-backed chats display both worktree and branch.
5. Existing selection behavior, safeguards, errors, announcements, and
   accessibility semantics are preserved.
6. The context strip remains usable without hiding values at narrow widths.
