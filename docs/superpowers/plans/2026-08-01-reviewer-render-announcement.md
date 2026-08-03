# Reviewer Render Announcement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the React render-phase cross-component update when the reviewer queue bucket filter announces its new state.

**Architecture:** Keep the correction inside `ReviewerSurface`: derive the next filter in the click handler, update local state, then announce separately. Preserve the existing `LiveRegionProvider` contract and pin the event-handler ordering with the reviewer surface source-contract test.

**Tech Stack:** React 19, TypeScript, Node test runner, Next.js 16

---

## File Structure

- Modify `src/components/role-surfaces/reviewer-surface.tsx`: separate bucket-filter state calculation from the live-region announcement.
- Modify `src/components/role-surfaces/reviewer-surface.test.ts`: prevent announcements from running inside React functional state updaters.

### Task 1: Make bucket-filter announcements render-safe

**Files:**
- Modify: `src/components/role-surfaces/reviewer-surface.tsx:398-407`
- Test: `src/components/role-surfaces/reviewer-surface.test.ts`

- [ ] **Step 1: Write the failing regression test**

Add this source-contract test near the existing surface wiring tests:

```ts
test("bucket filter announcements run outside React state updaters", () => {
  assert.match(
    surface,
    /const next = bucketFilter === bucket \? null : bucket;\s*setBucketFilter\(next\);\s*announce\(/,
  );
  assert.doesNotMatch(
    surface,
    /\bsetBucketFilter\(\s*(?:\(\s*(?:[A-Za-z_$][\w$]*)?\s*\)|[A-Za-z_$][\w$]*)\s*=>/,
  );
});
```

- [ ] **Step 2: Run the reviewer surface test to verify it fails**

Run:

```bash
node --experimental-strip-types src/components/role-surfaces/reviewer-surface.test.ts
```

Expected: FAIL in `bucket filter announcements run outside React state updaters` because the current handler calls `announce` inside `setBucketFilter((prev) => ...)`.

- [ ] **Step 3: Implement the targeted handler correction**

Replace `toggleBucket` with:

```tsx
const toggleBucket = useCallback(
  (bucket: keyof DeckSummary) => {
    const next = bucketFilter === bucket ? null : bucket;
    setBucketFilter(next);
    announce(next ? `Queue filtered to ${BUCKET_LABELS[next].toLowerCase()}.` : "Queue filter cleared.");
  },
  [announce, bucketFilter],
);
```

This keeps both updates in the user event handler while ensuring the
`LiveRegionProvider` update is not executed from a React state updater.

- [ ] **Step 4: Run focused verification**

Run:

```bash
node --experimental-strip-types src/components/role-surfaces/reviewer-surface.test.ts
pnpm typecheck
```

Expected: the reviewer surface test exits successfully and TypeScript reports no errors.

- [ ] **Step 5: Inspect and commit the implementation**

Run:

```bash
git diff --check
git diff -- src/components/role-surfaces/reviewer-surface.tsx src/components/role-surfaces/reviewer-surface.test.ts
git add src/components/role-surfaces/reviewer-surface.tsx src/components/role-surfaces/reviewer-surface.test.ts
git commit -S -m "fix(reviewer): announce bucket filters outside state updates"
```

Expected: a signed commit containing only the reviewer handler and its regression test.
