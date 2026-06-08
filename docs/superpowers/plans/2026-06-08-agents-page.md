# Agents Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a dedicated Agents surface — a new default landing tab that shows every familiar as a card with identity, status, activity, and a memory snapshot; clicking a card opens an in-place detail view with Memory / Files / Sessions tabs; a header action opens a global "memory across all agents" overlay.

**Architecture:** One new container component (`AgentsView`) owns roster/detail/global-memory state and reuses existing memory primitives (`AgentsMemoryView`, `MemoryGraph3D`, `/api/coven-memory`, `/api/memory`). A small pure helper (`agents-view-stats.ts`) derives per-card stats. Sidebar, workspace mode, default landing, and keyboard shortcuts get a minimal shift. The companion rail is hidden on this surface (parity with Browser).

**Tech Stack:** React 19, Next.js 16 (Turbopack), TypeScript strict, Phosphor icons, existing CSS variables (`--bg-*`, `--text-*`, `--accent-presence`, `--border-hairline`), Node test convention (string-grep assertions via `node:assert/strict`).

**Source spec:** `docs/superpowers/specs/2026-06-08-agents-page-design.md`

---

## File map

**Create:**
- `src/components/agents-view.tsx` — container + AgentRosterCard + AgentDetailRail + AgentDetailPanel + GlobalMemoryOverlay
- `src/components/agents-view-stats.ts` — `buildAgentCardStats` pure helper
- `src/components/agents-view.test.ts` — page-level behavior
- `src/components/agents-view-stats.test.ts` — pure helper tests
- `src/components/agent-roster-card.test.ts` — card-shape tests (string-grep against agents-view.tsx)
- `src/components/workspace-agents-landing.test.ts` — landing-tab + shortcut tests

**Modify:**
- `src/lib/workspace-mode.ts` — add `"agents"` to the union
- `src/components/agents-memory-view.tsx` — add `lockToFamiliar?: boolean`; extract `MemoryFilesList`
- `src/components/sidebar-minimal.tsx` — add `"agents"` folder mode (first in Work), shift `kbd` strings
- `src/components/workspace.tsx` — default mode `"agents"`, render branch, hide rail, update `SURFACE_ORDER` and `SURFACE_LABELS`

**Reuse without modification:**
- `src/lib/types.ts` (Familiar, SessionRow)
- `src/components/memory-graph-3d.tsx`
- `src/lib/memory-graph-3d-model.ts`
- `/api/coven-memory`, `/api/memory`, `/api/familiars`, `/api/sessions/list`

---

## Conventions

- **Tests** in this repo follow a string-grep pattern: `// @ts-nocheck`, `import assert from "node:assert/strict"`, `readFileSync(new URL("./component.tsx", import.meta.url), "utf8")`, then `assert.match(source, /regex/, "message")`. They run with `node --import tsx --test path/to/test.ts` but are primarily validated by `pnpm typecheck` and `pnpm build` (CI runs build, not tests). Match this convention exactly — do not introduce vitest or RTL.
- **Commits** must be signed (`-S`). Pre-commit hook runs a secret-scanner only; if signing fails, surface it and stop.
- **Co-author** every commit with `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`.
- **CSS classes** use existing `--var(--…)` tokens. No new global CSS unless explicitly added.
- **Imports** use the `@/` alias (configured in tsconfig paths).

After each task: run `pnpm typecheck` (must pass) before committing.

---

## Task 1: Add `"agents"` to the WorkspaceMode union

**Files:**
- Modify: `src/lib/workspace-mode.ts`

- [ ] **Step 1: Replace the union**

Replace the entire contents of `src/lib/workspace-mode.ts` with:

```ts
export type WorkspaceMode =
  | "agents"
  | "home"
  | "chat"
  | "board"
  | "calendar"
  | "inbox"
  | "library"
  | "browser"
  | "terminal"
  | "github"
  | "capabilities";
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: PASS. (At this point nothing references `"agents"` yet; the broader union is harmless.)

- [ ] **Step 3: Commit**

```bash
git add src/lib/workspace-mode.ts
git commit -S -m "$(cat <<'EOF'
feat(workspace): add "agents" to WorkspaceMode union

First step of the Agents page work — widening the discriminated union so
follow-up commits can wire the surface without churn.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 4: Verify the commit is signed**

Run: `git log -1 --show-signature 2>&1 | head -5`
Expected output contains: `Good "<algorithm>" signature` (e.g. `Good "git" signature` for SSH).
If absent: STOP. Resolve signing config and re-commit. Do not push.

---

## Task 2: Refactor `agents-memory-view.tsx` — extract `MemoryFilesList` and add `lockToFamiliar`

**Files:**
- Modify: `src/components/agents-memory-view.tsx`

We need two new affordances inside this existing file: an exported `MemoryFilesList` component (the file-list `<section>` extracted as-is, parameterised) and a `lockToFamiliar` prop that suppresses the familiar `<select>` (rendered as a static chip instead) for callers that have already chosen a familiar.

- [ ] **Step 1: Read the current file**

```bash
sed -n '1,50p' src/components/agents-memory-view.tsx
```

Confirm the existing exports are `AgentsMemoryView` (line 78) and `RailMemoryList` (line 391), and that the file-list section lives at lines 345-378 inside the `effectiveViewMode === "list"` branch.

- [ ] **Step 2: Add the `lockToFamiliar` prop**

Locate the `Props` type (lines 27-35) and replace it with:

```tsx
type Props = {
  familiars: Familiar[];
  activeFamiliar: Familiar | null;
  onOpenMemoryFile?: (path: string) => void;
  /** Lock to a specific view mode; when set, hides the mode toggle. */
  mode?: "list" | "graph";
  /** Cap the number of entries rendered per section. */
  limit?: number;
  /** Suppress the familiar <select>; render the active familiar as a chip. */
  lockToFamiliar?: boolean;
};
```

Then add `lockToFamiliar` to the destructure on the `AgentsMemoryView` function signature (current line 78):

```tsx
export function AgentsMemoryView({ familiars, activeFamiliar, onOpenMemoryFile, mode, limit, lockToFamiliar }: Props) {
```

Locate the familiar `<select>` block (lines 244-252) and wrap it in a conditional that renders a chip instead when locked:

```tsx
{lockToFamiliar ? (
  <span
    className="inline-flex h-8 items-center rounded-md border border-[var(--border-hairline)] bg-[var(--bg-raised)]/40 px-2 text-[12px] text-[var(--text-secondary)]"
    aria-label="Locked to familiar"
  >
    {selectedFamiliar?.display_name ?? "—"}
  </span>
) : (
  <select
    value={familiarFilter}
    onChange={(event) => setFamiliarFilter(event.target.value)}
    className="h-8 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-raised)]/40 px-2 text-[12px] text-[var(--text-secondary)] outline-none focus:border-[var(--accent-presence)]"
  >
    {familiarOptions.map((familiar) => (
      <option key={familiar.id} value={familiar.id}>{familiar.display_name}</option>
    ))}
  </select>
)}
```

- [ ] **Step 3: Extract `MemoryFilesList`**

At the very bottom of the file (after `RailMemoryList`), add a new exported component:

```tsx
type MemoryFilesListProps = {
  entries: FileMemoryEntry[];
  onOpen?: (path: string) => void;
  loaded: boolean;
  error: string | null;
  limit?: number;
};

export function MemoryFilesList({ entries, onOpen, loaded, error, limit }: MemoryFilesListProps) {
  const sliced = entries.slice(0, limit ?? entries.length);
  return (
    <div className="rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-raised)]/25">
      {sliced.length === 0 ? (
        <div className="px-3 py-8 text-center text-[12px] text-[var(--text-muted)]">
          {loaded
            ? error
              ? "Couldn’t load memory files. See the error above and try again."
              : "No memory files match this view."
            : "Loading files..."}
        </div>
      ) : (
        <ul className="max-h-[640px] divide-y divide-[var(--border-hairline)] overflow-y-auto">
          {sliced.map((entry) => (
            <li key={entry.fullPath}>
              <button
                type="button"
                onClick={() => onOpen?.(entry.fullPath)}
                className="flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-[var(--bg-raised)]"
              >
                <Icon name="ph:file-text" width={13} className="mt-0.5 shrink-0 text-[var(--text-muted)]" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12px] text-[var(--text-primary)]">{entry.relPath}</span>
                  <span className="mt-0.5 block truncate font-mono text-[10px] text-[var(--text-muted)]">
                    {entry.rootLabel} · {compactPath(entry.fullPath)}
                  </span>
                </span>
                <span className="shrink-0 text-[10px] text-[var(--text-muted)]">{age(entry.modified)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

Now replace the inline file-list `<section>` (lines 345-378) inside `AgentsMemoryView`'s list view with a delegating call:

```tsx
<section className="min-h-0">
  <div className="mb-2 flex items-center justify-between">
    <h3 className="text-[11px] font-semibold uppercase tracking-widest text-[var(--text-muted)]">Memory files</h3>
    <span className="text-[10px] text-[var(--text-muted)]">{visibleFiles.length} visible</span>
  </div>
  <MemoryFilesList
    entries={visibleFiles}
    onOpen={onOpenMemoryFile}
    loaded={loaded}
    error={error}
    limit={effectiveLimit === Infinity ? 160 : effectiveLimit}
  />
