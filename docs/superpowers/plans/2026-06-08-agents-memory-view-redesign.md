# Agents Memory View Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the horizontal-overflow bug in the memory list, then improve information density and clarity across the rail (`compact` + `lockToFamiliar`) and the full Agents > Memory tab.

**Architecture:** Single React component (`AgentsMemoryView`) renders both surfaces, parameterized by `compact` and `lockToFamiliar` props. Internal `MemoryFilesList` handles per-row rendering. Rail wrapper (`RailMemoryList`) composes the component with a sticky footer. Tests use source-text regex assertions (the repo's established pattern, see `agents-memory-view-sources.test.ts`).

**Tech Stack:** React 18 (Next.js client component), Tailwind classes, CSS variables for theme tokens (`var(--bg-base)` etc.), `node:test` via `npx --yes tsx --test` (per the user's test-runner memory).

**Spec:** `docs/superpowers/specs/2026-06-08-agents-memory-view-redesign-design.md`

---

## File Structure

**Modified:**
- `src/components/agents-memory-view.tsx` — component + `MemoryFilesList` + `RailMemoryList`. All rendering changes land here.
- `src/app/globals.css` — `.rail-memory*` rules. Add scroll wrapper, confirm footer pinning.

**Created (tests):**
- `src/components/agents-memory-view-overflow.test.ts` — verifies `min-w-0` on file-row containers.
- `src/components/agents-memory-view-compact-path.test.ts` — verifies middle-ellipsis logic.
- `src/components/agents-memory-view-redundant-tags.test.ts` — verifies suppression of familiar tag when filter matches.
- `src/components/agents-memory-view-rail.test.ts` — verifies compact/locked rail rendering (single-column, search placeholder, shared empty state).
- `src/components/agents-memory-view-full-tab.test.ts` — verifies inline stats row, balanced grid, drawer.

(Source-text regex tests are the repo convention; see `agents-memory-view-sources.test.ts`.)

---

## Task 1: Fix horizontal-overflow bug in MemoryFilesList

The root cause: nested flex containers without `min-w-0`. The `<button>` inside each `<li>` has `flex flex-1` but no `min-w-0`, so its child `<span>` `truncate` cannot clamp.

**Files:**
- Modify: `src/components/agents-memory-view.tsx:689-694`
- Test: `src/components/agents-memory-view-overflow.test.ts`

- [ ] **Step 1.1: Write the failing test**

Create `src/components/agents-memory-view-overflow.test.ts`:

```ts
// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./agents-memory-view.tsx", import.meta.url), "utf8");

// The <li> wrapping each memory file row must clamp its inner button.
assert.match(
  source,
  /<li[^>]*key=\{entry\.fullPath\}[^>]*className="[^"]*\bmin-w-0\b/,
  "Memory file <li> must include min-w-0 to prevent horizontal overflow in narrow surfaces",
);

// The <button> inside the <li> must also have min-w-0 so its child truncate clamps.
assert.match(
  source,
  /<button\s+[^>]*type="button"\s+onClick=\{\(\)\s*=>\s*onOpen\?\.\(entry\.fullPath\)\}[^>]*className="[^"]*\bmin-w-0\b/s,
  "Memory file row <button> must include min-w-0 so truncate clamps",
);

console.log("agents-memory-view-overflow.test.ts: ok");
```

- [ ] **Step 1.2: Run test to verify it fails**

Run: `npx --yes tsx --test src/components/agents-memory-view-overflow.test.ts`
Expected: FAIL on the first assertion (no `min-w-0` on the `<li>` yet).

- [ ] **Step 1.3: Apply the minimal source change**

In `src/components/agents-memory-view.tsx`, replace lines 689-694:

```tsx
            <li key={entry.fullPath} className="flex items-stretch gap-1 px-1 hover:bg-[var(--bg-raised)]">
              <button
                type="button"
                onClick={() => onOpen?.(entry.fullPath)}
                className="focus-ring-inset flex flex-1 items-start gap-2 px-2 py-2 text-left"
              >
```

with:

```tsx
            <li key={entry.fullPath} className="flex min-w-0 items-stretch gap-1 px-1 hover:bg-[var(--bg-raised)]">
              <button
                type="button"
                onClick={() => onOpen?.(entry.fullPath)}
                className="focus-ring-inset flex min-w-0 flex-1 items-start gap-2 px-2 py-2 text-left"
              >
```

- [ ] **Step 1.4: Run test to verify it passes**

Run: `npx --yes tsx --test src/components/agents-memory-view-overflow.test.ts`
Expected: PASS, logs `agents-memory-view-overflow.test.ts: ok`.

- [ ] **Step 1.5: Commit**

```bash
git add src/components/agents-memory-view.tsx src/components/agents-memory-view-overflow.test.ts
git commit -S -m "$(cat <<'EOF'
fix(memory): clamp memory file rows with min-w-0 to kill horizontal overflow

Nested flex without min-w-0 on the <li> and <button> meant the
existing truncate could not clamp the long provenance line, leaving a
visible horizontal scrollbar in the rail.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

Verify the commit is signed: `git log -1 --show-signature` must include `Good "<algorithm>" signature`.

---

## Task 2: Smarter compactPath with middle-ellipsis

The current `compactPath` only swaps `/Users/<name>` → `~`. Long paths still get right-truncated by CSS, hiding the filename — which is the most useful part. Add middle-ellipsis when total length exceeds threshold.

**Files:**
- Modify: `src/components/agents-memory-view.tsx:64-66`
- Test: `src/components/agents-memory-view-compact-path.test.ts`

- [ ] **Step 2.1: Write the failing test**

Create `src/components/agents-memory-view-compact-path.test.ts`:

```ts
// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./agents-memory-view.tsx", import.meta.url), "utf8");

// Function exists and uses middle-ellipsis for long paths.
assert.match(
  source,
  /function compactPath\(path: string\): string \{[\s\S]*?const collapsed = path\.replace\(\/\^\\\/Users\\\/\[\^\\\/\]\+\/, "~"\);[\s\S]*?const THRESHOLD\s*=\s*52/,
  "compactPath must keep the ~ collapsing and apply a length threshold for middle-ellipsis",
);

assert.match(
  source,
  /function compactPath\(path: string\): string \{[\s\S]*?\.\.\.last\s*=\s*segments\.slice\(-3\)/,
  "compactPath must take the last 3 segments (parent/parent/filename) when middle-ellipsizing",
);

assert.match(
  source,
  /function compactPath\(path: string\): string \{[\s\S]*?return `\$\{first\}\/…\/\$\{last\.join\("\/"\)\}`/,
  "compactPath must rejoin with the literal ellipsis character",
);

console.log("agents-memory-view-compact-path.test.ts: ok");
```

- [ ] **Step 2.2: Run test to verify it fails**

Run: `npx --yes tsx --test src/components/agents-memory-view-compact-path.test.ts`
Expected: FAIL — current `compactPath` is a one-liner.

- [ ] **Step 2.3: Replace the function**

In `src/components/agents-memory-view.tsx`, replace lines 64-66:

```tsx
function compactPath(path: string): string {
  return path.replace(/^\/Users\/[^/]+/, "~");
}
```

with:

```tsx
function compactPath(path: string): string {
  const collapsed = path.replace(/^\/Users\/[^/]+/, "~");
  const THRESHOLD = 52;
  if (collapsed.length <= THRESHOLD) return collapsed;
  const segments = collapsed.split("/").filter(Boolean);
  if (segments.length <= 4) return collapsed;
  const first = collapsed.startsWith("~") ? "~" : `/${segments[0]}`;
  const last = segments.slice(-3);
  return `${first}/…/${last.join("/")}`;
}
```

- [ ] **Step 2.4: Run test to verify it passes**

Run: `npx --yes tsx --test src/components/agents-memory-view-compact-path.test.ts`
Expected: PASS.

- [ ] **Step 2.5: Sanity check the function behaviour at runtime**

Run a quick repl check:

```bash
node --input-type=module -e "
const compactPath = (path) => {
  const collapsed = path.replace(/^\/Users\/[^/]+/, '~');
  const THRESHOLD = 52;
  if (collapsed.length <= THRESHOLD) return collapsed;
  const segments = collapsed.split('/').filter(Boolean);
  if (segments.length <= 4) return collapsed;
  const first = collapsed.startsWith('~') ? '~' : '/' + segments[0];
  const last = segments.slice(-3);
  return first + '/…/' + last.join('/');
};
console.log(compactPath('/Users/buns/.openclaw/familiars/nova/memory/2026-06-03.md'));
console.log(compactPath('/Users/buns/.openclaw/data/long/nested/path/familiars/nova/memory/2026-06-03.md'));
"
```

Expected:
```
~/.openclaw/familiars/nova/memory/2026-06-03.md
~/…/nova/memory/2026-06-03.md
```

(First is under threshold; second collapses.)

- [ ] **Step 2.6: Commit**

```bash
git add src/components/agents-memory-view.tsx src/components/agents-memory-view-compact-path.test.ts
git commit -S -m "$(cat <<'EOF'
feat(memory): middle-ellipsize long file paths to keep filename visible

Right-truncation hid the most useful part of the path (the filename).
Apply a 52-char threshold; collapse interior segments to '…' while
preserving the leading '~' and the last three segments.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Suppress redundant familiar tag in MemoryFilesList

Pass `activeFamiliarId` into `MemoryFilesList`. When the row's `familiarId` equals the active filter, drop the `familiar:<id>` badge — it's noise.

**Files:**
- Modify: `src/components/agents-memory-view.tsx` (props + caller sites + render)
- Test: `src/components/agents-memory-view-redundant-tags.test.ts`

- [ ] **Step 3.1: Write the failing test**

Create `src/components/agents-memory-view-redundant-tags.test.ts`:

```ts
// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./agents-memory-view.tsx", import.meta.url), "utf8");

// Prop on the type.
assert.match(
  source,
  /type MemoryFilesListProps = \{[\s\S]*?activeFamiliarId\?:\s*string\s*\|\s*null/,
  "MemoryFilesListProps must declare activeFamiliarId",
);

// Prop destructured in the component signature.
assert.match(
  source,
  /export function MemoryFilesList\(\{[\s\S]*?activeFamiliarId,[\s\S]*?\}: MemoryFilesListProps\)/,
  "MemoryFilesList must destructure activeFamiliarId",
);

// Conditional render that hides the familiar badge when it matches the filter.
assert.match(
  source,
  /entry\.familiarId\s*&&\s*entry\.familiarId\s*!==\s*activeFamiliarId\s*\?\s*<span/,
  "MemoryFilesList must hide the familiar:<id> badge when it matches the active filter",
);

// The internal call site in AgentsMemoryView must thread the filter through.
assert.match(
  source,
  /<MemoryFilesList[\s\S]*?activeFamiliarId=\{familiarFilter\}/,
  "AgentsMemoryView must pass familiarFilter as activeFamiliarId to MemoryFilesList",
);

console.log("agents-memory-view-redundant-tags.test.ts: ok");
```

- [ ] **Step 3.2: Run test to verify it fails**

Run: `npx --yes tsx --test src/components/agents-memory-view-redundant-tags.test.ts`
Expected: FAIL.

- [ ] **Step 3.3: Add the prop and update render**

In `src/components/agents-memory-view.tsx`, update `MemoryFilesListProps` (around line 536) to add `activeFamiliarId`:

```tsx
type MemoryFilesListProps = {
  entries: FileMemoryEntry[];
  onOpen?: (path: string) => void;
  loaded: boolean;
  error: string | null;
  limit?: number;
  className?: string;
  listClassName?: string;
  activeFamiliarId?: string | null;
};
```

Update the `MemoryFilesList` signature (around line 669):

```tsx
export function MemoryFilesList({
  entries,
  onOpen,
  loaded,
  error,
  limit,
  className,
  listClassName,
  activeFamiliarId,
}: MemoryFilesListProps) {
```

Replace the `familiar:<id>` badge line (around line 706) — change:

```tsx
{entry.familiarId ? <span className="rounded bg-[var(--bg-elevated)] px-1 py-0.5">familiar:{entry.familiarId}</span> : null}
```

to:

```tsx
{entry.familiarId && entry.familiarId !== activeFamiliarId ? <span className="rounded bg-[var(--bg-elevated)] px-1 py-0.5">familiar:{entry.familiarId}</span> : null}
```

Update the in-component caller (around line 472):

```tsx
          <MemoryFilesList
            entries={visibleFiles}
            onOpen={onOpenMemoryFile}
            loaded={loaded}
            error={error}
            limit={effectiveLimit === Infinity ? 160 : effectiveLimit}
            activeFamiliarId={familiarFilter}
          />
```

- [ ] **Step 3.4: Run the test to verify it passes**

Run: `npx --yes tsx --test src/components/agents-memory-view-redundant-tags.test.ts`
Expected: PASS.

- [ ] **Step 3.5: Run the existing sources test to confirm no regression**

Run: `npx --yes tsx --test src/components/agents-memory-view-sources.test.ts`
Expected: PASS (existing assertions are unaffected).

- [ ] **Step 3.6: Commit**

```bash
git add src/components/agents-memory-view.tsx src/components/agents-memory-view-redundant-tags.test.ts
git commit -S -m "$(cat <<'EOF'
feat(memory): hide familiar tag when it matches the active filter

Every row in the filtered view already pertains to the active familiar;
the badge was visual noise. Thread the filter through MemoryFilesList
and gate the badge on familiarId !== activeFamiliarId.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Search placeholder reflects locked familiar + drop redundant pill

When `lockToFamiliar` is true, the surface header already shows the familiar's name (e.g., rail shows "Nova" at top). Showing it again as a pill next to the search box wastes space. Move the cue into the placeholder instead.

**Files:**
- Modify: `src/components/agents-memory-view.tsx:281-309`
- Test: `src/components/agents-memory-view-rail.test.ts` (created in this task; expanded in later tasks)

- [ ] **Step 4.1: Write the failing test**

Create `src/components/agents-memory-view-rail.test.ts`:

```ts
// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./agents-memory-view.tsx", import.meta.url), "utf8");

// Placeholder is dynamic and falls back when there's no locked familiar.
assert.match(
  source,
  /placeholder=\{[^}]*lockToFamiliar[^}]*selectedFamiliar[^}]*display_name[^}]*"Search memory\.\.\."[^}]*\}/s,
  "Search input placeholder must reflect the locked familiar's display name",
);

