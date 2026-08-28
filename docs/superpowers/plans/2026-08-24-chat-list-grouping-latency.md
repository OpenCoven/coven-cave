# Chat List Grouping Latency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. **Checkbox state in this document is not evidence of completion. Verify what has shipped against code and merged PRs.**

**Goal:** Remove the duplicate full project-grouping pass from the default large chat-list render and preserve a reproducible before/after benchmark.

**Architecture:** Add one pure grouping coordinator that applies overrides once and reuses the grouped result when the visible list and rail list are the same array. Keep the existing `deriveChatProjectGroups` implementation and all filtering, sorting, drag/drop, and accessibility behavior unchanged; `ChatList` only selects the no-op filter fast path and delegates the two grouping outputs.

**Tech Stack:** TypeScript, React `useMemo`, Node test runner, existing chat-project benchmark.

---

### Task 1: Pin shared grouping semantics

**Files:**
- Create: `src/lib/chat-list-grouping.ts`
- Create: `src/lib/chat-list-grouping.test.ts`

- [x] **Step 1: Write the failing shared-input tests**

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { deriveChatListProjectGroups } from "./chat-list-grouping.ts";

test("shared list input reuses one grouped result", () => {
  const sessions = [session("one", "/work/one")];
  const result = deriveChatListProjectGroups(sessions, sessions, projects, projectIndex, {});
  assert.equal(result.sidebarGroups, result.grouped);
});

test("different filtered and rail inputs preserve distinct scopes", () => {
  const sessions = [session("one", "/work/one"), session("two", "/work/two")];
  const result = deriveChatListProjectGroups(sessions.slice(0, 1), sessions, projects, projectIndex, {});
  assert.deepEqual(result.grouped.flatMap((group) => group.sessions.map((row) => row.id)), ["one"]);
  assert.deepEqual(result.sidebarGroups.flatMap((group) => group.sessions.map((row) => row.id)), ["one", "two"]);
});
```

- [x] **Step 2: Run the focused test and verify it fails**

Run: `node --test src/lib/chat-list-grouping.test.ts`

Expected: FAIL because `src/lib/chat-list-grouping.ts` does not exist.

- [x] **Step 3: Implement the grouping coordinator**

```ts
export function deriveChatListProjectGroups(
  filteredSessions: SessionRow[],
  railSessions: SessionRow[],
  projects: CaveProject[],
  projectIndex: ChatProjectIndex,
  overrides: ProjectOverrides,
): { grouped: ChatProjectGroup[]; sidebarGroups: ChatProjectGroup[] } {
  const groupedSessions = applyProjectOverrides(filteredSessions, overrides);
  const railGroupedSessions = filteredSessions === railSessions
    ? groupedSessions
    : applyProjectOverrides(railSessions, overrides);
  const grouped = deriveChatProjectGroups(groupedSessions, projects, projectIndex, {
    sessionsNewestFirst: true,
  });
  const sidebarGroups = railGroupedSessions === groupedSessions
    ? grouped
    : deriveChatProjectGroups(railGroupedSessions, projects, projectIndex, {
      sessionsNewestFirst: true,
    });
  return { grouped, sidebarGroups };
}
```

- [x] **Step 4: Run the focused test and verify it passes**

Run: `node --test src/lib/chat-list-grouping.test.ts`

Expected: both shared-input and split-scope tests pass.

### Task 2: Wire the fast path and benchmark it

**Files:**
- Modify: `src/components/chat-list.tsx:299-350`
- Modify: `src/components/chat-all-familiars-project-list.test.ts`
- Modify: `src/components/chat-siderail-hide-archived.test.ts`
- Modify: `scripts/chat-project-grouping-benchmark.mjs`
- Modify: `scripts/run-tests.mjs`

- [x] **Step 1: Preserve array identity for no-op list filters**

```ts
const railSessions = useMemo(
  () => mine.some((session) => session.archived_at) ? mine.filter((session) => !session.archived_at) : mine,
  [mine],
);
const searched = useMemo(
  () => search.trim() ? filterChatListRows(mine, search, false) : mine,
  [mine, search],
);
const filtered = useMemo(() => {
  if (statusFilter === "all" && kindFilter === "all") return searched;
  return filterChatRowsByKind(filterChatRowsByStatus(searched, statusFilter), kindFilter);
}, [searched, statusFilter, kindFilter]);
```

- [x] **Step 2: Replace the two grouping memos with one coordinated memo**

```ts
const { grouped, sidebarGroups } = useMemo(
  () => deriveChatListProjectGroups(
    filtered,
    railSessions,
    projects,
    projectIndex,
    projectOverrides,
  ),
  [filtered, railSessions, projects, projectIndex, projectOverrides],
);
```

- [x] **Step 3: Extend the existing benchmark with legacy-double and shared-pass measurements**

```js
const doubleGroupingMs = measure(() => {
  const main = deriveChatProjectGroups(sessions, projects, projectIndex, { sessionsNewestFirst: true });
  const rail = deriveChatProjectGroups(sessions, projects, projectIndex, { sessionsNewestFirst: true });
  return groupChecksum(main) ^ groupChecksum(rail);
});
const sharedGroupingMs = measure(() => {
  const { grouped, sidebarGroups } = deriveChatListProjectGroups(
    sessions,
    sessions,
    projects,
    projectIndex,
    {},
  );
  return groupChecksum(grouped) ^ groupChecksum(sidebarGroups);
});
```

- [x] **Step 4: Run focused correctness and benchmark proof**

Run: `node --test src/lib/chat-list-grouping.test.ts src/lib/chat-list-model.test.ts src/lib/chat-projects.test.ts`

Expected: all tests pass.

Run: `pnpm bench:chat-projects`

Expected: JSON includes `doubleGroupingP50Ms`, `sharedGroupingP50Ms`, and `sharedGroupingSpeedup`; the shared path is faster on the 10,000-session fixture.

- [x] **Step 5: Run repository verification**

Run: `pnpm lint && pnpm typecheck && pnpm check:tests-wired && git diff --check`

Expected: all commands pass.

- [x] **Step 6: Commit the verified unit**

```bash
git add docs/superpowers/plans/2026-08-24-chat-list-grouping-latency.md src/lib/chat-list-grouping.ts src/lib/chat-list-grouping.test.ts src/components/chat-list.tsx src/components/chat-all-familiars-project-list.test.ts src/components/chat-siderail-hide-archived.test.ts scripts/chat-project-grouping-benchmark.mjs scripts/run-tests.mjs
git commit -S -s -m "perf(chat): share large-list project grouping (cave-i65lt)"
```
