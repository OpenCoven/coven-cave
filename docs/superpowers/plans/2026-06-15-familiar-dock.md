# Familiar Dock Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `<select>` familiar scope dropdown in the left workspace sidebar with a horizontal **familiar dock** — an avatar strip with an "All" chip, responsive overflow into a searchable popover, presence/unread indicators, drag-reorder, and per-familiar customize — wired to the existing workspace-wide familiar scope.

**Architecture:** The dock is a new presentational component (`familiar-dock.tsx`) mounted inside `sidebar-minimal.tsx` in place of `FamiliarScopeSelect`. Selecting an avatar calls the existing `onFamiliarScopeChange(id)` → `selectFamiliarScope` in `workspace.tsx`, which sets `activeId` (the global scope already consumed by chat/board/calendar via `filterVisibleChatSessions`). Overflow uses the existing `ui/popover`. Reorder uses `@dnd-kit` + `setFamiliarOrder` (same as the now-dead `familiar-avatar-rail.tsx`, which this plan deletes). A pure helper computes the inline-vs-overflow split from the measured container width.

**Tech Stack:** React (client component), TypeScript, Tailwind + `globals.css`, `@dnd-kit/core` + `@dnd-kit/sortable`, Phosphor icons via `@/lib/icon`, node `--experimental-strip-types` source-text/unit tests wired into `package.json` `test:app`.

---

## Reconciliation with the approved spec

The spec (`docs/superpowers/specs/2026-06-15-familiar-dock-redesign-design.md`) assumed the dock would live in the **chat rail above "Search chats…"** and that "select = filter" was new behavior. The post-spec investigation found that "select = filter" **already exists** via `FamiliarScopeSelect` (a `<select>`) driving the **workspace-wide** `activeId` scope. Per the user's follow-up decision ("Replace, keep in left sidebar"):

- The dock **replaces `FamiliarScopeSelect`** inside `sidebar-minimal.tsx` (left workspace sidebar), **not** the chat rail.
- Selecting drives the **global** `activeId` scope (filters chat **and** board/calendar), not a chat-local filter.
- **Persistence consequence (flag):** the existing global scope is persisted across reloads (`getActiveFamiliar()` in `workspace.tsx:112`). The earlier "resets to All on reload" answer applied only to the discarded chat-local option; with the global-scope choice we **keep existing persistence**. No work is done to force reset-on-reload.
- The chat rail's `RailFamiliarStrip` (footer "new chat with familiar") and the mobile `ChatListFamiliarStrip` are a **different feature** (quick new chat, not filtering) and are **left untouched**.
- The dead vertical `familiar-avatar-rail.tsx` (mounted nowhere) is **deleted** as part of consolidation, along with its two test files.

---

## File structure

**Create:**
- `src/lib/familiar-dock-overflow.ts` — pure helper: inline-vs-overflow split from measured width. One responsibility, unit-tested.
- `src/lib/familiar-dock-overflow.test.ts` — unit test for the helper.
- `src/components/familiar-dock.tsx` — the dock component (All chip, avatar run, presence/unread, overflow `···` + popover, `+` add, drag-reorder, right-click customize).
- `src/components/familiar-dock.test.ts` — source-text test for the dock's structure/wiring.

**Modify:**
- `src/components/sidebar-minimal.tsx` — delete `FamiliarScopeSelect`, mount `FamiliarDock`; add `responseNeeded` to props.
- `src/components/workspace.tsx:1179-1212` — pass `responseNeeded={responseNeeded}` to `SidebarMinimal`.
- `src/app/globals.css` — add `.familiar-dock*` styles (after the existing `.familiar-avatar-rail*` block, which is removed in the same task — see Task 9).
- `src/components/sidebar-familiar-filter.test.ts` — retarget assertions from the dropdown to the dock.
- `package.json` — wire the two new `*.test.ts` into `test:app`; unwire the two deleted rail tests.

**Delete (consolidation):**
- `src/components/familiar-avatar-rail.tsx`
- `src/components/familiar-avatar-rail.test.ts`
- `src/components/avatar-rail-roving.test.ts`

