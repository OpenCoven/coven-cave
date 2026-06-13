# Memory Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users delete familiar/agent memory in Coven Cave (soft-archive + undo), get rule-based suggestions for stale entries, and group/sort/filter memories dynamically — without daemon changes and with dream files protected from bulk delete.

**Architecture:** A client-safe pure lib (`memory-management.ts`) holds normalization, grouping, sorting, filtering, protection classification, and a pluggable stale scorer. A server lib (`memory-trash.ts`) soft-deletes files to a per-root `.trash/` with sidecar manifests, reusing the existing memory path allowlist. Thin API routes wrap the trash lib. `agents-memory-view.tsx` is extended with controls, per-entry delete (reusing `useUndoDelete` + `LibraryUndoToast`), and a suggestions section; a familiar-scoped "Memory" tab is added to Familiar Studio.

**Tech Stack:** Next.js (App Router) API routes, React client components, Node `fs/promises`. Tests run with `node --experimental-strip-types`. Pure libs get runtime tests; components get structural (source-pattern) tests per repo convention.

---

## Conventions (read first)

- **Worktree:** all work in `/Users/buns/Documents/GitHub/OpenCoven/coven-cave/.worktrees/memory-management` on branch `feat/memory-management`. Run all commands from there.
- **Run a test file:** `node --experimental-strip-types src/lib/memory-management.test.ts` (prints `<name>: ok` on success). Component structural tests: same command on the `.test.ts` file.
- **Full app test gate (CI):** `pnpm test:app` (run before final PR).
- **Commit signing:** every commit uses `git commit -S` (repo policy). After each commit run `git log -1 --pretty='%G?'` and confirm `G`.
- **Imports:** this repo imports local `.ts` modules WITH the `.ts` extension (see `memory-file-paths.ts` importing `"./memory-file-sources.ts"`). Match that.
- **Icon names** must be in the project's `ICON_NAMES` whitelist (`src/lib/icon`). Reuse an existing name unless you add to the whitelist; `ph:trash`, `ph:brain`, `ph:archive-box` — verify before use with `grep -n "archive-box\|ph:trash" src/lib/icon*`.

---

## File Structure

**Create:**
- `src/lib/memory-management.ts` — pure: types, `normalizeCovenEntry`, `normalizeFileEntry`, `parseRelativeTime`, `classifyProtection`, `isStructuralMemoryPath`, `groupMemories`, `sortMemories`, `filterMemories`, `StaleScorer`, `ruleBasedStaleScorer`, `detectStale`.
- `src/lib/memory-management.test.ts` — runtime tests for the above.
- `src/lib/server/memory-trash.ts` — server fs: `archiveMemoryFile`, `restoreMemoryFile`, `purgeMemoryTrash`, `listMemoryTrash`, `TRASH_DIRNAME`.
- `src/lib/server/memory-trash.test.ts` — runtime tests against a temp HOME.
- `src/app/api/memory/delete/route.ts` — `POST {path}` → archive.
- `src/app/api/memory/restore/route.ts` — `POST {trashId}` → restore.
- `src/app/api/memory/purge/route.ts` — `POST {trashId?}` → purge.
- `src/components/agents-memory-view-management.test.ts` — structural tests for the new UI.
- `src/components/familiar-studio-memory-tab.tsx` — wraps `AgentsMemoryView` scoped to one familiar.
- `src/components/familiar-studio-memory-tab.test.ts` — structural test.

**Modify:**
- `src/lib/server/memory-file-sources.ts` — classify `~/.coven/workspaces/familiars/{id}/memory/...` (where dream files live) and ignore `.trash/`.
- `src/app/api/memory/route.ts` — exclude `.trash/` from the file scan.
- `src/components/agents-memory-view.tsx` — controls (group/sort/stale-only), per-entry delete + undo toast, suggestions section.
- `src/components/familiar-studio.tsx` — add the "Memory" tab.
- `src/lib/familiar-studio-context.ts` — add `"memory"` to `FamiliarStudioTab`.

---

## Phase 1 — Shared pure lib (`memory-management.ts`)

### Task 1: Types + relative-time parser

**Files:**
- Create: `src/lib/memory-management.ts`
- Test: `src/lib/memory-management.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/memory-management.test.ts
import assert from "node:assert/strict";
import { parseRelativeTime } from "./memory-management.ts";

// Anchor "now" so the test is deterministic.
const NOW = 1_000_000_000_000;

assert.equal(parseRelativeTime("5m ago", NOW), NOW - 5 * 60_000, "5m ago");
assert.equal(parseRelativeTime("2h ago", NOW), NOW - 2 * 3_600_000, "2h ago");
assert.equal(parseRelativeTime("3d ago", NOW), NOW - 3 * 86_400_000, "3d ago");
assert.equal(parseRelativeTime("just now", NOW), NOW, "just now");
assert.equal(parseRelativeTime("garbage", NOW), 0, "unparseable -> 0");

console.log("memory-management.test: ok");
```

- [ ] **Step 2: Run it; expect failure**

Run: `node --experimental-strip-types src/lib/memory-management.test.ts`
Expected: FAIL — `Cannot find module './memory-management.ts'`.

- [ ] **Step 3: Create the file with the parser**

```ts
// src/lib/memory-management.ts

/** Best-effort parse of Coven's human-relative timestamps ("5m ago") into
 *  epoch ms. Returns 0 for anything unrecognized so callers can sort it last. */
export function parseRelativeTime(label: string, now = Date.now()): number {
  const t = label.trim().toLowerCase();
  if (t === "just now" || t === "now") return now;
  const m = t.match(/^(\d+)\s*(s|m|h|d|w)\b/);
  if (!m) return 0;
  const n = Number(m[1]);
  const unit: Record<string, number> = {
    s: 1_000,
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
    w: 604_800_000,
  };
  return now - n * unit[m[2]];
}
```

- [ ] **Step 4: Run the test; expect pass**

Run: `node --experimental-strip-types src/lib/memory-management.test.ts`
Expected: `memory-management.test: ok`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/memory-management.ts src/lib/memory-management.test.ts
git commit -S -m "feat(memory): add relative-time parser for memory management lib"
git log -1 --pretty='%G?'   # expect G
```

### Task 2: Entry types + normalizers

**Files:**
- Modify: `src/lib/memory-management.ts`
- Test: `src/lib/memory-management.test.ts`

- [ ] **Step 1: Append failing tests**

```ts
// append to src/lib/memory-management.test.ts (before the final console.log)
import { normalizeCovenEntry, normalizeFileEntry } from "./memory-management.ts";

const coven = normalizeCovenEntry(
  { id: "kitty-2026-06-09", familiar_id: "kitty", title: "2026-06-09", path: "/home/u/.coven/memory/kitty/2026-06-09.md", updated_at: "5m ago", excerpt: "hello" },
  NOW,
);
assert.equal(coven.source, "coven");
assert.equal(coven.familiarId, "kitty");
assert.equal(coven.path, "/home/u/.coven/memory/kitty/2026-06-09.md");
assert.equal(coven.updatedAt, NOW - 5 * 60_000);
assert.equal(coven.bodyHint, "hello");

