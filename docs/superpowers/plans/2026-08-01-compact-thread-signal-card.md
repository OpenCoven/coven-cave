# Compact Thread Signal Card Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Thread Signal chat cards substantially denser, less rounded, and responsive to their own available width with one score column when constrained and three columns only when wide.

**Architecture:** Keep the component markup and behavior unchanged; this is a token-only presentation refinement in the existing global Thread Signal card styles. Make `.tsc-card` the named size container, default `.tsc-scores` to one column, and use one `min-width: 560px` container query for the three-column layout.

**Tech Stack:** React 19, TypeScript, CSS container queries, Coven Cave design tokens, Node test runner.

---

## File Structure

- Modify `src/components/thread-signal-card.test.ts` to pin the compact spacing, smaller radius, named container, direct one-to-three-column behavior, and absence of a two-column state.
- Modify `src/styles/globals/shell-cards-and-controls.css` to implement the compact card without changing component behavior or data.
- Verify `docs/superpowers/specs/2026-08-01-compact-thread-signal-card-design.md` remains the source of truth; no further spec changes are expected.

### Task 1: Pin compact responsive behavior

**Files:**
- Modify: `src/components/thread-signal-card.test.ts:1-76`
- Read: `src/styles/globals/shell-cards-and-controls.css:33-125`

- [ ] **Step 1: Load the card stylesheet in the existing test**

Add this next to the existing `source` fixture:

```ts
const styles = readFileSync(
  new URL("../styles/globals/shell-cards-and-controls.css", import.meta.url),
  "utf8",
);
```

- [ ] **Step 2: Add the failing compact-layout test**

Add this test inside `describe("thread-signal-card module wiring", ...)`:

```ts
it("keeps the card compact and switches directly from one to three score columns", () => {
  assert.match(
    styles,
    /\.tsc-card\s*\{[\s\S]*?container-name:\s*thread-signal;[\s\S]*?container-type:\s*inline-size;[\s\S]*?gap:\s*var\(--space-2\);[\s\S]*?padding:\s*var\(--space-2\);[\s\S]*?border-radius:\s*var\(--radius-sm\);/,
  );
  assert.match(
    styles,
    /\.tsc-scores\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\);/,
  );
  assert.match(
    styles,
    /\.tsc-score-item\s*\{[\s\S]*?padding:\s*var\(--space-1\);[\s\S]*?border-radius:\s*var\(--radius-sm\);/,
  );
  assert.match(
    styles,
    /\.tsc-actions button\s*\{[\s\S]*?min-height:\s*var\(--space-6\);/,
  );
  assert.match(
    styles,
    /@container thread-signal \(min-width:\s*560px\)\s*\{[\s\S]*?\.tsc-scores\s*\{[\s\S]*?grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\);/,
  );
  assert.doesNotMatch(
    styles,
    /grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/,
  );
});
```

- [ ] **Step 3: Run the focused test and confirm it fails**

Run:

```bash
pnpm exec tsx --test src/components/thread-signal-card.test.ts
```

Expected: FAIL in the new compact-layout test because `.tsc-card` is not yet a named container, the default score grid is still three columns, and the current spacing and radii do not match.

### Task 2: Implement the balanced compact card

**Files:**
- Modify: `src/styles/globals/shell-cards-and-controls.css:33-125`
- Test: `src/components/thread-signal-card.test.ts`

- [ ] **Step 1: Make the card compact and establish its size container**

Replace the opening card rule with:

```css
.tsc-card {
  container-name: thread-signal;
  container-type: inline-size;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  margin: var(--space-2) 0;
  padding: var(--space-2);
  border: 1px solid color-mix(in oklch, var(--accent-presence) 34%, var(--border-hairline));
  border-radius: var(--radius-sm);
  background: color-mix(in oklch, var(--accent-presence) 7%, var(--bg-surface));
  color: var(--text-primary);
}
```

