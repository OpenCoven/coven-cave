# Compact Assistant Tool Activity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace tall per-turn tool activity with one compact, status-aware disclosure while keeping edit review cards visible and auto-expanding only repeated running-call groups.

**Architecture:** Keep the existing turn renderer and `ToolEvent` model intact. Add pure summary derivation beside the existing batch model, isolate repeated-run disclosure state in a small tested hook, then wire both into `ToolGroup`/`ToolRunGroup` and tighten the existing token-based CSS.

**Tech Stack:** TypeScript, React 19, native `details`/`summary`, Node test runner, react-test-renderer, CSS design tokens

---

## File map

- Modify `src/lib/chat-tool-batches.ts`: derive the compact turn-level call/category summary from existing tool events.
- Modify `src/lib/chat-tool-batches.test.ts`: prove category order, de-duplication, and singular/plural copy.
- Create `src/lib/use-tool-run-disclosure.ts`: own repeated-run automatic/manual disclosure state and focus-safe deferred collapse.
- Create `src/lib/use-tool-run-disclosure.test.ts`: exercise running, settlement, manual toggles, and focus behavior.
- Modify `scripts/run-tests.mjs`: wire the new hook test into the app suite.
- Modify `src/components/chat-view.tsx`: render the compact outer summary and use the repeated-run hook without changing edit-card separation.
- Modify `src/components/chat-tool-batches-ui.test.ts`: replace obsolete work-line source pins with compact rollup pins.
- Modify `src/components/chat-view-polish-tools-activity.test.ts`: pin outer/repeated disclosure behavior, edit-card placement, and accessibility labels.
- Modify `src/styles/cave-chat/activity.css`: reduce expanded row/card density using existing tokens.
- Modify `src/styles/cave-chat/transcript.css`: make the outer collapsed row low-height and preserve full-width expanded content.

### Task 1: Derive the compact turn summary

**Files:**
- Modify: `src/lib/chat-tool-batches.ts:21-31,143-156`
- Modify: `src/lib/chat-tool-batches.test.ts:7-13,112-129`

- [ ] **Step 1: Replace the old rollup assertions with failing compact-summary tests**

Update the import and replace the `toolBatchSummary` test block:

```ts
import {
  LONG_RUNNING_BATCH_MS,
  formatBatchDuration,
  toolActivitySummary,
  toolBatches,
  turnSkills,
} from "./chat-tool-batches.ts";

test("tool activity summary states call count and unique categories in first-use order", () => {
  assert.equal(
    toolActivitySummary([
      tool({ id: "a", name: "Grep" }),
      tool({ id: "b", name: "Read" }),
      tool({ id: "c", name: "Glob" }),
      tool({ id: "d", name: "Bash" }),
    ]),
    "4 calls · search, read, shell",
  );
});

test("tool activity summary uses singular copy and keeps other as a real category", () => {
  assert.equal(toolActivitySummary([tool({ id: "a", name: "UnknownTool" })]), "1 call · other");
});

test("tool activity summary is empty when the turn has no non-edit tools", () => {
  assert.equal(toolActivitySummary([]), "");
});
```

- [ ] **Step 2: Run the pure-model test and verify it fails**

Run:

```bash
node --experimental-strip-types src/lib/chat-tool-batches.test.ts
```

Expected: FAIL because `toolActivitySummary` is not exported.

- [ ] **Step 3: Add the minimal pure summary helper**

Add this export near the current summary helpers in `src/lib/chat-tool-batches.ts`:

```ts
export function toolActivitySummary(tools: readonly BatchTool[]): string {
  if (tools.length === 0) return "";
  const categories: ToolCategory[] = [];
  for (const tool of tools) {
    const category = toolCategory(tool.name);
    if (!categories.includes(category)) categories.push(category);
  }
  const calls = `${tools.length} ${tools.length === 1 ? "call" : "calls"}`;
  return `${calls} · ${categories.join(", ")}`;
}
```

Delete `toolBatchSummary`; after Task 3 the UI will no longer import it. Keep `toolBatches`, batch duration formatting, and skill derivation unchanged.

- [ ] **Step 4: Run the pure-model test and verify it passes**

Run:

```bash
node --experimental-strip-types src/lib/chat-tool-batches.test.ts
```

Expected: PASS, including the three new compact-summary cases.

- [ ] **Step 5: Commit the pure model**

```bash
git add src/lib/chat-tool-batches.ts src/lib/chat-tool-batches.test.ts
git commit -m "refactor(chat): derive compact tool summary"
```

