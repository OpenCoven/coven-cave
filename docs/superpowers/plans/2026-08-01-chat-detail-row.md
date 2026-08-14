# Chat Detail Row Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the existing Chat session context band into the supplied full-width instrument strip with interactive Done, Elapsed, and Context breakdowns.

**Architecture:** Keep all value derivation in the pure `chat-session-context` model, pass a narrow transcript summary into `ChatSessionContextRow`, and use the existing shared `Popover` for detail cards. Keep visual changes in `session-chrome.css` so the row remains theme-safe and isolated from the title/header actions.

**Tech Stack:** React 19, TypeScript, Next.js, Node test runner, shared Coven Cave Popover and design tokens.

---

### Task 1: Derive instrument-strip data

**Files:**
- Modify: `src/lib/chat-session-context.ts`
- Test: `src/lib/chat-session-context.test.ts`

- [ ] **Step 1: Write failing model tests**

Add coverage for a `chatContextDetails()` helper that:

```ts
const details = chatContextDetails({
  turns: [{
    role: "assistant",
    durationMs: 23 * 60_000 + 10_000,
    reasoning: "considered options",
    tools: [
      { name: "Bash", status: "ok", durationMs: 10_000 },
      { name: "Read", status: "ok", durationMs: 5_000 },
      { name: "Edit", status: "error", durationMs: 2_000 },
    ],
  }],
  usage: {
    inputTokens: 8_700,
    outputTokens: 2_600,
    cacheReadTokens: 1_700,
  },
  model: "anthropic/claude-opus-5",
});

assert.equal(details.done.value, "2");
assert.deepEqual(details.done.rows.map((row) => [row.label, row.value]), [
  ["shell", "1 call"],
  ["read", "1 call"],
]);
assert.equal(details.elapsed.value, "23m 10s");
assert.equal(details.context.usedTokens, 13_000);
assert.equal(details.context.rows.at(-1)?.label, "free");
```

- [ ] **Step 2: Run the focused test and verify failure**

Run:

```bash
node --import tsx --test src/lib/chat-session-context.test.ts
```

Expected: FAIL because `chatContextDetails` is not exported.

- [ ] **Step 3: Implement the pure derivation**

Add narrow input types for assistant turns and tools, category mapping for
`shell`, `read`, `edit`, `github`, and `other`, completed-call aggregation,
duration aggregation, and context rows based on `computeContextMeter`.
Exclude running/error tools from Done and omit unsupported detail rows rather
than manufacturing values.

- [ ] **Step 4: Run the focused model test**

Run:

```bash
node --import tsx --test src/lib/chat-session-context.test.ts
```

Expected: PASS.

### Task 2: Add accessible detail-card interactions

**Files:**
- Modify: `src/components/chat-session-context-row.tsx`
- Modify: `src/components/chat-view.tsx`
- Test: `src/components/chat-session-chrome.test.ts`

- [ ] **Step 1: Write failing structural tests**

Assert that:

```ts
assert.match(contextRow, /function StatPopover/);
assert.match(contextRow, /aria-haspopup="dialog"/);
assert.match(contextRow, /aria-label="Done details"/);
assert.match(contextRow, /aria-label="Elapsed details"/);
assert.match(contextRow, /aria-label="Context details"/);
assert.match(chatView, /turns=\{turns\}/);
assert.match(chatView, /harness=\{familiar\.harness\}/);
```

- [ ] **Step 2: Run the focused component test and verify failure**

Run:

```bash
node --import tsx --test src/components/chat-session-chrome.test.ts
```

Expected: FAIL on the missing triggers and props.

- [ ] **Step 3: Implement the React wiring**

Pass `turns` and `familiar.harness` from `ChatView`. In
`ChatSessionContextRow`, derive details once, render runtime/model, branch, and
project in reference order, and use one `StatPopover` component for the Done,
Elapsed, and Context triggers. Use `Popover`, one trigger ref per metric,
`placement="bottom-end"`, `.focus-ring`, Escape/outside-click dismissal, and
the shared focus-return behavior.

- [ ] **Step 4: Run the focused component test**

Run:

```bash
node --import tsx --test src/components/chat-session-chrome.test.ts
```

Expected: PASS.

### Task 3: Match the reference styling and responsive behavior

**Files:**
- Modify: `src/styles/cave-chat/session-chrome.css`
- Test: `src/components/chat-session-chrome.test.ts`

- [ ] **Step 1: Add failing CSS assertions**

Pin the required selectors and behavior:

```ts
assert.match(styles, /\.cave-chat-context-row\s*\{[\s\S]*overflow-x:\s*auto/);
assert.match(styles, /\.cave-chat-context-stat--action/);
assert.match(styles, /\.cave-chat-context-popover/);
assert.match(styles, /\.cave-chat-context-breakdown__bar/);
assert.doesNotMatch(styles, /@media \(max-width: 900px\)[\s\S]*cave-chat-context-row__stats\s*\{[\s\S]*display:\s*none/);
```

- [ ] **Step 2: Run the focused test and verify failure**

Run:

```bash
node --import tsx --test src/components/chat-session-chrome.test.ts
```

Expected: FAIL because the new strip and popover selectors are absent.

- [ ] **Step 3: Implement token-only CSS**

Use the existing mono type, hairline borders, semantic tints, token spacing,
control/card radii, and `color-mix` recipes. Match the supplied density with a
single compact row, neutral selector fills, tinted 4–6px dots, tabular values,
an inline context meter, and a raised breakdown card. Replace the mobile
`display:none` rule with horizontal scrolling and hidden scrollbars.

- [ ] **Step 4: Run the CSS/component test**

Run:

```bash
node --import tsx --test src/components/chat-session-chrome.test.ts
```

Expected: PASS.

### Task 4: Validate the complete surface

**Files:**
- Verify: all changed files

- [ ] **Step 1: Run targeted tests together**

Run:

```bash
node --import tsx --test \
  src/lib/chat-session-context.test.ts \
  src/components/chat-session-chrome.test.ts \
  src/components/chat-header-row.test.ts
```

Expected: all tests pass.

- [ ] **Step 2: Run design and type gates**

Run:

```bash
pnpm codemod:design:check
pnpm lint
pnpm build
```

Expected: all commands exit 0.

- [ ] **Step 3: Capture real-app comparisons**

Launch the app with the repository `run-cave-app` workflow, open an existing
Chat containing tool activity and usage, capture the strip at desktop and
narrow widths, and verify:

```text
left order: runtime/model → branch → project
right order: done → elapsed → context → tokens → cost
Done, Elapsed, Context open anchored cards
narrow width keeps every metric reachable through horizontal scrolling
```

- [ ] **Step 4: Record the handoff**

Add the worktree path, branch, changed files, and verification evidence to bead
`cave-yxmwh`. Keep the bead open until the work is merged, per repository
policy. Do not commit or push without explicit user authorization.