</section>
```

- [ ] **Step 4: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Smoke-build to catch JSX/runtime issues the typechecker misses**

Run: `pnpm build 2>&1 | tail -20`
Expected: build completes (final lines show "Compiled successfully" or similar — Turbopack flake retry per CI is acceptable; if it fails once, run again).

- [ ] **Step 6: Commit**

```bash
git add src/components/agents-memory-view.tsx
git commit -S -m "$(cat <<'EOF'
refactor(memory): extract MemoryFilesList; add lockToFamiliar prop

Pulls the file-list section out of AgentsMemoryView into an exported
MemoryFilesList so the upcoming Agents detail panel can reuse it
without rendering the coven-memory half. Adds lockToFamiliar to let
callers suppress the familiar <select> when the surrounding context
has already chosen.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
git log -1 --show-signature 2>&1 | head -5
```

Confirm `Good "<algorithm>" signature` appears. If not, STOP and resolve.

---

## Task 3: Create `agents-view-stats.ts` (pure helper) — TDD

**Files:**
- Create: `src/components/agents-view-stats.ts`
- Create: `src/components/agents-view-stats.test.ts`

The helper derives per-card stats from familiars + sessions + coven memory entries. Pure function — no React, no I/O — fully unit-testable.

- [ ] **Step 1: Write the failing test**

Create `src/components/agents-view-stats.test.ts`:

```ts
// @ts-nocheck
import assert from "node:assert/strict";
import { buildAgentCardStats } from "./agents-view-stats.ts";

const NOW = Date.parse("2026-06-08T12:00:00.000Z");
const minutesAgo = (m: number) => new Date(NOW - m * 60_000).toISOString();
const daysAgo = (d: number) => new Date(NOW - d * 24 * 60 * 60_000).toISOString();

const familiars = [
  { id: "f1", display_name: "Atlas", role: "engineer" },
  { id: "f2", display_name: "Vesta", role: "researcher" },
  { id: "f3", display_name: "Quill", role: "writer" },
];

const sessions = [
  { id: "s1", familiarId: "f1", updated_at: minutesAgo(2), project_root: "/r", harness: "claude", title: "t", status: "running", exit_code: null, archived_at: null, created_at: minutesAgo(10) },
  { id: "s2", familiarId: "f1", updated_at: daysAgo(1), project_root: "/r", harness: "claude", title: "t", status: "stopped", exit_code: 0, archived_at: null, created_at: daysAgo(1) },
  { id: "s3", familiarId: "f1", updated_at: daysAgo(8), project_root: "/r", harness: "claude", title: "t", status: "stopped", exit_code: 0, archived_at: null, created_at: daysAgo(8) },
  { id: "s4", familiarId: "f2", updated_at: daysAgo(3), project_root: "/r", harness: "claude", title: "t", status: "stopped", exit_code: 0, archived_at: null, created_at: daysAgo(3) },
];

const covenEntries = [
  { id: "m1", familiar_id: "f1", title: "Older f1 memory", path: "/a.md", updated_at: minutesAgo(60) },
  { id: "m2", familiar_id: "f1", title: "Latest f1 memory", path: "/b.md", updated_at: minutesAgo(5) },
  { id: "m3", familiar_id: "f2", title: "Only f2 memory", path: "/c.md", updated_at: minutesAgo(120) },
];

const stats = buildAgentCardStats({ familiars, sessions, covenEntries, now: NOW });

// f1
const f1 = stats.get("f1");
assert.equal(f1?.memoryCount, 2, "f1 has 2 memories");
assert.equal(f1?.latestMemory?.title, "Latest f1 memory", "f1 latest memory is the most-recent one");
assert.equal(f1?.lastSessionAt, sessions[0].updated_at, "f1 last session is the most-recent");
assert.equal(f1?.sessionsLast7d, 2, "f1 has 2 sessions in the last 7d (s1 and s2; s3 is excluded at 8d)");
assert.equal(f1?.hasActiveSession, true, "f1 has an active session (2min < 5min)");

// f2
const f2 = stats.get("f2");
assert.equal(f2?.memoryCount, 1);
assert.equal(f2?.latestMemory?.title, "Only f2 memory");
assert.equal(f2?.sessionsLast7d, 1);
assert.equal(f2?.hasActiveSession, false, "f2 last session was 3 days ago, not active");

// f3 — nothing
const f3 = stats.get("f3");
assert.equal(f3?.memoryCount, 0);
assert.equal(f3?.latestMemory, null);
assert.equal(f3?.lastSessionAt, null);
assert.equal(f3?.sessionsLast7d, 0);
assert.equal(f3?.hasActiveSession, false);

// 7d window edge: session at exactly 7d should be EXCLUDED (strict less-than)
const edge7d = buildAgentCardStats({
  familiars: [{ id: "x", display_name: "X", role: "" }],
  sessions: [{ id: "z", familiarId: "x", updated_at: daysAgo(7), project_root: "/r", harness: "c", title: "t", status: "s", exit_code: 0, archived_at: null, created_at: daysAgo(7) }],
  covenEntries: [],
  now: NOW,
});
assert.equal(edge7d.get("x")?.sessionsLast7d, 0, "session at exactly 7d ago is excluded");

// 5min window edge: session at exactly 5min should be INACTIVE (strict less-than)
const edge5m = buildAgentCardStats({
  familiars: [{ id: "y", display_name: "Y", role: "" }],
  sessions: [{ id: "z", familiarId: "y", updated_at: minutesAgo(5), project_root: "/r", harness: "c", title: "t", status: "s", exit_code: 0, archived_at: null, created_at: minutesAgo(5) }],
  covenEntries: [],
  now: NOW,
});
assert.equal(edge5m.get("y")?.hasActiveSession, false, "session at exactly 5min ago is not active");

// Empty inputs
const empty = buildAgentCardStats({ familiars: [], sessions: [], covenEntries: [], now: NOW });
assert.equal(empty.size, 0);

console.log("agents-view-stats: all assertions passed");
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `node --import tsx --test src/components/agents-view-stats.test.ts 2>&1 | tail -10`
Expected: FAIL — "Cannot find module './agents-view-stats.ts'" or similar.

- [ ] **Step 3: Write the implementation**

Create `src/components/agents-view-stats.ts`:

```ts
import type { Familiar, SessionRow } from "@/lib/types";

export type CovenMemoryEntry = {
  id: string;
  familiar_id: string;
  title: string;
  path: string;
  updated_at: string;
  excerpt?: string;
};

export type AgentCardStats = {
  memoryCount: number;
  latestMemory: { title: string; updatedAt: string } | null;
  lastSessionAt: string | null;
  sessionsLast7d: number;
  hasActiveSession: boolean;
};

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60_000;
const FIVE_MINUTES_MS = 5 * 60_000;

export function buildAgentCardStats(args: {
  familiars: Familiar[];
  sessions: SessionRow[];
  covenEntries: CovenMemoryEntry[];
  now?: number;
}): Map<string, AgentCardStats> {
  const now = args.now ?? Date.now();
  const sevenCutoff = now - SEVEN_DAYS_MS;
  const activeCutoff = now - FIVE_MINUTES_MS;

  const sessionsByFamiliar = new Map<string, SessionRow[]>();
  for (const session of args.sessions) {
    const fid = session.familiarId;
    if (!fid) continue;
    const bucket = sessionsByFamiliar.get(fid) ?? [];
    bucket.push(session);
    sessionsByFamiliar.set(fid, bucket);
  }

  const memoriesByFamiliar = new Map<string, CovenMemoryEntry[]>();
  for (const entry of args.covenEntries) {
    const bucket = memoriesByFamiliar.get(entry.familiar_id) ?? [];
    bucket.push(entry);
    memoriesByFamiliar.set(entry.familiar_id, bucket);
  }

  const result = new Map<string, AgentCardStats>();
  for (const familiar of args.familiars) {
    const sessions = sessionsByFamiliar.get(familiar.id) ?? [];
    const memories = memoriesByFamiliar.get(familiar.id) ?? [];

    let lastSessionAt: string | null = null;
    let lastSessionMs = -Infinity;
    let sessionsLast7d = 0;
    let hasActiveSession = false;
    for (const session of sessions) {
      const ms = Date.parse(session.updated_at);
      if (!Number.isFinite(ms)) continue;
      if (ms > lastSessionMs) {
        lastSessionMs = ms;
        lastSessionAt = session.updated_at;
      }
      if (ms > sevenCutoff) sessionsLast7d += 1;
      if (ms > activeCutoff) hasActiveSession = true;
    }

    let latestMemory: AgentCardStats["latestMemory"] = null;
    let latestMs = -Infinity;
    for (const entry of memories) {
      const ms = Date.parse(entry.updated_at);
      if (!Number.isFinite(ms)) continue;
      if (ms > latestMs) {
        latestMs = ms;
        latestMemory = { title: entry.title, updatedAt: entry.updated_at };
      }
    }

    result.set(familiar.id, {
      memoryCount: memories.length,
      latestMemory,
      lastSessionAt,
      sessionsLast7d,
      hasActiveSession,
    });
  }
  return result;
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `node --import tsx --test src/components/agents-view-stats.test.ts 2>&1 | tail -10`
Expected: PASS — "agents-view-stats: all assertions passed" line printed; node test runner reports `# pass 1` and 0 fail.

- [ ] **Step 5: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/agents-view-stats.ts src/components/agents-view-stats.test.ts
git commit -S -m "$(cat <<'EOF'
feat(agents): add buildAgentCardStats pure helper

Derives per-familiar memory count + latest memory + session activity
(last session, 7-day count, active-now within 5min) from the existing
familiars/sessions/coven-memory shapes. Pure, testable, ready for the
Agents page roster cards.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
git log -1 --show-signature 2>&1 | head -5
```

Confirm signature line. If missing, STOP.

---

## Task 4: Create `agents-view.tsx` — header + roster grid (no drill-in yet)

**Files:**
- Create: `src/components/agents-view.tsx`

Build the container + `AgentRosterCard` + roster grid only. Drill-in and overlay come in Tasks 5 and 6 to keep diffs reviewable.

- [ ] **Step 1: Create the file with container shell, types, fetch, and roster grid**

Create `src/components/agents-view.tsx`:

```tsx
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Icon } from "@/lib/icon";
import type { Familiar, SessionRow } from "@/lib/types";
import {
  buildAgentCardStats,
  type AgentCardStats,
  type CovenMemoryEntry,
} from "@/components/agents-view-stats";

type FileMemoryEntry = {
  root: string;
  rootLabel: string;
  relPath: string;
  fullPath: string;
  size: number;
  modified: string;
};

type CovenMemoryResponse =
  | { ok: true; entries: CovenMemoryEntry[] }
  | { ok: false; entries?: CovenMemoryEntry[]; error?: string };

type FileMemoryResponse =
  | { ok: true; entries: FileMemoryEntry[] }
  | { ok: false; entries?: FileMemoryEntry[]; error?: string };

type ViewMode = "roster" | "detail" | "global-memory";

const LAST_SELECTED_KEY = "cave:agents.lastSelected";

type AgentsViewProps = {
  familiars: Familiar[];
  sessions: SessionRow[];
  daemonRunning: boolean;
  responseNeeded: Set<string>;
  onStartChat: (familiarId: string) => void;
  onOpenSession: (sessionId: string, familiarId?: string | null) => void;
  onOpenMemoryFile: (path: string) => void;
  onOpenOnboarding: () => void;
};

