# Activity Lattice Readability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Repair the familiar activity lattice so its density ramp survives outliers, its year cells remain square, its quarter caption does not overlap the chart, and its narrow container layout is browser-verified.

**Architecture:** Preserve the existing `ActivityLattice` data shape and component DOM. Change only the pure density transform, lattice-local CSS, the design drift baseline, and focused regression coverage. Add one daemon-less Playwright test so the browser-only failures that escaped source-text tests remain permanently covered.

**Tech Stack:** TypeScript, React 19, CSS container queries, Node's built-in test runner, Playwright, Next.js.

---

## File Map

- Modify `src/lib/activity-lattice.ts`: use logarithmic density scaling without changing the exported API.
- Modify `src/lib/activity-lattice.test.ts`: pin the outlier distribution, monotonicity, and existing boundary guarantees.
- Modify `src/styles/familiar-analytics.css`: restore square year cells and separate quarter layout from fortnight bars.
- Modify `src/components/familiar-activity-lattice.test.ts`: pin the CSS structure that prevents the two visual regressions.
- Modify `src/lib/design-token-drift.test.ts`: admit and justify one 2px short-solid-mark radius.
- Create `tests/familiar-activity-lattice.spec.ts`: verify computed browser geometry, shade distribution, and the actual narrow container query.

### Task 1: Make Density Scaling Outlier-Resistant

**Files:**
- Modify: `src/lib/activity-lattice.test.ts:88-106`
- Modify: `src/lib/activity-lattice.ts:49-61`

- [ ] **Step 1: Write the failing logarithmic-density tests**

Add these tests after `"any activity is visibly distinct from silence"`:

```ts
test("density uses the full ramp when one day is an extreme outlier", () => {
  const counts = [0, 1, 4, 12, 24, 100];
  assert.deepEqual(
    counts.map((count) => densityStep(count, 100)),
    [0, 1, 2, 3, 3, 4],
  );
});

test("density remains monotonic across the full window", () => {
  const steps = Array.from({ length: 101 }, (_, count) =>
    densityStep(count, 100),
  );
  assert.equal(
    steps.every((step, index) => index === 0 || step >= steps[index - 1]),
    true,
  );
});
```

- [ ] **Step 2: Run the model test and confirm the regression is exposed**

Run:

```bash
node --experimental-strip-types src/lib/activity-lattice.test.ts
```

Expected: FAIL because the current linear implementation maps counts `4`, `12`, and `24` to step `1` instead of steps `2`, `3`, and `3`.

- [ ] **Step 3: Implement the guarded logarithmic ratio**

Replace the `densityStep` documentation and implementation with:

```ts
/**
 * Bucket a day count into a 0-4 density step on a logarithmic curve against
 * the window peak. The curve keeps one extreme day from flattening ordinary
 * active days into one shade. Any non-zero day is still at least step 1.
 */
export function densityStep(count: number, peak: number): number {
  if (count <= 0) return 0;
  if (peak <= 0) return 0;
  const scaled = Math.ceil(
    (Math.log1p(count) / Math.log1p(peak)) * DENSITY_STEPS,
  );
  return Math.min(DENSITY_STEPS, Math.max(1, scaled));
}
```

- [ ] **Step 4: Run the focused model test**

Run:

```bash
node --experimental-strip-types src/lib/activity-lattice.test.ts
```

Expected: PASS, including zero handling, nonzero visibility, monotonicity, and saturation above the peak.

- [ ] **Step 5: Commit the density model**

```bash
git add src/lib/activity-lattice.ts src/lib/activity-lattice.test.ts
git commit -m "fix(analytics): preserve lattice density under outliers"
```

### Task 2: Repair Cell Shape and Quarter Layout

**Files:**
- Modify: `src/components/familiar-activity-lattice.test.ts:118-180`
- Modify: `src/styles/familiar-analytics.css:3080-3130`
- Modify: `src/lib/design-token-drift.test.ts:72`

- [ ] **Step 1: Add failing CSS contract assertions**