const file = normalizeFileEntry({
  fullPath: "/home/u/.coven/memory/x.md", relPath: "x.md", title: "x",
  sourceKind: "coven-origin", sourceKindLabel: "Coven origin", rootLabel: "Coven", size: 12,
  modified: "2001-09-09T01:46:40.000Z", familiarId: null,
});
assert.equal(file.source, "file");
assert.equal(file.size, 12);
assert.equal(file.kind, "coven-origin");
assert.equal(file.updatedAt, Date.parse("2001-09-09T01:46:40.000Z"));
```

- [ ] **Step 2: Run; expect failure** (`normalizeCovenEntry` undefined).

- [ ] **Step 3: Implement** — append to `src/lib/memory-management.ts`:

```ts
export type ManagedSource = "coven" | "file";
export type ProtectionTier = "structural" | "bulk-protected" | "normal";

export type ManagedMemoryEntry = {
  /** Stable selection/dedup key — the absolute path. */
  key: string;
  /** Absolute fs path; the delete target. */
  path: string;
  source: ManagedSource;
  familiarId: string | null;
  title: string;
  /** sourceKind for files; "coven" for daemon entries. */
  kind: string;
  /** Epoch ms (best-effort), 0 if unknown. */
  updatedAt: number;
  /** Human label for display. */
  updatedAtLabel: string;
  size: number | null;
  /** Excerpt/body used by the stale scorer. */
  bodyHint: string;
  protection: ProtectionTier;
};

export type RawCovenEntry = {
  id: string;
  familiar_id: string;
  title: string;
  path: string;
  updated_at: string;
  excerpt?: string;
  source_context?: string;
};

export type RawFileEntry = {
  fullPath: string;
  relPath: string;
  title?: string;
  sourceKind: string;
  sourceKindLabel: string;
  rootLabel: string;
  size: number;
  modified: string;
  familiarId?: string | null;
};

export function normalizeCovenEntry(e: RawCovenEntry, now = Date.now()): ManagedMemoryEntry {
  return {
    key: e.path,
    path: e.path,
    source: "coven",
    familiarId: e.familiar_id || null,
    title: e.title,
    kind: "coven",
    updatedAt: parseRelativeTime(e.updated_at, now),
    updatedAtLabel: e.updated_at,
    size: null,
    bodyHint: e.excerpt ?? "",
    protection: classifyProtection(e.path),
  };
}

export function normalizeFileEntry(e: RawFileEntry): ManagedMemoryEntry {
  return {
    key: e.fullPath,
    path: e.fullPath,
    source: "file",
    familiarId: e.familiarId ?? null,
    title: e.title ?? e.relPath,
    kind: e.sourceKind,
    updatedAt: Number.isNaN(Date.parse(e.modified)) ? 0 : Date.parse(e.modified),
    updatedAtLabel: e.modified,
    size: e.size,
    bodyHint: "",
    protection: classifyProtection(e.fullPath),
  };
}
```

> Note: `classifyProtection` is defined in Task 3 but referenced here. Implement Task 3 in the same edit if your toolchain errors on the forward reference; functions are hoisted at runtime, so the test still passes once Task 3 lands. To keep steps green, paste the Task 3 `classifyProtection`/`isStructuralMemoryPath` block now as well.

- [ ] **Step 4: Run; expect pass.**

- [ ] **Step 5: Commit**

```bash
git add src/lib/memory-management.ts src/lib/memory-management.test.ts
git commit -S -m "feat(memory): normalize coven + file entries to a managed shape"
git log -1 --pretty='%G?'
```

### Task 3: Protection classifier

**Files:** Modify `src/lib/memory-management.ts`; Test `src/lib/memory-management.test.ts`.

- [ ] **Step 1: Append failing tests**

```ts
import { classifyProtection, isStructuralMemoryPath } from "./memory-management.ts";

assert.equal(classifyProtection("/h/.coven/memory/kitty/MEMORY.md"), "structural");
assert.equal(classifyProtection("/h/.openclaw/workspace/kitty/memory/.dreams/phase-signals.json"), "structural");
assert.equal(classifyProtection("/h/.coven/workspaces/familiars/kitty/memory/dreaming/light/2026-04-26.md"), "bulk-protected");
assert.equal(classifyProtection("/h/.coven/workspaces/familiars/kitty/memory/dreaming/deep/2026-04-26.md"), "bulk-protected");
assert.equal(classifyProtection("/h/.coven/memory/kitty/note.md"), "normal");
assert.equal(isStructuralMemoryPath("/h/x/MEMORY.md"), true);
assert.equal(isStructuralMemoryPath("/h/x/note.md"), false);
```

- [ ] **Step 2: Run; expect failure.**

- [ ] **Step 3: Implement** — append:

```ts
/** Classify a memory file by deletion protection tier, purely from its path.
 *  - structural: machine-managed indices/artifacts; never deletable via UI.
 *  - bulk-protected: dream summaries; individually deletable, never in bulk.
 *  - normal: everything else. */
