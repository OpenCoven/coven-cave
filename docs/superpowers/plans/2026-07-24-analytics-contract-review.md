# Analytics Contract Review Button + Empty-Results Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On the Familiar Analytics page, stop empty-state cards from leaving blank holes in the two-column grid, and give failing Contract compliance reports a "Review and resolve" button that direct-launches a chat seeded with the rehabilitation brief.

**Architecture:** Two surgical changes to one surface. (1) CSS-only layout fix: let `.fa-grid` rows stretch (grid default) and vertically center empty states inside their cards. (2) The `ContractCompliance` component gains an `onReview` callback prop and renders a primary Button when the report fails; the parent (`FamiliarAnalyticsContent`) owns the launch via the existing `requestAgentsNewChat` bridge + `buildRehabilitationBrief` — the exact flow the Studio Contract tab already uses.

**Tech Stack:** Next.js/React (TSX), plain CSS (component-imported sheet), node:test source-contract tests run with `--experimental-strip-types`.

**Spec:** `docs/superpowers/specs/2026-07-24-analytics-contract-review-design.md` (in the primary checkout at `/Users/buns/Documents/GitHub/OpenCoven/coven-cave`; `docs/superpowers` is gitignored — local-only, do not try to commit it).

**One deliberate deviation from the spec:** the spec listed a `familiarName` prop on `ContractCompliance`. It is not needed — the button copy is static and the brief is built in the parent, which already derives `familiarName`. YAGNI: only `onReview` is added.

**Worktree:** All work happens in `/Users/buns/Documents/GitHub/OpenCoven/coven-cave/.worktrees/feat-analytics-contract-review` (branch `feat/analytics-contract-review`, already created from `origin/main`, already has `node_modules` via pnpm — if not, run `pnpm install` there first, ~10s). All commands below run from that directory. Commits MUST be signed (`git commit -S`).

**Key existing code you'll touch or reuse (read these before editing):**

- `src/components/familiar-analytics-content.tsx`
  - `FaSection` shell (~line 37): renders `<section className="fa-section…">` with a head div, then `{children}` as direct children.
  - `ContractCompliance` (~line 886): memoized, currently takes only `{ report }`.
  - Parent `FamiliarAnalyticsContent` (~line 1320): `familiarName` derived at ~1332, `useAnnouncer()` at ~1367, `confirmAction` at ~1377 (the launch pattern to mirror), callsite `<ContractCompliance report={model.contractReport} />` at ~1555.
- `src/styles/familiar-analytics.css`: `.fa-grid` at ~376 (has `align-items: start` — the bug), `.fa-section` at ~383, `.fa-thread-empty { min-width: 0; }` at ~869, single-column collapse `@container fa (max-width: 880px)` at ~1712.
- `src/lib/familiar-rehabilitation.ts`: `buildRehabilitationBrief(familiarName, report)` — pure, unit-tested brief generator.
- `src/lib/agents-new-chat.ts`: `requestAgentsNewChat({ familiarId, initialPrompt, origin })` — already imported in the content file (line ~29).
- `src/components/familiar-studio-contract-tab.tsx` (~line 129–148): the Studio precedent — `<Button variant="primary" size="sm" className="self-start" leadingIcon="ph:sparkle">` launching a rehabilitation chat when `!report.pass`. (`self-start` is a Tailwind 4 utility; Tailwind is in this repo.)
- `src/components/familiar-analytics-view.test.ts`: the source-contract test for this surface (node:test `describe`/`it`; reads the content TSX into `source` at top, reads `faCss` per-test). Already registered in `scripts/run-tests.mjs` — extending it needs NO registration change.

**Test command used throughout (run from the worktree root):**

```bash
node --require ./scripts/css-source-contract-hook.cjs --experimental-strip-types src/components/familiar-analytics-view.test.ts
```

---

### Task 1: Empty-results layout — stretch grid rows, center empty states

**Files:**
- Modify: `src/components/familiar-analytics-view.test.ts` (add one `it` block after the `it("leads the grid with the full-width self-heal queue and closes with wide contract compliance", …)` block, which ends around line 502)
- Modify: `src/styles/familiar-analytics.css:375-393`

- [ ] **Step 1: Write the failing test**

In `src/components/familiar-analytics-view.test.ts`, directly after the closing `});` of the `it("leads the grid with the full-width self-heal queue and closes with wide contract compliance", …)` block (~line 502), insert:

