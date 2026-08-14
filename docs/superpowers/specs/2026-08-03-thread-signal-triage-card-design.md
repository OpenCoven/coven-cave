# Thread Signal Triage Card Design

Successor to [`2026-08-01-compact-thread-signal-card-design.md`](./2026-08-01-compact-thread-signal-card-design.md).
That spec made the card small; this one makes it useful. Where the two
disagree — the score layout and the column breakpoint — this spec wins.

## Goal

Turn the in-chat Thread Signal card from a read-only score strip into the place
a thread's problems get triaged. Every number is explainable in one tap, every
signal is actionable in one tap, and neither interaction changes the card's
height while the reader is looking at the transcript above it.

## Content

- **Header** — a composite score ring, the card title, and a one-line summary
  reading `<n> critical · <n> warnings · <thread> · <age>`. Two icon actions:
  view full report, dismiss.
- **Score tiles** — six tiles: the composite plus confidence, tools, memory,
  files, and context pressure. Selecting one opens the rationale strip; the
  weakest scored metric is selected on mount, because that is the number the
  reader is about to ask about.
- **Rationale strip** — the selected metric's label, its weight in the
  composite, a fill bar, the familiar's own words, and (composite only) the
  scoring formula. Rationale text is quoted from the report, never generated.
- **Signal queue** — up to six ranked signals derived from the single report,
  ordered critical-first then by rank, matching the analytics review queue so a
  signal sits in the same place on both surfaces.
- **Row detail** — kind, provenance, detail, the report's suggested fix when it
  gave one, and the actions `Fix in new thread` and `Create task`.
- **Footer** — `Analytics`, and a batch action that fixes every remaining
  critical signal in a single thread.

## Scoring

- Contributing metrics: `< 40` critical, `< 60` warning, `>= 90` ok, otherwise
  neutral. The 40/60 thresholds are the ones the analytics review queue already
  uses to promote a low score.
- The composite is graded harder — `< 40` critical, `< 70` warning, else ok —
  because it is the headline number.
- Neutral is deliberate: a middling metric inside a healthy thread must not
  spend the card's attention budget.
- Severity never travels alone. Every colored element carries a text label too.

## Layout

- The card is a size container; all breakpoints are card-relative, never
  viewport-relative.
- Tiles are two columns by default and three at a card width of `300px`. Six
  tiles split cleanly either way; the predecessor's `1 → 3` rule existed because
  three score rows do not.
- Row detail opens as an **overlay anchored above the row**, not an inline
  expansion. The card's height is therefore constant, so opening a signal never
  shifts the transcript above it.
- `Escape` closes an open row.

## Density and Shape

- `--space-2` for card padding and primary gaps, `--space-1` for tile padding,
  `--radius-sm` throughout — unchanged from the predecessor.
- Severity is carried by shared `.tsc-tone--*` / `.tsc-fill--*` utilities so
  text and fills cannot drift apart.
- Buttons are the shared `Button` / `IconButton` primitives, not bespoke rules.

## Actions

- `Fix in new thread` launches one primed thread through the existing
  `buildThreadSignalResolutionPrompt` + `requestAgentsNewChat` path.
- The batch action sends every remaining critical signal to a **single** thread.
  N threads racing each other over the same prompt and skill files is what
  one-tap-per-signal produced when the criticals shared a root cause.
- `Create task` posts to `/api/board` with the `thread-signal` label, the same
  shape the analytics section uses.
- Dismissal shows an undo chip and commits upward only after the undo window.

## Accessibility

- Keep the `Thread Signal` article label.
- Tiles are toggle buttons with `aria-pressed`; rows are buttons with
  `aria-expanded`; all carry a focus ring.
- Every mutation announces through `useAnnouncer()`.
- Action labels stay visible; only the header's two controls are icon-only, and
  both carry `aria-label` and `title`.

## Verification

- Source-level assertions for the tile grid breakpoint, the overlay's absolute
  positioning, the tone utilities, the deferred dismissal, and the batch launch.
- Unit tests for the single-report builders, including the case that motivated
  them: `aggregateThreadSignals([oneReport])` marks every blocker critical
  because frequency over total is always 1.
- Targeted tests, changed-file lint, the design codemod check, and the CSS
  budgets.

## Out of Scope

- Changing how self-reports are generated, scored, or persisted.
- Redesigning the Familiar Analytics Thread Signals section.
- Persisting per-signal dismissals from the chat card.
