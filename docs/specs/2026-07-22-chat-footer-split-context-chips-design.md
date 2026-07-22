# Chat footer: split context pill into project · model · branch chips

- **Date:** 2026-07-22
- **Bead:** cave-g21f
- **Status:** approved (design review in chat, 2026-07-22)

## Problem

The chat composer's footer band folds project, model, and git context into one
combined `ComposerContextPill` ("Project · Model · branch"). Clicking it opens
a hub popover that chains to the real pickers — two clicks for every change,
and the combined label is ambiguous. The home composer already solved this
(2026-07-22 refinement, PR #3670): its footer toolbar renders project and
model as two separate, individually labelled chips via the pill's
`splitControls` mode. Chat should match, and git context should keep a
first-class footer affordance.

## Decision

Extend the split-chip mode to be the **only** rendering of the context
control, add a **branch chip** for repo-rooted chats, and flip the chat footer
band to it. Approved as "Approach A" over (B) remounting the legacy
ProjectPicker/runtime-chip/git-chip cluster and (C) a partial split.

## Design

### 1. Component — `src/components/composer-context-pill.tsx`

- The combined-pill + hub-popover rendering retires (dead code once chat
  flips). The chips rendering becomes unconditional; the `splitControls` prop
  is removed.
- The component is renamed `ComposerContextChips`. The file name stays
  `composer-context-pill.tsx` to keep source-pin test paths stable; the header
  comment is rewritten to the new grammar.
- Shared exports used by `ComposerActionsMenu` survive unchanged:
  `useComposerContextActions`, `ComposerContextPickers`, and
  `ComposerContextView`. `ComposerContextActionRows` is mounted only by the
  hub, so it retires with it (source-pin tests in `composer-actions-menu`,
  `composer-runtime-chip`, `composer-git-chip`, and `project-picker` test
  files update accordingly).
- **New branch chip**, rendered only when `context.hasGit` (requires
  `projectRoot`; home passes none, so home renders exactly its current two
  chips):
  - Anatomy: `ph:git-branch` icon · branch name · `+N` dirty-count suffix when
    `count > 0` · worktree name suffix when present. Ellipsizes.
  - `aria-label`: `Branch: <branch> — switch branch or create a worktree`.
  - Click opens `GitBranchMenuPopover` anchored to the chip (one click to the
    branch list).
- Model chip stays disabled while streaming (`modelDisabled`), project chip
  while `disabled` — both as today.

### 2. Git popover extras — `src/components/composer-git-chip.tsx`

`GitBranchMenuPopover` gains optional props so the PR link and "Open Git
changes" rows (previously hub-only) survive the hub's removal:

- `pr?: BranchPr | null` + `onOpenPr?: (url: string) => void` — renders a
  separator and an "Open PR #N" row when present.
- `onOpenChanges?: () => void` — renders an "Open Git changes" row.

`ComposerContextPickers` passes these from the existing context
(`context.pr`, `config.onOpenUrl`, the `cave:changes-open` dispatch), so both
the footer branch chip and the actions-menu "Branch…" flow get the same
popover contents. When the props are absent the popover renders exactly as
today.

### 3. Chat wiring — `src/components/chat-view.tsx`

The footer band swaps `<ComposerContextPill …>` for
`<ComposerContextChips …>` with identical props (including
`projectRoot={activeProjectRoot}` and `onOpenUrl`). The linked-work strip
stays on the right; no state or handler changes.

### 4. CSS

- `.cave-context-chip*` rules move from
  `src/styles/home-composer/landing-composer.css` (home-scoped) into
  `src/styles/cave-composer.css`, which the component already imports — chat
  gets the styles without loading home sheets. Home-only toolbar layout rules
  stay in `landing-composer.css`.
- `.cave-context-pill*` rules (including `__hub`) retire with the hub.
- Fit: chips keep `min-width: 0` + ellipsis; the footer band's left cluster
  allows shrinking so three chips coexist with the linked-work strip. On
  mobile (≤767px) the linked strip already hides; chips truncate. The
  home-specific `max-width: 42%` cap is relaxed to a fixed `max-width` (e.g.
  `13rem`) that works for two or three chips.

## Error handling

No new async paths. `GitBranchMenuPopover` keeps its existing fetch/error
states; the PR row renders only when `useBranchPr` produced one; git-less
chats (no project, non-repo root) render no branch chip.

## Testing

- Rewrite `src/components/chat-composer-footer-band.test.ts` pins: the band
  leads with the three-chip cluster (project, model, branch-when-git); the
  combined pill, hub popover, and `.cave-context-pill` CSS are gone;
  `.cave-context-chip` lives in `cave-composer.css`; the popover-extras wiring
  exists.
- Update any `home-composer*` test pins referencing `splitControls`.
- Extend `composer-git-chip.test.ts` pins for the optional popover rows.
- Validate: targeted `node --experimental-strip-types --test` on the touched
  test files (with the CSS facade hook where globals are read), then
  `pnpm typecheck`; full `pnpm test:app` before PR.

## Out of scope

- The `ComposerActionsMenu` context-group duplication (2026-07-21 "both"
  reconciliation) stays as is.
- Home composer visuals beyond the shared-CSS move.
- The legacy `ComposerGitChip` component (unused by these surfaces) is not
  redesigned here.