export function classifyProtection(filePath: string): ProtectionTier {
  const p = filePath.replace(/\\/g, "/");
  if (/\/MEMORY\.md$/i.test(p)) return "structural";
  if (/\/\.dreams\//.test(p)) return "structural";
  if (/\/memory\/dreaming\/(light|deep)\//.test(p)) return "bulk-protected";
  return "normal";
}

export function isStructuralMemoryPath(filePath: string): boolean {
  return classifyProtection(filePath) === "structural";
}
```

- [ ] **Step 4: Run; expect pass.**
- [ ] **Step 5: Commit**

```bash
git add src/lib/memory-management.ts src/lib/memory-management.test.ts
git commit -S -m "feat(memory): classify entries into deletion protection tiers"
git log -1 --pretty='%G?'
```

### Task 4: Stale scorer (rule-based + interface)

**Files:** Modify `src/lib/memory-management.ts`; Test `src/lib/memory-management.test.ts`.

- [ ] **Step 1: Append failing tests**

```ts
import { detectStale, ruleBasedStaleScorer } from "./memory-management.ts";

const mk = (over: Partial<ManagedMemoryEntry>): ManagedMemoryEntry => ({
  key: "k", path: "/p", source: "coven", familiarId: null, title: "t",
  kind: "coven", updatedAt: 0, updatedAtLabel: "", size: null, bodyHint: "",
  protection: "normal", ...over,
});

assert.equal(detectStale(mk({ bodyHint: "# Light Sleep\n- No notable updates." })).stale, true, "dream placeholder is stale");
assert.equal(detectStale(mk({ bodyHint: "   " })).stale, true, "empty is stale");
assert.equal(detectStale(mk({ bodyHint: "real content here that is substantive and long enough" })).stale, false, "substantive not stale");
assert.equal(detectStale(mk({ protection: "structural", bodyHint: "" })).stale, false, "structural never stale");
// imported type-only at runtime is fine since strip-types erases it
import type { StaleScorer } from "./memory-management.ts";
const always: StaleScorer = { score: () => ({ stale: true, reason: "x", confidence: 1 }) };
assert.equal(detectStale(mk({}), always).stale, true, "scorer is pluggable");
```

- [ ] **Step 2: Run; expect failure.**

- [ ] **Step 3: Implement** — append:

```ts
export type StaleVerdict = { stale: boolean; reason: string; confidence: number };
export interface StaleScorer {
  score(entry: ManagedMemoryEntry): StaleVerdict;
}

const NOT_STALE: StaleVerdict = { stale: false, reason: "", confidence: 0 };

/** Deterministic stale detection. AI scoring can later implement StaleScorer
 *  and be passed to detectStale() with no caller changes. */
export const ruleBasedStaleScorer: StaleScorer = {
  score(entry) {
    if (entry.protection === "structural") return NOT_STALE;
    const stripped = entry.bodyHint
      .replace(/^#.*$/gm, "")   // drop markdown headings
      .replace(/^[-*]\s*/gm, "") // drop list bullets
      .trim();
    if (/^no notable updates\.?$/i.test(stripped)) {
      return { stale: true, reason: "No notable updates", confidence: 0.95 };
    }
    if (stripped.length === 0) {
      return { stale: true, reason: "Empty entry", confidence: 0.8 };
    }
    if (stripped.length < 40 && /^\d{4}-\d{2}-\d{2}/.test(entry.title)) {
      return { stale: true, reason: "Trivial dated entry", confidence: 0.5 };
    }
    return NOT_STALE;
  },
};

export function detectStale(
  entry: ManagedMemoryEntry,
  scorer: StaleScorer = ruleBasedStaleScorer,
): StaleVerdict {
  return scorer.score(entry);
}
```

- [ ] **Step 4: Run; expect pass.**
- [ ] **Step 5: Commit**

```bash
git add src/lib/memory-management.ts src/lib/memory-management.test.ts
git commit -S -m "feat(memory): rule-based stale scorer behind a pluggable interface"
git log -1 --pretty='%G?'
```

### Task 5: group / sort / filter

**Files:** Modify `src/lib/memory-management.ts`; Test `src/lib/memory-management.test.ts`.

- [ ] **Step 1: Append failing tests**

```ts
import { groupMemories, sortMemories, filterMemories } from "./memory-management.ts";

const a = mk({ key: "a", title: "alpha", familiarId: "kitty", kind: "coven", updatedAt: 100, source: "coven", bodyHint: "No notable updates" });
const b = mk({ key: "b", title: "beta", familiarId: "sage", kind: "coven-origin", updatedAt: 300, source: "file", size: 50 });
const c = mk({ key: "c", title: "gamma", familiarId: "kitty", kind: "runtime", updatedAt: 200, source: "file", size: 10 });
const all = [a, b, c];

// sort
assert.deepEqual(sortMemories(all, "recent").map((e) => e.key), ["b", "c", "a"], "recent = newest first");
assert.deepEqual(sortMemories(all, "oldest").map((e) => e.key), ["a", "c", "b"], "oldest first");
assert.deepEqual(sortMemories(all, "name").map((e) => e.key), ["a", "b", "c"], "name asc");
assert.deepEqual(sortMemories(all, "size").map((e) => e.key), ["b", "c", "a"], "size desc (null last)");
assert.equal(sortMemories(all, "staleFirst")[0].key, "a", "stale first");

// group
const g = groupMemories(all, "familiar");
assert.deepEqual(g.map((x) => x.key), ["kitty", "sage"], "groups by familiar");
assert.deepEqual(g[0].entries.map((e) => e.key), ["a", "c"], "kitty group members");
assert.equal(groupMemories(all, "none").length, 1, "none = single group");
assert.deepEqual(groupMemories(all, "source").map((x) => x.key).sort(), ["coven", "file"]);

// filter
assert.deepEqual(filterMemories(all, "alpha", {}).map((e) => e.key), ["a"], "text filter");
assert.deepEqual(filterMemories(all, "", { familiarId: "kitty" }).map((e) => e.key), ["a", "c"], "facet familiar");
assert.deepEqual(filterMemories(all, "", { source: "file" }).map((e) => e.key), ["b", "c"], "facet source");
assert.deepEqual(filterMemories(all, "", { staleOnly: true }).map((e) => e.key), ["a"], "stale only");
```

- [ ] **Step 2: Run; expect failure.**

- [ ] **Step 3: Implement** — append:

```ts
export type GroupBy = "none" | "familiar" | "source" | "type" | "date";
export type SortMode = "recent" | "oldest" | "name" | "size" | "staleFirst";
export type MemoryFacets = {
  familiarId?: string;
  source?: ManagedSource;
  kind?: string;
  staleOnly?: boolean;
};
export type MemoryGroup = { key: string; label: string; entries: ManagedMemoryEntry[] };

export function sortMemories(entries: ManagedMemoryEntry[], sort: SortMode): ManagedMemoryEntry[] {
  const out = [...entries];
  switch (sort) {
    case "recent": out.sort((x, y) => y.updatedAt - x.updatedAt); break;
    case "oldest": out.sort((x, y) => x.updatedAt - y.updatedAt); break;
    case "name": out.sort((x, y) => x.title.localeCompare(y.title)); break;
    case "size": out.sort((x, y) => (y.size ?? -1) - (x.size ?? -1)); break;
    case "staleFirst":
      out.sort((x, y) => Number(detectStale(y).stale) - Number(detectStale(x).stale));
      break;
  }
  return out;
}

function dateBucket(updatedAt: number, now = Date.now()): { key: string; label: string } {
  if (!updatedAt) return { key: "z-unknown", label: "Unknown" };
  const ageDays = (now - updatedAt) / 86_400_000;
  if (ageDays < 1) return { key: "a-today", label: "Today" };
  if (ageDays < 7) return { key: "b-week", label: "This week" };
  if (ageDays < 31) return { key: "c-month", label: "This month" };
  return { key: "d-older", label: "Older" };
}

export function groupMemories(entries: ManagedMemoryEntry[], by: GroupBy, now = Date.now()): MemoryGroup[] {
  if (by === "none") return [{ key: "all", label: "All", entries: [...entries] }];
  const map = new Map<string, MemoryGroup>();
  for (const e of entries) {
    let key: string;
    let label: string;
    if (by === "familiar") { key = e.familiarId ?? "—"; label = e.familiarId ?? "Unassigned"; }
    else if (by === "source") { key = e.source; label = e.source === "coven" ? "Coven" : "Files"; }
    else if (by === "type") { key = e.kind; label = e.kind; }
    else { const b = dateBucket(e.updatedAt, now); key = b.key; label = b.label; }
    if (!map.has(key)) map.set(key, { key, label, entries: [] });
    map.get(key)!.entries.push(e);
  }
  return [...map.values()].sort((x, y) => x.key.localeCompare(y.key));
}

export function filterMemories(entries: ManagedMemoryEntry[], query: string, facets: MemoryFacets): ManagedMemoryEntry[] {
  const q = query.trim().toLowerCase();
  return entries.filter((e) => {
    if (facets.familiarId && e.familiarId !== facets.familiarId) return false;
    if (facets.source && e.source !== facets.source) return false;
    if (facets.kind && e.kind !== facets.kind) return false;
    if (facets.staleOnly && !detectStale(e).stale) return false;
    if (!q) return true;
    return (
      e.title.toLowerCase().includes(q) ||
      e.path.toLowerCase().includes(q) ||
      e.bodyHint.toLowerCase().includes(q) ||
      (e.familiarId ?? "").toLowerCase().includes(q)
    );
  });
}
```

- [ ] **Step 4: Run; expect pass.**
- [ ] **Step 5: Commit**

```bash
git add src/lib/memory-management.ts src/lib/memory-management.test.ts
git commit -S -m "feat(memory): group/sort/filter helpers for managed memories"
git log -1 --pretty='%G?'
```

---

## Phase 2 — Server trash lib + path coverage

### Task 6: Extend the memory path allowlist to cover dream files

**Why:** the daemon-generated "No notable updates" files live under `~/.coven/workspaces/familiars/{id}/memory/...`, which `classifyMemoryFilePath` does not currently accept, so deletes there would be rejected.

**Files:**
- Modify: `src/lib/server/memory-file-sources.ts`
- Test: extend an existing source test or add `src/lib/server/memory-file-sources-coven-familiar.test.ts`

- [ ] **Step 1: VERIFY the real path** (one-off, not a code change):

Run: `ls -d ~/.coven/workspaces/familiars/*/memory/dreaming/light 2>/dev/null | head; ~/.coven` and confirm dream files live under `~/.coven/workspaces/familiars/<id>/memory/`. If they instead live under `~/.coven/memory/<id>/...`, they are ALREADY covered by the `coven-origin` root and you can skip the code change in this task (still add the test asserting coverage).

- [ ] **Step 2: Write failing test** `src/lib/server/memory-file-sources-coven-familiar.test.ts`

```ts
import assert from "node:assert/strict";
import { classifyMemoryFilePath } from "./memory-file-sources.ts";

const home = "/home/u";
const dream = "/home/u/.coven/workspaces/familiars/kitty/memory/dreaming/light/2026-04-26.md";
const c = classifyMemoryFilePath(dream, home);
assert.ok(c, "coven familiar dream path must classify");
assert.equal(c?.familiarId, "kitty");
console.log("memory-file-sources-coven-familiar.test: ok");
```

- [ ] **Step 3: Run; expect failure** (`c` is null).

- [ ] **Step 4: Implement** — in `classifyMemoryFilePath`, after the existing openclaw-workspace fallback block (the `openclawWorkspace` branch), add a coven-workspaces branch before `return null` paths:

```ts
  const covenFamiliars = path.resolve(
    /* turbopackIgnore: true */ path.join(home, ".coven", "workspaces", "familiars"),
  );
  if (isWithinRoot(resolved, covenFamiliars)) {
    const rel = path.relative(covenFamiliars, resolved);
    const parts = rel.split(path.sep);
    const familiarId = parts[0];
    if (familiarId && familiarId !== ".." && parts[1] === "memory" && parts.length >= 3) {
      return {
        sourceId: "coven-familiar",
        sourceKind: "coven-origin",
        sourceKindLabel: "Coven origin",
        kind: "coven-origin",
        root: `coven-familiar:${familiarId}`,
        rootLabel: `${displayId(familiarId)} memory`,
        rootPath: path.join(covenFamiliars, familiarId),
        origin: "coven",
        familiarId,
      };
    }
  }
```

(Place this block immediately before the final `return null` chain, and ensure the existing openclaw `return null` short-circuits don't run first — restructure the openclaw block to fall through rather than `return null` when not matched. Concretely: change the openclaw block's early `if (!isWithinRoot(resolved, openclawWorkspace)) return null;` to a guarded block so execution can continue to the coven-familiars check.)

- [ ] **Step 5: Run; expect pass.** Then run the existing source tests to ensure no regression:

Run: `node --experimental-strip-types src/components/agents-memory-view-sources.test.ts`
Expected: `agents-memory-view-sources.test: ok` (unchanged).

- [ ] **Step 6: Commit**

```bash
git add src/lib/server/memory-file-sources.ts src/lib/server/memory-file-sources-coven-familiar.test.ts
git commit -S -m "feat(memory): classify coven familiar-workspace memory paths"
git log -1 --pretty='%G?'
```

### Task 7: Trash lib — archive

**Files:**
- Create: `src/lib/server/memory-trash.ts`
- Test: `src/lib/server/memory-trash.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// src/lib/server/memory-trash.test.ts
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { archiveMemoryFile, TRASH_DIRNAME } from "./memory-trash.ts";

const home = await mkdtemp(path.join(tmpdir(), "memtrash-"));
const memDir = path.join(home, ".coven", "memory", "kitty");
await mkdir(memDir, { recursive: true });
const file = path.join(memDir, "note.md");
await writeFile(file, "hello", "utf8");

const res = await archiveMemoryFile(file, home);
assert.equal(res.ok, true, "archive ok");
// original gone
await assert.rejects(stat(file), "original moved away");
// trashed file present under <root>/.trash
const trashDir = path.join(home, ".coven", "memory", TRASH_DIRNAME);
const sidecar = path.join(trashDir, `${(res as { trashId: string }).trashId}.json`);
const meta = JSON.parse(await readFile(sidecar, "utf8"));
assert.equal(meta.originalPath, file, "sidecar records original path");

// structural rejected
const mem = path.join(home, ".coven", "memory", "kitty", "MEMORY.md");
await writeFile(mem, "# index", "utf8");
const bad = await archiveMemoryFile(mem, home);
assert.equal(bad.ok, false, "structural rejected");

// outside-root rejected
const outside = await archiveMemoryFile(path.join(home, "secret.md"), home);
assert.equal(outside.ok, false, "outside root rejected");

console.log("memory-trash.test: ok");
```

- [ ] **Step 2: Run; expect failure.**

- [ ] **Step 3: Implement archive** `src/lib/server/memory-trash.ts`

```ts
import path from "node:path";
import { homedir } from "node:os";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { classifyMemoryFilePath } from "./memory-file-sources.ts";
import { isStructuralMemoryPath } from "../memory-management.ts";

export const TRASH_DIRNAME = ".trash";

export type TrashOk = { ok: true; trashId: string };
export type TrashErr = { ok: false; error: string };
export type TrashResult = TrashOk | TrashErr;

type Sidecar = { originalPath: string; deletedAt: string; root: string };

export async function archiveMemoryFile(fullPath: string, home = homedir()): Promise<TrashResult> {
  const resolved = path.resolve(fullPath);
  const cls = classifyMemoryFilePath(resolved, home);
  if (!cls) return { ok: false, error: "path not allowed" };
  if (isStructuralMemoryPath(resolved)) return { ok: false, error: "protected: structural memory" };

  const trashDir = path.join(cls.rootPath, TRASH_DIRNAME);
  const base = path.basename(resolved);
  const trashId = `${Date.now()}-${base}`;
  try {
    await mkdir(trashDir, { recursive: true });
    await rename(resolved, path.join(trashDir, trashId));
    const sidecar: Sidecar = { originalPath: resolved, deletedAt: new Date().toISOString(), root: cls.rootPath };
    await writeFile(path.join(trashDir, `${trashId}.json`), JSON.stringify(sidecar), { mode: 0o600 });
    return { ok: true, trashId };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "archive failed" };
  }
}
```

- [ ] **Step 4: Run; expect pass.**
- [ ] **Step 5: Commit**

```bash
git add src/lib/server/memory-trash.ts src/lib/server/memory-trash.test.ts
git commit -S -m "feat(memory): soft-delete (archive) memory files to per-root .trash"
git log -1 --pretty='%G?'
```

### Task 8: Trash lib — restore, purge, list

**Files:** Modify `src/lib/server/memory-trash.ts`; Test `src/lib/server/memory-trash.test.ts`.

- [ ] **Step 1: Append failing tests** (after the archive assertions, before final log)

```ts
import { restoreMemoryFile, purgeMemoryTrash, listMemoryTrash } from "./memory-trash.ts";

// re-archive a fresh file then restore it
const f2 = path.join(memDir, "again.md");
await writeFile(f2, "again", "utf8");
const r2 = await archiveMemoryFile(f2, home);
assert.equal(r2.ok, true);
const list = await listMemoryTrash(home);
assert.ok(list.some((t) => t.trashId === (r2 as { trashId: string }).trashId), "listed in trash");
const restored = await restoreMemoryFile((r2 as { trashId: string }).trashId, home);
assert.equal(restored.ok, true, "restore ok");
assert.equal(await readFile(f2, "utf8"), "again", "file restored to original path");

// purge the first archived item
const purged = await purgeMemoryTrash((res as { trashId: string }).trashId, home);
assert.equal(purged.ok, true, "purge ok");
```

- [ ] **Step 2: Run; expect failure.**

- [ ] **Step 3: Implement** — append to `memory-trash.ts`:

```ts
import { readFile, readdir, rm, access } from "node:fs/promises";

export type TrashItem = { trashId: string; originalPath: string; deletedAt: string; trashDir: string };

function trashDirsForHome(home: string): string[] {
  // Re-derive every memory root's .trash dir. We import lazily to avoid a cycle.
  const { memoryFileSourcesForHome } = require("./memory-file-sources.ts");
  return memoryFileSourcesForHome(home).map(
    (s: { rootPath: string }) => path.join(s.rootPath, TRASH_DIRNAME),
  );
}

export async function listMemoryTrash(home = homedir()): Promise<TrashItem[]> {
  const out: TrashItem[] = [];
  for (const dir of trashDirsForHome(home)) {
    let names: string[];
    try { names = await readdir(dir); } catch { continue; }
    for (const n of names) {
      if (!n.endsWith(".json")) continue;
      try {
        const meta = JSON.parse(await readFile(path.join(dir, n), "utf8")) as Sidecar;
        out.push({ trashId: n.slice(0, -5), originalPath: meta.originalPath, deletedAt: meta.deletedAt, trashDir: dir });
      } catch { /* skip unreadable sidecar */ }
    }
  }
  return out;
}

async function findTrashItem(trashId: string, home: string): Promise<TrashItem | null> {
  const items = await listMemoryTrash(home);
  return items.find((t) => t.trashId === trashId) ?? null;
}

export async function restoreMemoryFile(trashId: string, home = homedir()): Promise<TrashResult> {
  const item = await findTrashItem(trashId, home);
  if (!item) return { ok: false, error: "not found" };
  const occupied = await access(item.originalPath).then(() => true).catch(() => false);
  if (occupied) return { ok: false, error: "target already exists" };
  try {
    await mkdir(path.dirname(item.originalPath), { recursive: true });
    await rename(path.join(item.trashDir, trashId), item.originalPath);
    await rm(path.join(item.trashDir, `${trashId}.json`), { force: true });
    return { ok: true, trashId };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "restore failed" };
  }
}