**Reference (read, don't change):**
- `src/components/ui/popover.tsx` — `Popover` (`open`, `onOpenChange`, `anchorRef`, `placement`, `offset`, `minWidth`), `PopoverBody`, `PopoverLabel`, `PopoverSeparator`, `PopoverItem`.
- `src/lib/presence.ts` — `computePresence({familiar, sessions, needsReply, harnessInstalled, isRemoteHarness}) → {state,label,pill,dot}`.
- `src/lib/familiar-resolve.ts` — `ResolvedFamiliar` (has `id`, `display_name`, `role`, `color`, `glyph`, `harness?`).
- `src/lib/cave-familiar-order.ts` — `setFamiliarOrder(ids: string[])`.
- `src/lib/familiar-studio-context.tsx` — `useFamiliarStudio() → { openFamiliarStudio(id, tab?), openFamiliarStudioListView() }`.
- `src/lib/use-roving-tabindex.ts` — `useRovingTabIndex({containerRef, itemSelector, orientation})`.

---

## Task 1: Pure overflow-split helper

**Files:**
- Create: `src/lib/familiar-dock-overflow.ts`
- Test: `src/lib/familiar-dock-overflow.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/familiar-dock-overflow.test.ts
// @ts-nocheck
import assert from "node:assert/strict";
import { computeDockInlineCount } from "./familiar-dock-overflow.ts";

// Wide container: everything fits inline, no overflow.
assert.equal(
  computeDockInlineCount({ containerWidth: 400, itemWidth: 40, reservedWidth: 100, total: 5 }),
  5,
  "wide container shows all familiars inline",
);

// Narrow container: only a subset fits; rest overflow.
// available = 200 - 100 = 100 → floor(100/40) = 2
assert.equal(
  computeDockInlineCount({ containerWidth: 200, itemWidth: 40, reservedWidth: 100, total: 5 }),
  2,
  "narrow container clamps to what fits",
);

// Exact fit shows all (no spurious overflow).
assert.equal(
  computeDockInlineCount({ containerWidth: 260, itemWidth: 40, reservedWidth: 100, total: 4 }),
  4,
  "exact fit shows all four",
);

// No familiars → zero.
assert.equal(
  computeDockInlineCount({ containerWidth: 400, itemWidth: 40, reservedWidth: 100, total: 0 }),
  0,
  "no familiars yields zero inline",
);

// Degenerate width (unmeasured / 0) never returns negative.
assert.equal(
  computeDockInlineCount({ containerWidth: 0, itemWidth: 40, reservedWidth: 100, total: 5 }),
  0,
  "unmeasured container yields zero, never negative",
);

console.log("familiar-dock-overflow.test.ts OK");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --experimental-strip-types src/lib/familiar-dock-overflow.test.ts`
Expected: FAIL — `Cannot find module './familiar-dock-overflow.ts'`.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/familiar-dock-overflow.ts

/**
 * Decide how many familiar avatars render inline in the dock vs. collapse into
 * the overflow popover. Pure + UI-agnostic so it can be unit-tested without a
 * DOM; the component feeds it a measured container width (ResizeObserver).
 *
 * `reservedWidth` accounts for the fixed controls that always render (the All
 * chip, the overflow ··· button, the + add button, and inter-item gaps).
 */
export function computeDockInlineCount(opts: {
  containerWidth: number;
  itemWidth: number;
  reservedWidth: number;
  total: number;
}): number {
  const { containerWidth, itemWidth, reservedWidth, total } = opts;
  if (total <= 0 || itemWidth <= 0) return 0;
  const available = containerWidth - reservedWidth;
  if (available <= 0) return 0;
  const fit = Math.floor(available / itemWidth);
  return Math.max(0, Math.min(total, fit));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --experimental-strip-types src/lib/familiar-dock-overflow.test.ts`
Expected: PASS — prints `familiar-dock-overflow.test.ts OK`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/familiar-dock-overflow.ts src/lib/familiar-dock-overflow.test.ts
git commit -S -m "feat(familiar-dock): pure inline/overflow split helper"
```

---

## Task 2: FamiliarDock skeleton — All chip + avatar run + add, wired to filter

Build the component with all familiars rendered inline (no overflow/presence/reorder yet) so wiring is verifiable in isolation.

**Files:**
- Create: `src/components/familiar-dock.tsx`
- Test: `src/components/familiar-dock.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/components/familiar-dock.test.ts
// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("./familiar-dock.tsx", import.meta.url), "utf8");

assert.match(src, /export function FamiliarDock/, "exports FamiliarDock");
// All chip clears the scope (null) and reflects the no-filter state.
assert.match(src, /onFamiliarScopeChange\(null\)/, "All chip clears the scope to null");
assert.match(src, /aria-pressed=\{activeFamiliarId == null\}/, "All chip pressed when no familiar is active");
// Avatar select drives the global scope (filter), NOT a new chat.
assert.match(src, /onFamiliarScopeChange\(f\.id\)/, "avatar selects the familiar scope by id");
assert.doesNotMatch(src, /onNewChat/, "dock filters; it does not start chats");
// Add button quick-creates via the studio list (discoverable add path).
assert.match(src, /familiar-dock__add/, "renders the add button");

console.log("familiar-dock.test.ts OK");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --experimental-strip-types src/components/familiar-dock.test.ts`
Expected: FAIL — `Cannot find module './familiar-dock.tsx'`.

- [ ] **Step 3: Write the minimal component**

```tsx
// src/components/familiar-dock.tsx
"use client";

import { useRef } from "react";
import { Icon } from "@/lib/icon";
import { FamiliarAvatar } from "@/components/familiar-avatar";
import { useFamiliarStudio } from "@/lib/familiar-studio-context";
import type { ResolvedFamiliar } from "@/lib/familiar-resolve";
import type { SessionRow } from "@/lib/types";

type Props = {
  familiars: ResolvedFamiliar[];
  activeFamiliarId?: string | null;
  sessions: SessionRow[];
  responseNeeded?: Set<string>;
  onFamiliarScopeChange: (id: string | null) => void;
};

export function FamiliarDock({
  familiars,
  activeFamiliarId,
  onFamiliarScopeChange,
}: Props) {
  const { openFamiliarStudio, openFamiliarStudioListView } = useFamiliarStudio();
  const rowRef = useRef<HTMLDivElement | null>(null);

  return (
    <div className="familiar-dock" aria-label="Familiars">
      <div className="familiar-dock__row" ref={rowRef} role="toolbar" aria-label="Familiar scope">
        <button
          type="button"
          className={`familiar-dock__all${activeFamiliarId == null ? " familiar-dock__all--active" : ""}`}
          aria-pressed={activeFamiliarId == null}
          onClick={() => onFamiliarScopeChange(null)}
          title="All familiars"
        >
          <Icon name="ph:sparkle" width={13} aria-hidden />
          <span>All</span>
        </button>

        {familiars.map((f) => {
          const active = f.id === activeFamiliarId;
          return (
            <button
              key={f.id}
              type="button"
              data-id={f.id}
              style={{ ["--familiar-accent" as string]: f.color }}
              className={`familiar-dock__avatar${active ? " familiar-dock__avatar--active" : ""}`}
              aria-pressed={active}
              aria-label={`Filter by ${f.display_name}`}
              title={f.display_name}
              onClick={() => onFamiliarScopeChange(f.id)}
              onContextMenu={(e) => { e.preventDefault(); openFamiliarStudio(f.id, "identity"); }}
            >
              <FamiliarAvatar familiar={f} size="sm" />
            </button>
          );
        })}

        <button
          type="button"
          className="familiar-dock__add"
          aria-label="Add familiar"
          title="Add familiar"
          onClick={() => openFamiliarStudioListView()}
        >
          <Icon name="ph:plus-bold" width={12} aria-hidden />
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --experimental-strip-types src/components/familiar-dock.test.ts`
Expected: PASS — prints `familiar-dock.test.ts OK`.

- [ ] **Step 5: Commit**

```bash
git add src/components/familiar-dock.tsx src/components/familiar-dock.test.ts
git commit -S -m "feat(familiar-dock): All chip + avatar scope row skeleton"
```

---

## Task 3: Presence + unread indicators

Add always-visible presence and unread dots, computed from `sessions` + `responseNeeded` (same primitives the dead rail used).

**Files:**
- Modify: `src/components/familiar-dock.tsx`
- Modify: `src/components/familiar-dock.test.ts`

- [ ] **Step 1: Add failing assertions to the test**

Append before the final `console.log` in `familiar-dock.test.ts`:

```ts
assert.match(src, /import \{ computePresence, REMOTE_HARNESSES \} from "@\/lib\/presence"/, "uses presence helpers");
assert.match(src, /familiar-dock__presence/, "renders a presence dot");
assert.match(src, /familiar-dock__unread/, "renders an unread dot");
assert.match(src, /responseNeeded\?\.has\(f\.id\)/, "unread comes from responseNeeded");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --experimental-strip-types src/components/familiar-dock.test.ts`
Expected: FAIL — presence assertions don't match.

- [ ] **Step 3: Implement presence + unread**

In `familiar-dock.tsx`, add the import:

```tsx
import { computePresence, REMOTE_HARNESSES } from "@/lib/presence";
```

Replace the `familiars.map(...)` body so each avatar computes presence and renders the dots:

```tsx
{familiars.map((f) => {
  const active = f.id === activeFamiliarId;
  const needsReply = responseNeeded?.has(f.id) ?? false;
  const presence = computePresence({
    familiar: f,
    sessions,
    needsReply,
    isRemoteHarness: f.harness ? REMOTE_HARNESSES.has(f.harness) : false,
  });
  return (
    <button
      key={f.id}
      type="button"
      data-id={f.id}
      style={{ ["--familiar-accent" as string]: f.color }}
      className={`familiar-dock__avatar${active ? " familiar-dock__avatar--active" : ""}`}
      aria-pressed={active}
      aria-label={`Filter by ${f.display_name}${needsReply ? " — reply needed" : ""}`}
      title={`${f.display_name} · ${presence.label}`}
      onClick={() => onFamiliarScopeChange(f.id)}
      onContextMenu={(e) => { e.preventDefault(); openFamiliarStudio(f.id, "identity"); }}
    >
      <FamiliarAvatar familiar={f} size="sm" />
      <span className={`familiar-dock__presence ${presence.dot}`} aria-hidden />
      {needsReply ? <span className="familiar-dock__unread" aria-hidden /> : null}
    </button>
  );
})}
```

Ensure `sessions` and `responseNeeded` are destructured from props at the top of `FamiliarDock`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --experimental-strip-types src/components/familiar-dock.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/familiar-dock.tsx src/components/familiar-dock.test.ts
git commit -S -m "feat(familiar-dock): always-visible presence + unread dots"
```

---

## Task 4: Responsive overflow (`···` + N badge)

Measure the row with a `ResizeObserver`, split inline vs overflow with the Task 1 helper, and render an overflow button carrying the hidden count.

**Files:**
- Modify: `src/components/familiar-dock.tsx`
- Modify: `src/components/familiar-dock.test.ts`

- [ ] **Step 1: Add failing assertions**

```ts
assert.match(src, /computeDockInlineCount/, "uses the overflow helper");
assert.match(src, /ResizeObserver/, "measures the row width responsively");
assert.match(src, /familiar-dock__overflow/, "renders the overflow button");
assert.match(src, /overflowCount > 0/, "overflow button is conditional on hidden count");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --experimental-strip-types src/components/familiar-dock.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement measurement + split**

Add imports:

```tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { computeDockInlineCount } from "@/lib/familiar-dock-overflow";
```

Inside `FamiliarDock`, before the return, add measurement state. `ITEM_WIDTH` = 32px avatar + 6px gap; `RESERVED` = All chip (~64) + add (32) + overflow (32) + gaps (~18):

```tsx
const [rowWidth, setRowWidth] = useState(0);
useEffect(() => {
  const el = rowRef.current;
  if (!el) return;
  const ro = new ResizeObserver((entries) => {
    for (const entry of entries) setRowWidth(entry.contentRect.width);
  });
  ro.observe(el);
  return () => ro.disconnect();
}, []);

const ITEM_WIDTH = 38;
const RESERVED = 146;
const inlineCount = computeDockInlineCount({
  containerWidth: rowWidth,
  itemWidth: ITEM_WIDTH,
  reservedWidth: RESERVED,
  total: familiars.length,
});
const inline = useMemo(() => familiars.slice(0, inlineCount), [familiars, inlineCount]);
const overflow = useMemo(() => familiars.slice(inlineCount), [familiars, inlineCount]);
const overflowCount = overflow.length;
```

Render only `inline` in the avatar map (replace `familiars.map` with `inline.map`). Add the overflow button between the avatar run and the add button:

```tsx
{overflowCount > 0 ? (
  <button
    type="button"
    ref={overflowBtnRef}
    className="familiar-dock__overflow"
    aria-label={`Show ${overflowCount} more familiars`}
    aria-haspopup="menu"
    aria-expanded={popoverOpen}
    onClick={() => setPopoverOpen((o) => !o)}
  >
    <Icon name="ph:dots-three-bold" width={14} aria-hidden />
    <span className="familiar-dock__overflow-badge">{overflowCount}</span>
  </button>
) : null}
```

Add the refs/state the overflow button references (the popover itself lands in Task 5):

```tsx
const overflowBtnRef = useRef<HTMLButtonElement | null>(null);
const [popoverOpen, setPopoverOpen] = useState(false);
```

> Note: when `rowWidth` is 0 on first paint, `inlineCount` is 0 — every familiar starts in overflow for one frame, then the ResizeObserver fires and the split settles. Acceptable; no flash mitigation needed for the sidebar width.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --experimental-strip-types src/components/familiar-dock.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/familiar-dock.tsx src/components/familiar-dock.test.ts
git commit -S -m "feat(familiar-dock): responsive overflow with hidden-count badge"
```

---

## Task 5: Overflow + operations popover

Add the searchable popover (anchored to `···`) with grouped rows, per-row customize, and a New / Manage / Reorder footer.

**Files:**
- Modify: `src/components/familiar-dock.tsx`
- Modify: `src/components/familiar-dock.test.ts`

- [ ] **Step 1: Add failing assertions**

```ts
assert.match(src, /from "@\/components\/ui\/popover"/, "uses the shared popover");
assert.match(src, /placeholder="Filter familiars…"/, "popover has a search field");
assert.match(src, /Not shown in dock/, "popover groups overflow familiars");
assert.match(src, /openFamiliarStudioListView\(\)/, "Manage opens the studio list");
assert.match(src, /Reorder/, "footer exposes Reorder");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --experimental-strip-types src/components/familiar-dock.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the popover**

Add imports + search state:

```tsx
import { Popover, PopoverBody, PopoverLabel, PopoverSeparator } from "@/components/ui/popover";
```
```tsx
const [query, setQuery] = useState("");
const q = query.trim().toLowerCase();
const matches = (f: ResolvedFamiliar) =>
  !q || f.display_name.toLowerCase().includes(q) || (f.role ?? "").toLowerCase().includes(q);
const overflowMatches = overflow.filter(matches);
const inlineMatches = inline.filter(matches);
```

Render after the `familiar-dock__row` closing tag, inside the component's root `div`:

```tsx
<Popover open={popoverOpen} onOpenChange={setPopoverOpen} anchorRef={overflowBtnRef} placement="bottom-end" minWidth={280}>
  <div className="familiar-dock__pop">
    <input
      type="text"
      value={query}
      onChange={(e) => setQuery(e.target.value)}
      placeholder="Filter familiars…"
      aria-label="Filter familiars"
      className="familiar-dock__pop-search"
      autoFocus
    />
    <PopoverBody>
      {overflowMatches.length > 0 ? (
        <>
          <PopoverLabel>Not shown in dock</PopoverLabel>
          {overflowMatches.map((f) => (
            <PopoverFamiliarRow
              key={f.id}
              familiar={f}
              active={f.id === activeFamiliarId}
              needsReply={responseNeeded?.has(f.id) ?? false}
              onSelect={() => { onFamiliarScopeChange(f.id); setPopoverOpen(false); }}
              onCustomize={() => { openFamiliarStudio(f.id, "identity"); setPopoverOpen(false); }}
            />
          ))}
        </>
      ) : null}
      {inlineMatches.length > 0 ? (
        <>
          <PopoverLabel>In dock</PopoverLabel>
          {inlineMatches.map((f) => (
            <PopoverFamiliarRow
              key={f.id}
              familiar={f}
              active={f.id === activeFamiliarId}
              needsReply={responseNeeded?.has(f.id) ?? false}
              onSelect={() => { onFamiliarScopeChange(f.id); setPopoverOpen(false); }}
              onCustomize={() => { openFamiliarStudio(f.id, "identity"); setPopoverOpen(false); }}
            />
          ))}
        </>
      ) : null}
      <PopoverSeparator />
      <div className="familiar-dock__pop-foot">
        <button type="button" className="familiar-dock__pop-btn familiar-dock__pop-btn--pri"
          onClick={() => { openFamiliarStudioListView(); setPopoverOpen(false); }}>
          <Icon name="ph:plus-bold" width={11} aria-hidden /> New
        </button>
        <button type="button" className="familiar-dock__pop-btn"
          onClick={() => { openFamiliarStudioListView(); setPopoverOpen(false); }}>
          <Icon name="ph:list-bullets" width={11} aria-hidden /> Manage
        </button>
        <button type="button" className="familiar-dock__pop-btn"
          onClick={() => { setReordering(true); setPopoverOpen(false); }}>
          <Icon name="ph:arrows-out-line-vertical" width={11} aria-hidden /> Reorder
        </button>
      </div>
    </PopoverBody>
  </div>
</Popover>
```

Add the `reordering` state (consumed in Task 6) near the other state:

```tsx
const [reordering, setReordering] = useState(false);
```

Add the row sub-component at the bottom of the file:

```tsx
function PopoverFamiliarRow({
  familiar,
  active,
  needsReply,
  onSelect,
  onCustomize,
}: {
  familiar: ResolvedFamiliar;
  active: boolean;
  needsReply: boolean;
  onSelect: () => void;
  onCustomize: () => void;
}) {
  return (
    <div className={`familiar-dock__pop-row${active ? " familiar-dock__pop-row--active" : ""}`}>
      <button type="button" className="familiar-dock__pop-pick" onClick={onSelect} aria-pressed={active}>
        <FamiliarAvatar familiar={familiar} size="sm" />
        <span className="familiar-dock__pop-name">{familiar.display_name}</span>
        <span className="familiar-dock__pop-role">{familiar.role}</span>
        {needsReply ? <span className="familiar-dock__pop-unread" aria-hidden /> : null}
      </button>
      <button type="button" className="familiar-dock__pop-gear" aria-label={`Customize ${familiar.display_name}`} title="Customize" onClick={onCustomize}>
        <Icon name="ph:gear-six" width={12} aria-hidden />
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --experimental-strip-types src/components/familiar-dock.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/familiar-dock.tsx src/components/familiar-dock.test.ts
git commit -S -m "feat(familiar-dock): searchable overflow + operations popover"
```

---

## Task 6: Drag-to-reorder + roving keyboard nav

Reuse the dead rail's `@dnd-kit` reorder idiom (horizontal) and roving tabindex. The popover "Reorder" button toggles a `reordering` mode that makes the inline avatars draggable.

**Files:**
- Modify: `src/components/familiar-dock.tsx`
- Modify: `src/components/familiar-dock.test.ts`

- [ ] **Step 1: Add failing assertions**

```ts
assert.match(src, /from "@dnd-kit\/core"/, "uses dnd-kit");
assert.match(src, /horizontalListSortingStrategy/, "horizontal sorting strategy");
assert.match(src, /setFamiliarOrder\(arrayMove/, "persists reorder via setFamiliarOrder");
assert.match(src, /useRovingTabIndex/, "roving tabindex for keyboard nav");
assert.match(src, /orientation: "horizontal"/, "roving nav is horizontal");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --experimental-strip-types src/components/familiar-dock.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement reorder + roving** (mirrors `familiar-avatar-rail.tsx`, adapted horizontal)

Add imports:

```tsx
import {
  DndContext, PointerSensor, KeyboardSensor, useSensor, useSensors, closestCenter,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext, useSortable, arrayMove, sortableKeyboardCoordinates,
  horizontalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { setFamiliarOrder } from "@/lib/cave-familiar-order";
import { useRovingTabIndex } from "@/lib/use-roving-tabindex";
```

Add sensors, roving, and the drag handler inside `FamiliarDock`:

```tsx
useRovingTabIndex({
  containerRef: rowRef,
  itemSelector: ".familiar-dock__avatar:not([disabled])",
  orientation: "horizontal",
});
const sensors = useSensors(
  useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
);
const familiarIds = useMemo(() => familiars.map((f) => f.id), [familiars]);
function handleDragEnd(event: DragEndEvent) {
  const { active, over } = event;
  if (!over || active.id === over.id) return;
  const oldIndex = familiarIds.indexOf(String(active.id));
  const newIndex = familiarIds.indexOf(String(over.id));
  if (oldIndex < 0 || newIndex < 0) return;
  setFamiliarOrder(arrayMove(familiarIds, oldIndex, newIndex));
}
```

Wrap the inline avatar run in `DndContext` + `SortableContext` (only when `reordering`, so a normal click stays a select; in reorder mode the avatars use the sortable transform). Extract the avatar button into a `SortableDockAvatar` sub-component that calls `useSortable({ id: familiar.id })` and spreads `attributes`/`listeners`, exactly as `SortableAvatarItem` does in `familiar-avatar-rail.tsx:229-301`, but with the dock classes and a horizontal `CSS.Translate` transform. When `reordering` is false, render the plain button from Task 3 (no sortable). Add a small "Done" affordance:

```tsx
{reordering ? (
  <button type="button" className="familiar-dock__done" onClick={() => setReordering(false)}>Done</button>
) : null}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --experimental-strip-types src/components/familiar-dock.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/familiar-dock.tsx src/components/familiar-dock.test.ts
git commit -S -m "feat(familiar-dock): drag-reorder + horizontal roving nav"
```

---

## Task 7: Dock styles

**Files:**
- Modify: `src/app/globals.css`
- Test: reuse `src/app/globals.css.test.ts` is not required; add a source assertion in `familiar-dock.test.ts` is unnecessary (CSS asserted in Task 9 retarget). Visual check happens in Task 11.

- [ ] **Step 1: Add the dock CSS** (append near the old rail block; place before deleting the rail block in Task 9 or after — order-independent)

```css
.familiar-dock { width: 100%; }
.familiar-dock__row {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  overflow: hidden;
}
.familiar-dock__all {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 30px;
  padding: 0 10px;
  border-radius: 999px;
  border: 1px solid var(--border-hairline);
  background: var(--bg-raised);
  color: var(--text-secondary);
  font-size: 12px;
  flex-shrink: 0;
  cursor: pointer;
  transition: background var(--duration-fast) var(--ease-standard), color var(--duration-fast) var(--ease-standard);
}
.familiar-dock__all--active {
  background: var(--accent-presence);
  border-color: var(--accent-presence);
  color: #fff;
}
.familiar-dock__avatar {
  position: relative;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  border: none;
  background: var(--bg-raised);
  display: grid;
  place-items: center;
  flex-shrink: 0;
  cursor: pointer;
  transition: transform var(--duration-fast) var(--ease-standard);
}
.familiar-dock__avatar:hover { transform: scale(1.06); }
.familiar-dock__avatar--active {
  box-shadow: 0 0 0 2px var(--familiar-accent, var(--accent-presence)), 0 0 0 4px var(--bg-panel);
}
.familiar-dock__presence {
  position: absolute; right: -1px; bottom: -1px;
  width: 10px; height: 10px; border-radius: 50%;
  border: 2px solid var(--bg-panel);
}
.familiar-dock__unread {
  position: absolute; right: -2px; top: -2px;
  width: 10px; height: 10px; border-radius: 50%;
  background: var(--color-danger); border: 2px solid var(--bg-panel);
}
.familiar-dock__overflow,
.familiar-dock__add {
  position: relative;
  display: grid; place-items: center;
  width: 30px; height: 30px;
  border-radius: 50%;
  flex-shrink: 0;
  cursor: pointer;
  color: var(--text-muted);
}
.familiar-dock__overflow { background: var(--bg-raised); border: 1px solid var(--border-hairline); }
.familiar-dock__add { background: transparent; border: 1px dashed var(--border-strong); }
.familiar-dock__overflow-badge {
  position: absolute; top: -3px; right: -3px;
  min-width: 14px; height: 14px; padding: 0 3px;
  border-radius: 999px;
  background: var(--bg-elevated); border: 2px solid var(--bg-panel);
  font-size: 9px; line-height: 1; display: grid; place-items: center;
  color: var(--text-secondary);
}
/* Popover */
.familiar-dock__pop { display: flex; flex-direction: column; }
.familiar-dock__pop-search {
  width: 100%; height: 32px; padding: 0 10px;
  border: 0; border-bottom: 1px solid var(--border-hairline);
  background: transparent; color: var(--text-primary); font-size: 12.5px; outline: none;
}
.familiar-dock__pop-row { display: flex; align-items: center; }
.familiar-dock__pop-row:hover,
.familiar-dock__pop-row--active { background: var(--bg-raised); }
.familiar-dock__pop-pick {
  flex: 1; display: flex; align-items: center; gap: 9px;
  padding: 7px 10px; background: transparent; border: 0; cursor: pointer; min-width: 0;
}
.familiar-dock__pop-name { color: var(--text-primary); font-size: 13px; }
.familiar-dock__pop-role { color: var(--text-muted); font-size: 10.5px; }
.familiar-dock__pop-unread { margin-left: auto; width: 8px; height: 8px; border-radius: 50%; background: var(--color-danger); }
.familiar-dock__pop-gear { padding: 7px 10px; background: transparent; border: 0; color: var(--text-muted); cursor: pointer; }
.familiar-dock__pop-foot { display: flex; gap: 6px; padding: 8px 10px; }
.familiar-dock__pop-btn {
  flex: 1; display: inline-flex; align-items: center; justify-content: center; gap: 5px;
  padding: 6px 0; border-radius: 7px;
  border: 1px solid var(--border-hairline); background: var(--bg-raised);
  color: var(--text-secondary); font-size: 11.5px; cursor: pointer;
}
.familiar-dock__pop-btn--pri { background: var(--accent-presence); border-color: var(--accent-presence); color: #fff; }
.familiar-dock__done {
  height: 30px; padding: 0 10px; border-radius: 7px; flex-shrink: 0;
  border: 1px solid var(--accent-presence); background: transparent;
  color: var(--accent-presence); font-size: 12px; cursor: pointer;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/globals.css
git commit -S -m "style(familiar-dock): dock + popover styling"
```

---

## Task 8: Mount the dock in the sidebar; thread responseNeeded

**Files:**
- Modify: `src/components/sidebar-minimal.tsx`
- Modify: `src/components/workspace.tsx:1179-1212`

- [ ] **Step 1: Replace `FamiliarScopeSelect` usage in `sidebar-minimal.tsx`**

Delete the `FamiliarScopeSelect` function (lines 111-142). Add the import near the others:

```tsx
import { FamiliarDock } from "@/components/familiar-dock";
```

Add `responseNeeded` to `SidebarMinimalProps` (after `onFamiliarScopeChange`):

```tsx
responseNeeded?: Set<string>;
```

Destructure `sessions` and `responseNeeded` in `SidebarMinimal` and replace the header-actions block (lines 250-261) — keep the New chat row:

```tsx
<div className="sidebar-actions sidebar-action-stack">
  <FamiliarDock
    familiars={familiars}
    activeFamiliarId={activeFamiliarId}
    sessions={props.sessions}
    responseNeeded={responseNeeded}
    onFamiliarScopeChange={onFamiliarScopeChange}
  />
  <ActionRow
    icon={<Icon name="ph:note-pencil" width={14} />}
    label="New chat"
    onClick={onNewChat}
  />
</div>
```

- [ ] **Step 2: Pass `responseNeeded` from `workspace.tsx`**

In the `<SidebarMinimal ...>` mount (after `onFamiliarScopeChange={selectFamiliarScope}` at line 1210):

```tsx
responseNeeded={responseNeeded}
```

- [ ] **Step 3: Verify build compiles**

Run: `pnpm --dir . build` (or `pnpm tsc --noEmit` if configured)
Expected: no type errors referencing `FamiliarScopeSelect`, `FamiliarDock`, or `responseNeeded`.

- [ ] **Step 4: Commit**

```bash
git add src/components/sidebar-minimal.tsx src/components/workspace.tsx
git commit -S -m "feat(sidebar): mount FamiliarDock in place of the scope dropdown"
```

---

## Task 9: Consolidation — delete dead rail; retarget tests

**Files:**
- Delete: `src/components/familiar-avatar-rail.tsx`, `src/components/familiar-avatar-rail.test.ts`, `src/components/avatar-rail-roving.test.ts`
- Modify: `src/app/globals.css` (remove `.familiar-avatar-rail*` block)
- Modify: `src/components/sidebar-familiar-filter.test.ts`
- Modify: `package.json` (`test:app`)

- [ ] **Step 1: Confirm the rail is unreferenced**

Run: `grep -rn "familiar-avatar-rail\|FamiliarAvatarRail" src | grep -v "\.test\.ts"`
Expected: no matches (component is dead). If any match appears, STOP and resolve before deleting.

- [ ] **Step 2: Delete the component, its tests, and its CSS**

```bash
git rm src/components/familiar-avatar-rail.tsx \
       src/components/familiar-avatar-rail.test.ts \
       src/components/avatar-rail-roving.test.ts
```

Remove the `.familiar-avatar-rail*` rules from `src/app/globals.css` (the block the rail owned, ~the `.familiar-avatar-rail` … `.familiar-avatar-rail__add-menu*` rules). Leave all other CSS intact.

- [ ] **Step 3: Retarget `sidebar-familiar-filter.test.ts`**

Replace the dropdown-specific assertions with dock assertions. Specifically:
- Remove the assertions matching `function FamiliarScopeSelect`, the `<option value="">Familiars</option>` block, and `onFamiliarScopeChange(e\.currentTarget\.value \|\| null)`.
- Add:

```ts
assert.match(sidebar, /<FamiliarDock/, "sidebar mounts the FamiliarDock");
assert.match(sidebar, /onFamiliarScopeChange=\{onFamiliarScopeChange\}/, "dock is wired to the scope change handler");
assert.doesNotMatch(sidebar, /function FamiliarScopeSelect/, "the scope dropdown is removed");
```
- Keep the existing assertions that workspace must not mount `FamiliarAvatarRail`/`sidebar-trigger-rail` and the `scopedFamiliars` ChatSurface assertion — both remain true.

- [ ] **Step 4: Update `package.json` `test:app`**

Remove the two entries:
`node --experimental-strip-types src/components/familiar-avatar-rail.test.ts` and
`node --experimental-strip-types src/components/avatar-rail-roving.test.ts`.
Add:
`node --experimental-strip-types src/lib/familiar-dock-overflow.test.ts` and
`node --experimental-strip-types src/components/familiar-dock.test.ts`.

- [ ] **Step 5: Run the wired-tests guard + the affected tests**

```bash
pnpm run check:tests-wired
node --experimental-strip-types src/lib/familiar-dock-overflow.test.ts
node --experimental-strip-types src/components/familiar-dock.test.ts
node --experimental-strip-types src/components/sidebar-familiar-filter.test.ts
```
Expected: guard passes (every `*.test.ts` wired, no dangling), all three tests print `OK`.

- [ ] **Step 6: Commit**

```bash
git add -u
git add src/components/familiar-dock.test.ts src/lib/familiar-dock-overflow.test.ts package.json
git commit -S -m "refactor(familiar): delete dead avatar rail; retarget tests to the dock"
```

---

## Task 10: Full test sweep + live verification

**Files:** none (verification only)

- [ ] **Step 1: Run the app test suite**

Run: `pnpm run test:app`
Expected: all tests pass (including the new dock tests and the retargeted sidebar test).

- [ ] **Step 2: Build**

Run: `pnpm --dir . build`
Expected: clean build, no type errors.

- [ ] **Step 3: Live-verify in the dev app** (desktop)

Per `reference_dev_app_browser_verify`: launch on a unique port, open the workspace, and confirm:
- The dock renders in the left sidebar with the All chip + avatars (no dropdown).
- Clicking an avatar filters chats/board to that familiar (active ring + lit state); the breadcrumb/scope reflects it.
- Clicking All clears the filter.
- Narrowing the sidebar collapses extra avatars into `···` with the correct +N badge; the popover opens, search filters, selecting a row applies the scope, Manage opens the studio list, Reorder enters reorder mode and a drag persists across reload.
- Right-clicking an avatar opens customize.

- [ ] **Step 4: Commit any verification fixups**, then the feature branch is ready for PR per the repo's protected-`main` workflow (signed commits, worktree, `gh pr create`, green checks, squash-merge).

---

## Self-review notes (author)

- **Spec coverage:** surface/layout (Tasks 2,4,7,8), filter interaction (Task 2), presence/unread (Task 3), responsive overflow (Tasks 1,4), popover with search/groups/customize/footer (Task 5), reorder + a11y (Task 6), consolidation/no-duplicate-UI (Task 9), testing (Tasks 1-10). The spec's "chat rail placement / resets to All" are intentionally overridden by the user's "left sidebar / global scope" decision — see Reconciliation.
- **Type consistency:** `FamiliarDock` props (`familiars`, `activeFamiliarId`, `sessions`, `responseNeeded`, `onFamiliarScopeChange`) are identical across Tasks 2-8 and the sidebar mount (Task 8). `computeDockInlineCount` signature is stable across Tasks 1 and 4. `setFamiliarOrder`, `computePresence`, `useFamiliarStudio`, `Popover` match their real source signatures.
- **No placeholders:** every code step ships real code; sub-components (`PopoverFamiliarRow`, `SortableDockAvatar`) are specified with their source-of-truth analog (`familiar-avatar-rail.tsx:229-301`).