Insert these assertions after the existing density-model wiring assertion:

```ts
assert.match(
  css,
  /\.fa-lattice__day\s*\{[^}]*border-radius:\s*2px;/,
  "year cells keep a 2px micro-radius so the square grid never becomes circles",
);
assert.doesNotMatch(
  css,
  /\.fa-lattice__trend,\s*\n?\.fa-lattice__pulse\s*\{/,
  "the quarter Sparkline does not inherit the fortnight bar layout",
);
assert.match(
  css,
  /\.fa-lattice__trend\s*\{[^}]*display:\s*block;[^}]*margin:\s*0;/,
  "the quarter figure stacks its Sparkline and caption vertically",
);
assert.match(
  css,
  /\.fa-lattice__pulse\s*\{[^}]*display:\s*flex;[^}]*height:\s*72px;/,
  "the fortnight alone retains the fixed-height flex bar layout",
);
assert.match(
  css,
  /\.fa-lattice__trend figcaption\s*\{[^}]*margin-top:\s*var\(--space-1\);/,
  "the quarter caption has explicit space below the Sparkline",
);
```

- [ ] **Step 2: Run the component contract test and confirm it fails**

Run:

```bash
node --experimental-strip-types src/components/familiar-activity-lattice.test.ts
```

Expected: FAIL because the year cell uses `var(--radius-sm)` and the quarter and fortnight still share one flex rule.

- [ ] **Step 3: Split the lattice CSS by responsibility**

Change the year cell rule to:

```css
.fa-lattice__day {
  aspect-ratio: 1;
  border-radius: 2px;
  background: var(--bg-hover);
}
```

Replace the shared quarter/fortnight rule with:

```css
/* Quarter: the Sparkline and its caption stack vertically. */
.fa-lattice__trend {
  display: block;
  min-width: 0;
  margin: 0;
}
.fa-lattice__trend figcaption {
  margin-top: var(--space-1);
  color: var(--text-muted);
  font-size: var(--text-2xs);
}

/* Fortnight: daily bars share one fixed-height baseline. */
.fa-lattice__pulse {
  display: flex;
  align-items: flex-end;
  gap: var(--space-1);
  height: 72px;
}
```

Do not change the density colors, selected-day outline, Sparkline height, or fortnight button rules.

- [ ] **Step 4: Raise the radius ratchet with the exact justification**

Change `offScaleRadiusPx` from `231` to `232` in `src/lib/design-token-drift.test.ts`. Prepend this explanation to the existing comment:

```ts
// +1: activity lattice year cells (cave-noz1s) — a 2px radius keeps the roughly
// 10px density swatches square; --radius-sm turns them into circles. This is the
// same short-solid-mark exception as the Chart Room and GitHub signal strips.
```

Keep all existing historical baseline commentary after the new explanation.

- [ ] **Step 5: Run focused CSS and drift tests**

Run:

```bash
node --experimental-strip-types src/components/familiar-activity-lattice.test.ts
node --experimental-strip-types src/lib/design-token-drift.test.ts
```

Expected: both commands PASS. The drift output reports `radius=232`, with no new spacing, color, font, or inline-style drift.

- [ ] **Step 6: Commit the visual corrections**

```bash
git add src/styles/familiar-analytics.css \
  src/components/familiar-activity-lattice.test.ts \
  src/lib/design-token-drift.test.ts
git commit -m "fix(analytics): restore activity lattice readability"
```

### Task 3: Add Browser Regression Coverage

**Files:**
- Create: `tests/familiar-activity-lattice.spec.ts`

- [ ] **Step 1: Create the daemon-less Playwright fixture**

Create `tests/familiar-activity-lattice.spec.ts` with:

