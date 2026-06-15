# Agent Memory Tab Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the Agent Memory tab's full view as a persistent master–detail surface — one unified, scannable memory list on the left and an always-present markdown reader on the right — without regressing the compact rail variant or the reused `MemoryFilesList` export.

**Architecture:** Extract pure/reusable units first (a `buildMemoryRows` selector in `src/lib/`, a `useMemoryFile` fetch hook), then build two presentational components (`MemoryRow`, `MemoryReaderPane`), then rewire `AgentsMemoryView`'s full-view branch to a two-pane layout, a "Stale" filter pill, and relocated bulk-delete. The `compact` branch and `MemoryFilesList` export are left intact.

**Tech Stack:** Next.js (React client components), TypeScript, Tailwind utility classes with CSS custom properties (`var(--…)`), Phosphor icons via `@/lib/icon`, `MarkdownBlock` from `@/components/message-bubble`. Tests are **source-text assertion scripts** run with `node --experimental-strip-types` (they `readFile` the component source and regex-match it — NOT a DOM runner).

---

## Critical context for the implementer

1. **Test style.** Every `agents-memory-view-*.test.ts` reads the `.tsx` source as a string and asserts with `assert.match(source, /regex/)`. Example from `agents-memory-view-detail.test.ts`:
   ```ts
   const source = await readFile(new URL("./agents-memory-view.tsx", import.meta.url), "utf8");
   assert.match(source, /function MemoryFilePreview\(\{ path \}/, "...");
   ```
   This means: when this plan says "write the failing test," you literally add/replace a regex assertion that matches the *new* source you're about to write. Run it, watch it fail (old source doesn't match), then write the source. Pure-logic modules (`buildMemoryRows`) get real behavioral unit tests instead.

2. **Run a single test file:** `node --experimental-strip-types src/components/<file>.test.ts` (per `reference_test_runner` memory — NOT `tsx`). The full suite is `pnpm test:app`.

3. **CI guard `check:tests-wired`:** every `*.test.ts` must appear in a `package.json` `test:*` chain or the build fails. Any NEW test file must be appended to the `test:app` chain.

4. **Branch protection:** `main` is protected. All work happens in a worktree on a branch; merge via PR with 6 green checks. Commits MUST be signed (`-S`).

5. **Two consumers must not break:**
   - `RailMemoryList` renders `<AgentsMemoryView compact limit={20} lockToFamiliar />`. The `compact` code path stays a simple feed (no two-pane, no reader pane, no selection drawer).
   - `MemoryFilesList` is an exported component reused by the Agents detail panel. Keep its name, export, and prop surface.

6. **`Icon` name gotcha:** `name=` must be in the `ICON_NAMES` whitelist in `src/lib/icon.tsx` (tsc-enforced). Reuse names already present in `agents-memory-view.tsx` (`ph:brain`, `ph:file-text`, `ph:arrows-out-simple`, `ph:trash`, `ph:x-bold`, `ph:arrows-clockwise`, `ph:caret-down`, `ph:magnifying-glass`, `ph:book-open`, `ph:arrow-left`, `ph:copy` — verify the last three exist; if `ph:copy`/`ph:arrow-left` are absent, add them to `ICON_NAMES` as part of Task 5/6).

---

## File structure

**Create:**
- `src/lib/memory-rows.ts` — pure selector that merges coven + file entries into a sorted, filtered `MemoryRow[]`. No React.
- `src/lib/memory-rows.test.ts` — behavioral unit tests for the selector.
- `src/lib/use-memory-file.ts` — `useMemoryFile(path)` hook: fetch `/api/memory/file`, return `{ text, error, loading }`.
- `src/components/agents-memory-row.tsx` — `MemoryRow` presentational row (compact two-line, hover actions).
- `src/components/agents-memory-reader.tsx` — `MemoryReaderPane` (header chips + copy-path + Rendered/Raw toggle + full-file body).
- `src/components/agents-memory-reader.test.ts` — source assertions for the reader pane.
- `src/components/agents-memory-master-detail.test.ts` — source assertions for the two-pane layout, Stale pill, relocated bulk delete.

**Modify:**
- `src/components/agents-memory-view.tsx` — full-view branch rewired to master-detail; suggestions `<section>` + grid drawer removed; Stale pill added; `MemoryFilePreview`/`MemoryReaderModal` refactored onto `useMemoryFile`. Compact branch + `MemoryFilesList` export retained.
- `src/lib/icon.tsx` — add any missing icon names (only if needed).
- `package.json` — wire the 3 new test files into `test:app`.

**Rewrite (assertions updated to the new structure):**
- `src/components/agents-memory-view-detail.test.ts` (drawer → reader pane; 40-line clip removed for inline reader).
- `src/components/agents-memory-view-management.test.ts` (suggestions section → Stale pill + relocated bulk delete).
- Audit the rest (`-filter-paginate`, `-compact-path`, `-full-tab`, `-overflow`, `-rail`, `-redundant-tags`, `-sources`) and update any assertion whose matched substring changed.

---

## Task 0: Worktree + branch setup

**Files:** none (environment only).

- [ ] **Step 1: Create the worktree off origin/main**

```bash
git -C /Users/buns/Documents/GitHub/OpenCoven/coven-cave fetch origin
git -C /Users/buns/Documents/GitHub/OpenCoven/coven-cave worktree add -b agent-memory-redesign .worktrees/agent-memory-redesign origin/main
pnpm --dir /Users/buns/Documents/GitHub/OpenCoven/coven-cave/.worktrees/agent-memory-redesign install
```

Expected: worktree created, `pnpm install` completes (~10s with the CAS store).

- [ ] **Step 2: Verify signing is configured (per global rule)**

```bash
git -C /Users/buns/Documents/GitHub/OpenCoven/coven-cave/.worktrees/agent-memory-redesign config --get user.signingkey
git -C /Users/buns/Documents/GitHub/OpenCoven/coven-cave/.worktrees/agent-memory-redesign config --get gpg.format
```

Expected: both return non-empty. If `user.signingkey` is empty, STOP and surface to the user.

> All subsequent file paths in this plan are relative to the worktree root `.worktrees/agent-memory-redesign/`.

---

## Task 1: `buildMemoryRows` selector (pure, unit-tested)

This is the heart of the unified list — a pure function so it can be tested behaviorally rather than by source-grep. It merges coven + file entries into one normalized, filtered, sorted array.