### Task 2: Isolate repeated-run disclosure behavior

**Files:**
- Create: `src/lib/use-tool-run-disclosure.ts`
- Create: `src/lib/use-tool-run-disclosure.test.ts`
- Modify: `scripts/run-tests.mjs` in the `app` suite beside other chat/tool tests

- [ ] **Step 1: Write the failing hook behavior test**

Create `src/lib/use-tool-run-disclosure.test.ts`:

```ts
// @ts-nocheck
import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { act, create } from "react-test-renderer";
import { useToolRunDisclosure } from "./use-tool-run-disclosure.ts";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function mount(statuses) {
  let controls;
  function Probe({ current }) {
    controls = useToolRunDisclosure(current);
    return createElement("tool-run-probe", { open: controls.open });
  }
  let renderer;
  act(() => {
    renderer = create(createElement(Probe, { current: statuses }));
  });
  return {
    controls: () => controls,
    update(current) {
      act(() => renderer.update(createElement(Probe, { current })));
    },
    unmount() {
      act(() => renderer.unmount());
    },
  };
}

test("a repeated run opens while running and collapses after settlement", () => {
  const probe = mount(["running", "running"]);
  assert.equal(probe.controls().open, true);
  probe.update(["ok", "ok"]);
  assert.equal(probe.controls().open, false);
  probe.unmount();
});

test("settled runs obey manual disclosure toggles", () => {
  const probe = mount(["ok", "ok"]);
  assert.equal(probe.controls().open, false);
  act(() => probe.controls().onToggle(true));
  assert.equal(probe.controls().open, true);
  act(() => probe.controls().onToggle(false));
  assert.equal(probe.controls().open, false);
  probe.unmount();
});

test("settlement defers collapse while focus remains inside the run", () => {
  const probe = mount(["running", "running"]);
  const inside = {};
  const outside = {};
  probe.controls().detailsRef.current = { contains: (node) => node === inside };
  globalThis.document = { activeElement: inside };

  probe.update(["ok", "ok"]);
  assert.equal(probe.controls().open, true);
  act(() => probe.controls().onBlurCapture({ currentTarget: probe.controls().detailsRef.current, relatedTarget: outside }));
  assert.equal(probe.controls().open, false);

  delete globalThis.document;
  probe.unmount();
});

test("running state cannot be manually collapsed", () => {
  const probe = mount(["running", "ok"]);
  act(() => probe.controls().onToggle(false));
  assert.equal(probe.controls().open, true);
  probe.unmount();
});
```

- [ ] **Step 2: Wire and run the test to verify it fails**

Add `"src/lib/use-tool-run-disclosure.test.ts"` to `SUITES.app` in `scripts/run-tests.mjs`, near `src/lib/chat-tool-batches.test.ts`.

Run:

```bash
node --experimental-strip-types src/lib/use-tool-run-disclosure.test.ts
```

Expected: FAIL because `useToolRunDisclosure` does not exist.

- [ ] **Step 3: Implement the focused disclosure hook**

Create `src/lib/use-tool-run-disclosure.ts`:

```ts
"use client";

import { useEffect, useRef, useState, type FocusEvent, type RefObject } from "react";

type ToolStatus = "running" | "ok" | "error";

export type ToolRunDisclosure = {
  open: boolean;
  detailsRef: RefObject<HTMLDetailsElement | null>;
  onToggle: (nextOpen: boolean) => void;
  onBlurCapture: (event: FocusEvent<HTMLDetailsElement>) => void;
};

export function useToolRunDisclosure(statuses: readonly ToolStatus[]): ToolRunDisclosure {
  const running = statuses.includes("running");
  const [open, setOpen] = useState(running);
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const wasRunningRef = useRef(running);
  const collapsePendingRef = useRef(false);

  useEffect(() => {
    if (running) {
      collapsePendingRef.current = false;
      setOpen(true);
    } else if (wasRunningRef.current) {
      const focusedInside =
        typeof document !== "undefined" &&
        detailsRef.current?.contains(document.activeElement);
      if (focusedInside) collapsePendingRef.current = true;
      else setOpen(false);
    }
    wasRunningRef.current = running;
  }, [running]);

  const onToggle = (nextOpen: boolean) => {
    if (running && !nextOpen) {
      if (detailsRef.current) detailsRef.current.open = true;
      setOpen(true);
      return;
    }
    setOpen(nextOpen);
  };

  const onBlurCapture = (event: FocusEvent<HTMLDetailsElement>) => {
    if (!collapsePendingRef.current || event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    collapsePendingRef.current = false;
    setOpen(false);
  };

  return { open, detailsRef, onToggle, onBlurCapture };
}
```

