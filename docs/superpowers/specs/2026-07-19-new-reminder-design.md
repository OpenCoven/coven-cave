# New Reminder Modal Redesign

## Goal

Re-port the useful New Reminder redesign from stale branch `feat/new-reminder-design` onto current `main` without carrying its merge history or unrelated changes.

## Scope

Change only:

- `src/components/new-reminder-modal.tsx`
- `src/components/new-reminder-modal.test.ts`
- `src/components/reminder-link-field.test.ts`

Delete the stale branch after the focused replacement PR merges.

## Interaction Design

- Keep the existing create and edit contracts unchanged.
- Add four selectable natural-language time examples: `in 30m`, `tomorrow at 9am`, `every tuesday 4pm`, and `jul 20`.
- Selecting an example updates the phrase, clears a conflicting manual date, and re-runs phrase parsing.
- Keep recurrence and link controls behind an accessible Advanced details disclosure.
- Open Advanced details automatically in edit mode when an existing reminder already has recurrence or link data.
- Present the reminder plan as a concise live summary with upcoming occurrences.
- Keep the dialog scroll-safe and preserve focus trapping, Escape handling, and coarse-pointer behavior.

## Visual Design

- Preserve the approved compact hierarchy from commit `8a37eba93`.
- Use repository typography tokens such as `--text-xs`, `--text-sm`, and `--text-base`; introduce no raw pixel text classes.
- Reuse existing colors, borders, radii, buttons, and focus-ring utilities.
- Keep the primary action visually dominant without changing the modal's semantic structure.

## Error Handling

- Preserve existing validation for title, familiar, date parsing, recurrence, and submission failures.
- Selecting a phrase example clears stale validation errors.
- Do not add broad catches or silent fallback behavior.

## Testing

- Port the source-contract coverage for examples, disclosure state, plan summary, edit prefill, responsive layout, and scroll containment.
- Keep reminder-link-field contracts aligned with the new Advanced details placement.
- Run the focused tests, typecheck, design lint, and required PR CI.

## Exclusions

- No project, onboarding, chat, Hermes, API, or daemon changes.
- No design-session notes or screenshots.
- No changes to reminder persistence or recurrence semantics.
