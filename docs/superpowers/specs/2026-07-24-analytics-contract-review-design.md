# Familiar Analytics: contract review button + empty-results layout

Date: 2026-07-24
Status: approved (design conversation, this session)
Surface: `/dashboard/familiars/<id>/analytics`

## Problem

1. **Contract compliance is a dead end.** The analytics "Contract compliance"
   section (`ContractCompliance` in `src/components/familiar-analytics-content.tsx`)
   shows the five familiar properties and, for a failing property, the violation
   messages behind it — but offers no action. The Studio Contract tab already
   launches a rehabilitation chat from the same failing state; analytics should
   too instead of stranding the reader.
2. **Empty results leave holes in the grid.** `.fa-grid`
   (`src/styles/familiar-analytics.css`) is a two-column grid with
   `align-items: start`. When one cell in a row is a short empty-state card and
   its neighbor is tall (e.g. empty "Confidence from thread analysis" next to a
   full "Recent sessions"), the short card floats at the top of the row leaving
   a large blank gap beneath it.

## Decisions (from design conversation)

- **Granularity:** one **section-level** review button, shown only when the
  contract report fails (`report.pass === false`). No per-property buttons —
  the rehabilitation brief always covers the whole contract, so per-violation
  buttons would differ only in emphasis.
- **Launch behavior:** **direct launch** (no confirm modal), matching the
  Studio Contract tab precedent, not the heal-queue's `ActionModal` flow.
- **Prompt source:** reuse `buildRehabilitationBrief(familiarName, report)`
  from `src/lib/familiar-rehabilitation.ts` — the deterministic, unit-tested
  "Rite of Binding" brief the Studio Contract tab already sends
  (`familiar-studio-contract-tab.tsx:139`). No new prompt synthesis.

## Design

### 1. Review button in `ContractCompliance`

- `ContractCompliance` gains two props: `familiarName: string` and
  `onReview: () => void`. It stays presentation-only; the parent owns the
  launch.
- When `report && !report.pass`, render after the property grid / detail
  panel:
  `<Button variant="primary" size="sm" leadingIcon="ph:sparkle" onClick={onReview}>Review and resolve</Button>`
  (verb-first action copy, no ampersand — codebase button copy uses none).
  (`ph:sparkle` is the icon the Studio tab's rehabilitation button uses for
  this same action; already in `ICON_NAMES`, no icon-subset regeneration).
  Button is aligned to the start of the column flow (`self-start`-style
  placement per the section's flex column).
- Passing reports and `report === null` render exactly as today — no button.
- Parent (`FamiliarAnalyticsContent`) wires `onReview` to:
  1. `requestAgentsNewChat({ familiarId: model.familiarId, initialPrompt, origin: "chat" })`
     where `initialPrompt` is the rehabilitation brief plus the same
     provenance line the heal-queue's `confirmAction` appends:
     `\n\nAnalytics source: /dashboard/familiars/<id>/analytics`.
  2. `announce(...)` via `useAnnouncer` (mutation announcement, per a11y
     contract), mirroring `confirmAction`'s announce.
- `familiarName` comes from the existing derivation at
  `familiar-analytics-content.tsx:1332`
  (`model.familiar?.display_name ?? model.familiarId`);
  `buildRehabilitationBrief` already falls back safely for blank names.

### 2. Empty-results layout in `.fa-grid`

- Remove `align-items: start` from `.fa-grid` so cards in the same grid row
  stretch to equal height (grid default). Bordered cards filling their cells
  read as intentional; a short card floating over a blank gap does not.
- Center empty states vertically inside their (now taller) cards with
  `margin-block: auto` on the two shapes that occur as direct section
  children:
  - `.fa-section > .ui-empty-state` (thread-analysis, recent-sessions,
    contract "no report" — all render `EmptyState` directly)
  - `.fa-section > .fa-thread-empty` (thread-signals wraps its `EmptyState`)
- No JSX/order changes. The thread-signals rule "empty state shouldn't claim
  both columns" (pinned by `src/components/thread-signals-section.test.ts`)
  is untouched.

## Testing

- Extend the analytics content source-contract test (same style as
  `familiar-studio-contract-tab.test.ts`): failing report renders the
  review button wired to `buildRehabilitationBrief` +
  `requestAgentsNewChat`; passing/null report paths render no button.
- Pin the two CSS invariants in the analytics CSS contract test surface if
  one exists; otherwise assert via the source-contract test that `.fa-grid`
  no longer declares `align-items: start` and the centering selectors exist.
- Run `src/lib/familiar-rehabilitation.test.ts` and
  `src/components/thread-signals-section.test.ts` unchanged (behavior pins).
- Any new test file must be registered in `scripts/run-tests.mjs` SUITES
  (`check:tests-wired` gate).

## Out of scope

- Per-violation heal-request changes (`familiar-heal-requests.ts` already
  models contract violations; unchanged).
- Studio Contract tab (already has the launch; unchanged).
- The pre-existing off-grid `gap: 18px` in `.fa-grid` (design-gate baseline
  concern, not this fix).
- Responsive single-column behavior for `.fa-grid` (none exists today).
