# Familiar Rooms UI Refinement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refine all eight familiar rooms into one clean, minimal, accessible interaction system without removing capabilities or rewriting room-specific workflows.

**Architecture:** Improve the generic `RoleSurfaceHost` and `SurfaceRoom` furniture first, then migrate the six rooms that use `SurfaceRoom` to explicit loading/error/empty semantics and mutation announcements. Research Desk and Code Workshop retain their existing architectures and receive only host-level consistency.

**Tech Stack:** React 19, Next.js, TypeScript, shared Coven UI primitives, CSS container queries, Node source-contract tests, Playwright visual verification.

---

## File structure

- `src/components/role-surface-host.tsx`: generic room header, overflow actions,
  notices, and room-level fallback behavior.
- `src/components/role-surfaces/surface-room.tsx`: shared room layout and compact
  state/furniture primitives.
- `src/styles/globals/surface-role-workspaces.css`: token-only room shell,
  container queries, disclosure behavior, and shared state styling.
- `src/components/role-surfaces/{messenger,sentinel,scribe,navigator,indexer,reviewer}-surface.tsx`:
  room-specific state handling, retry paths, copy, and announcements.
- `src/components/role-surfaces/researcher-surface.tsx`: remove duplicate host
  status only; retain the five-tab architecture.
- `src/components/role-surface-shell.test.ts`: shell purity plus shared host
  chrome contract.
- `src/components/role-surfaces/surface-room.test.ts`: new source-contract test
  for shared state and container behavior.
- Existing `*-surface.test.ts` files: room-specific regression pins.
- `scripts/run-tests.mjs`: register the new source-contract test.

### Task 1: Pin the shared room contract

**Files:**
- Create: `src/components/role-surfaces/surface-room.test.ts`
- Modify: `src/components/role-surface-shell.test.ts`
- Modify: `scripts/run-tests.mjs`

- [ ] **Step 1: Write the failing shared contract test**

Create a source-contract test that reads `surface-room.tsx`,
`role-surface-host.tsx`, and `surface-role-workspaces.css` and asserts:

```ts
assert.match(room, /export function SurfaceLoading/);
assert.match(room, /export function SurfaceError/);
assert.match(room, /role="status"/);
assert.match(room, /role="alert"/);
assert.match(host, /<OverflowMenu/);
assert.doesNotMatch(host, /role-surface-commands-menu/);
assert.match(css, /container-type:\s*inline-size/);
assert.match(css, /@container role-surface-room/);
assert.doesNotMatch(css, /role-surface-status-dot--ok\s*\{\s*background:\s*oklch/);
```

Extend `role-surface-shell.test.ts` to assert the header no longer renders
`role-surface-header-role` and still remains role-agnostic.

- [ ] **Step 2: Register and run the failing test**

Add `"src/components/role-surfaces/surface-room.test.ts"` beside the other role
surface tests in the `app` suite in `scripts/run-tests.mjs`.

Run:

```bash
node --experimental-strip-types src/components/role-surfaces/surface-room.test.ts
node --experimental-strip-types src/components/role-surface-shell.test.ts
```

Expected: both fail on the missing semantic primitives and old custom command
menu/role badge.

- [ ] **Step 3: Commit the test-only checkpoint**

```bash
git add src/components/role-surfaces/surface-room.test.ts \
  src/components/role-surface-shell.test.ts scripts/run-tests.mjs
git commit -S -m "test: pin familiar room interaction contract"
```

### Task 2: Refine the generic room host

**Files:**
- Modify: `src/components/role-surface-host.tsx`
- Modify: `src/styles/globals/surface-role-workspaces.css`
- Test: `src/components/role-surface-shell.test.ts`
- Test: `src/components/role-surfaces/surface-room.test.ts`

- [ ] **Step 1: Replace the custom command menu with shared overflow**