export async function purgeMemoryTrash(trashId: string | undefined, home = homedir()): Promise<TrashResult> {
  const items = trashId
    ? (await findTrashItem(trashId, home).then((i) => (i ? [i] : [])))
    : await listMemoryTrash(home);
  try {
    for (const it of items) {
      await rm(path.join(it.trashDir, it.trashId), { force: true });
      await rm(path.join(it.trashDir, `${it.trashId}.json`), { force: true });
    }
    return { ok: true, trashId: trashId ?? "all" };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "purge failed" };
  }
}
```

> Replace `import { readFile, readdir, rm, access } from ...` by merging into the existing top import to avoid a duplicate import statement.

- [ ] **Step 4: Run; expect pass.**
- [ ] **Step 5: Commit**

```bash
git add src/lib/server/memory-trash.ts src/lib/server/memory-trash.test.ts
git commit -S -m "feat(memory): restore, list, and purge soft-deleted memories"
git log -1 --pretty='%G?'
```

---

## Phase 3 — API routes + scan exclusion

### Task 9: Exclude `.trash/` from the memory scan

**Files:** Modify `src/app/api/memory/route.ts`; Test `src/app/api/memory-trash-excluded.test.ts` (structural).

- [ ] **Step 1: Write structural failing test** `src/app/api/memory-trash-excluded.test.ts`

```ts
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const source = await readFile(new URL("./memory/route.ts", import.meta.url), "utf8");
assert.match(source, /\.trash|TRASH_DIRNAME/, "memory scan must skip the .trash directory");
console.log("memory-trash-excluded.test: ok");
```

- [ ] **Step 2: Run; expect failure.**

- [ ] **Step 3: Implement** — in `src/app/api/memory/route.ts`, find the directory-walk recursion (the function that reads dir entries). Where it iterates `dirent` entries and recurses into subdirectories, add a skip:

```ts
// inside the walk, before recursing into a subdirectory `entry`:
if (entry.isDirectory() && entry.name === ".trash") continue;
```

(Import is not required — it's a literal name match. If the walk already has a `SKIP_DIRS`/ignore set, add `".trash"` to it instead.)

- [ ] **Step 4: Run; expect pass.**
- [ ] **Step 5: Commit**

```bash
git add src/app/api/memory/route.ts src/app/api/memory-trash-excluded.test.ts
git commit -S -m "feat(memory): hide .trash entries from the memory scan"
git log -1 --pretty='%G?'
```

### Task 10: Delete / restore / purge routes

**Files:**
- Create: `src/app/api/memory/delete/route.ts`, `.../restore/route.ts`, `.../purge/route.ts`
- Test: `src/app/api/memory-mutation-routes.test.ts` (structural)

- [ ] **Step 1: Write structural failing test** `src/app/api/memory-mutation-routes.test.ts`

```ts
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
for (const [file, fn] of [["delete", "archiveMemoryFile"], ["restore", "restoreMemoryFile"], ["purge", "purgeMemoryTrash"]] as const) {
  const src = await readFile(new URL(`./memory/${file}/route.ts`, import.meta.url), "utf8");
  assert.match(src, /export async function POST/, `${file} route is POST`);
  assert.match(src, new RegExp(fn), `${file} route calls ${fn}`);
}
console.log("memory-mutation-routes.test: ok");
```

- [ ] **Step 2: Run; expect failure.**

- [ ] **Step 3: Implement the three routes** (mirrors `workflows/delete/route.ts`):

`src/app/api/memory/delete/route.ts`:
```ts
import { NextResponse } from "next/server";
import { archiveMemoryFile } from "@/lib/server/memory-trash";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body: { path?: string };
  try { body = await req.json(); } catch {
    return NextResponse.json({ ok: false, error: "invalid json body" }, { status: 400 });
  }
  if (!body.path) return NextResponse.json({ ok: false, error: "path required" }, { status: 400 });
  const result = await archiveMemoryFile(body.path);
  const status = result.ok ? 200 : result.error.startsWith("protected") ? 409 : result.error === "path not allowed" ? 403 : 404;
  return NextResponse.json(result, { status });
}
```

`src/app/api/memory/restore/route.ts`:
```ts
import { NextResponse } from "next/server";
import { restoreMemoryFile } from "@/lib/server/memory-trash";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body: { trashId?: string };
  try { body = await req.json(); } catch {
    return NextResponse.json({ ok: false, error: "invalid json body" }, { status: 400 });
  }
  if (!body.trashId) return NextResponse.json({ ok: false, error: "trashId required" }, { status: 400 });
  const result = await restoreMemoryFile(body.trashId);
  return NextResponse.json(result, { status: result.ok ? 200 : 404 });
}
```

`src/app/api/memory/purge/route.ts`:
```ts
import { NextResponse } from "next/server";
import { purgeMemoryTrash } from "@/lib/server/memory-trash";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body: { trashId?: string };
  try { body = await req.json(); } catch { body = {}; }
  const result = await purgeMemoryTrash(body.trashId);
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}
```

- [ ] **Step 4: Run; expect pass.**
- [ ] **Step 5: Commit**

```bash
git add src/app/api/memory/delete/route.ts src/app/api/memory/restore/route.ts src/app/api/memory/purge/route.ts src/app/api/memory-mutation-routes.test.ts
git commit -S -m "feat(memory): add delete/restore/purge API routes"
git log -1 --pretty='%G?'
```

---

## Phase 4 — `agents-memory-view.tsx` UI

> All steps modify `src/components/agents-memory-view.tsx`. Tests are structural in `src/components/agents-memory-view-management.test.ts`. Anchor line numbers reference the origin/main version; re-locate by the quoted code, not the number, since earlier steps shift lines.

### Task 11: State + imports for management controls

- [ ] **Step 1: Structural failing test** `src/components/agents-memory-view-management.test.ts`

```ts
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const source = await readFile(new URL("./agents-memory-view.tsx", import.meta.url), "utf8");

