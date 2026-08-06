# Adaptive chat follow-up pills design

**Status:** approved for implementation review  
**Date:** 2026-08-05  
**Surface:** chat composer footer and historical assistant turns  
**Extends:** `2026-07-29-chat-follow-up-intent-design.md`

## Goal

Make chat follow-ups a minimal set of four useful next steps while preserving
the typed-intent safety boundary. The set adapts to the conversation, visibly
distinguishes replies from task and link actions, and marks the strongest reply
plus any explicitly recommended actions with a success-green border.

## Current baseline

The existing next-path pipeline:

- parses a structured `<coven:next-paths>` trailer;
- supports editable replies, reviewed task creation, and the allowlisted
  `open-tasks` navigation action;
- renders compact suggestions in the composer footer and typed cards on
  historical turns;
- safely converts unknown or malformed intents into editable replies; and
- currently caps the generated and rendered set at three.

The implementation should extend these boundaries rather than create a parallel
recommendation system.

## Decision

### Four context-adaptive options

When next paths are enabled and at least one sensible continuation exists, the
directive asks the settled assistant response for exactly four distinct
follow-ups. The assistant chooses the mix under these guardrails:

1. Include at least one reply and normally include two.
2. Include a task only when the conversation identifies durable follow-up work.
3. Include Save link only when the response or its cited sources contain at
   least one valid HTTP(S) URL.
4. Include navigation actions only when their destination is immediately useful.
5. Fill unused positions with relevant replies, never irrelevant actions.

The parser remains the product cap and truncates over-eager output to four.
During streaming, incomplete items remain hidden until they are safe to parse.
If a model omits the entire block, Cave renders no fallback suggestions rather
than inventing client-side content.

### Explicit recommendation metadata

Recommendation is separate from intent. The supported controls are:

```text
<coven:next-paths>
- [reply:recommended] Compare the two approaches
- [reply] Show the implementation details
- [task:recommended] Track the migration work
- [action:save-link:recommended] Save these sources
</coven:next-paths>
```

The allowlist includes:

| Control | Meaning |
| --- | --- |
| `reply`, `reply:recommended` | Fill the composer with editable text. |
| `task`, `task:recommended` | Open the existing conversation-linked task review. |
| `action:save-link`, `action:save-link:recommended` | Open the link destination picker. |
| `action:open-tasks`, `action:open-tasks:recommended` | Navigate to Tasks. |

The first reply must be marked recommended. A task or action receives the green
treatment only when its exact `:recommended` form is present. Recommendation
metadata never grants additional authority: it changes presentation only.
Unknown controls, unknown action ids, malformed prefixes, and legacy untyped
lines continue to degrade to editable replies.

`NextPath` gains an explicit `recommended` boolean. Renderers must use that
field instead of inferring recommendation from array position.

## Visual design

The latest settled response renders one four-item strip in the composer footer:

- one row at desktop widths, with four equal-width controls;
- one inline icon, short type label, separator, and imperative suggestion;
- `--radius-control`, not `--radius-pill`;
- compact vertical padding on the 4px spacing grid;
- neutral token-derived background and hairline border by default; and
- a `--color-success`-derived border for recommended items.

The type labels are **Reply**, **Task**, **Save**, and **Tasks**. Icons reinforce
the distinction but never carry it alone. Recommended items use both the green
border and accessible “Recommended” text. The text may be visually hidden in the
compact footer strip; historical cards may continue to show it.

At narrow widths, the strip becomes a two-by-two grid. Each control keeps the
minimum touch target while reducing internal decoration, so compactness does not
reduce the hit area or keyboard usability. Long labels truncate visually, while
the complete type, suggestion, outcome, and recommendation state remain in the
accessible name.

No recommendation pulse or other motion is required. Hover and focus states use
existing semantic tokens and `.focus-ring`, and the treatment must survive every
theme and mode.

## Activation behavior

### Reply

Fill the composer and focus it. Never send automatically. The existing Tab
autofill continues to select the first recommended reply only; it must not
activate task or action suggestions.

### Task

Open the existing chat follow-up task review with the active conversation
handoff. Creating the task remains a separate explicit user action.

### Save link

Extract and normalize HTTP(S) links from the source assistant turn using the
existing link extraction and normalization helpers. Activation opens a compact
shared `Modal`; it does not write immediately.

The picker offers only destinations the Cave can currently fulfill:

- **Research Resources** — always available; saving uses the existing
  `/api/research/links` route and its dedupe, categorization, and limits.
- **Current task** — shown only when the chat has linked task context; the modal
  previews the selected links and requires an explicit **Attach links** action.
  The mutation merges normalized URLs into the latest task record and preserves
  every existing human-authored link.

When the source contains multiple links, the picker lists them with checkboxes
and selects all valid, non-duplicate links by default. The user can adjust the
selection before choosing a destination. If no valid links remain, the action
is unavailable and announces “No links available to save” without opening an
empty picker.

Saving reports added, duplicate, invalid, and failed outcomes through the
existing announcer patterns. Closing the picker restores focus to the activating
pill.

### Navigation

Registered navigation actions continue to resolve through the chat-owned static
allowlist. No assistant-produced string becomes a route, command, or arbitrary
event name.

## Component boundaries

- `src/lib/next-paths.ts` owns the four-item cap, directive, typed parsing,
  recommendation metadata, and safe fallback behavior.
- `FollowUpCards` owns shared presentation and accessible names. It does not own
  navigation or mutations.
- `ChatView` owns activation routing and passes source-turn context to actions
  that need it.
- A focused link destination modal owns link selection, destination selection,
  focus trapping/return, and confirmation. It reuses the existing link intake
  helpers and API rather than introducing a new saved-link store.
- Compact consumers such as group chat and quick chat remain reply-only unless
  they explicitly implement the same safe action routing.

## Error handling and accessibility

- The save action is disabled when its source turn has no valid HTTP(S) links.
- API failures stay visible in the picker and preserve the user's selection for
  retry.
- Duplicate links are reported as duplicates, not failures.
- Task-link attachment re-reads the task before mutation, merges normalized
  URLs, and never silently overwrites human-authored links.
- All controls are native buttons with visible focus.
- Type and recommendation are conveyed in text, not color alone.
- The destination picker uses the shared `Modal`, Escape dismissal, focus trap
  and return, and mutation announcements.

## Verification

1. Parser tests cover the four-item cap, adaptive directive, every recommended
   and non-recommended control, legacy input, unknown actions, malformed input,
   and partial streams.
2. Component tests cover all four visible types, explicit recommendation
   styling, accessible names, long-label truncation, and activation delegation.
3. Chat wiring tests prove replies only fill, tasks only open review, Save only
   opens the picker, and navigation resolves only registered actions.
4. Picker tests cover URL extraction, multiple selection, duplicates, the
   conditional Current task destination, cancel/focus return, success
   announcements, and retryable failure.
5. Responsive tests pin one-by-four desktop and two-by-two narrow layouts,
   control radius, compact padding, touch targets, focus rings, and no required
   motion.
6. A real Tauri chat smoke verifies the footer in dark/light and one non-default
   theme, keyboard navigation, reply autofill, task review, and both available
   save destinations.

## Non-goals

- Arbitrary assistant-defined actions or destinations.
- A second bookmark or saved-link store.
- Automatic saving, task creation, or message sending.
- Guaranteeing a task or Save action in every four-item set.
- Changing read-only consumers that only strip the next-path trailer.