```ts
  it("stretches grid rows and centers empty states so short empty cards don't leave holes", () => {
    const faCss = readFileSync(new URL("../styles/familiar-analytics.css", import.meta.url), "utf8");
    const grid = faCss.match(/\.fa-grid\s*\{[^}]*\}/);
    assert.ok(grid, ".fa-grid rule should exist");
    assert.doesNotMatch(
      grid![0],
      /align-items:\s*start/,
      "grid rows stretch (the default), so an empty card fills its row instead of floating over a blank gap",
    );
    assert.match(
      faCss,
      /\.fa-section > \.ui-empty-state,\s*\.fa-section > \.fa-thread-empty\s*\{[^}]*margin-block:\s*auto/,
      "empty states center vertically inside a stretched card",
    );
  });
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
node --require ./scripts/css-source-contract-hook.cjs --experimental-strip-types src/components/familiar-analytics-view.test.ts
```

Expected: FAIL — the new `it` reports `grid rows stretch (the default)…` (the `align-items: start` doesNotMatch assertion trips first). All previously existing tests still pass.

- [ ] **Step 3: Make the CSS change**

In `src/styles/familiar-analytics.css`, replace the `.fa-grid` block (lines ~375–381):

```css
/* Sections flow in two columns on wide panes; `--wide` spans both. */
.fa-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 18px;
  align-items: start;
}
```

with (drop `align-items: start` — stretch is the grid default — and extend the comment):

```css
/* Sections flow in two columns on wide panes; `--wide` spans both. Rows
   stretch (grid default) so a short card sharing a row with a tall neighbor
   fills the cell instead of floating over a blank gap. */
.fa-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 18px;
}
```

Then, immediately after the `.fa-section { … }` block (ends ~line 393, right before the `/* Arriving via a drill-through flashes… */` comment), insert:

```css
/* Inside a stretched card, an empty-state notice centers in the leftover
   space instead of hugging the top. Covers both shapes that occur as direct
   section children: the shared EmptyState and thread-signals' wrapper. */
.fa-section > .ui-empty-state,
.fa-section > .fa-thread-empty { margin-block: auto; }
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
node --require ./scripts/css-source-contract-hook.cjs --experimental-strip-types src/components/familiar-analytics-view.test.ts
```

Expected: PASS (all tests, including the new one).

- [ ] **Step 5: Run the neighboring behavior pins (unchanged files, must stay green)**

```bash
node --require ./scripts/css-source-contract-hook.cjs --experimental-strip-types src/components/thread-signals-section.test.ts
node --require ./scripts/css-source-contract-hook.cjs --experimental-strip-types src/lib/design-token-drift.test.ts
```