assert.match(source, /useUndoDelete/, "uses the shared undo-delete hook");
assert.match(source, /LibraryUndoToast/, "renders the undo toast");
assert.match(source, /\[groupMode, setGroupMode\]/, "tracks group mode");
assert.match(source, /\[staleOnly, setStaleOnly\]/, "tracks stale-only filter");
assert.match(source, /"oldest"|"staleFirst"/, "sort mode extended");
assert.match(source, /detectStale|ruleBasedStaleScorer/, "uses the stale scorer");
assert.match(source, /Suggested for cleanup/, "renders a suggestions section");
assert.match(source, /classifyProtection|protection === "bulk-protected"|protection === "structural"/, "respects protection tiers");
console.log("agents-memory-view-management.test: ok");
```

- [ ] **Step 2: Run; expect failure.**

- [ ] **Step 3: Add imports** at the top of `agents-memory-view.tsx` (with the other `@/lib` / `./` imports):

```ts
import { useUndoDelete } from "@/lib/use-undo-delete";
import { LibraryUndoToast } from "./library-undo-toast";
import {
  detectStale,
  groupMemories,
  sortMemories,
  type GroupBy,
} from "@/lib/memory-management";
```

- [ ] **Step 4: Add state** next to the existing hooks (after `const [sortMode, setSortMode] = useState<...>("recent");` at ~line 120). Replace the sort type to include the new modes and add group/stale state + the undo hook:

```ts
// widen the existing sortMode union:
const [sortMode, setSortMode] = useState<"recent" | "oldest" | "name" | "size" | "staleFirst">("recent");
const [groupMode, setGroupMode] = useState<GroupBy>("none");
const [staleOnly, setStaleOnly] = useState(false);
const { pending: undoPending, scheduleDelete, undo: undoDelete, commit: commitDelete } = useUndoDelete<{ key: string }>();
```

- [ ] **Step 5: Run the structural test; some asserts pass.** Commit.

```bash
git add src/components/agents-memory-view.tsx src/components/agents-memory-view-management.test.ts
git commit -S -m "feat(memory-ui): add management state + imports to memory view"
git log -1 --pretty='%G?'
```

### Task 12: Delete handler + per-entry button + undo toast

- [ ] **Step 1:** (test already covers `useUndoDelete`/`LibraryUndoToast`; this step makes them real.)

- [ ] **Step 2: Add a delete handler** inside the component (near `load`):

```ts
const handleDelete = useCallback(
  (path: string, key: string, source: "coven" | "file") => {
    // optimistic removal from the rendered lists
    if (source === "coven") setCovenEntries((prev) => prev.filter((e) => e.path !== path));
    else setFileEntries((prev) => prev.filter((e) => e.fullPath !== path));
    scheduleDelete({ key }, path.split("/").pop() ?? "entry", async () => {
      await fetch("/api/memory/delete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path }),
      });
    });
  },
  [scheduleDelete],
);