This preserves the existing surface and severity recipe while reducing the outer footprint and making layout depend on the actual card width.

- [ ] **Step 2: Tighten header and title spacing**

Update only the gap declarations:

```css
.tsc-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  min-width: 0;
}

.tsc-title {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  font-size: var(--text-sm);
  font-weight: 700;
}
```

Keep `.tsc-meta` truncation unchanged so long thread names cannot widen the card.

- [ ] **Step 3: Default scores to one compact column**

Replace the score grid and score item rules with:

```css
.tsc-scores {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: var(--space-1);
}

.tsc-score-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  min-width: 0;
  padding: var(--space-1);
  border: 1px solid var(--border-hairline);
  border-radius: var(--radius-sm);
  background: var(--bg-base);
}
```

Do not change the label/value typography or semantic severity selectors.

- [ ] **Step 4: Tighten blocker and action density**

Use:

```css
.tsc-blockers {
  color: var(--color-warning);
  font-size: var(--text-sm);
  line-height: 1.3;
}

.tsc-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1);
}

.tsc-actions button {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  min-height: var(--space-6);
  padding: 0 var(--space-2);
  border: 1px solid var(--border-hairline);
  border-radius: var(--radius-sm);
  background: var(--bg-base);
  color: var(--text-secondary);
  font-size: var(--text-sm);
}
```

Keep the existing hover rule and visible button labels unchanged.

- [ ] **Step 5: Add the wide-card three-column layout**

Place this after the base Thread Signal card rules:

```css
@container thread-signal (min-width: 560px) {
  .tsc-scores {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}
```

Do not add a two-column query. The card must switch directly from one to three columns.

- [ ] **Step 6: Run the focused test**

Run:

```bash
pnpm exec tsx --test src/components/thread-signal-card.test.ts
```

Expected: all `thread-signal-card.test.ts` tests PASS.

### Task 3: Validate design-system and regression safety

**Files:**
- Verify: `src/components/thread-signal-card.test.ts`
- Verify: `src/styles/globals/shell-cards-and-controls.css`
- Verify: `docs/superpowers/specs/2026-08-01-compact-thread-signal-card-design.md`

- [ ] **Step 1: Run the targeted Thread Signal tests together**

Run:

```bash
pnpm exec tsx --test src/components/thread-signal-card.test.ts src/components/thread-signals-section.test.ts
```

Expected: both test files PASS with no failures.

- [ ] **Step 2: Run the design codemod drift check**

Run:

```bash
pnpm codemod:design:check
```

Expected: exit code 0 and no files requiring tokenization.

- [ ] **Step 3: Run whitespace and scoped diff checks**

Run:

```bash
git diff --check
git --no-pager diff -- src/components/thread-signal-card.test.ts src/styles/globals/shell-cards-and-controls.css docs/superpowers/specs/2026-08-01-compact-thread-signal-card-design.md docs/superpowers/plans/2026-08-01-compact-thread-signal-card.md
```

Expected: `git diff --check` exits 0; the scoped diff contains only the approved card-density, radius, responsive test, spec, and plan changes.

- [ ] **Step 4: Inspect constrained and wide rendering**

Run the native app in the foreground:

```bash
bash scripts/dev-app.sh
```

Open a chat containing a Thread Signal card, resize the chat pane below and
above `560px`, then stop the app with `Ctrl-C`.

Expected below `560px`:

```text
Scores: 1 column
Card: full available chat width
Overflow: none
Actions: wrapped when needed
```

Expected at or above `560px`:

```text
Scores: 3 equal columns
Card radius: visibly tighter than the previous control radius
Overflow: none
```

- [ ] **Step 5: Record completion in Beads**

Update `cave-slw35` with the exact test commands and rendered-width evidence. Keep it `in_progress` until the implementation is complete; close it only when its explicit completion criteria are satisfied.

Do not commit, push, or open a pull request without explicit user authorization.