Import `OverflowMenu`, `PopoverItem`, and `PopoverSeparator`. Keep at most two
contributed toolbar actions visible and place remaining actions plus commands
inside one overflow:

```tsx
const directActions = toolbarActions.slice(0, 2);
const overflowActions = toolbarActions.slice(2);

{(overflowActions.length > 0 || commands.length > 0) && (
  <OverflowMenu ariaLabel={`${surface.title} actions`}>
    {overflowActions.map((action) => (
      <PopoverItem key={action.id} icon={action.iconName} onSelect={() => action.run(context)}>
        {action.title}
      </PopoverItem>
    ))}
    {overflowActions.length > 0 && commands.length > 0 ? <PopoverSeparator /> : null}
    {commands.map((command) => (
      <PopoverItem key={command.id} onSelect={() => command.run(context)} meta={command.hint}>
        {command.title}
      </PopoverItem>
    ))}
  </OverflowMenu>
)}
```

Delete `commandsOpen` and the custom menu markup. Remove the visible role badge;
include the role in the header's accessible label instead.

- [ ] **Step 2: Make status and fallback semantics explicit**

Give status indicators a text-inclusive accessible label, keep color
supplementary, and add the room description as quiet header context only when
space permits. Change unavailable/error copy to use concrete recovery actions,
including the existing `onLeave` callback.

- [ ] **Step 3: Tokenize and quiet the host CSS**

Replace raw status colors with `--color-success`, `--color-warning`, and
`--text-muted`. Remove `.role-surface-header-role` and custom command-menu
rules. Ensure the header has one hairline boundary and no more than one
overflow trigger.

- [ ] **Step 4: Run host tests**

```bash
node --experimental-strip-types src/components/role-surface-shell.test.ts
node --experimental-strip-types src/components/role-surfaces/surface-room.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/role-surface-host.tsx \
  src/styles/globals/surface-role-workspaces.css \
  src/components/role-surface-shell.test.ts \
  src/components/role-surfaces/surface-room.test.ts
git commit -S -m "refactor: quiet familiar room chrome"
```

### Task 3: Add semantic room states and container-aware layout

**Files:**
- Modify: `src/components/role-surfaces/surface-room.tsx`
- Modify: `src/styles/globals/surface-role-workspaces.css`
- Test: `src/components/role-surfaces/surface-room.test.ts`

- [ ] **Step 1: Implement compact state primitives**

Reuse existing UI primitives instead of cloning their semantics:

```tsx
export function SurfaceLoading({ label }: { label: string }) {
  return (
    <div className="role-surface-state" role="status" aria-label={label}>
      <SkeletonRows count={3} />
      <span className="role-surface-state-label">{label}</span>
    </div>
  );
}

export function SurfaceError({
  title,
  hint,
  onRetry,
}: {
  title: string;
  hint?: string;
  onRetry?: () => void;
}) {
  return (
    <ErrorState
      compact
      className="role-surface-state"
      headline={title}
      subtitle={hint}
      actions={onRetry ? <Button size="sm" onClick={onRetry}>Retry</Button> : undefined}
    />
  );
}
```

Extend `SurfaceEmpty` with `action?: ReactNode` and render the shared
`EmptyState` in compact mode.

- [ ] **Step 2: Make rails label-addressable and collapsible**

Add stable ids and a compact disclosure button to `SurfaceRail`. Preserve the
wide three-column DOM order. Do not move state ownership into the room shell;
the disclosure is local presentation state.

- [ ] **Step 3: Replace viewport media queries with room containers**

Add `container: role-surface-room / inline-size` to `.role-surface-room`.
Replace `@media (max-width: 1023px)` with:

```css
@container role-surface-room (max-width: 860px) {
  .role-surface-columns {
    grid-template-columns: minmax(0, 1fr);
  }
  .role-surface-rail {
    display: none;
  }
  .role-surface-rail[data-expanded="true"] {
    display: flex;
  }
}
```

