# Dia-Style Sidebar Edge Implementation Plan

**Goal:** Give the expanded desktop sidebar and hover-peek one inset, rounded,
token-driven floating silhouette while preserving the compact rail, vertical
scrolling, mobile drawer, and shell behavior.

**Architecture:** Keep navigation components and state unchanged. Implement the
desktop treatment in the owning shell stylesheet, share it across non-rail
states, and pin the resulting state matrix with one wired source-contract test.

## Task 1: Pin the state contract

**Files:**

- Create `src/components/sidebar-floating-edge.test.ts`.
- Modify `scripts/run-tests.mjs`.

- [x] Add a failing source contract for the shared desktop silhouette.
- [x] Require the same inset for expanded and hover-peek states.
- [x] Require `overflow-x: hidden` and `overflow-y: auto` so rounded clipping
  cannot disable long-list scrolling.
- [x] Require the collapsed rail to remain outside the floating selector.
- [x] Require the detail canvas to lose its competing rounded gutter.
- [x] Require the responsive stylesheet to remain unchanged for this feature.
- [x] Wire the test into the app suite and verify the initial red result.

## Task 2: Implement the minimal CSS

**File:** `src/styles/globals/shell-navigation.css`

- [x] Remove the detail pane's leading radius and inset margin.
- [x] Return `.shell-detail-panel` to `--bg-base`.
- [x] Keep hover-peek absolute positioning in its existing base rule.
- [x] Add a desktop-only shared selector for every non-rail `.shell-nav` direct
  child of `.shell-nav-panel`.
- [x] Apply the token border, panel radius, derived shadow, horizontal clipping,
  vertical scrolling, and shared grid-aligned margin in that selector.
- [x] Keep expanded navigation in flex layout with width reduced by the shared
  inline margins; rely on existing flex stretch for height.
- [x] Avoid a mobile override because the new rule is desktop-only.

## Task 3: Resolve review feedback

- [x] Replace the initial `overflow: hidden` shorthand with axis-specific
  overflow declarations.
- [x] Update the contract so it protects vertical scrolling rather than pinning
  the buggy shorthand.
- [x] Reply to both review threads with the fix and verification evidence.
- [x] Resolve only the addressed threads.

## Task 4: Verify and deliver

- [x] Run the focused sidebar contract.
- [x] Run `pnpm lint`.
- [x] Run `pnpm typecheck`.
- [x] Run `pnpm check:tests-wired`.
- [x] Run the complete `pnpm test:app` suite.
- [x] Run `pnpm build` and enforce bundle/standalone budgets.
- [x] Run `git diff --check`.
- [x] Commit the scoped implementation and documentation.
- [ ] Push the exact verified head and require CI to pass.
- [ ] Re-audit review conversations, squash-merge the protected PR, close the
  Bead, and remove the short-lived branch/worktree.

## Expected shipped diff

- `src/styles/globals/shell-navigation.css`
- `src/components/sidebar-floating-edge.test.ts`
- `scripts/run-tests.mjs`
- this implementation plan and its matching design spec