// The standalone <span aria-label="Locked to familiar"> must be gone.
assert.doesNotMatch(
  source,
  /aria-label="Locked to familiar"/,
  "The redundant locked-familiar pill must be removed when lockToFamiliar is true",
);

console.log("agents-memory-view-rail.test.ts: ok");
```

- [ ] **Step 4.2: Run test to verify it fails**

Run: `npx --yes tsx --test src/components/agents-memory-view-rail.test.ts`
Expected: FAIL — placeholder is static and pill exists.

- [ ] **Step 4.3: Update the search input block**

In `src/components/agents-memory-view.tsx`, replace lines 281-309 (the search input + lockToFamiliar branch):

```tsx
        <div className={`${compact ? "" : "mt-3"} flex flex-wrap items-center gap-2`}>
          <div className={`relative ${compact ? "min-w-0" : "min-w-[220px]"} flex-1`}>
            <Icon name="ph:magnifying-glass" width={12} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={lockToFamiliar && selectedFamiliar?.display_name ? `Search ${selectedFamiliar.display_name}'s memory...` : "Search memory..."}
              className="focus-ring h-8 w-full rounded-md border border-[var(--border-hairline)] bg-[var(--bg-raised)]/40 pl-7 pr-3 text-[12px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--accent-presence)]"
            />
          </div>
          {lockToFamiliar ? null : (
            <select
              value={familiarFilter}
              onChange={(event) => setFamiliarFilter(event.target.value)}
              className="focus-ring h-8 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-raised)]/40 px-2 text-[12px] text-[var(--text-secondary)] focus:border-[var(--accent-presence)]"
            >
              {familiarOptions.map((familiar) => (
                <option key={familiar.id} value={familiar.id}>{familiar.display_name}</option>
              ))}
            </select>
          )}
        </div>