Use tokenized spacing, radii, state colors, and motion throughout the touched
rules. Do not expand the design-token drift baseline.

- [ ] **Step 4: Run shared tests and design codemod check**

```bash
node --experimental-strip-types src/components/role-surfaces/surface-room.test.ts
pnpm codemod:design:check
```

Expected: PASS and no generated diff.

- [ ] **Step 5: Commit**

```bash
git add src/components/role-surfaces/surface-room.tsx \
  src/styles/globals/surface-role-workspaces.css \
  src/components/role-surfaces/surface-room.test.ts
git commit -S -m "feat: add adaptive familiar room furniture"
```

### Task 4: Migrate data-driven room states

**Files:**
- Modify: `src/components/role-surfaces/messenger-surface.tsx`
- Modify: `src/components/role-surfaces/sentinel-surface.tsx`
- Modify: `src/components/role-surfaces/navigator-surface.tsx`
- Modify: `src/components/role-surfaces/indexer-surface.tsx`
- Test: `src/components/role-surfaces/sentinel-surface.test.ts`
- Test: `src/components/role-surfaces/navigator-surface.test.ts`
- Create: `src/components/role-surfaces/messenger-surface.test.ts`
- Create: `src/components/role-surfaces/indexer-surface.test.ts`
- Modify: `scripts/run-tests.mjs`

- [ ] **Step 1: Write failing state-separation pins**

For each room, assert the source imports `SurfaceLoading` and `SurfaceError`,
keeps error state separate from the collection, and passes its loader to
`onRetry`. Pin Indexer's `SearchInput` usage and `placeholder="Filter memories…"`.

- [ ] **Step 2: Run the four room tests**

```bash
node --experimental-strip-types src/components/role-surfaces/messenger-surface.test.ts
node --experimental-strip-types --import ./scripts/test-alias-register.mjs src/components/role-surfaces/sentinel-surface.test.ts
node --experimental-strip-types --import ./scripts/test-alias-register.mjs src/components/role-surfaces/navigator-surface.test.ts
node --experimental-strip-types src/components/role-surfaces/indexer-surface.test.ts
```

Expected: new assertions fail.

- [ ] **Step 3: Implement retryable loading and failure states**

Extract stable `useCallback` loaders in Messenger, Sentinel, Navigator, and
Indexer. Keep `null` as loading, arrays as successful data, and separate error
strings. Render `SurfaceLoading`, `SurfaceError`, and `SurfaceEmpty` distinctly.
Use `SearchInput` for Archive filtering with `onClear={() => patch({ filter: "" })}`.

- [ ] **Step 4: Add mutation announcements**

Use `useAnnouncer()` in Sentinel and Navigator:

```tsx
const { announce } = useAnnouncer();
announce(`Moved "${selected.title}" to ${LANE_LABELS[status]}.`);
announce(`Resolved "${selected.title}".`);
```

Use assertive announcements in existing failure catches without replacing the
visible error.

- [ ] **Step 5: Run room tests**

