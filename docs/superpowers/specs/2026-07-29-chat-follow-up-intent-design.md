# Chat follow-up intent design

**Status:** approved for implementation review  
**Date:** 2026-07-29  
**Surface:** chat transcript and composer

## Problem

Chat follow-ups currently arrive as bare lines in a `<coven:next-paths>` trailer.
The renderer turns every line into an indistinguishable pill whose click sends
text immediately. That collapses very different user intents—continuing a
conversation, creating a task, or opening a review surface—into one surprising
chat-send action.

## Decision

Replace bare next-path pills with typed follow-up cards. The assistant declares
the intent in the existing trailer; Cave owns the interpretation, visible
affordance, and side-effect boundary.

### Structured trailer

The directive asks for one of these forms:

```text
<coven:next-paths>
- [reply] Ask Jules to verify the rollout plan
- [task] Create a task for the accessibility fixes
- [action:open-changes] Review the edited files
</coven:next-paths>
```

The supported intent set is deliberately small:

| Intent | Meaning | Result on activation |
| --- | --- | --- |
| `reply` | A conversational next message. | Put the recommendation into the composer for editing; never send it directly. |
| `task` | Captured work that belongs in Tasks. | Open a prefilled, conversation-linked task review. The user explicitly creates the task from that review. |
| `action:<id>` | A named, non-arbitrary in-app destination or action. | Resolve only a registered client-side action. Mutating actions require their existing confirmation or review step. |

Plain legacy lines remain valid and parse as `reply`. An unknown intent,
malformed bracket prefix, unknown action identifier, or incomplete streaming
line is harmless: it becomes an editable reply or remains hidden until safe to
render. No model-produced string can choose an arbitrary command, route, or
side effect.

### Shared card surface

`FollowUpCards` will render the same semantic item in both existing locations:

1. The latest settled assistant turn's row directly above the composer.
2. Historical assistant-turn rows, where they are not suppressed as the active
   composer row.

The group has the persistent label **Suggested next steps**. Each card has an
icon, visible type label (**Reply**, **Task**, or **Action**), imperative title,
and one-line outcome cue:

- Reply: “Drafts a reply below”
- Task: “Opens a linked task review”
- Action: names its actual destination, such as “Opens Changes”

The assistant's first item is marked **Recommended** separately from its type.
That marker combines text with the existing success-derived treatment; color is
never the only signal. Cards use the existing semantic tokens, `--space-*`
grid, card/control radii, `.focus-ring`, and a 1–2 column container-query
layout. The compact card form must stay readable in narrow panes and mobile.

### Interaction boundaries

- Reply activation updates the composer draft and focuses it, preserving the
  existing edit-before-send expectation.
- Task activation opens a review built from the existing chat-to-task handoff
  context: current session, familiar, project, source turns, and assistant
  suggestion. Creating is a separate explicit control in that review.
- Action activation only routes through a static allowlist owned by the chat
  surface. A registered navigation action may open its target directly;
  state-changing actions retain their owning flow's confirmation.
- Success and failure states use the existing announcer and exact action copy.
  Focus returns to the activating card when a review closes without creating.

## Architecture

`src/lib/next-paths.ts` becomes the source of truth for a typed `NextPath`
model, parser, and revised assistant directive. The model has a display label,
intent, optional registered action id, and the source prompt/title. It remains
pure and streaming-safe.

`chat-view.tsx` consumes that model instead of raw strings and sends activation
through one intent router. The router delegates task review/creation to the
existing chat-task handoff helpers rather than inventing a second board write.
The component owns its rendering and accessibility; its CSS belongs beside the
current chat next-path rules and uses only the design-token contract.

Other consumers that only strip trailers continue to use `extractNextPaths(...)
.visible`; their behavior is unchanged. Consumers that render suggestions (for
example group chat and compact quick chat) are audited explicitly: they must
either adopt typed cards with safe routing or intentionally render reply-only
suggestions. No consumer may continue to treat a task/action item as text to
send.

## Error handling and accessibility

- Partial trailer control text never appears in assistant prose.
- Unsupported cards explain that the action is unavailable and offer the safe
  reply route; they do not silently trigger an unrelated operation.
- Cards are native buttons with type-and-result accessible names. The group is
  labelled; the recommended state is spoken; keyboard focus is visible.
- The task review is focus-trapped and restores focus on cancellation. Task
  creation and failures announce their outcome.
- Any recommendation motion honors `prefers-reduced-motion`; no new movement
  is required to understand the state.

## Verification

1. Pure parser tests cover legacy lines, every typed intent, unknown/malformed
   input, action-id allowlist boundaries, over-limit input, and partial streams.
2. Component tests prove type labels, outcome cues, accessible names, duplicate
   suppression, and each activation route.
3. Task tests prove the review receives the chat handoff context and no board
   write happens before explicit creation.
4. Design gates cover token-only styling, lint/codemod drift, typecheck, and
   the relevant app suite wiring.
5. A real desktop and narrow-pane/Tauri smoke verifies reply drafting, task
   review/cancel/create, action routing, dark/light plus a non-default theme,
   keyboard focus, and reduced-motion behavior.

## Non-goals

- Letting assistants define arbitrary executable actions.
- Replacing existing board task storage or chat-to-task audit fields.
- Adding a user-facing mode selector for every follow-up.
- Changing non-chat consumers beyond the audit needed to keep their semantics
  safe.
