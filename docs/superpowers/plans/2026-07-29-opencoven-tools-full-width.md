# OpenCoven Tools Full-Width Settings Control Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the OpenCoven Tools control a full-width desktop row on Settings > About while keeping CovenCave compact and preserving the existing narrow layout.

**Architecture:** Keep the existing two-column `.settings-about-control-grid` and mark only the OpenCoven Tools control with a focused wide modifier. The modifier spans all explicit grid columns; the existing `55rem` single-column container rule continues to handle narrow panes without an override.

**Tech Stack:** React 19, TypeScript, CSS Grid, Node test runner, pnpm, Next.js 16, Playwright via the project `run-cave-app` skill.

---

## File Map

- Modify `src/components/settings-about.test.ts` to pin the OpenCoven Tools
  modifier and its full-span CSS contract.
- Modify `src/components/settings-about.tsx` to apply the modifier to the
  existing OpenCoven Tools control only.
- Modify `src/styles/settings-about.css` to make the modifier span the controls
  grid without adding tokens or breakpoints.
- Keep
  `docs/superpowers/specs/2026-07-29-opencoven-tools-full-width-design.md` as
  the source of truth for scope and responsive behavior.

### Task 1: Add the failing layout contract

**Files:**
- Modify: `src/components/settings-about.test.ts`
- Test: `src/components/settings-about.test.ts`

- [ ] **Step 1: Install the worktree dependencies**

Run:

```bash
cd .worktrees/cave-77y74-opencoven-tools-full-width
pnpm install --frozen-lockfile
```

Expected: installation succeeds and `git status --short` shows no dependency
manifest or lockfile changes.

- [ ] **Step 2: Add the source-contract test**

Insert this test after
`"About ports the Claude Design hero and live control-sheet hierarchy"`:

```ts
test("About gives OpenCoven Tools a full-width desktop row", () => {
  assert.match(
    component,
    /id=\{settingsGroupId\("OpenCoven tools"\)\}[\s\S]*?className="settings-about-control settings-about-control--wide"/,
  );
  assert.match(
    css,
    /\.settings-about-control--wide\s*\{[^}]*grid-column:\s*1\s*\/\s*-1;/,
  );
});
```

- [ ] **Step 3: Run the focused test and verify the new contract fails**

Run:

```bash
node --experimental-strip-types --test src/components/settings-about.test.ts
```

Expected: the new
`About gives OpenCoven Tools a full-width desktop row` test fails because the
component does not yet contain `settings-about-control--wide`.

### Task 2: Implement the full-width control

**Files:**
- Modify: `src/components/settings-about.tsx:466-471`
- Modify: `src/styles/settings-about.css:181-191`
- Test: `src/components/settings-about.test.ts`

- [ ] **Step 1: Apply the modifier to OpenCoven Tools only**

Change the existing OpenCoven Tools container to:

```tsx
<div
  id={settingsGroupId("OpenCoven tools")}
  data-settings-group
  className="settings-about-control settings-about-control--wide"
>
```

Leave the CovenCave container as `className="settings-about-control"`.

- [ ] **Step 2: Add the minimal grid-span rule**

Add this rule immediately after `.settings-about-control-grid`:

```css
.settings-about-control--wide {
  grid-column: 1 / -1;
}
```

Do not add a narrow-pane override: on the existing one-column grid,
`1 / -1` already spans the single explicit column.

- [ ] **Step 3: Run the focused test and verify it passes**

Run:

```bash
node --experimental-strip-types --test src/components/settings-about.test.ts
```

Expected: all About tests pass, including
`About gives OpenCoven Tools a full-width desktop row`.

- [ ] **Step 4: Check the implementation diff**

Run:

```bash
git diff --check
git diff -- src/components/settings-about.tsx \
  src/styles/settings-about.css \
  src/components/settings-about.test.ts
```

Expected: no whitespace errors; the diff contains only the test, one modifier
class, and one CSS rule.

- [ ] **Step 5: Commit and push the implementation**

Run:

```bash
git add src/components/settings-about.tsx \
  src/styles/settings-about.css \
  src/components/settings-about.test.ts
git commit -S -m "fix: widen OpenCoven Tools settings control"
git push
```

Expected: the signed implementation commit succeeds and the remote feature
branch advances.

### Task 3: Verify design, behavior, and production gates

**Files:**
- Verify: `src/components/settings-about.tsx`
- Verify: `src/styles/settings-about.css`
- Verify: `src/components/settings-about.test.ts`

- [ ] **Step 1: Run the design and type gates**

Run:

```bash
pnpm lint
pnpm typecheck
pnpm check:tests-wired
```

Expected: all commands exit successfully; no design-token or test-registration
ratchet changes are required.

- [ ] **Step 2: Run the complete app test suite**

Run:

```bash
pnpm test:app
```

Expected: the full app suite passes with no failures.