function age(iso: string | null | undefined): string {
  if (!iso) return "";
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return "";
  if (ms < 60_000) return "just now";
  const m = Math.floor(ms / 60_000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function familiarMatches(familiar: Familiar, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  return (
    familiar.display_name.toLowerCase().includes(q) ||
    (familiar.role ?? "").toLowerCase().includes(q) ||
    (familiar.harness ?? "").toLowerCase().includes(q) ||
    familiar.id.toLowerCase().includes(q)
  );
}

export function AgentsView({
  familiars,
  sessions,
  daemonRunning,
  responseNeeded,
  onStartChat,
  onOpenSession,
  onOpenMemoryFile,
  onOpenOnboarding,
}: AgentsViewProps) {
  void onStartChat;
  void onOpenSession;
  void onOpenMemoryFile;
  const [covenEntries, setCovenEntries] = useState<CovenMemoryEntry[]>([]);
  const [fileEntries, setFileEntries] = useState<FileMemoryEntry[]>([]);
  void fileEntries;
  const [memoryError, setMemoryError] = useState<string | null>(null);
  const [memoryLoaded, setMemoryLoaded] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedFamiliarId, setSelectedFamiliarId] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return window.localStorage.getItem(LAST_SELECTED_KEY);
  });
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    if (typeof window === "undefined") return "roster";
    return window.localStorage.getItem(LAST_SELECTED_KEY) ? "detail" : "roster";
  });
  void viewMode;
  void setViewMode;

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (selectedFamiliarId) window.localStorage.setItem(LAST_SELECTED_KEY, selectedFamiliarId);
    else window.localStorage.removeItem(LAST_SELECTED_KEY);
  }, [selectedFamiliarId]);

  const loadMemory = useCallback(async () => {
    try {
      const [covenRes, fileRes] = await Promise.all([
        fetch("/api/coven-memory", { cache: "no-store" }),
        fetch("/api/memory", { cache: "no-store" }),
      ]);
      const covenJson = (await covenRes.json()) as CovenMemoryResponse;
      const fileJson = (await fileRes.json()) as FileMemoryResponse;
      if (covenJson.ok) setCovenEntries(covenJson.entries ?? []);
      if (fileJson.ok) setFileEntries(fileJson.entries ?? []);
      const errors = [
        covenJson.ok ? null : covenJson.error ?? "Coven memory unavailable",
        fileJson.ok ? null : fileJson.error ?? "Memory files unavailable",
      ].filter(Boolean);
      setMemoryError(errors.length > 0 ? errors.join(" · ") : null);
    } catch (err) {
      setMemoryError(err instanceof Error ? err.message : "memory unavailable");
    } finally {
      setMemoryLoaded(true);
    }
  }, []);

  useEffect(() => {
    void loadMemory();
    const t = setInterval(loadMemory, 30_000);
    return () => clearInterval(t);
  }, [loadMemory]);

  const stats = useMemo(
    () => buildAgentCardStats({ familiars, sessions, covenEntries }),
    [familiars, sessions, covenEntries],
  );

  const visibleFamiliars = useMemo(
    () => familiars.filter((f) => familiarMatches(f, query)),
    [familiars, query],
  );

  return (
    <div className="agents-view flex h-full min-h-0 flex-col bg-[var(--bg-base)]">
      <header className="shrink-0 border-b border-[var(--border-hairline)] px-4 py-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Icon name="ph:users-three" width={16} className="text-[var(--accent-presence)]" />
              <h1 className="text-[14px] font-semibold text-[var(--text-primary)]">Agents</h1>
            </div>
            <p className="mt-1 text-[11px] text-[var(--text-muted)]">
              Roster of every familiar — identity, status, recent activity, memory at a glance.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void loadMemory()}
              className="inline-flex h-7 items-center gap-1.5 rounded-md border border-[var(--border-hairline)] px-2.5 text-[11px] text-[var(--text-secondary)] hover:bg-[var(--bg-raised)]"
            >
              <Icon name="ph:arrows-clockwise" width={12} />
              Refresh
            </button>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <div className="relative min-w-[240px] flex-1">
            <Icon
              name="ph:magnifying-glass"
              width={12}
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]"
            />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search agents…"
              className="h-8 w-full rounded-md border border-[var(--border-hairline)] bg-[var(--bg-raised)]/40 pl-7 pr-3 text-[12px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)] focus:border-[var(--accent-presence)]"
            />
          </div>
          {memoryError ? (
            <span className="inline-flex items-center gap-1.5 rounded-md border border-[var(--color-warning)]/40 bg-[var(--color-warning)]/10 px-2 py-1 text-[11px] text-[var(--color-warning)]">
              <Icon name="ph:warning" width={12} />
              Memory feed unavailable
              <button
                type="button"
                onClick={() => void loadMemory()}
                className="ml-1 underline underline-offset-2"
              >
                Refresh
              </button>
            </span>
          ) : null}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {familiars.length === 0 ? (
          <AgentsEmptyState onOpenOnboarding={onOpenOnboarding} />
        ) : (
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {visibleFamiliars.map((familiar) => (
              <AgentRosterCard
                key={familiar.id}
                familiar={familiar}
                stats={stats.get(familiar.id) ?? emptyStats()}
                daemonRunning={daemonRunning}
                responseNeeded={responseNeeded.has(familiar.id)}
                memoryStatus={memoryError ? "error" : memoryLoaded ? "ready" : "loading"}
                onSelect={() => setSelectedFamiliarId(familiar.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function emptyStats(): AgentCardStats {
  return {
    memoryCount: 0,
    latestMemory: null,
    lastSessionAt: null,
    sessionsLast7d: 0,
    hasActiveSession: false,
  };
}

function AgentsEmptyState({ onOpenOnboarding }: { onOpenOnboarding: () => void }) {
  return (
    <div className="agents-view__empty mx-auto flex max-w-md flex-col items-center px-6 py-16 text-center">
      <Icon name="ph:sparkle" width={28} className="text-[var(--accent-presence)]" />
      <h2 className="mt-3 text-[14px] font-semibold text-[var(--text-primary)]">No familiars yet</h2>
      <p className="mt-1 text-[12px] text-[var(--text-muted)]">
        Set up your first familiar to populate the roster.
      </p>
      <button
        type="button"
        onClick={onOpenOnboarding}
        className="mt-4 inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-raised)] px-3 text-[12px] text-[var(--text-primary)] hover:bg-[var(--bg-raised)]/80"
      >
        <Icon name="ph:plus" width={12} />
        Set up your first familiar
      </button>
    </div>
  );
}

type MemoryStatus = "loading" | "error" | "ready";

type AgentRosterCardProps = {
  familiar: Familiar;
  stats: AgentCardStats;
  daemonRunning: boolean;
  responseNeeded: boolean;
  memoryStatus: MemoryStatus;
  onSelect: () => void;
};

function AgentRosterCard({
  familiar,
  stats,
  daemonRunning,
  responseNeeded,
  memoryStatus,
  onSelect,
}: AgentRosterCardProps) {
  const glyph = familiar.icon ?? "ph:circle-half-tilt";
  const lastSessionLabel = stats.lastSessionAt
    ? `Last session ${age(stats.lastSessionAt)}`
    : "No sessions yet";
  const sessionsLabel =
    stats.sessionsLast7d > 0 ? ` · ${stats.sessionsLast7d} this week` : "";
  return (
    <button
      type="button"
      onClick={onSelect}
      className="agents-view__card group flex h-full flex-col items-stretch gap-2 rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-raised)]/35 p-3 text-left transition-colors hover:border-[var(--accent-presence)]/50 hover:bg-[var(--bg-raised)]/60"
      aria-label={`Open ${familiar.display_name}`}
    >
      <div className="flex items-center gap-2">
        <Icon name={glyph} width={18} className="text-[var(--accent-presence)]" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-semibold text-[var(--text-primary)]">
            {familiar.display_name}
          </span>
          <span className="block truncate text-[10px] uppercase tracking-widest text-[var(--text-muted)]">
            {familiar.role || familiar.harness || familiar.id}
          </span>
        </span>
        <Icon
          name="ph:caret-right"
          width={12}
          className="text-[var(--text-muted)] opacity-0 transition-opacity group-hover:opacity-100"
        />
      </div>

      <div className="flex flex-wrap items-center gap-1.5 text-[10px] uppercase tracking-widest text-[var(--text-muted)]">
        <span
          className={`inline-flex h-1.5 w-1.5 rounded-full ${daemonRunning ? "bg-[var(--accent-presence)]" : "bg-[var(--text-muted)]"}`}
          aria-hidden="true"
        />
        <span>{daemonRunning ? "online" : "offline"}</span>
        {stats.hasActiveSession ? (
          <span className="rounded bg-[var(--accent-presence)]/15 px-1.5 py-0.5 text-[9px] text-[var(--accent-presence)]">
            active session
          </span>
        ) : null}
        {responseNeeded ? (
          <span className="rounded bg-[var(--color-warning)]/15 px-1.5 py-0.5 text-[9px] text-[var(--color-warning)]">
            response needed
          </span>
        ) : null}
      </div>

      <p className="text-[11px] text-[var(--text-secondary)]">
        {lastSessionLabel}{sessionsLabel}
      </p>

      <div className="mt-auto border-t border-[var(--border-hairline)] pt-2 text-[11px] text-[var(--text-secondary)]">
        {memoryStatus === "loading" ? (
          <span className="text-[var(--text-muted)]">Loading memory…</span>
        ) : memoryStatus === "error" ? (
          <span className="text-[var(--text-muted)]">Memory unavailable</span>
        ) : stats.memoryCount === 0 ? (
          <span className="text-[var(--text-muted)]">No memories yet</span>
        ) : (
          <>
            <span className="block">
              {stats.memoryCount} memor{stats.memoryCount === 1 ? "y" : "ies"}
              {stats.latestMemory ? ` · last write ${age(stats.latestMemory.updatedAt)}` : ""}
            </span>
            {stats.latestMemory ? (
              <span className="mt-0.5 block truncate text-[10px] text-[var(--text-muted)]">
                {stats.latestMemory.title}
              </span>
            ) : null}
          </>
        )}
      </div>
    </button>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: PASS. The intentional `void`-binds keep unused props/state from triggering noUnusedLocals; they will be removed in Task 5 when drill-in wires them in.

- [ ] **Step 3: Smoke-build**

Run: `pnpm build 2>&1 | tail -20`
Expected: build completes (retry on Turbopack flake if needed).

- [ ] **Step 4: Commit**

```bash
git add src/components/agents-view.tsx
git commit -S -m "$(cat <<'EOF'
feat(agents): scaffold AgentsView roster grid + AgentRosterCard

Header with search and refresh, responsive card grid (1-4 columns),
per-card stats from buildAgentCardStats, empty state CTA wired to
onboarding. Drill-in detail panel, all-memory overlay, and workspace
wiring follow.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
git log -1 --show-signature 2>&1 | head -5
```

Confirm signature.

---

## Task 5: Add drill-in — `AgentDetailRail` + `AgentDetailPanel`

**Files:**
- Modify: `src/components/agents-view.tsx`

Add the master-detail layout that appears when `viewMode === "detail"`. Replace the `void`-binds with real wiring.

- [ ] **Step 1: Add imports for the detail panel's Memory tab**

At the top of `src/components/agents-view.tsx`, add to the imports below the existing ones:

```tsx
import { AgentsMemoryView, MemoryFilesList } from "@/components/agents-memory-view";
```

- [ ] **Step 2: Remove the `void` bindings and add the detail-mode branch**

Inside `AgentsView`, delete these placeholder lines:

```tsx
void onStartChat;
void onOpenSession;
void onOpenMemoryFile;
…
void viewMode;
void setViewMode;
```

Compute the selected familiar and the visible-memory-files filter once, then replace the body `<div>` that currently always renders the roster with a branch:

```tsx
const selectedFamiliar = useMemo(
  () => familiars.find((f) => f.id === selectedFamiliarId) ?? null,
  [familiars, selectedFamiliarId],
);

useEffect(() => {
  if (selectedFamiliarId && !selectedFamiliar) {
    setSelectedFamiliarId(null);
    setViewMode("roster");
  }
}, [selectedFamiliar, selectedFamiliarId]);

const enterDetail = useCallback((id: string) => {
  setSelectedFamiliarId(id);
  setViewMode("detail");
}, []);

const backToRoster = useCallback(() => {
  setViewMode("roster");
  setSelectedFamiliarId(null);
}, []);
```

Update the roster card's `onSelect` to call `enterDetail(familiar.id)` instead of the inline setter.

Replace the body `<div>` (the one containing `familiars.length === 0` check + the roster grid) with:

```tsx
<div className="min-h-0 flex-1 overflow-y-auto">
  {familiars.length === 0 ? (
    <div className="p-4">
      <AgentsEmptyState onOpenOnboarding={onOpenOnboarding} />
    </div>
  ) : viewMode === "detail" && selectedFamiliar ? (
    <div className="agents-view__detail flex h-full min-h-0">
      <AgentDetailRail
        familiars={familiars}
        selectedId={selectedFamiliar.id}
        onSelect={enterDetail}
        onBack={backToRoster}
      />
      <AgentDetailPanel
        familiar={selectedFamiliar}
        familiars={familiars}
        sessions={sessions}
        fileEntries={fileEntries}
        memoryError={memoryError}
        memoryLoaded={memoryLoaded}
        onClose={backToRoster}
        onStartChat={() => onStartChat(selectedFamiliar.id)}
        onOpenSession={(sid) => onOpenSession(sid, selectedFamiliar.id)}
        onOpenMemoryFile={onOpenMemoryFile}
      />
    </div>
  ) : (
    <div className="p-4">
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {visibleFamiliars.map((familiar) => (
          <AgentRosterCard
            key={familiar.id}
            familiar={familiar}
            stats={stats.get(familiar.id) ?? emptyStats()}
            daemonRunning={daemonRunning}
            responseNeeded={responseNeeded.has(familiar.id)}
            memoryStatus={memoryError ? "error" : memoryLoaded ? "ready" : "loading"}
            onSelect={() => enterDetail(familiar.id)}
          />
        ))}
      </div>
    </div>
  )}
</div>
```

- [ ] **Step 3: Append the two new components at the bottom of the file**

At the end of `src/components/agents-view.tsx`, append:

```tsx
type AgentDetailRailProps = {
  familiars: Familiar[];
  selectedId: string;
  onSelect: (id: string) => void;
  onBack: () => void;
};

function AgentDetailRail({ familiars, selectedId, onSelect, onBack }: AgentDetailRailProps) {
  return (
    <nav className="agents-view__rail flex w-[64px] shrink-0 flex-col items-center gap-2 border-r border-[var(--border-hairline)] bg-[var(--bg-raised)]/20 py-3">
      <button
        type="button"
        onClick={onBack}
        className="agents-view__rail-back inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--border-hairline)] bg-[var(--bg-raised)]/40 text-[var(--text-secondary)] hover:bg-[var(--bg-raised)]"
        aria-label="Back to roster"
        title="Back to roster"
      >
        <Icon name="ph:caret-left" width={14} />
      </button>
      <div className="mt-1 h-px w-8 bg-[var(--border-hairline)]" aria-hidden="true" />
      <ul className="flex flex-col items-center gap-1.5">
        {familiars.map((f) => {
          const active = f.id === selectedId;
          return (
            <li key={f.id}>
              <button
                type="button"
                onClick={() => onSelect(f.id)}
                className={`agents-view__rail-avatar inline-flex h-9 w-9 items-center justify-center rounded-full border ${
                  active
                    ? "border-[var(--accent-presence)] bg-[var(--accent-presence)]/15 text-[var(--accent-presence)]"
                    : "border-[var(--border-hairline)] bg-[var(--bg-raised)]/40 text-[var(--text-secondary)] hover:bg-[var(--bg-raised)]"
                }`}
                title={f.display_name}
                aria-label={f.display_name}
                aria-current={active ? "true" : undefined}
              >
                <Icon name={f.icon ?? "ph:circle-half-tilt"} width={14} />
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

type DetailTab = "memory" | "files" | "sessions";

type AgentDetailPanelProps = {
  familiar: Familiar;
  familiars: Familiar[];
  sessions: SessionRow[];
  fileEntries: FileMemoryEntry[];
  memoryError: string | null;
  memoryLoaded: boolean;
  onClose: () => void;
  onStartChat: () => void;
  onOpenSession: (sessionId: string) => void;
  onOpenMemoryFile: (path: string) => void;
};

function AgentDetailPanel({
  familiar,
  familiars,
  sessions,
  fileEntries,
  memoryError,
  memoryLoaded,
  onClose,
  onStartChat,
  onOpenSession,
  onOpenMemoryFile,
}: AgentDetailPanelProps) {
  const [tab, setTab] = useState<DetailTab>("memory");
  const familiarSessions = useMemo(
    () =>
      sessions
        .filter((s) => s.familiarId === familiar.id)
        .sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1)),
    [sessions, familiar.id],
  );

  return (
    <section className="agents-view__panel flex min-h-0 flex-1 flex-col bg-[var(--bg-base)]">
      <header className="flex items-center justify-between gap-2 border-b border-[var(--border-hairline)] px-4 py-3">
        <div className="flex items-center gap-2">
          <Icon name={familiar.icon ?? "ph:circle-half-tilt"} width={18} className="text-[var(--accent-presence)]" />
          <div className="min-w-0">
            <h2 className="truncate text-[14px] font-semibold text-[var(--text-primary)]">
              {familiar.display_name}
            </h2>
            <p className="truncate text-[10px] uppercase tracking-widest text-[var(--text-muted)]">
              {familiar.role || familiar.harness || familiar.id}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={onStartChat}
            className="inline-flex h-7 items-center gap-1 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-raised)] px-2 text-[11px] text-[var(--text-primary)] hover:bg-[var(--bg-raised)]/80"
          >
            <Icon name="ph:chat-circle" width={12} />
            Start chat
          </button>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-7 items-center gap-1 rounded-md border border-[var(--border-hairline)] px-2 text-[11px] text-[var(--text-secondary)] hover:bg-[var(--bg-raised)]"
            aria-label="Back to roster"
          >
            <Icon name="ph:x" width={12} />
            Close
          </button>
        </div>
      </header>

      <div className="flex shrink-0 border-b border-[var(--border-hairline)] px-3">
        {(["memory", "files", "sessions"] as const).map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`agents-view__tab inline-flex h-9 items-center gap-1.5 px-3 text-[12px] capitalize transition-colors ${
              tab === id
                ? "border-b-2 border-[var(--accent-presence)] text-[var(--text-primary)]"
                : "border-b-2 border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            }`}
            aria-current={tab === id ? "page" : undefined}
          >
            {id}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        {tab === "memory" ? (
          <AgentsMemoryView
            familiars={familiars}
            activeFamiliar={familiar}
            mode="list"
            lockToFamiliar
            onOpenMemoryFile={onOpenMemoryFile}
          />
        ) : tab === "files" ? (
          <div className="h-full overflow-y-auto p-4">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-[11px] font-semibold uppercase tracking-widest text-[var(--text-muted)]">
                Memory files
              </h3>
              <span className="text-[10px] text-[var(--text-muted)]">
                {fileEntries.length} total
              </span>
            </div>
            <MemoryFilesList
              entries={fileEntries}
              loaded={memoryLoaded}
              error={memoryError}
              onOpen={onOpenMemoryFile}
            />
            <p className="mt-2 text-[10px] text-[var(--text-muted)]">
              Note: /api/memory is global today, so this list is the same for every familiar.
            </p>
          </div>
        ) : (
          <div className="h-full overflow-y-auto p-4">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-[11px] font-semibold uppercase tracking-widest text-[var(--text-muted)]">
                Sessions
              </h3>
              <span className="text-[10px] text-[var(--text-muted)]">
                {familiarSessions.length} total
              </span>
            </div>
            {familiarSessions.length === 0 ? (
              <div className="grid min-h-[120px] place-items-center rounded-lg border border-dashed border-[var(--border-hairline)] text-[12px] text-[var(--text-muted)]">
                No sessions for this familiar yet.
              </div>
            ) : (
              <ul className="divide-y divide-[var(--border-hairline)] rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-raised)]/25">
                {familiarSessions.map((s) => (
                  <li key={s.id}>
                    <button
                      type="button"
                      onClick={() => onOpenSession(s.id)}
                      className="flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-[var(--bg-raised)]"
                    >
                      <Icon name="ph:terminal-window" width={13} className="mt-0.5 shrink-0 text-[var(--text-muted)]" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[12px] text-[var(--text-primary)]">
                          {s.title || s.id}
                        </span>
                        <span className="mt-0.5 block truncate font-mono text-[10px] text-[var(--text-muted)]">
                          {s.harness} · {s.status}
                        </span>
                      </span>
                      <span className="shrink-0 text-[10px] text-[var(--text-muted)]">
                        {age(s.updated_at)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Smoke-build**

Run: `pnpm build 2>&1 | tail -20`
Expected: build completes.

- [ ] **Step 6: Commit**

```bash
git add src/components/agents-view.tsx
git commit -S -m "$(cat <<'EOF'
feat(agents): in-place drill-in with Memory / Files / Sessions tabs

Click a roster card to swap into a master-detail layout (thin rail of
agent avatars on the left, detail panel on the right). Detail panel
reuses AgentsMemoryView (locked to the selected familiar) for Memory,
MemoryFilesList for Files, and a session list for Sessions. Back-to-
roster button + close action return to the grid; selection persists
in localStorage so reopening Agents resumes the same detail view.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
git log -1 --show-signature 2>&1 | head -5
```

Confirm signature.

---

## Task 6: Add `GlobalMemoryOverlay` + header trigger

**Files:**
- Modify: `src/components/agents-view.tsx`

Add the modal-style "Memory across all agents" overlay that uses `AgentsMemoryView` with no locked familiar so all agents are selectable from its built-in dropdown, defaulting to graph mode.

- [ ] **Step 1: Add the overlay component at the bottom of the file**

Append at the end of `src/components/agents-view.tsx`:

```tsx
type GlobalMemoryOverlayProps = {
  familiars: Familiar[];
  onClose: () => void;
  onOpenMemoryFile: (path: string) => void;
};

function GlobalMemoryOverlay({ familiars, onClose, onOpenMemoryFile }: GlobalMemoryOverlayProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="agents-view__overlay fixed inset-0 z-50 grid place-items-center bg-black/40 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Memory across all agents"
      onClick={onClose}
    >
      <div
        className="agents-view__overlay-panel relative flex h-[85vh] w-[90vw] max-w-[1280px] flex-col overflow-hidden rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-base)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute right-3 top-3 z-10 inline-flex h-7 items-center gap-1 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-raised)] px-2 text-[11px] text-[var(--text-secondary)] hover:bg-[var(--bg-raised)]/80"
          aria-label="Close"
        >
          <Icon name="ph:x" width={12} />
          Close
        </button>
        <AgentsMemoryView
          familiars={familiars}
          activeFamiliar={null}
          mode="graph"
          onOpenMemoryFile={onOpenMemoryFile}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add the trigger button in the header**

In the header `<div className="flex items-center gap-2">` (the one with the Refresh button), insert the new button BEFORE the Refresh button:

```tsx
<button
  type="button"
  onClick={() => setViewMode("global-memory")}
  className="inline-flex h-7 items-center gap-1.5 rounded-md border border-[var(--border-hairline)] bg-[var(--accent-presence)]/10 px-2.5 text-[11px] text-[var(--accent-presence)] hover:bg-[var(--accent-presence)]/15"
>
  <Icon name="ph:graph" width={12} />
  Memory across all agents
</button>
```

- [ ] **Step 3: Render the overlay when active**

`viewMode === "global-memory"` should overlay whatever else is showing. Add the overlay rendering OUTSIDE the body `<div>` but still inside the root `<div>` of `AgentsView`. Place it as a sibling to the body `<div>`:

```tsx
{viewMode === "global-memory" ? (
  <GlobalMemoryOverlay
    familiars={familiars}
    onClose={() => setViewMode(selectedFamiliarId ? "detail" : "roster")}
    onOpenMemoryFile={onOpenMemoryFile}
  />
) : null}
```

- [ ] **Step 4: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Smoke-build**

Run: `pnpm build 2>&1 | tail -20`
Expected: build completes.

- [ ] **Step 6: Commit**

```bash
git add src/components/agents-view.tsx
git commit -S -m "$(cat <<'EOF'
feat(agents): "Memory across all agents" overlay

Header button opens a modal-style overlay rendering AgentsMemoryView
in graph mode with no locked familiar — the all-agents memory view
without leaving the Agents surface. Esc and backdrop click close;
previous viewMode (roster vs detail) is restored on dismiss.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
git log -1 --show-signature 2>&1 | head -5
```

Confirm signature.

---

## Task 7: Tests for `AgentsView` and `AgentRosterCard`

**Files:**
- Create: `src/components/agents-view.test.ts`
- Create: `src/components/agent-roster-card.test.ts`

Following the repo string-grep test convention.

- [ ] **Step 1: Create `agents-view.test.ts`**

```ts
// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./agents-view.tsx", import.meta.url), "utf8");

assert.match(source, /export function AgentsView/, "AgentsView must be exported");

assert.match(
  source,
  /const LAST_SELECTED_KEY = "cave:agents\.lastSelected"/,
  "Selection persistence uses cave:agents.lastSelected localStorage key",
);

assert.match(
  source,
  /window\.localStorage\.getItem\(LAST_SELECTED_KEY\)/,
  "Initial selectedFamiliarId reads from localStorage",
);

assert.match(
  source,
  /window\.localStorage\.getItem\(LAST_SELECTED_KEY\) \? "detail" : "roster"/,
  "Initial viewMode boots into detail when a selection is persisted, else roster",
);

assert.match(
  source,
  /fetch\("\/api\/coven-memory"[\s\S]*fetch\("\/api\/memory"/,
  "Memory data is fetched from /api/coven-memory and /api/memory",
);

assert.match(
  source,
  /setInterval\(loadMemory, 30_000\)/,
  "Memory data refreshes on 30s interval",
);

assert.match(
  source,
  /buildAgentCardStats\(\{[\s\S]*familiars,[\s\S]*sessions,[\s\S]*covenEntries[\s\S]*\}\)/,
  "Per-card stats are derived from buildAgentCardStats",
);

assert.match(
  source,
  /viewMode === "detail" && selectedFamiliar/,
  "Detail layout renders when viewMode is detail and a familiar is selected",
);

assert.match(
  source,
  /<AgentDetailRail[\s\S]*<AgentDetailPanel/,
  "Detail layout mounts the rail + panel",
);

assert.match(
  source,
  /<GlobalMemoryOverlay[\s\S]*familiars=\{familiars\}/,
  "Global memory overlay is rendered when active",
);

assert.match(
  source,
  /setViewMode\("global-memory"\)/,
  "Header button switches to global-memory mode",
);

assert.match(
  source,
  /onClose=\{\(\) => setViewMode\(selectedFamiliarId \? "detail" : "roster"\)\}/,
  "Closing the overlay restores the previous viewMode based on selection",
);

assert.match(
  source,
  /AgentsEmptyState[\s\S]*onOpenOnboarding/,
  "Empty state CTA wires to onOpenOnboarding",
);

assert.match(
  source,
  /lockToFamiliar/,
  "Memory tab inside detail passes lockToFamiliar to AgentsMemoryView",
);

assert.match(
  source,
  /role="dialog"[\s\S]*aria-modal="true"/,
  "Overlay exposes modal dialog semantics",
);

console.log("agents-view: all assertions passed");
```

- [ ] **Step 2: Create `agent-roster-card.test.ts`**

```ts
// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./agents-view.tsx", import.meta.url), "utf8");
const card = source.match(/function AgentRosterCard[\s\S]*?\n\}\n/)?.[0] ?? "";

assert.ok(card.length > 0, "AgentRosterCard function should be present in agents-view.tsx");

assert.match(card, /aria-label=\{`Open \$\{familiar\.display_name\}`\}/, "Card has accessible label naming the familiar");

assert.match(
  card,
  /Icon name=\{glyph\}/,
  "Card renders the familiar glyph (familiar.icon, with circle-half-tilt fallback)",
);

assert.match(card, /familiar\.display_name/, "Card shows display name");
assert.match(card, /familiar\.role \|\| familiar\.harness \|\| familiar\.id/, "Card shows role / harness / id fallback chain");

assert.match(
  card,
  /daemonRunning \? "online" : "offline"/,
  "Status row shows online/offline tied to daemonRunning",
);

assert.match(
  card,
  /stats\.hasActiveSession \?[\s\S]*active session/,
  "Active-session pill rendered when stats.hasActiveSession",
);

assert.match(
  card,
  /responseNeeded \?[\s\S]*response needed/,
  "Response-needed chip rendered when responseNeeded",
);

assert.match(card, /No sessions yet/, "Activity line handles zero-session case");
assert.match(card, /this week/, "Activity line shows sessionsLast7d label");

assert.match(
  card,
  /memoryStatus === "loading"[\s\S]*Loading memory/,
  "Memory snapshot shows 'Loading memory…' while the fetch is in flight",
);

assert.match(
  card,
  /memoryStatus === "error"[\s\S]*Memory unavailable/,
  "Memory snapshot falls back to 'Memory unavailable' when memory feed errored",
);

assert.match(
  card,
  /No memories yet/,
  "Memory snapshot shows 'No memories yet' for zero-memory familiars in the ready state",
);

assert.match(
  card,
  /stats\.memoryCount === 1 \? "y" : "ies"/,
  "Memory count pluralization is correct",
);

assert.match(
  card,
  /stats\.latestMemory\.title/,
  "Latest memory title is rendered",
);

console.log("agent-roster-card: all assertions passed");
```

- [ ] **Step 3: Run both tests**

Run: `node --import tsx --test src/components/agents-view.test.ts src/components/agent-roster-card.test.ts 2>&1 | tail -15`
Expected: both print their "all assertions passed" line; node test runner reports 0 fails.

- [ ] **Step 4: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/agents-view.test.ts src/components/agent-roster-card.test.ts
git commit -S -m "$(cat <<'EOF'
test(agents): cover AgentsView wiring and AgentRosterCard shape

String-grep assertions matching the repo's existing test convention.
Covers localStorage selection persistence, memory fetch cadence,
detail / roster / global-memory branches, empty state, and the
per-card identity / status / activity / memory-snapshot rendering.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
git log -1 --show-signature 2>&1 | head -5
```

Confirm signature.

---

## Task 8: Add `"agents"` to the sidebar and shift keyboard shortcuts

**Files:**
- Modify: `src/components/sidebar-minimal.tsx`

- [ ] **Step 1: Add `"agents"` to the `FolderMode` union**

Replace the `FolderMode` type (~lines 21-31) with:

```tsx
export type FolderMode =
  | "agents"
  | "home"
  | "chat"
  | "board"
  | "calendar"
  | "inbox"
  | "terminal"
  | "browser"
  | "github"
  | "library"
  | "capabilities";
```

- [ ] **Step 2: Update the `FOLDER_MODES` array**

Replace the entire `FOLDER_MODES` const (~lines 58-80) with:

```tsx
const FOLDER_MODES: Array<{
  id: FolderMode;
  label: string;
  iconName: Parameters<typeof Icon>[0]["name"];
  badge?: (props: SidebarMinimalProps) => string | undefined;
  group: "work" | "knowledge" | "tools" | "addons";
  kbd?: string;
}> = [
  // Work
  { id: "agents", label: "Agents", iconName: "ph:users-three", group: "work", kbd: "⌘1" },
  { id: "home", label: "Home", iconName: "ph:house-bold", group: "work", kbd: "⌘2" },
  { id: "chat", label: "Chat", iconName: "ph:chats", group: "work", kbd: "⌘3" },
  { id: "board", label: "Board", iconName: "ph:kanban", group: "work", kbd: "⌘4" },
  { id: "calendar", label: "Calendar", iconName: "ph:calendar-blank", group: "work", kbd: "⌘5" },
  { id: "inbox", label: "Inbox", iconName: "ph:tray", group: "work", kbd: "⌘6" },
  // Knowledge
  { id: "library", label: "Library", iconName: "ph:books", group: "knowledge", kbd: "⌘7" },
  // Tools
  { id: "browser", label: "Browser", iconName: "ph:globe", group: "tools", kbd: "⌘8" },
  { id: "terminal", label: "Terminal", iconName: "ph:terminal-window", group: "tools" },
  { id: "capabilities", label: "Capabilities", iconName: "ph:lightning-bold", group: "tools" },
  // Add-ons (gated)
  { id: "github", label: "GitHub", iconName: "ph:github-logo", group: "addons" },
];
```

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: PASS. Workspace already accepts arbitrary string in `onModeChange` (it does `setMode(m as WorkspaceMode)` at line ~843), so the new `"agents"` id flows through unchanged.

- [ ] **Step 4: Commit**

```bash
git add src/components/sidebar-minimal.tsx
git commit -S -m "$(cat <<'EOF'
feat(sidebar): add Agents folder; shift Work shortcuts ⌘1..⌘8

Agents takes the top slot in Work and ⌘1. Home/Chat/Board/Calendar/
Inbox each shift down one. Library moves to ⌘7, Browser to ⌘8.
Terminal stays in the sidebar but loses its shortcut hint (still
reachable via /terminal palette command).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
git log -1 --show-signature 2>&1 | head -5
```

Confirm signature.

---

## Task 9: Wire the Agents surface into `workspace.tsx`

**Files:**
- Modify: `src/components/workspace.tsx`

Four edits: import `AgentsView`, add to `SURFACE_LABELS`, change default mode, render the branch, update `SURFACE_ORDER` for keyboard shortcuts, hide the companion rail.

- [ ] **Step 1: Import `AgentsView`**

Add to the import block at the top (alphabetised near the other `agents-*` import):

```tsx
import { AgentsView } from "@/components/agents-view";
```

- [ ] **Step 2: Add `"agents"` to `SURFACE_LABELS`**

Locate `SURFACE_LABELS` (~line 49) and replace it with:

```tsx
const SURFACE_LABELS: Record<WorkspaceMode, string> = {
  agents: "Agents",
  home: "Home",
  chat: "Chat",
  board: "Board",
  calendar: "Calendar",
  inbox: "Inbox",
  library: "Library",
  browser: "Browser",
  terminal: "Terminal",
  github: "GitHub",
  capabilities: "Capabilities",
};
```

- [ ] **Step 3: Change the default mode**

Find this line (~line 75):

```tsx
const [mode, setMode] = useState<WorkspaceMode>("home");
```

Replace with:

```tsx
const [mode, setMode] = useState<WorkspaceMode>("agents");
```

- [ ] **Step 4: Update `SURFACE_ORDER` in the keyboard handler**

Find the `SURFACE_ORDER` array inside the `useEffect` that handles `⌘1..⌘8` (~line 549) and replace it with:

```tsx
const SURFACE_ORDER: WorkspaceMode[] = [
  "agents", "home", "chat", "board", "calendar", "inbox", "library", "browser",
];
```

- [ ] **Step 5: Render the `"agents"` branch in the detail body**

Find the detail render JSX (the long `mode === "home" ? ... : mode === "chat" ? ...` chain, around lines 868-995). Insert the agents branch as the FIRST condition (before the `home` branch), so the resulting prefix reads:

```tsx
const detail = (
  <div key={mode} className="cave-mode-fade h-full flex flex-col">
    {mode === "agents" ? (
      <AgentsView
        familiars={familiars}
        sessions={sessions}
        daemonRunning={daemonRunning}
        responseNeeded={responseNeeded}
        onStartChat={(familiarId) => startAgentChat(familiarId)}
        onOpenSession={(sessionId, familiarId) => openAgentSession(sessionId, familiarId)}
        onOpenMemoryFile={(path) => {
          window.location.hash = `memory:${encodeURIComponent(path)}`;
        }}
        onOpenOnboarding={openOnboarding}
      />
    ) : mode === "home" ? (
```

(Leave the existing `home` branch and everything after it untouched.)

- [ ] **Step 6: Hide the companion rail on Agents**

Find the `agent={...}` prop on the `<Shell ...>` element (~line 1035). Replace this line:

```tsx
mode === "browser" ? undefined : (
```

with:

```tsx
mode === "browser" || mode === "agents" ? undefined : (
```

- [ ] **Step 7: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 8: Smoke-build**

Run: `pnpm build 2>&1 | tail -20`
Expected: build completes (retry on Turbopack flake if needed).

- [ ] **Step 9: Commit**

```bash
git add src/components/workspace.tsx
git commit -S -m "$(cat <<'EOF'
feat(workspace): land Agents as default landing surface

Mounts AgentsView for mode === "agents"; sets it as the initial mode
for fresh sessions (returning users keep their last surface via
getLastSurface). Prepends "agents" to SURFACE_ORDER so ⌘1 selects
Agents and ⌘2..⌘8 shift accordingly. Hides the companion rail on
Agents — full-width surface, parity with Browser.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
git log -1 --show-signature 2>&1 | head -5
```

Confirm signature.

---

## Task 10: Workspace landing test

**Files:**
- Create: `src/components/workspace-agents-landing.test.ts`

- [ ] **Step 1: Create the test**

```ts
// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const workspace = readFileSync(new URL("./workspace.tsx", import.meta.url), "utf8");
const sidebar = readFileSync(new URL("./sidebar-minimal.tsx", import.meta.url), "utf8");
const workspaceMode = readFileSync(
  new URL("../lib/workspace-mode.ts", import.meta.url),
  "utf8",
);

assert.match(
  workspaceMode,
  /\|\s*"agents"/,
  "WorkspaceMode union must include \"agents\"",
);

assert.match(
  workspace,
  /useState<WorkspaceMode>\("agents"\)/,
  "Default workspace mode must be \"agents\" (replaces home as landing tab)",
);

assert.match(
  workspace,
  /import \{ AgentsView \} from "@\/components\/agents-view"/,
  "workspace.tsx imports AgentsView",
);

assert.match(
  workspace,
  /mode === "agents" \? \(\s*<AgentsView/,
  "workspace.tsx renders AgentsView when mode === \"agents\"",
);

assert.match(
  workspace,
  /mode === "browser" \|\| mode === "agents" \? undefined/,
  "Companion rail is hidden on Agents (and Browser, as before)",
);

assert.match(
  workspace,
  /SURFACE_ORDER: WorkspaceMode\[\] = \[\s*"agents", "home", "chat", "board", "calendar", "inbox", "library", "browser",/,
  "SURFACE_ORDER prepends agents so ⌘1 selects Agents",
);

assert.match(
  workspace,
  /agents: "Agents"/,
  "SURFACE_LABELS has an Agents entry",
);

assert.match(
  sidebar,
  /\{ id: "agents", label: "Agents", iconName: "ph:users-three", group: "work", kbd: "⌘1" \}/,
  "Sidebar FOLDER_MODES lists Agents first in Work with ⌘1",
);

assert.match(
  sidebar,
  /\{ id: "home", label: "Home", iconName: "ph:house-bold", group: "work", kbd: "⌘2" \}/,
  "Sidebar Home shifted to ⌘2",
);

assert.match(
  sidebar,
  /\{ id: "browser", label: "Browser", iconName: "ph:globe", group: "tools", kbd: "⌘8" \}/,
  "Sidebar Browser shifted to ⌘8",
);

assert.match(
  sidebar,
  /\{ id: "terminal", label: "Terminal", iconName: "ph:terminal-window", group: "tools" \}/,
  "Sidebar Terminal kept but without shortcut hint",
);

console.log("workspace-agents-landing: all assertions passed");
```

- [ ] **Step 2: Run the test**

Run: `node --import tsx --test src/components/workspace-agents-landing.test.ts 2>&1 | tail -10`
Expected: PASS — "workspace-agents-landing: all assertions passed".

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/components/workspace-agents-landing.test.ts
git commit -S -m "$(cat <<'EOF'
test(workspace): assert Agents landing, mounting, and shortcut shift

Pins the wiring: WorkspaceMode includes "agents", workspace defaults
to it, the surface mounts AgentsView, the companion rail is hidden,
and SURFACE_ORDER + sidebar shortcuts agree on the new ⌘1..⌘8 layout.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
git log -1 --show-signature 2>&1 | head -5
```

Confirm signature.

---

## Task 11: Manual UI verification

The verification-before-completion skill requires running the feature in a browser before declaring done.

- [ ] **Step 1: Start the dev server**

Run: `pnpm dev`
Expected: Next.js dev server boots at http://localhost:3000. Leave running.

- [ ] **Step 2: Open the app and confirm first-run lands on Agents**

Open http://localhost:3000 in a browser. Clear localStorage in DevTools (Application → Storage → Clear site data) to simulate a fresh session, then reload.

Verify:
- The default surface is **Agents** (top-bar surface label, sidebar shows Agents row active with ⌘1).
- Sidebar Work group order is Agents · Home · Chat · Board · Calendar · Inbox with ⌘1..⌘6.
- Knowledge group shows Library with ⌘7.
- Tools group shows Browser (⌘8), Terminal (no shortcut), Capabilities (no shortcut).
- The companion rail on the right is hidden.

- [ ] **Step 3: Empty state**

If no familiars are present, the Agents page should show the empty-state card with the "Set up your first familiar" button. Click it — onboarding overlay should open.

- [ ] **Step 4: Roster cards**

With at least one familiar present:
- Each card shows glyph + display name + role/harness sub-label.
- Status row shows daemon online/offline dot. If `responseNeeded` is set anywhere in the app, the relevant card shows the chip.
- Activity line reads "Last session …" + " · N this week" (or "No sessions yet").
- Memory snapshot shows count + last write age + truncated latest-memory title (or "No memories yet" / "Memory unavailable").

- [ ] **Step 5: Drill-in**

Click a card. Expect:
- Roster collapses; thin avatar rail appears on the left; detail panel on the right.
- Header shows the selected familiar's glyph, name, role + Start chat / Close buttons.
- Memory tab is default; AgentsMemoryView renders with the familiar-locked chip (no dropdown) and shows the familiar's coven-memory entries.
- Files tab shows the global file list + the "Note: /api/memory is global today…" footnote.
- Sessions tab shows the familiar's sessions (or empty-state card if none).
- Clicking another familiar in the left rail switches the detail without going back to the grid.
- "Close" button returns to the roster grid.
- Reload page → boots straight back into the detail view for that familiar.

- [ ] **Step 6: Global memory overlay**

Click "Memory across all agents" in the header:
- Modal-style overlay opens with backdrop, dimmed background.
- AgentsMemoryView renders in graph mode by default (3D constellation).
- Esc key closes the overlay; backdrop click closes it.
- After close, you're back exactly where you were (roster OR the same detail view).

- [ ] **Step 7: Keyboard shortcuts**

- `⌘1` → Agents
- `⌘2` → Home
- `⌘3` → Chat
- `⌘4` → Board
- `⌘5` → Calendar
- `⌘6` → Inbox
- `⌘7` → Library
- `⌘8` → Browser
- Switching to Browser → companion rail still hidden (existing behavior).
- Switching to any other surface → companion rail returns.

- [ ] **Step 8: Daemon-offline banner**

If the daemon is stopped (`pnpm dev` runs Next only; daemon is separate), confirm the daemon-offline banner renders ABOVE the Agents header (not duplicated inside the page).

- [ ] **Step 9: Returning-user behavior**

In the browser, switch to Board (⌘4). Reload the page (don't clear storage). Expect to land back on Agents (default for new mode state) UNLESS the workspace previously persisted a lastSurface via `setLastSurface(activeId, mode)` — this is per-familiar, so behavior is "first ever load = Agents; otherwise resume". This is by design per the spec.

- [ ] **Step 10: Record outcomes**

Run: `git status`

If everything above passed, no further commits are needed (the verification itself is a pure observation step). If any UI bug surfaced, fix it as an incremental commit and re-run Step 8 of the affected earlier task.

- [ ] **Step 11: Run the test suite one final time**

Run:
```bash
node --import tsx --test \
  src/components/agents-view-stats.test.ts \
  src/components/agents-view.test.ts \
  src/components/agent-roster-card.test.ts \
  src/components/workspace-agents-landing.test.ts 2>&1 | tail -20
```
Expected: all four print their "all assertions passed" lines and the node test summary shows 0 failures.

- [ ] **Step 12: Final typecheck + build**

```bash
pnpm typecheck && pnpm build 2>&1 | tail -10
```
Expected: typecheck PASS, build completes.

- [ ] **Step 13: Sanity-check signed-commit chain on the branch**

```bash
git log origin/$(git rev-parse --abbrev-ref HEAD)..HEAD --pretty='%H %G?' | awk '$2 != "G" {print "UNSIGNED:", $0}'
```
Expected: no output (every commit on the branch is signed). If anything prints, STOP and fix.

---

## Final notes

- **Open questions from the spec** (icon choice, detail rail filter, overlay default mode) were resolved in the plan: `ph:users-three` for the sidebar / header icon, the rail shows all familiars (not filtered to active-only), overlay defaults to graph mode. Revisit during the manual verification pass if any feel wrong.
- **`/api/memory` is global, not familiar-scoped.** The Files tab annotates this explicitly. A follow-up to add `?familiarId=` filtering is out of scope.
- **No SSE / live memory updates.** 30s poll + manual Refresh button.
- **No edit/delete of memory.** Read-only surface.
