# Group chat mention selection

## Problem

Desktop group chat treats a picker-confirmed mention as an unfinished
multi-word query. Selecting Sage inserts `@Sage `, but the composer immediately
scans that text again; ordinary prose such as `@Sage what do you think?` keeps
the mention popover open and eventually shows a false “No matching familiar”
state.

The interface also hides its `@` instruction inside the placeholder, selected
targets do not read as distinct tokens, and the coven prompt only explains
`@display name` addressing inside the narrower delegation protocol.

## Goals

- A picker-confirmed mention closes autocomplete immediately.
- Ordinary text after that mention stays ordinary text.
- Typing a new `@` opens a fresh familiar search.
- Selected `@Display Name` targets stand out in the composer and group
  transcript.
- The composer keeps a persistent instruction to use `@` outside its
  placeholder.
- Every familiar receives concise coven context explaining that exact
  `@Display Name` tags address another familiar.
- Raw message text remains the routing authority and the accessible textarea
  remains the editing control.

## Non-goals

- Replacing the textarea with a rich-text or `contenteditable` editor.
- Changing mention parsing, targeted-message routing, or delegation security.
- Changing one-to-one chat or iOS mention behavior.
- Adding durable mention metadata to stored transcript records.

## Design

### Completed mention state

The group composer records the display name confirmed through the picker. Its
active-mention synchronization suppresses the same `@Display Name` query after
selection, including later prose separated by the inserted space. Moving back
into and editing the selected name clears that completion guard. A different
active `@` token also clears it and opens the picker normally.

The guard is an interaction detail, not routing state. `parseMentions` continues
to derive recipients from visible text at send time.

### Standout targets

The view derives familiar targets from the current raw text with the existing
mention parser. It renders their literal `@Display Name` labels as compact
accent-tinted pills:

- in a persistent target strip above the group textarea; and
- alongside group transcript messages that contain familiar mentions.

The pills use `--accent-presence` with the design system tint recipe, a hairline
border, and `--radius-pill`. They add no new color vocabulary and survive every
theme/mode combination. Raw `@` text stays visible in the textarea and message
body, so copy/paste, editing, persistence, accessibility, and routing do not
depend on decoration.

When no target is present, the composer strip says “Use @ to tag a familiar.”
The textarea placeholder returns to the plain composition grammar
`Message <count> familiar(s)…`.

### Familiar guidance

The coven roster prompt adds one identity-safe instruction after the participant
list: use another familiar’s exact `@Display Name` when addressing them in this
chat. Existing delegation instructions remain unchanged and continue to govern
whether an `@` mention may dispatch follow-up work.

### Accessibility

- Picker selection announces `Tagged <name>.`
- The persistent target strip exposes a concise tagged-familiar label while
  decorative pills avoid duplicate announcements.
- The existing textarea, keyboard navigation, IME guard, Popover focus
  behavior, and visible focus rings remain intact.
- Styling is static, so no new motion or reduced-motion handling is needed.

## Verification

- Pure tests reproduce selection followed by ordinary prose and a subsequent
  fresh `@`.
- Prompt tests require exact `@display name` guidance.
- Group-view contract tests pin the persistent hint, plain placeholder,
  completion guard, announcement, and composer/transcript pills.
- Focused app tests, test wiring, design lint/codemod checks, typecheck, and the
  full app suite pass.
- Native Tauri verification confirms the picker closes after selection, pills
  render in the composer/transcript, and a new `@` reopens the picker.