**Files:**
- Create: `src/lib/memory-rows.ts`
- Test: `src/lib/memory-rows.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// @ts-nocheck
import assert from "node:assert/strict";
import { buildMemoryRows } from "./memory-rows.ts";

const NOW = Date.parse("2026-06-13T12:00:00Z");

const coven = [
  { id: "c1", familiar_id: "echo", title: "Daily note", excerpt: "hello",
    path: "/Users/x/.coven/echo/memory/2026-06-13.md", updated_at: "2026-06-13T11:00:00Z", source_context: "" },
];
const files = [
  { fullPath: "/Users/x/.coven/echo/memory/old.md", relPath: "old.md", rootLabel: "echo",
    sourceKind: "coven-origin", sourceKindLabel: "Coven origin", size: 2048,
    modified: "2026-01-01T00:00:00Z", sourceId: "s", rootPath: "/Users/x", root: "/Users/x" },
  { fullPath: "/Users/x/.coven/echo/memory/new.md", relPath: "new.md", rootLabel: "echo",
    sourceKind: "runtime", sourceKindLabel: "Runtime memory", size: 100,
    modified: "2026-06-13T11:30:00Z", sourceId: "s", rootPath: "/Users/x", root: "/Users/x" },
];

// Merges both sources, defaults to recency-desc.
{
  const rows = buildMemoryRows({ coven, files, familiarFilter: "echo", query: "",
    sourceFilter: "all", sortMode: "recent", staleOnly: false, now: NOW });
  assert.equal(rows.length, 3, "all three entries present");
  assert.deepEqual(rows.map((r) => r.kind), ["file", "agent", "file"], "newest file, then coven, then old file");
  assert.equal(rows[0].rowId, "file:/Users/x/.coven/echo/memory/new.md");
  assert.equal(rows[1].rowId, "coven:c1");
  assert.ok(rows.every((r) => typeof r.title === "string" && r.title.length > 0));
}

// Agent rows carry an excerpt; file rows carry a size.
{
  const rows = buildMemoryRows({ coven, files, familiarFilter: "echo", query: "",
    sourceFilter: "all", sortMode: "recent", staleOnly: false, now: NOW });
  const agent = rows.find((r) => r.kind === "agent");
  const file = rows.find((r) => r.kind === "file");
  assert.equal(agent.excerpt, "hello");
  assert.equal(file.size, 100);
});

// Coven rows are scoped to the active familiar; files are not.
{
  const rows = buildMemoryRows({ coven, files, familiarFilter: "other", query: "",
    sourceFilter: "all", sortMode: "recent", staleOnly: false, now: NOW });
  assert.equal(rows.filter((r) => r.kind === "agent").length, 0, "coven filtered out for other familiar");
  assert.equal(rows.filter((r) => r.kind === "file").length, 2, "files unaffected by familiar filter");
}

// sourceFilter narrows files only.
{
  const rows = buildMemoryRows({ coven, files, familiarFilter: "echo", query: "",
    sourceFilter: "runtime", sortMode: "recent", staleOnly: false, now: NOW });
  assert.deepEqual(rows.map((r) => r.rowId), ["file:/Users/x/.coven/echo/memory/new.md", "coven:c1"],
    "runtime filter keeps runtime file + coven (coven is not a file source)");
}

// query matches title/path across both kinds.
{
  const rows = buildMemoryRows({ coven, files, familiarFilter: "echo", query: "daily",
    sourceFilter: "all", sortMode: "recent", staleOnly: false, now: NOW });
  assert.deepEqual(rows.map((r) => r.rowId), ["coven:c1"], "query matches the coven title only");
}

// staleOnly keeps only stale rows; every row exposes a boolean `stale`.
{
  const rows = buildMemoryRows({ coven, files, familiarFilter: "echo", query: "",
    sourceFilter: "all", sortMode: "recent", staleOnly: true, now: NOW });
  assert.ok(rows.every((r) => r.stale === true), "staleOnly yields only stale rows");
}

// name sort is alpha by title; size sort is desc by bytes (files first since coven has no size).
{
  const byName = buildMemoryRows({ coven, files, familiarFilter: "echo", query: "",
    sourceFilter: "all", sortMode: "name", staleOnly: false, now: NOW });
  assert.deepEqual(byName.map((r) => r.title), ["Daily note", "new.md", "old.md"]);
}

console.log("memory-rows: all assertions passed");
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `node --experimental-strip-types src/lib/memory-rows.test.ts`
Expected: FAIL — `Cannot find module './memory-rows.ts'`.

- [ ] **Step 3: Implement `buildMemoryRows`**

Reuse the existing helpers in `src/lib/memory-management.ts` (`normalizeCovenEntry`, `normalizeFileEntry`, `detectStale`, `classifyProtection`) so staleness/protection logic stays single-sourced. `formatBytes`/`fileBase` live in the component today; this module re-derives `title` from the basename inline (no UI import).

```ts
import {
  classifyProtection,
  detectStale,
  normalizeCovenEntry,
  normalizeFileEntry,
  type RawCovenEntry,
  type RawFileEntry,
  type SortMode,
} from "./memory-management.ts";

export type MemoryRowKind = "agent" | "file";

export type MemoryRow = {
  rowId: string;            // "coven:<id>" | "file:<fullPath>"
  kind: MemoryRowKind;
  title: string;
  path: string;             // full path for reader fetch + delete
  sortTime: string;         // raw iso
  size?: number;            // files only
  sourceLabel: string;      // familiar display name (resolved by caller) | sourceKindLabel
  stale: boolean;
  protection: "structural" | "bulk-protected" | "normal";
  excerpt?: string;         // agent rows only
};

type BuildArgs = {
  coven: RawCovenEntry[];
  files: RawFileEntry[];
  familiarFilter: string;
  query: string;            // already-lowercased query is fine; we lowercase defensively
  sourceFilter: "all" | RawFileEntry["sourceKind"];
  sortMode: SortMode;
  staleOnly: boolean;
  /** Optional display-name resolver for coven familiar labels. */
  familiarLabel?: (id: string) => string;
  now?: number;
};

function baseName(p: string): string {
  const segs = p.split("/").filter(Boolean);
  return segs[segs.length - 1] ?? p;
}

function matches(row: MemoryRow, q: string): boolean {
  if (!q) return true;
  const hay = [row.title, row.path, row.sourceLabel, row.excerpt ?? ""].join(" ").toLowerCase();
  return hay.includes(q);
}