const handleUndoDelete = useCallback(() => {
  undoDelete();
  void load(); // re-pull so the optimistically-removed row reappears
}, [undoDelete, load]);
```

- [ ] **Step 3: Add a trash button** to the coven card actions (the action-button group at ~lines 415-425) and the file row (`MemoryFilesList`, ~lines 891-893). For coven cards, guard structural entries:

```tsx
{classifyProtection(entry.path) !== "structural" && (
  <button
    type="button"
    className="memory-card-delete"
    aria-label={`Delete ${entry.title}`}
    onClick={(e) => { e.stopPropagation(); handleDelete(entry.path, entry.id, "coven"); }}
  >
    <Icon name="ph:trash" aria-hidden />
  </button>
)}
```

(For the file row inside `MemoryFilesList`, thread a `onDelete?: (path: string) => void` prop and render the same button using `entry.fullPath`; call it from the parent as `onDelete={(p) => handleDelete(p, p, "file")}`. Import `classifyProtection` from `@/lib/memory-management` and `Icon` is already imported.)

- [ ] **Step 4: Render the toast** near the component's root return (e.g. just before the closing fragment/section):

```tsx
{undoPending && (
  <LibraryUndoToast
    label={undoPending.label}
    onUndo={handleUndoDelete}
    onDismiss={commitDelete}
  />
)}
```

- [ ] **Step 5: Run the structural test; expect pass. Manually verify** in the dev app (see Phase 6). Commit.

```bash
git add src/components/agents-memory-view.tsx
git commit -S -m "feat(memory-ui): per-entry soft-delete with undo toast"
git log -1 --pretty='%G?'
```

### Task 13: Controls bar (group / sort / stale-only)

- [ ] **Step 1:** (covered by structural test asserts for groupMode/staleOnly/sort.)

- [ ] **Step 2: Add controls** in the controls header (the search/familiar block, ~lines 299-336). After the source-filter chips, add:

```tsx
<div className="memory-controls">
  <label className="memory-control">
    Group
    <select value={groupMode} onChange={(e) => setGroupMode(e.target.value as GroupBy)}>
      <option value="none">None</option>
      <option value="familiar">Familiar</option>
      <option value="source">Source</option>
      <option value="type">Type</option>
      <option value="date">Date</option>
    </select>
  </label>
  <label className="memory-control">
    Sort
    <select value={sortMode} onChange={(e) => setSortMode(e.target.value as typeof sortMode)}>
      <option value="recent">Recent</option>
      <option value="oldest">Oldest</option>
      <option value="name">Name</option>
      <option value="size">Size</option>
      <option value="staleFirst">Stale first</option>
    </select>
  </label>
  <label className="memory-control memory-control-toggle">
    <input type="checkbox" checked={staleOnly} onChange={(e) => setStaleOnly(e.target.checked)} />
    Stale only
  </label>