Run the commands from Step 2. Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/role-surfaces/messenger-surface.tsx \
  src/components/role-surfaces/sentinel-surface.tsx \
  src/components/role-surfaces/navigator-surface.tsx \
  src/components/role-surfaces/indexer-surface.tsx \
  src/components/role-surfaces/*-surface.test.ts scripts/run-tests.mjs
git commit -S -m "fix: clarify familiar room data states"
```

### Task 5: Refine authoring and review rooms

**Files:**
- Modify: `src/components/role-surfaces/scribe-surface.tsx`
- Modify: `src/components/role-surfaces/reviewer-surface.tsx`
- Modify: `src/components/role-surfaces/researcher-surface.tsx`
- Test: `src/components/role-surfaces/scribe-surface.test.ts`
- Test: `src/components/role-surfaces/reviewer-surface.test.ts`
- Test: `src/components/role-surfaces/researcher-surface.test.ts`

- [ ] **Step 1: Add failing source-contract assertions**

Pin `useAnnouncer()` in Scribe and Reviewer, a retry action for published works
and working-tree failures, and the absence of duplicate visible engine status
in Research Desk when host status is present.

- [ ] **Step 2: Implement Scribe feedback and disclosure**

Announce successful publish/republish. Keep Publish visible as the primary
action. Move discard behind an existing room overflow or secondary reveal
without deleting it. Preserve local draft state and Knowledge Vault writes.

- [ ] **Step 3: Implement Reviewer feedback**

Announce approve, request-changes, and merge completion. Give working-tree and
diff failures retry actions wired to `loadChanges` and `showDiff(openFile)`.
Preserve Review Deck's specialized stylesheet and tri-pane behavior.

- [ ] **Step 4: Remove Research Desk status duplication**

Keep the tab strip and checkpoint indicator. Remove or visually demote the
in-panel engine status so the generic host is the single room-level status
source.

- [ ] **Step 5: Run focused tests**

```bash
node --experimental-strip-types --import ./scripts/test-alias-register.mjs src/components/role-surfaces/scribe-surface.test.ts
node --experimental-strip-types --import ./scripts/test-alias-register.mjs src/components/role-surfaces/reviewer-surface.test.ts
node --experimental-strip-types --import ./scripts/test-alias-register.mjs src/components/role-surfaces/researcher-surface.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/role-surfaces/scribe-surface.tsx \
  src/components/role-surfaces/reviewer-surface.tsx \
  src/components/role-surfaces/researcher-surface.tsx \
  src/components/role-surfaces/scribe-surface.test.ts \
  src/components/role-surfaces/reviewer-surface.test.ts \
  src/components/role-surfaces/researcher-surface.test.ts
git commit -S -m "refactor: focus familiar authoring rooms"
```

### Task 6: Validate every room and land through a PR

**Files:**
- Modify only if validation exposes a scoped defect.

- [ ] **Step 1: Run focused room suite**

```bash
pnpm test:app
```

Expected: all app tests pass, including every registered role-surface test.

- [ ] **Step 2: Run static and design gates**

```bash
pnpm typecheck
pnpm lint
pnpm codemod:design:check
node --experimental-strip-types --import ./scripts/test-alias-register.mjs src/lib/design-token-drift.test.ts
```

Expected: all commands pass with no drift baseline increase.

- [ ] **Step 3: Browser-review all eight rooms**

Launch the app with the repository's browser-driving skill. For each room,
inspect wide, medium, and compact widths in Coven dark, Coven light, and one
non-default palette. Confirm:

```text
header <= 2 direct actions + 1 overflow
no clipped header/status text
canvas is the first visual priority
rails remain reachable at compact widths
loading, empty, error, and filtered-empty states are distinct
Escape closes overflow and returns focus
drawer state and actions still work
```

- [ ] **Step 4: Record evidence and update the Bead**

```bash
bd update cave-k1pkx --append-notes "Implemented on feat/refine-familiar-rooms in .worktrees/refine-familiar-rooms. Verification: app suite, typecheck, lint, design codemod/drift, and browser review of all 8 rooms across wide/medium/compact and 3 theme combinations."
```

- [ ] **Step 5: Push, open PR, resolve conversations, and merge**

```bash
git push -u origin feat/refine-familiar-rooms
gh pr create --base main --head feat/refine-familiar-rooms \
  --title "refactor: refine familiar room UI contract" \
  --body "Closes cave-k1pkx. Refines the shared familiar-room host, adaptive layout, semantic states, and room-specific feedback without removing capabilities."
```

Wait for all six required checks, resolve any review threads, squash-merge, then
close `cave-k1pkx` with the merge SHA.

- [ ] **Step 6: Clean local transport**

From the main checkout:

```bash
git worktree remove .worktrees/refine-familiar-rooms
git branch -D feat/refine-familiar-rooms
git worktree list
```