export function buildMemoryRows(args: BuildArgs): MemoryRow[] {
  const now = args.now ?? Date.now();
  const q = args.query.trim().toLowerCase();

  const covenRows: MemoryRow[] = args.coven
    .filter((e) => e.familiar_id === args.familiarFilter)
    .map((e) => {
      const managed = normalizeCovenEntry(e, now);
      return {
        rowId: `coven:${e.id}`,
        kind: "agent" as const,
        title: e.title,
        path: e.path,
        sortTime: e.updated_at,
        sourceLabel: args.familiarLabel ? args.familiarLabel(e.familiar_id) : e.familiar_id,
        stale: detectStale(managed, undefined, now).stale,
        protection: classifyProtection(e.path),
        excerpt: e.excerpt,
      };
    });

  const fileRows: MemoryRow[] = args.files
    .filter((e) => args.sourceFilter === "all" || e.sourceKind === args.sourceFilter)
    .map((e) => {
      const managed = normalizeFileEntry(e);
      return {
        rowId: `file:${e.fullPath}`,
        kind: "file" as const,
        title: baseName(e.relPath),
        path: e.fullPath,
        sortTime: e.modified,
        size: e.size,
        sourceLabel: e.sourceKindLabel,
        stale: detectStale(managed, undefined, now).stale,
        protection: classifyProtection(e.fullPath),
      };
    });

  let rows = [...covenRows, ...fileRows];
  if (q) rows = rows.filter((r) => matches(r, q));
  if (args.staleOnly) rows = rows.filter((r) => r.stale);

  const cmp: Record<SortMode, (a: MemoryRow, b: MemoryRow) => number> = {
    recent: (a, b) => (a.sortTime < b.sortTime ? 1 : a.sortTime > b.sortTime ? -1 : 0),
    oldest: (a, b) => (a.sortTime > b.sortTime ? 1 : a.sortTime < b.sortTime ? -1 : 0),
    name: (a, b) => a.title.localeCompare(b.title),
    size: (a, b) => (b.size ?? 0) - (a.size ?? 0),
    staleFirst: (a, b) => Number(b.stale) - Number(a.stale),
  };
  return rows.sort(cmp[args.sortMode]);
}
```

> Verify the real signature of `detectStale` in `src/lib/memory-management.ts:147` and `normalizeCovenEntry`/`normalizeFileEntry` (the `RawCovenEntry`/`RawFileEntry` shapes are exported at lines 44/54). Adjust the `detectStale(managed, undefined, now)` call to match its actual arity — if it takes `(entry, scorer?, now?)` keep as written; if `(entry, now?)`, drop the `undefined`.

- [ ] **Step 4: Run the test, verify it passes**

Run: `node --experimental-strip-types src/lib/memory-rows.test.ts`
Expected: `memory-rows: all assertions passed`. If the sort/filter order assertions fail, fix the comparator — do not weaken the test.

- [ ] **Step 5: Commit**

```bash
git add src/lib/memory-rows.ts src/lib/memory-rows.test.ts
git commit -S -m "feat(memory): pure buildMemoryRows selector for unified list"
```

---

## Task 2: `useMemoryFile` hook (dedupe the three fetchers)

**Files:**
- Create: `src/lib/use-memory-file.ts`
- (No standalone unit test — it's a React hook; it's covered indirectly by the reader source assertions in Task 4. Do not wire a fake DOM test.)

- [ ] **Step 1: Implement the hook**

Lift the exact fetch+cancel logic currently duplicated in `MemoryFilePreview` (`agents-memory-view.tsx:906`) and `MemoryReaderModal` (`:812`).

```ts
"use client";
import { useEffect, useState } from "react";

export type MemoryFileState = { text: string | null; error: string | null; loading: boolean };