```ts
import { expect, test, type Page } from "@playwright/test";

const DAY_MS = 24 * 60 * 60_000;

function sessionsForDay(daysBack: number, count: number) {
  const updatedAt = new Date(Date.now() - daysBack * DAY_MS).toISOString();
  return Array.from({ length: count }, (_, index) => ({
    id: `nova-${daysBack}-${index}`,
    familiarId: "nova",
    title: `Nova session ${daysBack}-${index}`,
    created_at: updatedAt,
    updated_at: updatedAt,
    archived_at: null,
  }));
}

async function gotoAnalytics(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.setItem("cave:onboarding:dismissed", "1");
  });

  await page.route("**/api/**", (route) =>
    route.fulfill({ status: 503, json: { ok: false, error: "not needed" } }),
  );
  await page.route("**/api/familiars", (route) =>
    route.fulfill({
      json: {
        ok: true,
        familiars: [{
          id: "nova",
          display_name: "Nova",
          role: "Builder",
          color: "#9386d0",
          active_sessions: 0,
        }],
      },
    }),
  );
  await page.route("**/api/familiars/nova/contract", (route) =>
    route.fulfill({ json: { ok: true, report: null } }),
  );
  await page.route("**/api/sessions/list**", (route) =>
    route.fulfill({
      json: {
        ok: true,
        sessions: [
          ...sessionsForDay(1, 1),
          ...sessionsForDay(2, 4),
          ...sessionsForDay(3, 12),
          ...sessionsForDay(4, 24),
          ...sessionsForDay(5, 100),
        ],
      },
    }),
  );
  await page.route("**/api/familiars/nova/self-reports?limit=all", (route) =>
    route.fulfill({ json: { ok: true, reports: [], total: 0 } }),
  );
  await page.route("**/api/familiars/nova/self-reports/snapshots", (route) =>
    route.fulfill({ json: { ok: true, snapshots: [], total: 0 } }),
  );

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/dashboard/familiars/nova/analytics");
  await expect(page.getByTestId("familiar-activity-lattice")).toBeVisible({
    timeout: 30_000,
  });
}

test("activity lattice keeps readable shades and geometry at wide and narrow widths", async ({
  page,
}) => {
  await gotoAnalytics(page);

  const lattice = page.getByTestId("familiar-activity-lattice");
  const activeSteps = await lattice
    .locator('.fa-lattice__day:not([data-step="0"])')
    .evaluateAll((cells) =>
      [...new Set(cells.map((cell) => cell.getAttribute("data-step")))].sort(),
    );
  expect(activeSteps).toEqual(["1", "2", "3", "4"]);

  await expect(lattice.locator(".fa-lattice__day").first()).toHaveCSS(
    "border-radius",
    "2px",
  );

  const quarterGeometry = await lattice.locator(".fa-lattice__trend").evaluate(
    (figure) => {
      const spark = figure.querySelector<HTMLElement>(".spark");
      const caption = figure.querySelector<HTMLElement>("figcaption");
      if (!spark || !caption) throw new Error("quarter chart is incomplete");
      const sparkRect = spark.getBoundingClientRect();
      const captionRect = caption.getBoundingClientRect();
      return {
        sparkBottom: sparkRect.bottom,
        captionTop: captionRect.top,
      };
    },
  );
  expect(quarterGeometry.captionTop).toBeGreaterThanOrEqual(
    quarterGeometry.sparkBottom,
  );

  const wide = await lattice.evaluate((root) => {
    const quarter = root.querySelector<HTMLElement>(".fa-lattice__cell--quarter");
    const fortnight = root.querySelector<HTMLElement>(".fa-lattice__cell--fortnight");
    if (!quarter || !fortnight) throw new Error("lattice cells are incomplete");
    const q = quarter.getBoundingClientRect();
    const f = fortnight.getBoundingClientRect();
    return { quarterTop: q.top, fortnightTop: f.top, quarterLeft: q.left, fortnightLeft: f.left };
  });
  expect(Math.abs(wide.quarterTop - wide.fortnightTop)).toBeLessThan(2);
  expect(wide.fortnightLeft).toBeGreaterThan(wide.quarterLeft);

  await lattice.evaluate((element) => {
    const host = element as HTMLElement;
    host.style.inlineSize = "520px";
    host.style.maxInlineSize = "520px";
  });

  await expect
    .poll(() =>
      lattice.locator(".fa-lattice__views").evaluate((views) =>
        getComputedStyle(views).gridTemplateColumns.split(" ").length,
      ),
    )
    .toBe(1);

  const narrow = await lattice.evaluate((root) => {
    const views = root.querySelector<HTMLElement>(".fa-lattice__views");
    const quarter = root.querySelector<HTMLElement>(".fa-lattice__cell--quarter");
    const fortnight = root.querySelector<HTMLElement>(".fa-lattice__cell--fortnight");
    if (!views || !quarter || !fortnight) throw new Error("lattice cells are incomplete");
    const q = quarter.getBoundingClientRect();
    const f = fortnight.getBoundingClientRect();
    return {
      sameLeft: Math.abs(q.left - f.left) < 2,
      ordered: f.top >= q.bottom,
      viewsFit: views.scrollWidth <= views.clientWidth,
    };
  });
  expect(narrow).toEqual({
    sameLeft: true,
    ordered: true,
    viewsFit: true,
  });
});
```

