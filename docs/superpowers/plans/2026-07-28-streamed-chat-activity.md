# Streamed Chat Activity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stream inline reasoning and collapse adjacent repeated tool calls into an expandable, counted run without changing chat stream data.

**Architecture:** Add a pure run-partition helper alongside `segmentTurn`, then use it in the shared tool rendering path. Move the existing reasoning disclosure ahead of assistant prose and make its default-open state depend on pending status. Keep all ToolEvent data and existing ToolBlock behavior intact.

**Tech Stack:** React, TypeScript, Node assertion tests, tokenized CSS.

---

## Files

- Modify: `src/lib/turn-segments.ts` — export a pure consecutive-run partitioner.
- Test: `src/lib/turn-segments.test.ts` — prove grouping boundaries.
- Modify: `src/components/chat-view.tsx` — render streamed reasoning first and grouped tool runs.
- Modify: `src/components/chat-view-polish-tools-activity.test.ts` — assert the new transcript contracts.
- Modify: `src/styles/cave-chat/activity.css` and `src/styles/cave-chat/transcript.css` — compact tokenized nested-run layout.

### Task 1: Define consecutive tool-run semantics

**Files:**
- Modify: `src/lib/turn-segments.ts`
- Test: `src/lib/turn-segments.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
assert.deepEqual(
  groupConsecutiveTools([
    { id: "1", name: "Read" },
    { id: "2", name: "read" },
    { id: "3", name: "Grep" },
    { id: "4", name: "Read" },
  ]).map((run) => run.tools.map((tool) => tool.id)),
  [["1", "2"], ["3"], ["4"]],
);
```

- [ ] **Step 2: Verify the test fails**

Run: `pnpm exec tsx src/lib/turn-segments.test.ts`

Expected: a failure because `groupConsecutiveTools` is not exported.

- [ ] **Step 3: Implement the smallest pure helper**

```ts
export function groupConsecutiveTools<T extends { name: string }>(tools: T[]): { name: string; tools: T[] }[] {
  return tools.reduce<{ name: string; tools: T[] }[]>((runs, tool) => {
    const key = tool.name.trim().toLowerCase();
    const previous = runs.at(-1);
    if (previous && previous.name.trim().toLowerCase() === key) previous.tools.push(tool);
    else runs.push({ name: tool.name, tools: [tool] });
    return runs;
  }, []);
}
```

- [ ] **Step 4: Verify the helper passes**

Run: `pnpm exec tsx src/lib/turn-segments.test.ts`

Expected: PASS.

### Task 2: Render grouped tool runs and live reasoning

**Files:**
- Modify: `src/components/chat-view.tsx`
- Test: `src/components/chat-view-polish-tools-activity.test.ts`

- [ ] **Step 1: Write failing source-contract assertions**

Assert that `ReasoningBlock` receives `pending`, derives `open` from
`pending || showThinking`, and appears before `MessageBubble`; assert that
`ToolRunGroup` uses `groupConsecutiveTools(tools)` and renders every child via
`ToolBlock`.

- [ ] **Step 2: Verify the assertions fail**

Run: `pnpm exec tsx src/components/chat-view-polish-tools-activity.test.ts`

Expected: FAIL because neither `pending` nor `ToolRunGroup` exists.

- [ ] **Step 3: Implement the render path**

```tsx
function ToolRuns({ tools }: { tools: ToolEvent[] }) {
  return groupConsecutiveTools(tools).map((run) =>
    run.tools.length === 1 ? <ToolBlock key={run.tools[0].id} tool={run.tools[0]} /> :
      <ToolRunGroup key={run.tools.map((tool) => tool.id).join(":")} name={run.name} tools={run.tools} />,
  );
}
```

Use `ToolRuns` in both chronological streaming segments and the expanded
`ToolGroup`, and render `<ReasoningBlock reasoning={reasoning} pending={!!turn.pending} ... />`
before the assistant message body.

- [ ] **Step 4: Verify the focused UI test passes**

Run: `pnpm exec tsx src/components/chat-view-polish-tools-activity.test.ts`

Expected: PASS.

### Task 3: Add compact disclosure styling and run integration checks

**Files:**
- Modify: `src/styles/cave-chat/activity.css`
- Modify: `src/styles/cave-chat/transcript.css`

- [ ] **Step 1: Add tokenized nested-run styles**

Add a `.cave-tool-run` disclosure style using existing `--border-hairline`,
`--bg-subtle`, `--radius-control`, and spacing tokens. Reuse the parent
disclosure rules rather than adding colors or a new animation.

- [ ] **Step 2: Run focused checks**

Run: `pnpm exec tsx src/lib/turn-segments.test.ts && pnpm exec tsx src/components/chat-view-polish-tools-activity.test.ts`

Expected: both PASS.

- [ ] **Step 3: Run integration checks**

Run: `pnpm lint && pnpm test -- --runInBand`

Expected: PASS, or record the exact unrelated blocker before handoff.