- [ ] **Step 3: Run the production build and budgets**

Run:

```bash
pnpm build
```

Expected: Next.js, the server build, bundle budgets, and standalone budgets all
pass.

- [ ] **Step 4: Verify the real layout**

Invoke the project `run-cave-app` skill, open Settings > About, and capture:

1. A desktop screenshot wider than the `55rem` About container breakpoint.
2. A narrow screenshot at or below the breakpoint.

Expected desktop geometry:

- CovenCave remains one grid column.
- OpenCoven Tools sits on the following row.
- OpenCoven Tools spans the complete controls-grid width.

Expected narrow geometry:

- Both controls remain in one-column document order.
- No horizontal overflow appears.
- Existing actions, focus styles, status text, and tool controls remain
  unchanged.

- [ ] **Step 5: Record verification in the Bead**

Run:

```bash
bd update cave-77y74 --append-notes \
  "Verification: focused About test, lint/design gates, typecheck, test registration, full app suite, production build/budgets, and desktop+narrow real-app layout checks passed."
```

Expected: Bead `cave-77y74` remains in progress with current verification
evidence attached.

### Task 4: Review, publish, and merge through protected main

**Files:**
- Review the complete branch diff against:
  `docs/superpowers/specs/2026-07-29-opencoven-tools-full-width-design.md`

- [ ] **Step 1: Request an independent code review**

Invoke the `requesting-code-review` skill on the complete branch diff.

Expected: no high-confidence correctness, accessibility, responsive-layout, or
scope issues remain. If review finds a real issue, fix it, rerun the affected
checks, commit the fix separately, and push it.

- [ ] **Step 2: Open the focused pull request**

Run:

```bash
gh pr create \
  --base main \
  --head fix/cave-77y74-opencoven-tools-full-width \
  --title "fix: widen OpenCoven Tools settings control" \
  --body $'## Summary\n- keep CovenCave compact in the About controls grid\n- place OpenCoven Tools on a full-width row beneath it\n- pin desktop span and preserve the existing narrow layout\n\n## Verification\n- focused About source-contract test\n- lint and design gates\n- typecheck and test registration\n- full app suite\n- production build and budgets\n- desktop and narrow real-app screenshots'
```

Expected: GitHub returns a new PR URL for the feature branch.

- [ ] **Step 3: Link the PR to the Bead**

Run:

```bash
bd update cave-77y74 \
  --external-ref "gh-pr-$(gh pr view --json number --jq .number)" \
  --append-notes "PR opened: $(gh pr view --json url --jq .url)"
```

Expected: Bead `cave-77y74` records the PR number and URL.

- [ ] **Step 4: Wait for protected checks and resolve conversations**

Run:

```bash
gh pr checks --watch --interval 20
```

Then verify:

```bash
gh pr view --json mergeable,mergeStateStatus,statusCheckRollup \
  --jq '{mergeable,mergeStateStatus,nonPassing:[.statusCheckRollup[]|select(.status!="COMPLETED" or (.conclusion!="SUCCESS" and .conclusion!="SKIPPED"))|{name,status,conclusion}]}'
gh api graphql \
  -F number="$(gh pr view --json number --jq .number)" \
  -f query='query($number:Int!) { repository(owner:"OpenCoven", name:"coven-cave") { pullRequest(number:$number) { reviewThreads(first:100) { nodes { isResolved } } } } }' \
  --jq '{unresolvedThreads:([.data.repository.pullRequest.reviewThreads.nodes[] | select(.isResolved == false)] | length)}'
```

Expected: `mergeable` is `MERGEABLE`, `mergeStateStatus` is `CLEAN`, and
`nonPassing` is empty; `unresolvedThreads` is `0`. Resolve any review thread
before merging and rerun affected checks after every code change.

- [ ] **Step 5: Squash-merge the PR**

Run:

```bash
gh pr merge "$(gh pr view --json number --jq .number)" \
  --squash \
  --subject "fix: widen OpenCoven Tools settings control" \
  --body "Keep CovenCave compact while OpenCoven Tools spans the full Settings > About controls grid on desktop, with the existing narrow layout preserved."
```

Expected: the PR state becomes `MERGED`.

- [ ] **Step 6: Close the Bead and clean the feature transport**

From the repository root, run:

```bash
bd close cave-77y74 \
  --reason "Full-width OpenCoven Tools layout merged with protected checks passing." \
  --session c62815d6-4d65-4f8d-a5dc-db27f88d2870
git worktree remove .worktrees/cave-77y74-opencoven-tools-full-width
git branch -D fix/cave-77y74-opencoven-tools-full-width
git push origin --delete fix/cave-77y74-opencoven-tools-full-width
git worktree list
```

Expected: the Bead is closed, the local worktree and branch are gone, the
remote feature branch is deleted, and `main` remains untouched locally except
for unrelated pre-existing user changes.