</div>
```

- [ ] **Step 3: Apply group/sort to file rendering.** Where file entries are mapped/sorted for display today (the existing `sortMode` switch around lines 450-462), route them through the lib. Build a normalized list and apply `staleOnly` + `groupMemories` + `sortMemories`. Minimal approach — keep existing card markup, but compute the visible order from the lib:

```ts
// near the render computation for files:
const normalizedFiles = useMemo(
  () => fileEntries.map(normalizeFileEntry),
  [fileEntries],
);
const visibleFileGroups = useMemo(() => {
  let list = normalizedFiles;
  if (staleOnly) list = list.filter((e) => detectStale(e).stale);
  list = sortMemories(list, sortMode);
  return groupMemories(list, groupMode);
}, [normalizedFiles, staleOnly, sortMode, groupMode]);
```

Render group headers when `groupMode !== "none"` (iterate `visibleFileGroups`, render `<h4>{group.label} ({group.entries.length})</h4>` then the group's rows). Map each group entry back to its original `FileMemoryEntry` by `fullPath` for the existing row markup. (Import `normalizeFileEntry` from `@/lib/memory-management`.)

- [ ] **Step 4: Add minimal CSS.** In the memory view's stylesheet (find via `grep -rn "memory-card\|agents-memory" src/styles`), add `.memory-controls { display:flex; gap:.75rem; align-items:center; flex-wrap:wrap; }` and a small `.memory-card-delete` style.

- [ ] **Step 5: Run structural test; pass. Verify in dev app.** Commit.

```bash
git add src/components/agents-memory-view.tsx src/styles
git commit -S -m "feat(memory-ui): group/sort/stale-only controls"
git log -1 --pretty='%G?'
```

### Task 14: "Suggested for cleanup" section + protection in bulk

- [ ] **Step 1:** (structural test already asserts "Suggested for cleanup" + protection handling.)

- [ ] **Step 2: Compute suggestions** (combine both sources):

```ts
const suggestions = useMemo(() => {
  const all = [...covenEntries.map(normalizeCovenEntry), ...normalizedFiles];
  return all.filter((e) => detectStale(e).stale);
}, [covenEntries, normalizedFiles]);

// bulk-selectable = suggestions that are NOT protected from bulk
const bulkDeletable = useMemo(
  () => suggestions.filter((e) => e.protection === "normal"),
  [suggestions],
);
```

(Import `normalizeCovenEntry` too.)

- [ ] **Step 3: Render the section** above the lists, only when `suggestions.length > 0`:

```tsx
{suggestions.length > 0 && (
  <section className="memory-suggestions" aria-label="Suggested for cleanup">
    <header>
      <h3>Suggested for cleanup ({suggestions.length})</h3>
      <button
        type="button"
        disabled={bulkDeletable.length === 0}
        onClick={() => bulkDeletable.forEach((e) => handleDelete(e.path, e.key, e.source))}
      >
        Delete {bulkDeletable.length} cleanable
      </button>
    </header>
    <ul>
      {suggestions.map((e) => (
        <li key={e.key} className={e.protection !== "normal" ? "memory-suggestion-protected" : ""}>
          <span>{e.title}</span>
          <em>{detectStale(e).reason}</em>
          {e.protection !== "normal" ? (
            <span className="memory-protected-badge" title="Protected from bulk delete">🔒 protected</span>
          ) : null}
          {e.protection !== "structural" && (
            <button type="button" onClick={() => handleDelete(e.path, e.key, e.source)}>Delete</button>
          )}
        </li>
      ))}
    </ul>
  </section>
)}
```

This satisfies the protection rule: bulk button only deletes `normal` entries; `bulk-protected` (dream summaries incl. "No notable updates") show a 🔒 badge and an **individual** Delete; `structural` show no delete.

- [ ] **Step 4: Run structural test; pass. Verify in dev app** (seed a `dreaming/light/<date>.md` with "No notable updates" and confirm it appears as protected). Commit.

```bash
git add src/components/agents-memory-view.tsx src/styles
git commit -S -m "feat(memory-ui): stale 'Suggested for cleanup' with dream-file bulk protection"
git log -1 --pretty='%G?'
```

---

## Phase 5 — Familiar Studio "Memory" tab

### Task 15: Add the tab type + wiring

**Files:**
- Modify: `src/lib/familiar-studio-context.ts` (add `"memory"` to `FamiliarStudioTab`)
- Create: `src/components/familiar-studio-memory-tab.tsx`
- Modify: `src/components/familiar-studio.tsx` (TABS array + content switch + import)
- Test: `src/components/familiar-studio-memory-tab.test.ts`

- [ ] **Step 1: Structural failing test** `src/components/familiar-studio-memory-tab.test.ts`

```ts
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const tab = await readFile(new URL("./familiar-studio-memory-tab.tsx", import.meta.url), "utf8");
assert.match(tab, /AgentsMemoryView/, "memory tab embeds the memory view");
assert.match(tab, /lockToFamiliar/, "memory tab scopes to one familiar");
const studio = await readFile(new URL("./familiar-studio.tsx", import.meta.url), "utf8");
assert.match(studio, /id: "memory"/, "studio registers a memory tab");
console.log("familiar-studio-memory-tab.test: ok");
```

- [ ] **Step 2: Run; expect failure.**

- [ ] **Step 3: Add the tab id type** in `src/lib/familiar-studio-context.ts` — find `type FamiliarStudioTab = "identity" | "look" | "brain" | "lifecycle"` and add `| "memory"`.

- [ ] **Step 4: Create** `src/components/familiar-studio-memory-tab.tsx`:

```tsx
"use client";