- [ ] **Step 4: Run the hook test and test-wiring guard**

Run:

```bash
node --experimental-strip-types src/lib/use-tool-run-disclosure.test.ts
pnpm check:tests-wired
```

Expected: both commands PASS.

- [ ] **Step 5: Commit the disclosure behavior**

```bash
git add src/lib/use-tool-run-disclosure.ts src/lib/use-tool-run-disclosure.test.ts scripts/run-tests.mjs
git commit -m "feat(chat): control repeated tool disclosures"
```

### Task 3: Wire compact turn and repeated-run summaries

**Files:**
- Modify: `src/components/chat-view.tsx:70-90,8762-8908`
- Modify: `src/components/chat-tool-batches-ui.test.ts:1-32`
- Modify: `src/components/chat-view-polish-tools-activity.test.ts:87-145,155-213`

- [ ] **Step 1: Replace obsolete source pins with failing compact-rollup pins**

In `src/components/chat-tool-batches-ui.test.ts`, replace the old “batches and settled calls” test with:

```ts
test("the turn rollup states call count and first-use categories while trouble stays visible", () => {
  assert.match(
    chatView,
    /const summary = toolActivitySummary\(tools\);/,
    "the collapsed phrase comes from the pure summary model",
  );
  assert.match(
    chatView,
    /\{summary\}[\s\S]{0,500}cave-tool-count--running[\s\S]{0,300}cave-tool-count--error/,
    "running and error counts remain visible beside the compact phrase",
  );
  assert.doesNotMatch(
    chatView.match(/function ToolGroup[\s\S]*?function ToolRuns/)?.[0] ?? "",
    /lastCommand|toolBatchSummary|Worked for|steps/,
    "duration, command, batch and success prose no longer crowd the outer row",
  );
});
```

In `src/components/chat-view-polish-tools-activity.test.ts`, add or update pins so they require:

```ts
assert.match(
  source,
  /function ToolGroup[\s\S]*toolActivitySummary\(tools\)[\s\S]*<details[\s\S]*data-default-collapsed="true"[\s\S]*<ToolRuns tools=\{tools\}/,
  "each assistant turn keeps one collapsed tool disclosure around its non-edit calls",
);
assert.match(
  source,
  /function ToolRunGroup[\s\S]*useToolRunDisclosure\(tools\.map\(\(tool\) => tool\.status\)\)[\s\S]*open=\{disclosure\.open\}[\s\S]*onBlurCapture=\{disclosure\.onBlurCapture\}/,
  "repeated runs use the focus-safe running disclosure controller",
);
assert.match(
  source,
  /aria-label=\{toolGroupAriaLabel\(summary, running, errors\)\}/,
  "the outer collapsed summary names its count and non-success state for assistive technology",
);
```

Keep the existing edit-card assertions that require `editCards` before `otherTools`.

- [ ] **Step 2: Run the focused UI source tests and verify they fail**

Run:

```bash
node --experimental-strip-types src/components/chat-tool-batches-ui.test.ts
node --experimental-strip-types src/components/chat-view-polish-tools-activity.test.ts
```

Expected: FAIL on missing `toolActivitySummary`, `useToolRunDisclosure`, and the new labels.

- [ ] **Step 3: Update imports and the outer `ToolGroup` summary**

In `src/components/chat-view.tsx`:

```ts
import {
  formatBatchDuration,
  toolActivitySummary,
  toolBatches,
  turnSkills,
  type ToolBatch,
} from "@/lib/chat-tool-batches";
import { useToolRunDisclosure } from "@/lib/use-tool-run-disclosure";
```

Add a local label helper:

```ts
function toolGroupAriaLabel(summary: string, running: number, errors: number): string {
  return [
    `Tool activity: ${summary}`,
    running ? `${running} running` : "",
    errors ? `${errors} ${errors === 1 ? "error" : "errors"}` : "",
  ].filter(Boolean).join(", ");
}
```

Replace duration/last-command/old-rollup derivation in `ToolGroup` with:

```ts
const summary = toolActivitySummary(tools);
```

Replace the summary body with:

```tsx
<summary
  className="cave-tool-summary focus-ring"
  aria-expanded={open}
  aria-label={toolGroupAriaLabel(summary, running, errors)}
>
  <Icon name="ph:wrench" width={12} className="shrink-0" aria-hidden />
  <span className="cave-work-line__label">{summary}</span>
  <span className="cave-work-line__status">
    {running ? <span className="cave-tool-count cave-tool-count--running">{running} running</span> : null}
    {errors ? <span className="cave-tool-count cave-tool-count--error">{errors} {errors === 1 ? "error" : "errors"}</span> : null}
  </span>
</summary>
```

Keep the outer `details` uncontrolled and collapsed by default. Keep skills and `ToolRuns` exactly once per turn.

- [ ] **Step 4: Control repeated groups and use compact count copy**

Replace `ToolRunGroup` state with:

```ts
const disclosure = useToolRunDisclosure(tools.map((tool) => tool.status));
```

Wire the native disclosure:

```tsx
<details
  ref={disclosure.detailsRef}
  className="cave-tool-run"
  data-default-collapsed="true"
  data-tool-category={visual.category}
  open={disclosure.open}
  onToggle={(event) => disclosure.onToggle(event.currentTarget.open)}
  onBlurCapture={disclosure.onBlurCapture}
>
  <summary
    className="cave-tool-summary focus-ring"
    aria-expanded={disclosure.open}
    aria-label={[
      `${displayName}, ${tools.length} calls`,
      running ? `${running} running` : "",
      errors ? `${errors} ${errors === 1 ? "error" : "errors"}` : "",
    ].filter(Boolean).join(", ")}
  >
    <Icon name={visual.icon} width={12} className="cave-tool-icon shrink-0" aria-hidden />
    <span className="cave-tool-run__name">{displayName}</span>
    <span className="cave-tool-count">×{tools.length}</span>
    <span className="cave-tool-run__status">
      {running ? <span className="cave-tool-count cave-tool-count--running">{running} running</span> : null}
      {errors ? <span className="cave-tool-count cave-tool-count--error">{errors} {errors === 1 ? "error" : "errors"}</span> : null}
    </span>
  </summary>
```

Do not change `TurnRowImpl`'s `editCards`/`otherTools` split or `containsEdit` protection in `ToolRuns`.

- [ ] **Step 5: Run focused model, hook, and UI tests**

Run:

```bash
node --experimental-strip-types src/lib/chat-tool-batches.test.ts
node --experimental-strip-types src/lib/use-tool-run-disclosure.test.ts
node --experimental-strip-types src/components/chat-tool-batches-ui.test.ts
node --experimental-strip-types src/components/chat-view-polish-tools-activity.test.ts
```

Expected: all commands PASS.

- [ ] **Step 6: Commit the component wiring**

```bash
git add src/components/chat-view.tsx src/components/chat-tool-batches-ui.test.ts src/components/chat-view-polish-tools-activity.test.ts
git commit -m "feat(chat): compact assistant tool activity"
```

### Task 4: Tighten expanded density with design tokens

**Files:**
- Modify: `src/styles/cave-chat/activity.css:204-243,338-376,485-496`
- Modify: `src/styles/cave-chat/transcript.css:282-345`
- Modify: `src/components/chat-view-polish-tools-activity.test.ts`

- [ ] **Step 1: Add failing CSS contract assertions**

Append to `src/components/chat-view-polish-tools-activity.test.ts`:

```ts
assert.match(
  styles,
  /\.cave-tool-group\.cave-work-line > \.cave-tool-summary[\s\S]*min-height: var\(--space-8\)/,
  "the collapsed turn rollup uses a compact spacing-token height",
);
assert.match(
  styles,
  /\.cave-tool-run[\s\S]*border: 0;[\s\S]*background: transparent;/,
  "repeated groups avoid nested card framing inside the expanded turn",
);
assert.match(
  styles,
  /\.cave-tool-run__list[\s\S]*gap: var\(--space-1\)/,
  "expanded repeated calls use compact list spacing",
);
assert.match(
  styles,
  /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.cave-tool-summary::before[\s\S]*transition: none/,
  "tool disclosure chevrons stop animating under reduced motion",
);
```

- [ ] **Step 2: Run the UI source test and verify it fails**

Run:

```bash
node --experimental-strip-types src/components/chat-view-polish-tools-activity.test.ts
```

Expected: FAIL because the compact density and reduced-motion contracts are absent.

- [ ] **Step 3: Apply compact token-based styles**

Update the relevant selectors:

```css
.cave-tool-group.cave-work-line > .cave-tool-summary {
  display: inline-flex;
  min-height: var(--space-8);
  max-width: 100%;
  align-items: center;
  gap: var(--space-2);
  border: 1px solid var(--border-hairline);
  border-radius: var(--radius-control);
  padding: 0 var(--space-3);
  color: var(--text-muted);
  font-size: var(--text-sm);
  font-weight: 500;
  letter-spacing: normal;
  text-transform: none;
}

.cave-work-line__label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cave-work-line__status,
.cave-tool-run__status {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: var(--space-1);
  margin-left: auto;
}

.cave-tool-run {
  border: 0;
  border-radius: 0;
  background: transparent;
  padding: var(--space-1) 0;
}

.cave-tool-run__list {
  display: grid;
  gap: var(--space-1);
  margin-top: var(--space-1);
  border-top: 1px solid var(--border-hairline);
  padding: var(--space-1) 0 0 var(--space-4);
}

.cave-tool-block {
  padding: var(--space-2);
}

@media (prefers-reduced-motion: reduce) {
  .cave-tool-summary::before {
    transition: none;
  }
}
```

Retain existing category tints, state tint recipes, code-output clamp, focus rings, and expanded outer containment. Remove obsolete `.cave-work-line__ran`/`__cmd` rules after confirming no JSX references remain.

- [ ] **Step 4: Run the CSS tokenizer before hand-tuning**

Run:

```bash
node scripts/codemods/tokenize-css.mjs
```

Expected: either no changes, or only token substitutions inside the two touched stylesheets. Inspect and keep only task-related substitutions.

- [ ] **Step 5: Run focused tests and design gates**

Run:

```bash
node --experimental-strip-types src/components/chat-view-polish-tools-activity.test.ts
node --experimental-strip-types src/components/chat-tool-batches-ui.test.ts
pnpm codemod:design:check
pnpm lint:design
```

Expected: all commands PASS with zero warnings.

- [ ] **Step 6: Commit the density pass**

```bash
git add src/styles/cave-chat/activity.css src/styles/cave-chat/transcript.css src/components/chat-view-polish-tools-activity.test.ts
git commit -m "style(chat): tighten tool activity rows"
```

### Task 5: Verify the complete behavior and record evidence

**Files:**
- Modify only if a verification failure reveals a task-scoped defect.

- [ ] **Step 1: Run all directly affected tests together**

Run:

```bash
node --experimental-strip-types src/lib/chat-tool-batches.test.ts
node --experimental-strip-types src/lib/use-tool-run-disclosure.test.ts
node --experimental-strip-types src/components/chat-tool-batches-ui.test.ts
node --experimental-strip-types src/components/chat-view-polish-tools-activity.test.ts
```

Expected: all PASS.

- [ ] **Step 2: Run repository wiring, type, and design checks**

Run:

```bash
pnpm check:tests-wired
pnpm typecheck
pnpm lint
```

Expected: all PASS.

- [ ] **Step 3: Review the scoped diff against the design**

Run:

```bash
git diff --check origin/main...HEAD
git diff --stat origin/main...HEAD
git status --short
```

Expected: no whitespace errors; only the spec, plan, focused tool model/hook/tests, chat renderer, test registry, and chat activity styles are changed.

- [ ] **Step 4: Record verification and leave the Bead active for PR completion**

Run:

```bash
bd update cave-1c8zf --append-notes "Implementation verified: compact summary/model tests, repeated-run disclosure tests, chat UI source tests, test wiring, typecheck, and design lint all pass. Branch fix/cave-1c8zf-compact-tool-rollup remains active pending PR merge."
```

Expected: Bead `cave-1c8zf` remains `in_progress`; do not close it before merge.

- [ ] **Step 5: Commit any final task-scoped corrections**

If Step 1 or Step 2 required corrections:

```bash
git add src/lib/chat-tool-batches.ts \
  src/lib/chat-tool-batches.test.ts \
  src/lib/use-tool-run-disclosure.ts \
  src/lib/use-tool-run-disclosure.test.ts \
  src/components/chat-view.tsx \
  src/components/chat-tool-batches-ui.test.ts \
  src/components/chat-view-polish-tools-activity.test.ts \
  src/styles/cave-chat/activity.css \
  src/styles/cave-chat/transcript.css \
  scripts/run-tests.mjs
git commit -m "fix(chat): finalize compact tool activity"
```

If no corrections were needed, make no empty commit.