- [ ] **Step 2: Run the focused browser test**

Run:

```bash
pnpm exec playwright test tests/familiar-activity-lattice.spec.ts --project=desktop
```

Expected: PASS. The test proves all four active density steps render, cells compute to a 2px radius, the caption begins below the Sparkline, the wide layout has two lower columns, and a 520px lattice container stacks without overflow.

- [ ] **Step 3: Inspect the browser result**

Invoke the `run-cave-app` skill and open:

```text
/dashboard/familiars/nova/analytics
```

Capture one wide screenshot and one screenshot after narrowing the lattice container below 560px. Confirm visually:

- cells read as rounded squares, not circles;
- ordinary active days use multiple lavender shades;
- the quarter caption is below the chart;
- the stacked layout has no overlap or clipped controls.

- [ ] **Step 4: Commit the browser regression**

```bash
git add tests/familiar-activity-lattice.spec.ts
git commit -m "test(analytics): cover activity lattice browser geometry"
```

### Task 4: Run Final Quality Gates and Record the Handoff

**Files:**
- Modify through Beads CLI: `cave-noz1s` metadata/comment only

- [ ] **Step 1: Run all targeted tests together**

```bash
node --experimental-strip-types src/lib/activity-lattice.test.ts
node --experimental-strip-types src/components/familiar-activity-lattice.test.ts
node --experimental-strip-types src/lib/design-token-drift.test.ts
pnpm exec playwright test tests/familiar-activity-lattice.spec.ts --project=desktop
```

Expected: all commands PASS.

- [ ] **Step 2: Run repository quality gates**

```bash
pnpm lint
pnpm typecheck
pnpm test:app
```

Expected: all commands exit `0`.

- [ ] **Step 3: Confirm the branch is scoped**

```bash
git status --short
git diff origin/main...HEAD -- \
  docs/superpowers/specs/2026-08-08-activity-lattice-readability-design.md \
  docs/superpowers/plans/2026-08-08-activity-lattice-readability.md \
  src/lib/activity-lattice.ts \
  src/lib/activity-lattice.test.ts \
  src/styles/familiar-analytics.css \
  src/components/familiar-activity-lattice.test.ts \
  src/lib/design-token-drift.test.ts \
  tests/familiar-activity-lattice.spec.ts
```

Expected: no unrelated files and no uncommitted implementation changes.

- [ ] **Step 4: Record branch, worktree, and verification on the bead**

```bash
bd update cave-noz1s --comment "Implemented on fix/cave-noz1s-activity-lattice in .worktrees/cave-noz1s-activity-lattice. Verified logarithmic density scaling, square year cells, quarter caption flow, and the <=560px container layout with focused Node tests, design-token drift, Playwright desktop coverage, lint, typecheck, and the app suite."
```

Expected: Bead remains `in_progress` until the PR merges or explicit completion criteria authorize closure.