import { AgentsMemoryView } from "./agents-memory-view";
import type { Familiar } from "@/lib/familiar-types"; // match the type used by AgentsMemoryView's `familiars` prop

export function FamiliarStudioMemoryTab({ familiar, familiars }: { familiar: Familiar; familiars: Familiar[] }) {
  return (
    <div className="familiar-studio-memory-tab">
      <AgentsMemoryView familiars={familiars} activeFamiliar={familiar} lockToFamiliar />
    </div>
  );
}
```

(Confirm the exact `Familiar` import path used by `agents-memory-view.tsx` — reuse the same import to keep types aligned.)

- [ ] **Step 5: Register the tab** in `src/components/familiar-studio.tsx`:
  - Add to the `TABS` array (after `brain`): `{ id: "memory", label: "Memory", icon: "ph:archive-box" }` — **first verify** `ph:archive-box` is whitelisted: `grep -n "archive-box" src/lib/icon*`; if absent, reuse `"ph:brain"` or add the name to the whitelist.
  - Import `FamiliarStudioMemoryTab` and render it in the tab-content switch where the other tabs render (mirror the `activeTab === "brain"` branch), passing `familiar` and `familiars` from the component's existing props/context.

- [ ] **Step 6: Run the structural test + existing studio tab tests:**

Run: `node --experimental-strip-types src/components/familiar-studio-memory-tab.test.ts`
Run: `node --experimental-strip-types src/components/familiar-studio-tabs.test.ts`
Expected: both `ok` (the latter may need a `"memory"` addition if it enumerates tabs — update it if it fails by adding the new tab to its expected set).

- [ ] **Step 7: Verify in dev app** (open a familiar, click the Memory tab). Commit.

```bash
git add src/lib/familiar-studio-context.ts src/components/familiar-studio-memory-tab.tsx src/components/familiar-studio-memory-tab.test.ts src/components/familiar-studio.tsx
git commit -S -m "feat(memory-ui): familiar-scoped Memory tab in Familiar Studio"
git log -1 --pretty='%G?'
```

---

## Phase 6 — Verification & PR

### Task 16: Full test gate + manual verification

- [ ] **Step 1: Run every new test file**

```bash
for f in \
  src/lib/memory-management.test.ts \
  src/lib/server/memory-trash.test.ts \
  src/lib/server/memory-file-sources-coven-familiar.test.ts \
  src/app/api/memory-trash-excluded.test.ts \
  src/app/api/memory-mutation-routes.test.ts \
  src/components/agents-memory-view-management.test.ts \
  src/components/familiar-studio-memory-tab.test.ts ; do
  node --experimental-strip-types "$f" || { echo "FAIL: $f"; break; }
done
```
Expected: each prints `<name>: ok`.

- [ ] **Step 2: Run the app test gate**

Run: `pnpm test:app`
Expected: pass (fix any regressions surfaced).

- [ ] **Step 3: Manual verification in the dev app.** Follow the dev-app browser-verify recipe: launch dev:app, open the memory view, and confirm:
  - a `normal` entry deletes with an undo toast, and undo restores it;
  - the controls group/sort/filter live;
  - a seeded `dreaming/light/<date>.md` "No notable updates" file shows under "Suggested for cleanup" with a 🔒 protected badge and is NOT included in the bulk "Delete N cleanable" count, but can be deleted individually;
  - the Familiar Studio "Memory" tab shows only that familiar's entries.

- [ ] **Step 4: Lint/typecheck** per repo (`pnpm lint` / `pnpm typecheck` if present). Fix issues.

- [ ] **Step 5: Push + open PR**

```bash
git log origin/main..HEAD --pretty='%H %G?' | awk '$2!="G"{print "UNSIGNED:",$0}'   # must be empty
git push -u origin feat/memory-management
gh pr create --base main --head feat/memory-management --title "feat(memory): manage memory — delete, stale suggestions, group/sort/filter" --body "Implements docs/superpowers/specs/2026-06-13-memory-management-design.md. Soft-delete + undo, rule-based stale suggestions (AI-ready scorer seam), group/sort/filter; dream files protected from bulk delete; no daemon changes."
```

---

## Self-Review (completed by plan author)

**Spec coverage:** delete (Tasks 7–10, 12), undo/soft-archive (Tasks 7–8, 12), stale suggestions incl. "No notable updates" (Tasks 4, 14), AI-ready scorer seam (Task 4 interface), grouping/sorting/filtering (Tasks 5, 13), both surfaces via shared lib (Phase 1 + Tasks 11–15), dream-file protection: structural never-deletable + dream-summary bulk-protection (Tasks 3, 12, 14), no daemon changes (all cave-side), `.trash` scan exclusion (Task 9), path-allowlist reuse + dream-path coverage (Tasks 6–7). All spec sections map to tasks.

**Open confirmations flagged in-plan:** real dream-file path (Task 6 Step 1), the file-walk ignore insertion point (Task 9 Step 3), `Familiar` type import path and icon whitelist (Task 15). These are explicit verification steps, not placeholders.

**Type consistency:** `ManagedMemoryEntry`, `GroupBy`, `SortMode`, `StaleScorer`, `archiveMemoryFile/restoreMemoryFile/purgeMemoryTrash/listMemoryTrash`, `TRASH_DIRNAME`, `classifyProtection/isStructuralMemoryPath` are used consistently across tasks. The component reuses `useUndoDelete`/`LibraryUndoToast` exactly as their real signatures require (`scheduleDelete(item,label,deleteFn)`, toast props `label/onUndo/onDismiss`).