export function useMemoryFile(path: string | null): MemoryFileState {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!path) { setText(null); setError(null); setLoading(false); return; }
    let cancelled = false;
    setText(null); setError(null); setLoading(true);
    void (async () => {
      try {
        const res = await fetch(`/api/memory/file?path=${encodeURIComponent(path)}`, { cache: "no-store" });
        const json = await res.json();
        if (cancelled) return;
        if (json.ok) setText(typeof json.text === "string" ? json.text : "");
        else setError(json.error ?? "Failed to load memory");
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load memory");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [path]);

  return { text, error, loading };
}
```

- [ ] **Step 2: Refactor `MemoryFilePreview` and `MemoryReaderModal` onto the hook**

In `agents-memory-view.tsx`, replace the bespoke `useState`/`useEffect` fetch blocks in both components with `const { text, error } = useMemoryFile(path);` (keep their existing JSX). Add `import { useMemoryFile } from "@/lib/use-memory-file";`.

> Keep `MemoryFilePreview`'s 40-line clip exactly as-is for now — it's still referenced by the old drawer until Task 5 removes that drawer. Removing it earlier would break the build between commits.

- [ ] **Step 3: Verify build + existing detail test still green**

Run: `node --experimental-strip-types src/components/agents-memory-view-detail.test.ts`
Expected: PASS (the `/api/memory/file?path=${encodeURIComponent(path)}` string still appears — now inside the hook, which the test reads from a different file, so ALSO update the detail test's source URL for that one assertion, OR keep the literal in a comment). Simplest: the detail test asserts the endpoint string against `agents-memory-view.tsx`; since the fetch moved to the hook, **move that single assertion** into a new check that reads `use-memory-file.ts`. Make that edit now.

```ts
// in agents-memory-view-detail.test.ts — replace the endpoint assertion:
const hook = await readFile(new URL("../lib/use-memory-file.ts", import.meta.url), "utf8");
assert.match(hook, /\/api\/memory\/file\?path=\$\{encodeURIComponent\(path\)\}/,
  "the shared hook must fetch the redaction-safe memory/file endpoint");
```

Run it again: Expected PASS.

- [ ] **Step 4: Commit**

```bash
git add src/lib/use-memory-file.ts src/components/agents-memory-view.tsx src/components/agents-memory-view-detail.test.ts
git commit -S -m "refactor(memory): extract useMemoryFile hook from preview + reader modal"
```

---

## Task 3: `MemoryRow` row component

Compact two-line row with hover-revealed actions. Built as its own component so the list and tests stay focused.

**Files:**
- Create: `src/components/agents-memory-row.tsx`

- [ ] **Step 1: Implement the row**

```tsx
"use client";
import { Icon } from "@/lib/icon";
import type { MemoryRow } from "@/lib/memory-rows";

function formatBytes(n: number | undefined): string {
  if (!n || n < 0 || !Number.isFinite(n)) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function MemoryRowItem({
  row,
  age,
  selected,
  onSelect,
  onExpand,
  onDelete,
}: {
  row: MemoryRow;
  age: string;
  selected: boolean;
  onSelect: () => void;
  onExpand: () => void;
  onDelete?: () => void;
}) {
  const size = formatBytes(row.size);
  return (
    <li
      className={`group/row relative flex min-w-0 items-stretch gap-1 border-l-2 px-1 transition-colors ${
        selected
          ? "border-[var(--accent-presence)] bg-[var(--bg-raised)]/60"
          : "border-transparent hover:bg-[var(--bg-raised)]"
      }`}
    >
      <button
        type="button"
        onClick={onSelect}
        aria-current={selected ? "true" : undefined}
        className="focus-ring-inset flex min-w-0 flex-1 items-start gap-2 px-2 py-2 text-left"
      >
        <Icon
          name={row.kind === "agent" ? "ph:brain" : "ph:file-text"}
          width={13}
          className="mt-0.5 shrink-0 text-[var(--text-muted)]"
          aria-hidden
        />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="block min-w-0 flex-1 truncate text-[12px] font-medium text-[var(--text-primary)]" title={row.title}>
              {row.title}
            </span>
            <span className="shrink-0 text-[10px] text-[var(--text-muted)]">{age}</span>
          </span>
          <span className="mt-0.5 flex items-center gap-1.5 text-[10px] text-[var(--text-muted)]">
            <span className="truncate">{row.sourceLabel}</span>
            {size ? <><span aria-hidden>·</span><span>{size}</span></> : null}
            {row.stale ? (
              <span className="inline-flex items-center gap-1" title="Stale — suggested for cleanup">
                <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-[var(--color-warning)]" />
                <span className="sr-only">stale</span>
              </span>
            ) : null}
          </span>
        </span>
      </button>
      <div className="flex items-center gap-1 pr-2 opacity-0 transition-opacity focus-within:opacity-100 group-hover/row:opacity-100">
        <button
          type="button"
          onClick={onExpand}
          aria-label={`Expand ${row.title} to reader view`}
          title="Expand to reader view"
          className="focus-ring inline-flex h-7 w-7 items-center justify-center rounded-md border border-[var(--border-hairline)] text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
        >
          <Icon name="ph:arrows-out-simple" width={12} aria-hidden />
        </button>
        {onDelete && row.protection !== "structural" ? (
          <button
            type="button"
            onClick={onDelete}
            aria-label={`Delete ${row.title}`}
            className="memory-card-delete focus-ring inline-flex h-7 w-7 items-center justify-center rounded-md border border-[var(--border-hairline)] text-[var(--text-muted)] hover:text-[var(--color-warning)]"
          >
            <Icon name="ph:trash" width={12} aria-hidden />
          </button>
        ) : null}
      </div>
    </li>
  );
}
```

> Note: `onExpand`/`onDelete` here are plain callbacks (no `e.stopPropagation`) because the row uses a flex layout, not a clickable wrapper — the select button and action buttons are siblings, so clicks don't bubble between them. This is intentional and simpler than the current nested-button pattern.

- [ ] **Step 2: Typecheck**

Run: `pnpm --dir . exec tsc --noEmit` (or the project's typecheck script — check `package.json` for `"typecheck"`/`"check"`).
Expected: no errors from `agents-memory-row.tsx`. (`opacity-0 … group-hover/row:opacity-100` is valid Tailwind.)

- [ ] **Step 3: Commit**

```bash
git add src/components/agents-memory-row.tsx
git commit -S -m "feat(memory): compact two-line MemoryRowItem with hover actions"
```

---

## Task 4: `MemoryReaderPane` component

The always-present right pane: metadata header, copy-path, Rendered/Raw toggle, full-file body. Reuses `useMemoryFile` and `MarkdownBlock`.

**Files:**
- Create: `src/components/agents-memory-reader.tsx`
- Test: `src/components/agents-memory-reader.test.ts`

- [ ] **Step 1: Write the failing source-assertion test**

```ts
// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./agents-memory-reader.tsx", import.meta.url), "utf8");

assert.match(source, /export function MemoryReaderPane\(/, "MemoryReaderPane must be exported");
assert.match(source, /useMemoryFile\(/, "reader must load file content via the shared hook");
assert.match(source, /<MarkdownBlock/, "Rendered mode must use MarkdownBlock");

// Rendered/Raw toggle.
assert.match(source, /useState<"rendered" \| "raw">\("rendered"\)/, "toggle defaults to rendered");
assert.ok(source.includes("Rendered") && source.includes("Raw"), "both toggle labels present");
assert.match(source, /<pre/, "Raw mode must render a <pre> of the source");

// Full file — no 40-line clip in the inline reader.
assert.ok(!/Showing first \{?MAX_LINES/.test(source), "inline reader must NOT clip to 40 lines");

// Copy-path + empty state + open-file affordances.
assert.match(source, /navigator\.clipboard\.writeText/, "copy-path button must copy the path");
assert.match(source, /Select a memory to read/, "empty state when no row selected");

console.log("agents-memory-reader: all assertions passed");
```

- [ ] **Step 2: Run, verify it fails**

Run: `node --experimental-strip-types src/components/agents-memory-reader.test.ts`
Expected: FAIL — file not found.

- [ ] **Step 3: Implement the reader pane**

```tsx
"use client";
import { useState } from "react";
import { Icon } from "@/lib/icon";
import { MarkdownBlock } from "@/components/message-bubble";
import { useMemoryFile } from "@/lib/use-memory-file";
import type { MemoryRow } from "@/lib/memory-rows";

function compactPath(path: string): string {
  const collapsed = path.replace(/^\/Users\/[^/]+/, "~");
  if (collapsed.length <= 52) return collapsed;
  const segments = collapsed.split("/").filter(Boolean);
  if (segments.length <= 4) return collapsed;
  const first = collapsed.startsWith("~") ? "~" : `/${segments[0]}`;
  return `${first}/…/${segments.slice(-3).join("/")}`;
}

export function MemoryReaderPane({
  row,
  age,
  sizeLabel,
  onOpenFile,
  onExpand,
}: {
  row: MemoryRow | null;
  age: string;
  sizeLabel: string;
  onOpenFile: (path: string) => void;
  onExpand: (row: MemoryRow) => void;
}) {
  const [mode, setMode] = useState<"rendered" | "raw">("rendered");
  const [copied, setCopied] = useState(false);
  const { text, error, loading } = useMemoryFile(row?.path ?? null);

  if (!row) {
    return (
      <div className="grid min-h-0 place-items-center rounded-lg border border-dashed border-[var(--border-hairline)] bg-[var(--bg-raised)]/20 p-8 text-center">
        <div>
          <Icon name="ph:book-open" width={24} className="mx-auto text-[var(--text-muted)]" aria-hidden />
          <p className="mt-3 text-[13px] font-medium text-[var(--text-primary)]">Select a memory to read</p>
          <p className="mt-1 text-[11px] text-[var(--text-muted)]">Pick an entry on the left to view its contents.</p>
        </div>
      </div>
    );
  }

  const copyPath = () => {
    void navigator.clipboard.writeText(row.path).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div className="flex min-h-0 flex-col rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-raised)]/30">
      <div className="shrink-0 border-b border-[var(--border-hairline)] p-3">
        <div className="flex items-start justify-between gap-2">
          <h3 className="min-w-0 flex-1 truncate text-[14px] font-semibold text-[var(--text-primary)]" title={row.title}>
            {row.title}
          </h3>
          <div className="flex shrink-0 items-center gap-1">
            <div className="mr-1 inline-flex overflow-hidden rounded-md border border-[var(--border-hairline)] text-[10px]">
              {(["rendered", "raw"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  aria-pressed={mode === m}
                  onClick={() => setMode(m)}
                  className={`px-2 py-1 capitalize transition-colors ${
                    mode === m ? "bg-[var(--accent-presence)]/15 text-[var(--text-primary)]" : "text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]"
                  }`}
                >
                  {m === "rendered" ? "Rendered" : "Raw"}
                </button>
              ))}
            </div>
            <button type="button" onClick={() => onExpand(row)} aria-label="Expand to fullscreen reader" title="Fullscreen"
              className="focus-ring inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-muted)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]">
              <Icon name="ph:arrows-out-simple" width={12} aria-hidden />
            </button>
          </div>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[10px] text-[var(--text-muted)]">
          <span className="rounded bg-[var(--bg-elevated)] px-1.5 py-0.5 text-[var(--text-secondary)]">
            {row.kind === "agent" ? "Agent memory" : "File"}
          </span>
          <span className="rounded bg-[var(--bg-elevated)] px-1.5 py-0.5">{row.sourceLabel}</span>
          {sizeLabel ? <span className="rounded bg-[var(--bg-elevated)] px-1.5 py-0.5">{sizeLabel}</span> : null}
          <span className="rounded bg-[var(--bg-elevated)] px-1.5 py-0.5">{age}</span>
          {row.stale ? <span className="rounded bg-[var(--color-warning)]/15 px-1.5 py-0.5 text-[var(--color-warning)]">Stale</span> : null}
        </div>
        <div className="mt-2 flex items-center gap-1">
          <code className="min-w-0 flex-1 truncate font-mono text-[10px] text-[var(--text-muted)]" title={row.path}>
            {compactPath(row.path)}
          </code>
          <button type="button" onClick={copyPath} aria-label="Copy path"
            className="focus-ring inline-flex h-6 items-center gap-1 rounded px-1.5 text-[10px] text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]">
            <Icon name="ph:copy" width={11} aria-hidden />
            {copied ? "Copied" : "Copy"}
          </button>
          <button type="button" onClick={() => onOpenFile(row.path)}
            className="focus-ring inline-flex h-6 items-center gap-1 rounded border border-[var(--border-hairline)] px-1.5 text-[10px] text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]">
            <Icon name="ph:file-text" width={11} aria-hidden />
            Open file
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {error ? (
          <p className="text-[12px] text-[var(--color-warning)]">{error}</p>
        ) : loading || text === null ? (
          <p className="text-[12px] text-[var(--text-muted)]">Loading memory…</p>
        ) : text.trim() === "" ? (
          <p className="text-[12px] text-[var(--text-muted)]">Empty file.</p>
        ) : mode === "rendered" ? (
          <MarkdownBlock text={text} />
        ) : (
          <pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-5 text-[var(--text-secondary)]">{text}</pre>
        )}
      </div>
    </div>
  );
}
```

> If `ph:copy` is not in `ICON_NAMES`, add it to `src/lib/icon.tsx` in this task (tsc will flag it otherwise).

- [ ] **Step 4: Run the reader test, verify it passes**

Run: `node --experimental-strip-types src/components/agents-memory-reader.test.ts`
Expected: `agents-memory-reader: all assertions passed`.

- [ ] **Step 5: Commit**

```bash
git add src/components/agents-memory-reader.tsx src/components/agents-memory-reader.test.ts src/lib/icon.tsx
git commit -S -m "feat(memory): MemoryReaderPane with rendered/raw toggle + full-file body"
```

---

## Task 5: Rewire `AgentsMemoryView` full view to master-detail

This is the integration task: replace the full-view body (suggestions section + familiar cards + files list + grid drawer) with a two-pane master-detail driven by `buildMemoryRows`, add the Stale filter pill, and relocate bulk-delete. The `compact` branch and `MemoryFilesList` export are untouched.

**Files:**
- Modify: `src/components/agents-memory-view.tsx`
- Test: `src/components/agents-memory-master-detail.test.ts` (new)

- [ ] **Step 1: Write the failing source-assertion test**

```ts
// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./agents-memory-view.tsx", import.meta.url), "utf8");

// Unified list is built by the pure selector.
assert.match(source, /buildMemoryRows\(/, "full view must derive rows from buildMemoryRows");
assert.match(source, /import \{ MemoryRowItem \}/, "must render MemoryRowItem rows");
assert.match(source, /import \{ MemoryReaderPane \}/, "must render the reader pane");

// Persistent two-pane: reader is rendered whether or not a row is selected (no `selectedRowId ?` gate around the pane).
assert.match(source, /<MemoryReaderPane/, "reader pane is always mounted in the full view");

// Stale pill replaces the old standalone suggestions <section> and the staleOnly checkbox label.
assert.ok(!/memory-suggestions/.test(source), "the standalone Suggested-for-cleanup section is removed");
assert.match(source, /Stale \(/, "a Stale (N) filter pill is present");

// Relocated bulk delete lives in the list header, gated on staleOnly.
assert.match(source, /Delete \{bulkDeletable\.length\} cleanable/, "bulk-delete action retained");

// Old grid drawer testid is gone (selection now drives the persistent pane).
assert.ok(!/memory-list-drawer/.test(source), "old grid drawer removed");

// Compact rail path still present and untouched in spirit.
assert.match(source, /compact \? /, "compact branch retained");

console.log("agents-memory-master-detail: all assertions passed");
```

- [ ] **Step 2: Run, verify it fails**

Run: `node --experimental-strip-types src/components/agents-memory-master-detail.test.ts`
Expected: FAIL (e.g. `buildMemoryRows(` not found; `memory-suggestions` still present).

- [ ] **Step 3: Wire imports + the unified row memo**

At the top of `agents-memory-view.tsx` add:
```tsx
import { buildMemoryRows, type MemoryRow } from "@/lib/memory-rows";
import { MemoryRowItem } from "@/components/agents-memory-row";
import { MemoryReaderPane } from "@/components/agents-memory-reader";
```

After the existing `visibleFiles`/`visibleCoven` memos, add the unified rows (full view only — the compact branch keeps using the existing lists):
```tsx
const unifiedRows = useMemo(
  () =>
    buildMemoryRows({
      coven: covenEntries,
      files: fileEntries,
      familiarFilter,
      query: q,
      sourceFilter,
      sortMode,
      staleOnly,
      familiarLabel: (id) => familiarById.get(id)?.display_name ?? id,
    }),
  [covenEntries, fileEntries, familiarFilter, q, sourceFilter, sortMode, staleOnly, familiarById],
);
const selectedRow = useMemo(
  () => unifiedRows.find((r) => r.rowId === selectedRowId) ?? null,
  [unifiedRows, selectedRowId],
);
```

> Keep `groupMode`/`visibleFileGroups` for now if you want grouped display in the unified list; for the first pass, render the flat `unifiedRows` and treat grouping as a follow-up (the Group control may be hidden in full view until grouping is reimplemented over `MemoryRow`). If you keep the Group control, wrap `unifiedRows` with a row-level grouping helper — but do NOT block this task on it. Hiding the Group `<select>` in the full view is acceptable for this PR; note it in the PR body.

- [ ] **Step 4: Replace the `contentClass` grid with a two-pane layout**

Replace the `contentClass` computation (lines ~305-313) and the full-view body. For the full view, the container is a two-pane flex/grid; the compact branch keeps its `flex flex-col` path:
```tsx
const contentClass = compact
  ? "flex flex-col gap-4 overflow-y-auto p-4"
  : "grid min-h-0 gap-4 p-4 xl:grid-cols-[minmax(0,1fr)_minmax(420px,560px)]";
```

- [ ] **Step 5: Replace the full-view sections with list pane + reader pane**

Inside the `<div className={...contentClass}>`, the `compact` branch is unchanged. The `!compact` branch becomes:
```tsx
{!compact ? (
  <>
    {/* LIST PANE */}
    <section className="flex min-h-0 flex-col">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-widest text-[var(--text-secondary)]">
          Memories
        </h3>
        <div className="flex items-center gap-2">
          {staleOnly && bulkDeletable.length > 0 ? (
            <button
              type="button"
              onClick={() => bulkDeletable.forEach((e) => handleDelete(e.path, e.key, e.source))}
              className="focus-ring inline-flex h-7 items-center gap-1 rounded-md border border-[var(--border-hairline)] px-2 text-[11px] text-[var(--color-warning)] hover:bg-[var(--bg-raised)]"
            >
              <Icon name="ph:trash" width={11} />
              Delete {bulkDeletable.length} cleanable
            </button>
          ) : null}
          <span className="text-[10px] text-[var(--text-muted)]">
            {unifiedRows.length > fileLimit ? `${fileLimit} of ${unifiedRows.length}` : `${unifiedRows.length} shown`}
          </span>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-raised)]/25">
        {unifiedRows.length === 0 ? (
          <div className="px-3 py-8 text-center text-[12px] text-[var(--text-muted)]">
            {loaded ? (error ? "Couldn't load memories. See the error above and try again." : "No memories match this view.") : "Loading memories…"}
          </div>
        ) : (
          <ul className="divide-y divide-[var(--border-hairline)]">
            {unifiedRows.slice(0, fileLimit).map((row) => (
              <MemoryRowItem
                key={row.rowId}
                row={row}
                age={age(row.sortTime)}
                selected={selectedRowId === row.rowId}
                onSelect={() => setSelectedRowId(row.rowId)}
                onExpand={() => setExpandRow(row)}
                onDelete={row.protection !== "structural" ? () => handleDelete(row.path, row.rowId, row.kind === "agent" ? "coven" : "file") : undefined}
              />
            ))}
          </ul>
        )}
        {unifiedRows.length > fileLimit ? (
          <button
            type="button"
            onClick={() => setFileLimit((n) => n + FILE_PAGE)}
            className="focus-ring flex w-full items-center justify-center gap-1.5 border-t border-[var(--border-hairline)] px-3 py-2 text-[11px] text-[var(--text-secondary)] hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)]"
          >
            <Icon name="ph:caret-down" width={11} />
            Show more · {fileLimit} of {unifiedRows.length}
          </button>
        ) : null}
      </div>
    </section>

    {/* READER PANE */}
    <MemoryReaderPane
      row={selectedRow}
      age={selectedRow ? age(selectedRow.sortTime) : ""}
      sizeLabel={selectedRow ? formatBytes(selectedRow.size) : ""}
      onOpenFile={(p) => onOpenMemoryFile?.(p)}
      onExpand={(r) => setExpandRow(r)}
    />
  </>
) : (
  /* …existing compact branch: familiar memory section + MemoryFilesList… */
)}
```

Add the fullscreen-expand state near the other `useState`s:
```tsx
const [expandRow, setExpandRow] = useState<MemoryRow | null>(null);
```
And render the existing `MemoryReaderModal` at the bottom when `expandRow` is set (replaces the per-button `ExpandMemoryButton` modal for the full view):
```tsx
{expandRow ? (
  <MemoryReaderModal path={expandRow.path} title={expandRow.title} onClose={() => setExpandRow(null)} />
) : null}
```

- [ ] **Step 6: Delete the now-dead full-view code**

Remove from the `!compact` path: the `suggestions`/`memory-suggestions` `<section>`, the "Familiar memory" card grid section, the `MemoryFilesList` render *for the full view*, and the `<aside data-testid="memory-list-drawer">` block. Keep: `suggestions`/`bulkDeletable` memos (the pill/bulk-delete still use them), `handleDelete`, the undo toast, and everything the compact branch uses. Keep `MemoryFilesList`, `MemoryFilePreview`, `ExpandMemoryButton`, `MemoryReaderModal` definitions (compact branch + external consumers still use `MemoryFilesList`; `ExpandMemoryButton` still used inside `MemoryFilesList`).

Add a Stale pill into the controls row (next to Group/Sort, replacing the `staleOnly` checkbox label) — full view only:
```tsx
<button
  type="button"
  aria-pressed={staleOnly}
  onClick={() => setStaleOnly((s) => !s)}
  className={`focus-ring inline-flex h-7 items-center gap-1 rounded-md border px-2 text-[11px] transition-colors ${
    staleOnly ? "border-[var(--color-warning)] bg-[var(--color-warning)]/12 text-[var(--text-primary)]" : "border-[var(--border-hairline)] text-[var(--text-secondary)] hover:bg-[var(--bg-raised)]"
  }`}
>
  Stale ({suggestions.length})
</button>
```

> `formatBytes` is currently a module-level function in `agents-memory-view.tsx` — it stays; the reader pane has its own copy (acceptable small duplication, or export it from a shared util if you prefer — not required).

- [ ] **Step 7: Run the master-detail test + the existing suite for this view**

```bash
node --experimental-strip-types src/components/agents-memory-master-detail.test.ts
node --experimental-strip-types src/components/agents-memory-reader.test.ts
node --experimental-strip-types src/lib/memory-rows.test.ts
```
Expected: all PASS. (Other `agents-memory-view-*` tests will now FAIL — that's expected and fixed in Task 6.)

- [ ] **Step 8: Commit**

```bash
git add src/components/agents-memory-view.tsx src/components/agents-memory-master-detail.test.ts
git commit -S -m "feat(memory): master-detail full view with unified list + reader pane + stale pill"
```

---

## Task 6: Update the brittle source-assertion tests

The existing `agents-memory-view-*.test.ts` files assert against the OLD structure. Update each to the new structure (or move assertions to the new component files). Do this file-by-file; run each as you go.

**Files (modify):** all under `src/components/`:
`agents-memory-view-detail.test.ts`, `-management.test.ts`, `-filter-paginate.test.ts`, `-compact-path.test.ts`, `-full-tab.test.ts`, `-overflow.test.ts`, `-rail.test.ts`, `-redundant-tags.test.ts`, `-sources.test.ts`.

- [ ] **Step 1: Run the whole view suite to see what breaks**

```bash
for f in src/components/agents-memory-view-*.test.ts; do echo "== $f =="; node --experimental-strip-types "$f" 2>&1 | tail -3; done
```
Expected: a list of pass/fail. Note every failing assertion.

- [ ] **Step 2: Fix `-detail.test.ts`**

The drawer (`memory-list-drawer`, `MemoryFilePreview` inside the drawer, "Showing first {MAX_LINES}") is gone from the full view. Repoint these to the reader pane:
- Replace drawer assertions with `assert.match(source, /<MemoryReaderPane/, …)`.
- Remove the inline-preview-clip assertion (the reader shows full files); if you want clip coverage, assert it against `MemoryFilePreview` only where it's still used (the component still exists for `MemoryFilesList`/compact). Keep the `formatBytes` behavioral block — but move it to read from `agents-memory-row.tsx` (where `formatBytes` now also lives) OR keep reading `agents-memory-view.tsx` (still defines it). Verify which file you point at.

Run: `node --experimental-strip-types src/components/agents-memory-view-detail.test.ts` → PASS.

- [ ] **Step 3: Fix `-management.test.ts`**

This asserts the `memory-suggestions` section + bulk button + sort/group/stale controls. Update:
- `memory-suggestions` → assert the **Stale pill** (`/Stale \(/`) and the relocated bulk button (`/Delete \{bulkDeletable\.length\} cleanable/`).
- Keep group/sort assertions if those controls remain; if you hid the Group control in the full view (Task 5 Step 3), update/remove the group assertion accordingly.

Run it → PASS.

- [ ] **Step 4: Fix the remaining files**

For each of `-filter-paginate`, `-compact-path`, `-full-tab`, `-overflow`, `-rail`, `-redundant-tags`, `-sources`:
- `-rail` asserts the compact variant — should still pass (compact branch unchanged). Verify, don't edit unless red.
- `-compact-path` asserts the `compactPath` helper — still defined in the view AND duplicated in the reader. Point at whichever file the test reads; keep behavioral checks.
- `-filter-paginate` / `-overflow` / `-full-tab`: update any assertion referencing the removed familiar-card grid, the removed `MemoryFilesList` full-view render, or the old drawer; re-anchor pagination assertions to the unified list's `fileLimit`/`Show more` (still present).
- `-sources` / `-redundant-tags`: source-chip filter row is retained in the header — likely still pass. The per-row `harness:`/`runtime:` tag chips were dropped from the unified row (compact two-line). If `-redundant-tags` asserts their *absence*, good; if it asserts their *presence* in rows, move that coverage to `MemoryFilesList` (compact) or delete the obsolete assertion and note it.

After each edit run that single file until green.

- [ ] **Step 5: Run the full view suite green**

```bash
for f in src/components/agents-memory-view-*.test.ts src/components/agents-memory-reader.test.ts src/components/agents-memory-master-detail.test.ts src/lib/memory-rows.test.ts; do node --experimental-strip-types "$f" || { echo "FAIL: $f"; break; }; done
echo "done"
```
Expected: no `FAIL:` line; prints `done`.

- [ ] **Step 6: Commit**

```bash
git add src/components/agents-memory-view-*.test.ts
git commit -S -m "test(memory): update source assertions to master-detail structure"
```

---

## Task 7: Responsive overlay for narrow widths

At `< xl` the two-pane grid collapses to one column; selecting a row should open the reader as a full-pane overlay with a back button instead of squashing both panes.

**Files:** Modify `src/components/agents-memory-view.tsx`.

- [ ] **Step 1: Add the narrow-overlay behavior**

The simplest robust approach: render the reader pane normally in the grid (it occupies the second column at `xl`), and at narrow widths overlay it absolutely within the content area when a row is selected. Add a back button visible only below `xl`:
```tsx
{/* shown only < xl, inside the reader pane header */}
<button
  type="button"
  onClick={() => setSelectedRowId(null)}
  className="focus-ring mr-1 inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-muted)] hover:bg-[var(--bg-elevated)] xl:hidden"
  aria-label="Back to list"
>
  <Icon name="ph:arrow-left" width={13} aria-hidden />
</button>
```
And gate visibility with Tailwind: list pane `${selectedRowId ? "hidden xl:flex" : "flex"}`, reader pane wrapper `${selectedRowId ? "flex" : "hidden xl:flex"}`. At `xl` both always show.

> If `ph:arrow-left` is missing from `ICON_NAMES`, add it to `src/lib/icon.tsx`.

- [ ] **Step 2: Typecheck + re-run the view suite**

```bash
pnpm --dir . exec tsc --noEmit
node --experimental-strip-types src/components/agents-memory-master-detail.test.ts
```
Expected: typecheck clean; test green. If you added a back-button assertion, include it in the master-detail test.

- [ ] **Step 3: Commit**

```bash
git add src/components/agents-memory-view.tsx src/lib/icon.tsx
git commit -S -m "feat(memory): narrow-width reader overlay with back navigation"
```

---

## Task 8: Wire new tests, run full suite, build

**Files:** Modify `package.json`.

- [ ] **Step 1: Append the 3 new test files to the `test:app` chain**

Add to the end of the `test:app` script value (mirror the existing `&& node --experimental-strip-types …` pattern):
```
&& node --experimental-strip-types src/lib/memory-rows.test.ts && node --experimental-strip-types src/components/agents-memory-reader.test.ts && node --experimental-strip-types src/components/agents-memory-master-detail.test.ts
```

- [ ] **Step 2: Run the tests-wired guard**

Run: `pnpm --dir . run check:tests-wired` (confirm the exact script name in `package.json`).
Expected: PASS — every `*.test.ts` is wired.

- [ ] **Step 3: Run the full app test suite**

Run: `pnpm --dir . run test:app`
Expected: all pass. Fix any stragglers (a missed assertion in another suite that happened to reference this component).

- [ ] **Step 4: Production build**

Run: `pnpm --dir . run build`
Expected: build succeeds (this is the `Frontend build` required check).

- [ ] **Step 5: Commit**

```bash
git add package.json
git commit -S -m "test(memory): wire new memory test files into test:app"
```

---

## Task 9: Manual verify, push, PR

**Files:** none.

- [ ] **Step 1: Live verify in the dev app**

Per `reference_dev_app_browser_verify` / `project_memory_mgmt_and_ci_guards`: run the dev app on a UNIQUE port (avoid the stale :3100 trap), open the Agent Memory tab, and confirm by eye:
- Two-pane layout; list scrolls without moving the reader.
- Selecting a row renders the file in the reader; Rendered/Raw toggle works; full file shows (no 40-line clip).
- Stale pill filters; "Delete N cleanable" appears only when Stale is active.
- Hover reveals row expand/delete; structural entries hide delete.
- Narrow the window below `xl`: list goes full-width, selection opens the reader overlay with a working back button.
- The companion **rail** memory tab still renders its simple feed.

- [ ] **Step 2: Signed-commit audit before push**

```bash
git -C . log origin/main..HEAD --pretty='%H %G?' | awk '$2 != "G" {print "UNSIGNED:", $0}'
```
Expected: no output. If anything prints, STOP and sign before pushing.

- [ ] **Step 3: Push + open PR**

```bash
git -C . push -u origin agent-memory-redesign
gh pr create --base main --head agent-memory-redesign \
  --title "feat(memory): redesign Agent Memory tab as master-detail" \
  --body "$(cat <<'EOF'
Redesigns the Agent Memory tab full view as a persistent master–detail surface.

- Unified, scannable list (agent memories + files) via a pure `buildMemoryRows` selector
- Always-present reader pane: rendered markdown by default + Rendered/Raw toggle, full file (no 40-line clip), copy-path
- "Stale (N)" filter pill replaces the standalone Suggested-for-cleanup banner + checkbox; bulk delete relocated to the list header
- Compact two-line rows with hover-revealed actions
- Narrow-width reader overlay with back navigation
- Extracted `useMemoryFile` hook (dedupes the three file fetchers)
- Compact rail variant + exported `MemoryFilesList` unchanged

Spec: docs/superpowers/specs/2026-06-13-agent-memory-redesign-design.md

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 4: Wait for the 6 required checks, then squash-merge**

```bash
gh pr checks --watch
gh pr merge --squash --delete-branch
```
Expected: all 6 checks green; merged. Then local worktree cleanup per `CLAUDE.md`:
```bash
git -C /Users/buns/Documents/GitHub/OpenCoven/coven-cave worktree remove .worktrees/agent-memory-redesign
git -C /Users/buns/Documents/GitHub/OpenCoven/coven-cave branch -D agent-memory-redesign 2>/dev/null || true
git -C /Users/buns/Documents/GitHub/OpenCoven/coven-cave worktree list
```

---

## Self-review notes (for the implementer)

- **Spec coverage:** Layout (Tasks 5/7), unified list (Tasks 1/3/5), reader pane + Rendered/Raw (Task 4), Stale pill + relocated bulk delete (Task 5), internal cleanup `useMemoryFile`/file split (Tasks 2/3/4/5), data flow unchanged (no API tasks — correct), testing (Tasks 1/4/5/6/8). All spec sections map to a task.
- **Known deferral:** grouping over `MemoryRow` is explicitly punted in Task 5 (hide the Group control in full view, note in PR). If the user wants grouping retained, add a row-grouping helper to `memory-rows.ts` + a `groupMemoryRows` test before Task 5 Step 5.
- **Type consistency:** `MemoryRow` shape is defined once (Task 1) and imported everywhere (`agents-memory-row.tsx`, `agents-memory-reader.tsx`, `agents-memory-view.tsx`). `buildMemoryRows` arg names match between the test and impl.
- **Don't-break list:** compact branch, `MemoryFilesList` export, `MemoryReaderModal`, API routes — all retained.
