# Thread Signal Chat Overlay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render the complete Thread Signal card over chat content without adding it to transcript layout or scroll height.

**Architecture:** Keep `chat-view.tsx` as the owner of `threadSignalReport`, but move the card from inside the conversation log to an absolutely positioned sibling within a transcript-column overlay host. CSS bounds the card to that host, passes pointer input through empty overlay space, and gives oversized cards an internal scroll container.

**Tech Stack:** React 19, TypeScript, CSS container queries and design tokens, Node test runner, Playwright measurement.

---

## File Map

- `src/components/chat-view.tsx` owns Thread Signal state and positions the card outside the transcript flow.
- `src/styles/globals/shell-cards-and-controls.css` defines overlay bounds, stacking, input behavior, and internal overflow.
- `src/components/chat-view.test.ts` pins the card after the transcript tail.
- `src/components/thread-signal-card.test.ts` pins absolute positioning and pointer behavior.
- `docs/superpowers/specs/2026-08-14-thread-signal-chat-overlay-design.md` records the approved interaction design.

### Task 1: Pin the non-flow host

**Files:**
- Modify: `src/components/chat-view.test.ts:121-130`
- Modify: `src/components/thread-signal-card.test.ts:143-163`

- [ ] **Step 1: Write the chat-host regression**

Replace the old transcript-row assertion with:

```ts
assert.match(
  source,
  /<div className="cave-thread-signal-overlay">[\s\S]*<ThreadSignalCard[\s\S]*report=\{threadSignalReport\}/,
  "Successful reflection should render the ThreadSignalCard in the chat overlay",
);

assert.ok(
  source.indexOf('<div ref={tailRef} />') < source.indexOf('<div className="cave-thread-signal-overlay">'),
  "Thread Signal should render after the transcript tail rather than inside the conversation log",
);
```

- [ ] **Step 2: Write the overlay-style regression**

Add:

```ts
it("floats the complete card above chat content without changing transcript height", () => {
  assert.match(
    styles,
    /\.cave-thread-signal-overlay\s*\{[\s\S]*?position:\s*absolute;[\s\S]*?inset:[\s\S]*?pointer-events:\s*none;/,
  );
  assert.match(
    styles,
    /\.cave-thread-signal-overlay\s*>\s*\*\s*\{[\s\S]*?pointer-events:\s*auto;/,
    "the non-flow host stays transparent while the card remains interactive",
  );
});
```

- [ ] **Step 3: Run the focused tests and confirm they fail**

Run:

```bash
node --require ./scripts/css-source-contract-hook.cjs \
  --experimental-strip-types \
  --import ./scripts/test-alias-register.mjs \
  src/components/chat-view.test.ts
node --require ./scripts/css-source-contract-hook.cjs \
  --experimental-strip-types \
  --import ./scripts/test-alias-register.mjs \
  src/components/thread-signal-card.test.ts
```

Expected: failure because `cave-thread-signal-overlay` does not yet exist and the card still renders before the transcript tail.

### Task 2: Move the card outside transcript flow

**Files:**
- Modify: `src/components/chat-view.tsx:7784-7960`
- Modify: `src/styles/globals/shell-cards-and-controls.css:33-65`
- Test: `src/components/chat-view.test.ts`
- Test: `src/components/thread-signal-card.test.ts`

- [ ] **Step 1: Add a positioned transcript-column host**

Wrap the transcript scroller and overlay with:

```tsx
<div className="flex min-h-0 flex-1">
  <div className="cave-chat-overlay-host relative min-h-0 flex-1">
    <div
      ref={scrollRef}
      tabIndex={0}
      className="cave-chat-transcript relative h-full min-h-0 overflow-y-auto"
    >
      {/* Existing conversation content remains here. */}
    </div>
    {/* Thread Signal overlay mounts here. */}
  </div>
  {/* Existing code-reading inspector remains beside the host. */}
</div>
```

Keep `role="log"` on the existing `.cave-chat-thread`; do not move transcript rows into the overlay host.

- [ ] **Step 2: Render Thread Signal after the transcript scroller**

Remove the existing `ThreadSignalCard` block from `.cave-chat-thread`, then add:

```tsx
{threadSignalReport ? (
  <div className="cave-thread-signal-overlay">
    <ThreadSignalCard
      report={threadSignalReport}
      onDismiss={() => setThreadSignalReport(null)}
      onViewFull={() => {
        const params = new URLSearchParams({ sessionId: threadSignalReport.sessionId });
        window.location.href = `/dashboard/familiars/${encodeURIComponent(threadSignalReport.familiarId)}/analytics?${params.toString()}`;
      }}
    />
  </div>
) : null}
```

Do not change report state, dismissal timing, analytics navigation, task creation, or resolution-thread behavior.

- [ ] **Step 3: Style the bounded click-through overlay**

Add:

```css
.cave-thread-signal-overlay {
  position: absolute;
  inset: var(--space-3) clamp(var(--space-3), 3vw, var(--space-8));
  z-index: 70;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  pointer-events: none;
}

.cave-thread-signal-overlay > * {
  width: min(100%, 720px);
  max-height: 100%;
  margin: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  pointer-events: auto;
  scrollbar-width: thin;
}

.cave-thread-signal-overlay .tsc-card {
  box-shadow:
    0 18px 48px color-mix(in oklch, var(--shadow-color) 48%, transparent),
    0 0 0 1px color-mix(in oklch, var(--accent-presence) 14%, transparent);
}
```

- [ ] **Step 4: Run the focused tests**

Run:

```bash
node --require ./scripts/css-source-contract-hook.cjs \
  --experimental-strip-types \
  --import ./scripts/test-alias-register.mjs \
  src/components/chat-view.test.ts
node --require ./scripts/css-source-contract-hook.cjs \
  --experimental-strip-types \
  --import ./scripts/test-alias-register.mjs \
  src/components/thread-signal-card.test.ts
```

Expected: both files pass.

- [ ] **Step 5: Measure the scroll-height invariant**

In the existing mocked chat Playwright fixture, record:

```ts
const before = await page.locator(".cave-chat-transcript").evaluate((node) => node.scrollHeight);
// Trigger the settled Thread Signal report.
await expect(page.locator(".cave-thread-signal-overlay")).toBeVisible();
const after = await page.locator(".cave-chat-transcript").evaluate((node) => node.scrollHeight);
expect(after).toBe(before);
```

Expected: identical `before` and `after` values.

### Task 3: Verify and prepare the pull request

**Files:**
- Create: `docs/superpowers/plans/2026-08-15-thread-signal-chat-overlay.md`
- Commit: the four implementation files, design spec, and this plan

- [ ] **Step 1: Run repository verification**

Run:

```bash
pnpm typecheck
pnpm lint
pnpm test:app
pnpm test:api
pnpm check:tests-wired
pnpm test:e2e
pnpm build
```

Expected: every command exits 0.

- [ ] **Step 2: Confirm the diff is scoped**

Run:

```bash
git status --porcelain
git --no-pager diff origin/main...HEAD --stat
```

Expected: only the Thread Signal overlay implementation, tests, design spec, and implementation plan are present.

- [ ] **Step 3: Commit the implementation**

Run:

```bash
git add \
  docs/superpowers/plans/2026-08-15-thread-signal-chat-overlay.md \
  src/components/chat-view.test.ts \
  src/components/chat-view.tsx \
  src/components/thread-signal-card.test.ts \
  src/styles/globals/shell-cards-and-controls.css
git commit -m "fix(chat): float Thread Signal above transcript"
```

Expected: one implementation commit with no unrelated paths.

- [ ] **Step 4: Push and open the pull request**

Run:

```bash
branch=$(git branch --show-current)
git push -u origin "$branch"
gh pr create \
  --base main \
  --head "$branch" \
  --title "Keep Thread Signal out of transcript flow" \
  --body "$(printf '%s\n' \
    '## Summary' \
    '- float the Thread Signal card over chat instead of adding it to transcript flow' \
    '- keep the overlay responsive, internally scrollable, and click-through outside the card' \
    '- pin the non-flow host and preserve existing Thread Signal interactions' \
    '' \
    '## Verification' \
    '- pnpm typecheck' \
    '- pnpm lint' \
    '- pnpm test:app' \
    '- pnpm test:api' \
    '- pnpm check:tests-wired' \
    '- pnpm test:e2e' \
    '- pnpm build' \
    '' \
    'Bead: cave-dvi73')"
```

The PR body must describe the non-flow overlay, preserved card behavior, fresh verification, and Bead `cave-dvi73`, with no AI attribution.
