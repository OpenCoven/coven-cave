# Memories Sidebar Collapse Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Memories navigator a locally persisted, explicitly collapsible icon rail while preserving the expanded experience by default.

**Architecture:** `GrimoireView` owns a new boolean rail preference independently of its existing per-section collapse record. The navigator’s root `aside` switches from its full-width container-query class to a narrow rail class; its source controls retain accessible labels, focus behavior, and existing selection/search behavior.

**Tech Stack:** React, TypeScript, Tailwind utility classes, Phosphor icon subset, Node source-pinned component tests.

---

### Task 1: Pin the whole-rail contract

**Files:**
- Modify: `src/components/grimoire-view.test.ts`
- Test: `src/components/grimoire-view.test.ts`

- [ ] **Step 1: Write the failing test**

Add assertions that pin a distinct persisted whole-rail key, a focusable toggle labelled `Collapse Memories sidebar` / `Expand Memories sidebar`, and a collapsed `aside` branch that keeps the navigator rendered as a narrow rail rather than hiding it.

```ts
assert.match(view, /"cave:grimoire:navigator-collapsed:v1"/, "whole navigator collapse persists locally");
assert.match(view, /aria-label=\{navigatorCollapsed \? "Expand Memories sidebar" : "Collapse Memories sidebar"\}/, "navigator toggle exposes its action");
assert.match(view, /navigatorCollapsed \? "@min-\[880px\]\/grimoire:w-\[44px\]" : "@min-\[880px\]\/grimoire:w-\[300px\]"/, "collapsed navigator becomes a compact rail");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --experimental-strip-types src/components/grimoire-view.test.ts`

Expected: assertion failure because the whole-navigator preference and controls do not exist.

### Task 2: Add the persisted collapse behavior

**Files:**
- Modify: `src/components/grimoire-view.tsx:394-435, 724-753, 1450-1490`
- Test: `src/components/grimoire-view.test.ts`

- [ ] **Step 1: Add a storage key and safe reader**

Add a versioned `NAVIGATOR_COLLAPSED_STORAGE_KEY` and `readNavigatorCollapsed()` near the existing navigator preference helpers. It returns `false` during SSR, storage failures, or malformed values.

```ts
const NAVIGATOR_COLLAPSED_STORAGE_KEY = "cave:grimoire:navigator-collapsed:v1";

function readNavigatorCollapsed(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(NAVIGATOR_COLLAPSED_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}
```

- [ ] **Step 2: Add a toggle to `GrimoireView`**

Initialize `navigatorCollapsed` with the reader, invert it only on the explicit button action, and write `String(next)` to local storage inside a `try/catch`. Announce the resulting state through the already-mounted `useAnnouncer()`.

```ts
const [navigatorCollapsed, setNavigatorCollapsed] = useState(readNavigatorCollapsed);
const toggleNavigator = useCallback(() => {
  setNavigatorCollapsed((previous) => {
    const next = !previous;
    try { window.localStorage.setItem(NAVIGATOR_COLLAPSED_STORAGE_KEY, String(next)); } catch {}
    announce(next ? "Memories sidebar collapsed" : "Memories sidebar expanded", "polite");
    return next;
  });
}, [announce]);
```

- [ ] **Step 3: Render the compact rail**

Keep the existing `aside` in the DOM. Add the toggle as its first interactive control, switch its wide width between `44px` and `300px`, and hide text-only navigator detail with the collapsed state while retaining labels, selected state, and explicit `aria-label`s on icon controls. Reuse `ph:sidebar-simple`, `focus-ring-inset`, and existing tokens; do not add CSS literals or alter the section-collapse data model.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --experimental-strip-types src/components/grimoire-view.test.ts`

Expected: `grimoire-view.test.ts: ok`.

### Task 3: Verify the surface stays safe

**Files:**
- Modify: `src/components/grimoire-view.tsx`
- Test: `src/components/grimoire-view.test.ts`

- [ ] **Step 1: Run focused tests**

Run: `node --experimental-strip-types src/components/grimoire-view.test.ts && node --experimental-strip-types src/components/grimoire-launcher.test.ts`

Expected: both tests print `ok` and exit 0.

- [ ] **Step 2: Run lint**

Run: `pnpm lint`

Expected: exit 0, including the design-token and static-style gates.

- [ ] **Step 3: Inspect scope**

Run: `git diff -- src/components/grimoire-view.tsx src/components/grimoire-view.test.ts docs/superpowers/specs/2026-07-27-memories-sidebar-collapse-design.md docs/superpowers/plans/2026-07-27-memories-sidebar-collapse.md`

Expected: only the navigator collapse feature, its source-pinned test, and its approved design/plan artifacts appear.