```

- [ ] **Step 4.4: Run test to verify it passes**

Run: `npx --yes tsx --test src/components/agents-memory-view-rail.test.ts`
Expected: PASS.

- [ ] **Step 4.5: Commit**

```bash
git add src/components/agents-memory-view.tsx src/components/agents-memory-view-rail.test.ts
git commit -S -m "$(cat <<'EOF'
fix(memory): dynamic search placeholder, drop redundant locked-familiar pill

When lockToFamiliar is true the surface header already shows the
familiar's name (e.g. the rail's 'Nova' header). Surface the cue in
the placeholder instead of repeating it in a pill.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Rail — single-column vertical stack in compact mode

The grid `xl:grid-cols-[minmax(0,1.25fr)_minmax(320px,0.75fr)]` always trips xl at rail width, but each column is too narrow. In `compact` mode, stack the two sections vertically.

**Files:**
- Modify: `src/components/agents-memory-view.tsx:418` (list-mode container)
- Test: extend `src/components/agents-memory-view-rail.test.ts`

- [ ] **Step 5.1: Extend the failing test**

Append to `src/components/agents-memory-view-rail.test.ts`:

```ts
// The list-mode container must drop the xl 2-column grid when compact is true.
assert.match(
  source,
  /\$\{compact\s*\?\s*"flex flex-col gap-4 overflow-y-auto p-4"\s*:\s*"grid gap-4 overflow-y-auto p-4 xl:grid-cols-\[minmax\(0,1fr\)_minmax\(0,1fr\)\]"\}/s,
  "List-mode container must stack vertically in compact mode and use a balanced 2-col grid otherwise",
);
```

- [ ] **Step 5.2: Run test to verify it fails**

Run: `npx --yes tsx --test src/components/agents-memory-view-rail.test.ts`
Expected: FAIL — the new assertion misses.

- [ ] **Step 5.3: Update the list-mode container className**

In `src/components/agents-memory-view.tsx`, line 418, replace:

```tsx
      <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto p-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(320px,0.75fr)]">
```

with:

```tsx
      <div className={`min-h-0 flex-1 ${compact ? "flex flex-col gap-4 overflow-y-auto p-4" : "grid gap-4 overflow-y-auto p-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"}`}>
```