Expected: both PASS. (`thread-signals-section.test.ts` pins that an empty Thread signals section does NOT go wide — we didn't touch that. `design-token-drift.test.ts` confirms the CSS codemod stays a no-op; `margin-block: auto` has no px literal so nothing to tokenize.)

- [ ] **Step 6: Commit (signed)**

```bash
git add src/styles/familiar-analytics.css src/components/familiar-analytics-view.test.ts
git commit -S -m "fix(analytics): stretch fa-grid rows and center empty states

A short empty-state card sharing a grid row with a tall neighbor (e.g.
empty thread-analysis confidence next to a full Recent sessions list)
floated at the top of the row and left a large blank hole beneath it.
Drop align-items:start so rows stretch, and center empty-state notices
inside the stretched cards.

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
git push -u origin feat/analytics-contract-review
```

---

### Task 2: "Review and resolve" button on failing contract reports

**Files:**
- Modify: `src/components/familiar-analytics-view.test.ts` (add one `it` block right after the one added in Task 1)
- Modify: `src/components/familiar-analytics-content.tsx` (import at ~line 29, `ContractCompliance` at ~886, parent callback at ~1387, callsite at ~1555)

- [ ] **Step 1: Write the failing test**

In `src/components/familiar-analytics-view.test.ts`, directly after the `it("stretches grid rows and centers empty states…")` block added in Task 1, insert:

```ts
  it("offers a direct review launch when the contract fails", () => {
    // Same flow as the Studio Contract tab: seed a chat with the shared,
    // deterministic rehabilitation brief. No confirm modal — direct launch.
    assert.match(
      source,
      /import \{ buildRehabilitationBrief \} from "@\/lib\/familiar-rehabilitation";/,
      "content reuses the shared rehabilitation brief builder",
    );
    assert.match(
      source,
      /buildRehabilitationBrief\(familiarName, model\.contractReport\)/,
      "the review thread is seeded with the brief for this familiar's failing report",
    );
    assert.match(
      source,
      /\{!report\.pass \? \([\s\S]*?Review and resolve[\s\S]*?\) : null\}/,
      "the Review and resolve button renders only for failing reports",
    );
    assert.match(
      source,
      /onReview=\{reviewContract\}/,
      "the contract section is wired to the parent-owned launch callback",
    );
    assert.match(
      source,
      /const reviewContract = useCallback\(\(\) => \{[\s\S]*?requestAgentsNewChat\(\{[\s\S]*?familiarId: model\.familiarId,[\s\S]*?origin: "chat"/,
      "review launches a familiar-scoped working thread via the agents-new-chat bridge",
    );
    assert.match(
      source,
      /announce\(`Opening a review thread to repair \$\{familiarName\}'s contract\.`\)/,
      "the launch is announced to assistive tech",
    );
  });
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
node --require ./scripts/css-source-contract-hook.cjs --experimental-strip-types src/components/familiar-analytics-view.test.ts
```

Expected: FAIL — the new `it` reports `content reuses the shared rehabilitation brief builder`.

- [ ] **Step 3: Implement in `familiar-analytics-content.tsx`**

**(a)** After the existing import at ~line 29 (`import { requestAgentsNewChat } from "@/lib/agents-new-chat";`), add:

```ts
import { buildRehabilitationBrief } from "@/lib/familiar-rehabilitation";
```

**(b)** Change the `ContractCompliance` signature (~line 886) from:

```tsx
const ContractCompliance = memo(function ContractCompliance({ report }: { report: ContractReport | null }) {
```

to:

```tsx
const ContractCompliance = memo(function ContractCompliance({
  report,
  onReview,
}: {
  report: ContractReport | null;
  /** Direct-launch a review thread for a failing report (parent owns the launch). */
  onReview: () => void;
}) {
```

**(c)** Inside the same component, directly after the detail-panel expression (`{detail ? ( … ) : null}`, ends ~line 938) and before the closing `</>`, add:

```tsx
          {/* Failing contract = operating as an agent. Mirror the Studio
              Contract tab: direct-launch a chat seeded with the rehabilitation
              brief so investigation and resolution start in one click. */}
          {!report.pass ? (
            <Button
              variant="primary"
              size="sm"
              className="self-start"
              leadingIcon="ph:sparkle"
              onClick={onReview}
            >
              Review and resolve
            </Button>
          ) : null}
```

(This sits inside the `{report ? (…) : (…)}` truthy branch, so `report` is non-null there. `Button` is already imported; `ph:sparkle` is already in `ICON_NAMES` — no icon-subset regeneration.)

**(d)** In `FamiliarAnalyticsContent`, directly after the `confirmAction` callback (ends ~line 1387), add:

```tsx
  // Contract review: direct-launch a thread seeded with the rehabilitation
  // brief — the same "Rite of Binding" flow as the Studio Contract tab.
  const reviewContract = useCallback(() => {
    if (!model.contractReport) return;
    requestAgentsNewChat({
      familiarId: model.familiarId,
      initialPrompt: `${buildRehabilitationBrief(familiarName, model.contractReport)}\n\nAnalytics source: /dashboard/familiars/${encodeURIComponent(model.familiarId)}/analytics`,
      origin: "chat" as const,
    });
    announce(`Opening a review thread to repair ${familiarName}'s contract.`);
  }, [announce, familiarName, model.contractReport, model.familiarId]);
```

**(e)** Update the callsite (~line 1555) from:

```tsx
        <ContractCompliance report={model.contractReport} />
```

to:

```tsx
        <ContractCompliance report={model.contractReport} onReview={reviewContract} />
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
node --require ./scripts/css-source-contract-hook.cjs --experimental-strip-types src/components/familiar-analytics-view.test.ts
```

Expected: PASS (all tests).

- [ ] **Step 5: Type-check and lint the changed files**

```bash
pnpm exec tsc --noEmit
pnpm exec eslint src/components/familiar-analytics-content.tsx src/components/familiar-analytics-view.test.ts
```

Expected: both clean (tsc may take ~1–2 min; the eslint run includes the design-gate rules).

- [ ] **Step 6: Commit (signed) and push**

```bash
git add src/components/familiar-analytics-content.tsx src/components/familiar-analytics-view.test.ts
git commit -S -m "feat(analytics): review-and-resolve launch for failing contract reports

The Contract compliance section showed violations but offered no action.
When the report fails, render a section-level 'Review and resolve' button
that direct-launches a working thread seeded with the shared rehabilitation
brief (buildRehabilitationBrief) — the same flow as the Studio Contract
tab — plus an analytics-source provenance line, with an a11y announcement.

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
git push
```

---

### Task 3: Full verification, PR, merge

**Files:** none created/modified (verification + workflow only)

- [ ] **Step 1: Run the full neighboring test set**

```bash
node --require ./scripts/css-source-contract-hook.cjs --experimental-strip-types src/components/familiar-analytics-view.test.ts
node --require ./scripts/css-source-contract-hook.cjs --experimental-strip-types src/components/thread-signals-section.test.ts
node --require ./scripts/css-source-contract-hook.cjs --experimental-strip-types src/lib/familiar-rehabilitation.test.ts
node --require ./scripts/css-source-contract-hook.cjs --experimental-strip-types src/components/familiar-studio-contract-tab.test.ts
node --require ./scripts/css-source-contract-hook.cjs --experimental-strip-types src/lib/design-token-drift.test.ts
```

Expected: all five print ok / pass with exit code 0.

- [ ] **Step 2: Design codemod no-op check**

```bash
pnpm codemod:design:check
```

Expected: clean (no rewrites proposed).

- [ ] **Step 3: Open the PR**

```bash
gh pr create --base main --head feat/analytics-contract-review \
  --title "feat(analytics): contract review launch + empty-results grid layout" \
  --body "$(cat <<'EOF'
Two fixes for the Familiar Analytics surface (design spec: docs/superpowers/specs/2026-07-24-analytics-contract-review-design.md, local-only):

**1. Empty results no longer leave holes in the grid.** `.fa-grid` had `align-items: start`, so a short empty-state card sharing a row with a tall neighbor (empty confidence card next to a full Recent sessions list) floated over a large blank gap. Rows now stretch (grid default) and empty-state notices center vertically inside their cards (`.fa-section > .ui-empty-state`, `.fa-section > .fa-thread-empty`). No JSX/order changes; the "empty thread-signals doesn't go wide" pin is untouched.

**2. Contract compliance violations are actionable.** When the contract report fails, the section renders a "Review and resolve" primary button that direct-launches a working thread seeded with `buildRehabilitationBrief` (the Studio Contract tab's exact flow) plus an analytics-source provenance line, announced via the live region.

**Testing:** extended `familiar-analytics-view.test.ts` (already registered) with pins for both behaviors; ran thread-signals, rehabilitation, studio-contract-tab, and design-token-drift suites; `tsc --noEmit` and design-gate eslint clean.
EOF
)"
```

- [ ] **Step 4: Wait for required checks, then squash-merge**

```bash
gh pr checks feat/analytics-contract-review --watch
```

Expected: `Frontend build`, `Rust check`, `E2E (Playwright)`, `Cross-environment required`, `Sidecar runtime required`, `CodeQL` all pass. Then:

```bash
gh pr merge feat/analytics-contract-review --squash --delete-branch
```

(If the merge commit message is editable, keep the `Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>` trailer.)

- [ ] **Step 5: Local cleanup (squash orphans the tip — bypass is sanctioned after verifying content landed)**

```bash
cd /Users/buns/Documents/GitHub/OpenCoven/coven-cave
git fetch origin --quiet
# verify the squash landed the same content before destroying the branch:
git diff feat/analytics-contract-review origin/main -- src/components/familiar-analytics-content.tsx src/components/familiar-analytics-view.test.ts src/styles/familiar-analytics.css
# expected: empty diff. Then:
WT_GUARD_BYPASS=1 git worktree remove .worktrees/feat-analytics-contract-review
WT_GUARD_BYPASS=1 git branch -D feat/analytics-contract-review
git worktree list
```

Expected: worktree gone, branch gone, `git worktree list` no longer shows it.