(Tailwind needs the literal strings unbroken so JIT can pick them up; the template above keeps both class strings intact.)

- [ ] **Step 5.4: Run test to verify it passes**

Run: `npx --yes tsx --test src/components/agents-memory-view-rail.test.ts`
Expected: PASS.

- [ ] **Step 5.5: Commit**

```bash
git add src/components/agents-memory-view.tsx src/components/agents-memory-view-rail.test.ts
git commit -S -m "$(cat <<'EOF'
feat(memory): vertical stack in rail, balanced columns in full tab

Compact mode (the companion rail) now stacks the familiar-memory and
memory-files sections vertically so neither column gets squeezed.
Non-compact mode uses a balanced 1fr/1fr grid instead of 1.25/0.75.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Rail — shared empty state when both sections empty

When neither familiar memories nor file memories exist for the locked familiar, render a single shared empty state explaining the concept instead of two dashed boxes.

**Files:**
- Modify: `src/components/agents-memory-view.tsx` (list-mode body, around lines 419-480)
- Test: extend `src/components/agents-memory-view-rail.test.ts`

- [ ] **Step 6.1: Extend the failing test**

Append to `src/components/agents-memory-view-rail.test.ts`:

```ts
// Shared empty state copy must be present.
assert.match(
  source,
  /No memories yet for/,
  "Rail must render a unified empty state copy when both sections are empty",
);

assert.match(
  source,
  /Familiar memories are saved during chats/,
  "Shared empty state must explain what familiar memories are",
);

// The empty-state branch must be gated on compact + both lists empty + loaded.
assert.match(
  source,
  /\{compact\s*&&\s*loaded\s*&&\s*visibleCoven\.length\s*===\s*0\s*&&\s*visibleFiles\.length\s*===\s*0\s*\?/,
  "Shared empty state must only render in compact mode when both lists are empty after load",
);
```

- [ ] **Step 6.2: Run test to verify it fails**

Run: `npx --yes tsx --test src/components/agents-memory-view-rail.test.ts`
Expected: FAIL.

- [ ] **Step 6.3: Inject the shared empty-state branch**

In `src/components/agents-memory-view.tsx`, inside the list-mode branch (just inside the container `<div>` opened in Task 5, before the first `<section>` at line 419), add:

```tsx
        {compact && loaded && visibleCoven.length === 0 && visibleFiles.length === 0 ? (
          <div className="grid place-items-center rounded-lg border border-dashed border-[var(--border-hairline)] bg-[var(--bg-raised)]/25 px-4 py-10 text-center">
            <Icon name="ph:brain" width={22} className="text-[var(--text-muted)]" />
            <div className="mt-3 text-[13px] font-medium text-[var(--text-primary)]">
              No memories yet for {selectedFamiliar?.display_name ?? "this familiar"}
            </div>
            <p className="mt-1 max-w-[280px] text-[11px] leading-5 text-[var(--text-muted)]">
              Familiar memories are saved during chats. Memory files appear when the agent's harness writes to disk.
            </p>
          </div>
        ) : (
          <>
```

And close the fragment `</>` and the conditional after the second `</section>` (after the existing line 479 `</section>` and before the container closing `</div>` at line 480). So the structure becomes:

```tsx
      <div className={`min-h-0 flex-1 ${compact ? ... : ...}`}>
        {compact && loaded && visibleCoven.length === 0 && visibleFiles.length === 0 ? (
          <div ...>...</div>
        ) : (
          <>
            <section className="min-h-0"> ... familiar memory section ... </section>
            <section className="min-h-0"> ... memory files section ... </section>
          </>
        )}
      </div>
```

- [ ] **Step 6.4: Run test to verify it passes**

Run: `npx --yes tsx --test src/components/agents-memory-view-rail.test.ts`
Expected: PASS.

- [ ] **Step 6.5: Commit**

```bash
git add src/components/agents-memory-view.tsx src/components/agents-memory-view-rail.test.ts
git commit -S -m "$(cat <<'EOF'
feat(memory): unified empty state for rail when no memories exist

Replace the two-dashed-box layout (one per section) with a single
contextual empty-state card explaining what familiar memories are and
why memory files appear. Only renders in compact mode when both
sections have no entries.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Full tab — inline stats row replaces 4 hero tiles

Reclaim ~80px of vertical space by collapsing four stat tiles into a single inline strip.

**Files:**
- Modify: `src/components/agents-memory-view.tsx:260-279`
- Test: `src/components/agents-memory-view-full-tab.test.ts`

- [ ] **Step 7.1: Write the failing test**

Create `src/components/agents-memory-view-full-tab.test.ts`:

```ts
// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./agents-memory-view.tsx", import.meta.url), "utf8");

// New inline stats row marker.
assert.match(
  source,
  /data-testid="memory-stats-inline"/,
  "Inline stats row must be marked with data-testid='memory-stats-inline'",
);

// The old 4-card grid (sm:grid-cols-2 lg:grid-cols-4) is gone.
assert.doesNotMatch(
  source,
  /grid gap-2 sm:grid-cols-2 lg:grid-cols-4/,
  "Old four-card stats grid must be removed",
);

// All four metric labels still appear inline.
for (const label of ["Agent memories", "Coven origin", "External harnesses", "Runtime memory"]) {
  assert.ok(source.includes(label), `Inline stats row must keep label: ${label}`);
}

console.log("agents-memory-view-full-tab.test.ts: ok");
```

- [ ] **Step 7.2: Run test to verify it fails**

Run: `npx --yes tsx --test src/components/agents-memory-view-full-tab.test.ts`
Expected: FAIL.

- [ ] **Step 7.3: Replace the stats block**

In `src/components/agents-memory-view.tsx`, replace lines 260-279 (the entire `{compact ? null : (... 4-card grid ...)}` block) with:

```tsx
        {compact ? null : (
          <div
            data-testid="memory-stats-inline"
            className="mt-3 flex flex-wrap items-baseline gap-x-5 gap-y-1 text-[11px] text-[var(--text-secondary)]"
          >
            <span><span className="text-[var(--text-muted)]">Agent memories</span> <span className="ml-1 font-semibold text-[var(--text-primary)]">{visibleCoven.length}</span></span>
            <span><span className="text-[var(--text-muted)]">Coven origin</span> <span className="ml-1 font-semibold text-[var(--text-primary)]">{fileSourceCounts.covenOrigin}</span></span>
            <span><span className="text-[var(--text-muted)]">External harnesses</span> <span className="ml-1 font-semibold text-[var(--text-primary)]">{fileSourceCounts.externalHarnesses}</span></span>
            <span><span className="text-[var(--text-muted)]">Runtime memory</span> <span className="ml-1 font-semibold text-[var(--text-primary)]">{fileSourceCounts.runtimeMemory}</span></span>
          </div>
        )}
```

- [ ] **Step 7.4: Run tests to verify they pass**

Run both:

```bash
npx --yes tsx --test src/components/agents-memory-view-full-tab.test.ts
npx --yes tsx --test src/components/agents-memory-view-sources.test.ts
```

Expected: PASS for both. The sources test passes because it asserts the *labels* exist; we kept all four labels.

- [ ] **Step 7.5: Commit**

```bash
git add src/components/agents-memory-view.tsx src/components/agents-memory-view-full-tab.test.ts
git commit -S -m "$(cat <<'EOF'
feat(memory): collapse hero stat tiles into an inline strip

The four-card stat grid took ~80px of vertical real estate before the
list even started. Same information now renders as a single inline row
of label/count pairs.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Full tab — collapse empty-state min-height

When one column is empty and the other has content, the empty side's `min-h-[180px]` makes the row taller than it needs to be. Drop the constraint so the populated side dictates height.

**Files:**
- Modify: `src/components/agents-memory-view.tsx:425`
- Test: extend `src/components/agents-memory-view-full-tab.test.ts`

- [ ] **Step 8.1: Extend the failing test**

Append to `src/components/agents-memory-view-full-tab.test.ts`:

```ts
assert.doesNotMatch(
  source,
  /grid min-h-\[180px\] place-items-center rounded-lg border border-dashed/,
  "Familiar memory empty-state card must not enforce min-h-[180px] (lets populated peer dictate row height)",
);

// Replacement empty-state class — same structure, no min-h.
assert.match(
  source,
  /grid place-items-center rounded-lg border border-dashed border-\[var\(--border-hairline\)\] px-4 py-6/,
  "Empty-state card must use py-6 padding instead of min-h",
);
```

- [ ] **Step 8.2: Run test to verify it fails**

Run: `npx --yes tsx --test src/components/agents-memory-view-full-tab.test.ts`
Expected: FAIL.

- [ ] **Step 8.3: Update the empty-state className**

In `src/components/agents-memory-view.tsx`, line 425, replace:

```tsx
            <div className="grid min-h-[180px] place-items-center rounded-lg border border-dashed border-[var(--border-hairline)] text-center text-[12px] text-[var(--text-muted)]">
```

with:

```tsx
            <div className="grid place-items-center rounded-lg border border-dashed border-[var(--border-hairline)] px-4 py-6 text-center text-[12px] text-[var(--text-muted)]">
```

- [ ] **Step 8.4: Run test to verify it passes**

Run: `npx --yes tsx --test src/components/agents-memory-view-full-tab.test.ts`
Expected: PASS.

- [ ] **Step 8.5: Commit**

```bash
git add src/components/agents-memory-view.tsx src/components/agents-memory-view-full-tab.test.ts
git commit -S -m "$(cat <<'EOF'
fix(memory): let empty-state column adopt populated peer's height

The familiar-memory empty card enforced min-h-[180px], making an
asymmetric row (empty + populated) feel like wasted vertical space.
Switch to py-6 padding; the populated column now dictates row height.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Full tab — selected-row drawer (third column on selection)

When the user clicks a memory card or file row in list mode, slide a third column in showing title, badges, excerpt, provenance, and actions — mirroring the graph-mode aside.

**Files:**
- Modify: `src/components/agents-memory-view.tsx` (state, click handlers, render)
- Test: extend `src/components/agents-memory-view-full-tab.test.ts`

- [ ] **Step 9.1: Extend the failing test**

Append to `src/components/agents-memory-view-full-tab.test.ts`:

```ts
// New state hook tracking the selected list-mode row.
assert.match(
  source,
  /const \[selectedRowId, setSelectedRowId\] = useState<string \| null>\(null\);/,
  "AgentsMemoryView must keep a selectedRowId state for the list-mode drawer",
);

// Drawer marker.
assert.match(
  source,
  /data-testid="memory-list-drawer"/,
  "List-mode drawer must be marked with data-testid='memory-list-drawer'",
);

// Drawer must only render when something is selected.
assert.match(
  source,
  /selectedRowId\s*\?\s*<aside[\s\S]*?data-testid="memory-list-drawer"/,
  "Drawer renders only when selectedRowId is set",
);

// Container grid must expand to a 3-column track when drawer is open.
assert.match(
  source,
  /selectedRowId\s*\?\s*"grid gap-4 overflow-y-auto p-4 xl:grid-cols-\[minmax\(0,1fr\)_minmax\(0,1fr\)_minmax\(280px,360px\)\]"/,
  "Container grid must use a 3-track layout when the drawer is open",
);

// A close handler must clear selection.
assert.match(
  source,
  /setSelectedRowId\(null\)/,
  "Drawer must provide a way to clear the selection",
);
```

- [ ] **Step 9.2: Run test to verify it fails**

Run: `npx --yes tsx --test src/components/agents-memory-view-full-tab.test.ts`
Expected: FAIL.

- [ ] **Step 9.3: Add state and click handlers**

In `src/components/agents-memory-view.tsx`, near the other `useState` declarations around line 98, add:

```tsx
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null);
```

In the familiar-memory `<article>` (around lines 433-461), wrap clickable behavior — change the article element to add `onClick` and `tabIndex` and a data attribute:

```tsx
                <article
                  key={entry.id}
                  data-row-id={`coven:${entry.id}`}
                  onClick={() => setSelectedRowId(`coven:${entry.id}`)}
                  className={`cursor-pointer rounded-lg border p-3 transition-colors ${selectedRowId === `coven:${entry.id}` ? "border-[var(--accent-presence)] bg-[var(--bg-raised)]/55" : "border-[var(--border-hairline)] bg-[var(--bg-raised)]/35 hover:bg-[var(--bg-raised)]/50"}`}
                >
```

In `MemoryFilesList`, add an `onSelect?: (id: string) => void` prop and a `selectedRowId?: string | null` prop. Update each `<li>` button's `onClick` to ALSO call `onSelect?.(file:${entry.fullPath})` before triggering `onOpen` — actually, **separate the actions:** the row click selects (drawer); a small "Open file" affordance opens the modal.

Concretely, replace the file-row block (lines 689-715) with:

```tsx
            <li
              key={entry.fullPath}
              data-row-id={`file:${entry.fullPath}`}
              className={`flex min-w-0 items-stretch gap-1 px-1 ${selectedRowId === `file:${entry.fullPath}` ? "bg-[var(--bg-raised)]/60" : "hover:bg-[var(--bg-raised)]"}`}
            >
              <button
                type="button"
                onClick={() => (onSelect ? onSelect(`file:${entry.fullPath}`) : onOpen?.(entry.fullPath))}
                className="focus-ring-inset flex min-w-0 flex-1 items-start gap-2 px-2 py-2 text-left"
              >
                <Icon name="ph:file-text" width={13} className="mt-0.5 shrink-0 text-[var(--text-muted)]" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12px] text-[var(--text-primary)]">{entry.relPath}</span>
                  <span className="mt-0.5 block truncate font-mono text-[10px] text-[var(--text-muted)]">
                    {entry.sourceKindLabel} · {entry.rootLabel} · {compactPath(entry.fullPath)}
                  </span>
                  {(entry.harnessId || entry.runtimeId || entry.origin || (entry.familiarId && entry.familiarId !== activeFamiliarId)) ? (
                    <span className="mt-1 flex flex-wrap gap-1 text-[10px] text-[var(--text-muted)]">
                      {entry.origin ? <span className="rounded bg-[var(--bg-elevated)] px-1 py-0.5">origin:{entry.origin}</span> : null}
                      {entry.harnessId ? <span className="rounded bg-[var(--bg-elevated)] px-1 py-0.5">harness:{entry.harnessId}</span> : null}
                      {entry.runtimeId ? <span className="rounded bg-[var(--bg-elevated)] px-1 py-0.5">runtime:{entry.runtimeId}</span> : null}
                      {entry.familiarId && entry.familiarId !== activeFamiliarId ? <span className="rounded bg-[var(--bg-elevated)] px-1 py-0.5">familiar:{entry.familiarId}</span> : null}
                    </span>
                  ) : null}
                </span>
                <span className="shrink-0 text-[10px] text-[var(--text-muted)]">{age(entry.modified)}</span>
              </button>
              <div className="flex items-center pr-2">
                <ExpandMemoryButton path={entry.fullPath} title={entry.relPath} variant="compact" />
              </div>
            </li>
```

Also update `MemoryFilesListProps` to declare the new props:

```tsx
type MemoryFilesListProps = {
  entries: FileMemoryEntry[];
  onOpen?: (path: string) => void;
  loaded: boolean;
  error: string | null;
  limit?: number;
  className?: string;
  listClassName?: string;
  activeFamiliarId?: string | null;
  onSelect?: (rowId: string) => void;
  selectedRowId?: string | null;
};
```

And destructure them in the `MemoryFilesList` function signature.

In `AgentsMemoryView`, thread the new props through at the call site (around line 472):

```tsx
          <MemoryFilesList
            entries={visibleFiles}
            onOpen={onOpenMemoryFile}
            loaded={loaded}
            error={error}
            limit={effectiveLimit === Infinity ? 160 : effectiveLimit}
            activeFamiliarId={familiarFilter}
            onSelect={(rowId) => setSelectedRowId(rowId)}
            selectedRowId={selectedRowId}
          />
```

- [ ] **Step 9.4: Update list-mode container grid to react to selection**

Update the list-mode container `<div>` className (from Task 5) to use the 3-column track when `selectedRowId` is truthy AND `!compact`:

Replace:

```tsx
      <div className={`min-h-0 flex-1 ${compact ? "flex flex-col gap-4 overflow-y-auto p-4" : "grid gap-4 overflow-y-auto p-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"}`}>
```

with:

```tsx
      <div className={`min-h-0 flex-1 ${compact ? "flex flex-col gap-4 overflow-y-auto p-4" : selectedRowId ? "grid gap-4 overflow-y-auto p-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(280px,360px)]" : "grid gap-4 overflow-y-auto p-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"}`}>
```

- [ ] **Step 9.5: Add the drawer aside**

Inside the non-compact branch (after the second `</section>` and before the container closing `</div>`), add:

```tsx
        {!compact && selectedRowId ? (
          <aside data-testid="memory-list-drawer" className="min-h-0 rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-raised)]/30 p-3">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-[11px] font-semibold uppercase tracking-widest text-[var(--text-secondary)]">
                Selected
              </h3>
              <button
                type="button"
                onClick={() => setSelectedRowId(null)}
                className="focus-ring inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-muted)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
                aria-label="Close drawer"
              >
                <Icon name="ph:x-bold" width={11} />
              </button>
            </div>
            {(() => {
              if (selectedRowId.startsWith("coven:")) {
                const id = selectedRowId.slice("coven:".length);
                const entry = visibleCoven.find((c) => c.id === id);
                if (!entry) return <div className="mt-3 text-[12px] text-[var(--text-muted)]">Memory no longer in view.</div>;
                const familiar = familiarById.get(entry.familiar_id);
                return (
                  <div className="mt-3">
                    <h4 className="line-clamp-3 text-[14px] font-semibold leading-5 text-[var(--text-primary)]">{entry.title}</h4>
                    <div className="mt-2 flex flex-wrap gap-1.5 text-[10px] text-[var(--text-muted)]">
                      <span className="rounded bg-[var(--bg-elevated)] px-1.5 py-0.5 text-[var(--text-secondary)]">{familiar?.display_name ?? entry.familiar_id}</span>
                      <span className="rounded bg-[var(--bg-elevated)] px-1.5 py-0.5">Coven memory</span>
                      <span className="rounded bg-[var(--bg-elevated)] px-1.5 py-0.5">{age(entry.updated_at)}</span>
                    </div>
                    {entry.excerpt ? <p className="mt-3 line-clamp-6 text-[12px] leading-5 text-[var(--text-secondary)]">{entry.excerpt}</p> : null}
                    <div className="mt-3 flex flex-wrap items-center gap-1.5">
                      <button type="button" onClick={() => onOpenMemoryFile?.(entry.path)} className="focus-ring inline-flex h-7 items-center gap-1 rounded-md border border-[var(--border-hairline)] px-2 text-[11px] text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]">
                        <Icon name="ph:file-text" width={12} />
                        Open memory
                      </button>
                      <ExpandMemoryButton path={entry.path} title={entry.title} />
                    </div>
                  </div>
                );
              }
              if (selectedRowId.startsWith("file:")) {
                const fullPath = selectedRowId.slice("file:".length);
                const entry = visibleFiles.find((f) => f.fullPath === fullPath);
                if (!entry) return <div className="mt-3 text-[12px] text-[var(--text-muted)]">File no longer in view.</div>;
                return (
                  <div className="mt-3">
                    <h4 className="line-clamp-3 text-[14px] font-semibold leading-5 text-[var(--text-primary)]">{entry.relPath}</h4>
                    <div className="mt-2 flex flex-wrap gap-1.5 text-[10px] text-[var(--text-muted)]">
                      <span className="rounded bg-[var(--bg-elevated)] px-1.5 py-0.5 text-[var(--text-secondary)]">{entry.sourceKindLabel}</span>
                      <span className="rounded bg-[var(--bg-elevated)] px-1.5 py-0.5">{entry.rootLabel}</span>
                      <span className="rounded bg-[var(--bg-elevated)] px-1.5 py-0.5">{age(entry.modified)}</span>
                    </div>
                    <div className="mt-3 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-elevated)]/40 px-2.5 py-2">
                      <div className="text-[10px] font-semibold uppercase tracking-widest text-[var(--text-secondary)]">Path</div>
                      <code className="mt-1 block break-all font-mono text-[11px] leading-4 text-[var(--text-primary)]">{compactPath(entry.fullPath)}</code>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-1.5">
                      <button type="button" onClick={() => onOpenMemoryFile?.(entry.fullPath)} className="focus-ring inline-flex h-7 items-center gap-1 rounded-md border border-[var(--border-hairline)] px-2 text-[11px] text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]">
                        <Icon name="ph:file-text" width={12} />
                        Open file
                      </button>
                      <ExpandMemoryButton path={entry.fullPath} title={entry.relPath} />
                    </div>
                  </div>
                );
              }
              return null;
            })()}
          </aside>
        ) : null}
```

- [ ] **Step 9.6: Run the tests**

```bash
npx --yes tsx --test src/components/agents-memory-view-full-tab.test.ts
npx --yes tsx --test src/components/agents-memory-view-redundant-tags.test.ts
npx --yes tsx --test src/components/agents-memory-view-rail.test.ts
npx --yes tsx --test src/components/agents-memory-view-sources.test.ts
npx --yes tsx --test src/components/agents-memory-view-overflow.test.ts
npx --yes tsx --test src/components/agents-memory-view-compact-path.test.ts
```

Expected: all PASS.

- [ ] **Step 9.7: Commit**

```bash
git add src/components/agents-memory-view.tsx src/components/agents-memory-view-full-tab.test.ts
git commit -S -m "$(cat <<'EOF'
feat(memory): list-mode selection drawer with peek of selected row

Click a memory card or file row in the full Agents > Memory tab to
open a thin third-column drawer with title, badges, excerpt or path,
and the same Open / Expand actions the graph aside already offers.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Rail CSS — sticky footer with scroll wrapper

The `Open full memory →` button currently sits in flow at the bottom of `RailMemoryList`. Wrap the AgentsMemoryView in a scroll pane so the footer pins.

**Files:**
- Modify: `src/components/agents-memory-view.tsx:508-528` (`RailMemoryList`)
- Modify: `src/app/globals.css:2978-2998` (rail-memory styles)

- [ ] **Step 10.1: Write the failing test**

Append to `src/components/agents-memory-view-rail.test.ts`:

```ts
const cssSource = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

assert.match(
  cssSource,
  /\.rail-memory\s*\{[^}]*overflow:\s*hidden/,
  "rail-memory container must hide overflow so the inner scroll pane handles it",
);

assert.match(
  cssSource,
  /\.rail-memory__scroll\s*\{[^}]*flex:\s*1[\s\S]*?min-height:\s*0[\s\S]*?overflow-y:\s*auto/,
  "rail-memory__scroll must define the inner scroll surface",
);

assert.match(
  cssSource,
  /\.rail-memory__open-full\s*\{[^}]*flex-shrink:\s*0/,
  "rail-memory__open-full must be pinned (flex-shrink: 0)",
);

// JSX wraps AgentsMemoryView in the scroll div.
assert.match(
  source,
  /<div className="rail-memory__scroll">\s*<AgentsMemoryView/,
  "RailMemoryList must wrap AgentsMemoryView in a .rail-memory__scroll div",
);
```

- [ ] **Step 10.2: Run test to verify it fails**

Run: `npx --yes tsx --test src/components/agents-memory-view-rail.test.ts`
Expected: FAIL.

- [ ] **Step 10.3: Update `RailMemoryList` JSX**

In `src/components/agents-memory-view.tsx`, replace lines 508-528:

```tsx
  return (
    <div className="rail-memory">
      <AgentsMemoryView
        familiars={familiars}
        activeFamiliar={familiar}
        mode="list"
        limit={20}
        compact
        lockToFamiliar
      />
      {onOpenFullView ? (
        <button
          type="button"
          className="focus-ring rail-memory__open-full"
          onClick={onOpenFullView}
        >
          Open full memory →
        </button>
      ) : null}
    </div>
  );
```

with:

```tsx
  return (
    <div className="rail-memory">
      <div className="rail-memory__scroll">
        <AgentsMemoryView
          familiars={familiars}
          activeFamiliar={familiar}
          mode="list"
          limit={20}
          compact
          lockToFamiliar
        />
      </div>
      {onOpenFullView ? (
        <button
          type="button"
          className="focus-ring rail-memory__open-full"
          onClick={onOpenFullView}
        >
          Open full memory →
        </button>
      ) : null}
    </div>
  );
```

- [ ] **Step 10.4: Update `globals.css`**

In `src/app/globals.css`, replace lines 2978-2998 (the `.rail-memory*` block):

```css
.rail-memory {
  display: flex;
  flex-direction: column;
  min-height: 0;
  flex: 1;
}

.rail-memory__open-full {
  padding: 8px 12px;
  border-top: 1px solid var(--border-hairline);
  background: transparent;
  color: var(--text-secondary);
  font-size: var(--text-sm);
  text-align: left;
  cursor: pointer;
  border: 0;
}

.rail-memory__open-full:hover {
  background: var(--bg-hover);
}
```

with:

```css
.rail-memory {
  display: flex;
  flex-direction: column;
  min-height: 0;
  flex: 1;
  overflow: hidden;
}

.rail-memory__scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}

.rail-memory__open-full {
  flex-shrink: 0;
  padding: 8px 12px;
  border-top: 1px solid var(--border-hairline);
  background: transparent;
  color: var(--text-secondary);
  font-size: var(--text-sm);
  text-align: left;
  cursor: pointer;
  border-left: 0;
  border-right: 0;
  border-bottom: 0;
}

.rail-memory__open-full:hover {
  background: var(--bg-hover);
}
```

- [ ] **Step 10.5: Run tests**

```bash
npx --yes tsx --test src/components/agents-memory-view-rail.test.ts
npx --yes tsx --test src/components/agents-memory-view-overflow.test.ts
npx --yes tsx --test src/components/agents-memory-view-compact-path.test.ts
npx --yes tsx --test src/components/agents-memory-view-redundant-tags.test.ts
npx --yes tsx --test src/components/agents-memory-view-full-tab.test.ts
npx --yes tsx --test src/components/agents-memory-view-sources.test.ts
```

Expected: all PASS.

- [ ] **Step 10.6: Commit**

```bash
git add src/components/agents-memory-view.tsx src/app/globals.css src/components/agents-memory-view-rail.test.ts
git commit -S -m "$(cat <<'EOF'
fix(memory): pin 'Open full memory' footer with explicit scroll wrapper

Wrap AgentsMemoryView in .rail-memory__scroll so the inner pane owns
the y-scroll, and mark the footer flex-shrink: 0 so it stays anchored
at the bottom of the rail panel.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: TypeScript + lint check

Make sure nothing regressed at the language level.

- [ ] **Step 11.1: Run typecheck**

Run the project's typecheck (check `package.json` for the script; most likely `npm run typecheck` or `npm run lint`):

```bash
cat package.json | grep -E '"(typecheck|lint|check)"' | head
```

Then run whichever script exists. Expected: 0 errors.

If `tsc --noEmit` is the only available check, run:

```bash
npx --yes tsc --noEmit
```

Expected: 0 errors in `src/components/agents-memory-view.tsx`. Existing errors in other files are out of scope.

- [ ] **Step 11.2: Run all memory tests one more time**

```bash
for t in src/components/agents-memory-view*.test.ts; do
  npx --yes tsx --test "$t" || { echo "FAILED: $t"; exit 1; }
done
echo "All memory-view tests passed."
```

Expected: every test prints `ok` and the script ends with "All memory-view tests passed."

---

## Task 12: Visual verification (playwright-mcp)

**Files:** none — verification step.

- [ ] **Step 12.1: Start the dev server**

```bash
npm run dev
```

Wait for "Ready" in the output.

- [ ] **Step 12.2: Navigate and screenshot the rail**

Use playwright-mcp to:
1. Navigate to the workspace (typically `http://localhost:3000` or similar — check the dev server output).
2. Pick a familiar (e.g., Nova) and open the companion rail.
3. Click the brain icon (memory tab).
4. Screenshot at narrow viewport (~520px rail width).

Visually confirm:
- No horizontal scrollbar in the Memory Files card.
- Familiar memory + Memory files stack vertically (single column).
- When both lists are empty: single unified empty state with explanatory copy.
- "Open full memory →" sits pinned at the bottom border.
- File paths use middle-ellipsis when long.

- [ ] **Step 12.3: Navigate to the full Agents > Memory tab**

Use playwright-mcp to navigate to the full Agents tab > Memory subview. Screenshot.

Visually confirm:
- Stats render as a single inline row (not 4 cards).
- The two columns are balanced 1fr / 1fr.
- Clicking a memory card or file row reveals the right-side drawer with details.
- Clicking the drawer's close button restores the 2-column layout.

- [ ] **Step 12.4: Stop the dev server**

Kill the dev server process. If launched in background, `kill` the PID.

---

## Self-Review Checklist (performed by plan author)

1. **Spec coverage:** Every section of the spec maps to a task:
   - §1.1 bug fix → Task 1
   - §1.2 compactPath → Task 2
   - §1.3 redundant tags → Task 3 (+ Task 9 extends to harness when redrawn)
   - §1.4 search placeholder → Task 4
   - §2.1 single column rail → Task 5
   - §2.2 section visibility / shared empty → Task 6
   - §2.3 dense file rows → covered by Task 9's row rewrite (which also handles redundant tags consistently)
   - §2.4 sticky footer → Task 10
   - §2.5 inline excerpt (familiar memories) — **NOT in the plan**; deferred as nice-to-have. Adds complexity (expand/collapse state) for marginal benefit and is dependent on `excerpt` shape. Will surface as a follow-up.
   - §3.1 inline stats → Task 7
   - §3.2 balanced columns → Task 5 (non-compact branch)
   - §3.3 empty state collapses → Task 8
   - §3.4 selected-memory drawer → Task 9
   - §4 CSS → Task 10
   - §5 component API → Task 3 + Task 9

2. **Placeholder scan:** No "TBD" / "implement appropriately" / "similar to Task N" hand-waves. Code blocks included for every code change.

3. **Type consistency:** `selectedRowId` is `string | null` throughout. Row IDs use the `coven:<id>` / `file:<fullPath>` schema consistently in Task 9. `MemoryFilesListProps` additions (`activeFamiliarId`, `onSelect`, `selectedRowId`) match call sites in `AgentsMemoryView`.

4. **One deviation from spec:** §2.5 (inline excerpt for first familiar item) is deliberately deferred — see above.
