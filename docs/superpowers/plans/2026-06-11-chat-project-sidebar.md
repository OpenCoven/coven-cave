# Chat Project Sidebar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a collapsible left sidebar to the chats list page that shows projects with their sessions and acts as a scope filter for the main list.

**Architecture:** A pure selection-helper module (`chat-project-selection.ts`, unit-tested) + a presentational `ChatProjectSidebar` component, integrated into `ChatList` which owns the persisted state (localStorage, hydrated post-mount to avoid SSR mismatch). Builds on the merged grouping lib `src/lib/chat-projects.ts` (PR #368). Spec: `docs/superpowers/specs/2026-06-11-chat-project-sidebar-design.md`.

**Tech Stack:** Next.js (App Router), React 19, Tailwind + CSS custom-property tokens, Phosphor icons via `@/lib/icon` (ICON_NAMES whitelist — all icons below verified registered), tests via `node --experimental-strip-types`.

---

## Ground rules for this repo

- **Work in a worktree:** `.worktrees/chat-project-sidebar/`. Nine concurrent Claude sessions are live; never touch the primary checkout.
- **Every commit must be signed:** always `git commit -S`; verify with `git log -1 --show-signature`; before any push run the unsigned check (Task 5).
- Use `git -C <path>` / `pnpm --dir <path>`, absolute paths.
- Desktop only (`lg+`); below 1024px the page must be byte-for-byte behaviorally unchanged.

---

### Task 0: Worktree setup

**Files:** none

- [ ] **Step 1: Create the worktree**

```bash
git -C /Users/buns/Documents/GitHub/OpenCoven/coven-cave fetch origin main
git -C /Users/buns/Documents/GitHub/OpenCoven/coven-cave worktree add -b chat-project-sidebar .worktrees/chat-project-sidebar origin/main
pnpm --dir /Users/buns/Documents/GitHub/OpenCoven/coven-cave/.worktrees/chat-project-sidebar install
```

Expected: worktree created, install ~10s.

- [ ] **Step 2: Verify signing config**

```bash
git -C .worktrees/chat-project-sidebar config --get user.signingkey
git -C .worktrees/chat-project-sidebar config --get gpg.format
```

Expected: both non-empty (ssh). If empty, STOP and surface to the user.

---

### Task 1: Selection helpers — `chat-project-selection.ts` (TDD)

**Files:**
- Create: `src/lib/chat-project-selection.ts`
- Test: `src/lib/chat-project-selection.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/chat-project-selection.test.ts` (repo convention: `// @ts-nocheck`, `node:assert/strict`, top-level asserts, `.ts` import suffix):

```ts
// @ts-nocheck
import assert from "node:assert/strict";
import {
  selectionKey,
  applyProjectScope,
  normalizeSelection,
  readPersisted,
  PROJECT_SIDEBAR_KEYS,
} from "./chat-project-selection.ts";

const group = (projectRoot, n = 1) => ({
  projectRoot,
  sessions: Array.from({ length: n }, (_, i) => ({ id: `${projectRoot ?? "none"}-${i}` })),
  defaultFamiliarId: null,
  updatedAt: "2026-06-11T00:00:00Z",
});

// selectionKey: null root maps to the "none" sentinel
assert.equal(selectionKey("/Users/x/repos/coven-cave"), "/Users/x/repos/coven-cave");
assert.equal(selectionKey(null), "none");

// applyProjectScope: "all" passes groups through untouched (same reference)
const groups = [group("/a"), group("/b", 2), group(null)];
assert.equal(applyProjectScope(groups, "all"), groups);

// specific root → single matching group
assert.deepEqual(applyProjectScope(groups, "/b").map((g) => g.projectRoot), ["/b"]);

// "none" → the null-root group
assert.deepEqual(applyProjectScope(groups, "none").map((g) => g.projectRoot), [null]);

// missing root → empty
assert.deepEqual(applyProjectScope(groups, "/gone"), []);

// normalizeSelection: keeps live selections, falls back to "all" for stale ones
assert.equal(normalizeSelection("all", groups), "all");
assert.equal(normalizeSelection("/a", groups), "/a");
assert.equal(normalizeSelection("none", groups), "none");
assert.equal(normalizeSelection("/gone", groups), "all");
assert.equal(normalizeSelection("none", [group("/a")]), "all");

// readPersisted: no window in node → fallback (SSR-safe)
assert.equal(readPersisted("cave:test:key", "fallback"), "fallback");
assert.deepEqual(readPersisted("cave:test:key", []), []);

// storage keys are stable contract values
assert.equal(PROJECT_SIDEBAR_KEYS.open, "cave:chat:project-sidebar-open");
assert.equal(PROJECT_SIDEBAR_KEYS.expanded, "cave:chat:project-sidebar-expanded");
assert.equal(PROJECT_SIDEBAR_KEYS.selected, "cave:chat:project-selected");

console.log("chat-project-selection tests passed");
```

- [ ] **Step 2: Run test to verify it fails**

Run from the worktree root: `node --experimental-strip-types src/lib/chat-project-selection.test.ts`
Expected: FAIL — `Cannot find module './chat-project-selection.ts'`

- [ ] **Step 3: Write the implementation**

Create `src/lib/chat-project-selection.ts`:

```ts
import type { ChatProjectGroup } from "@/lib/chat-projects";

/** "all" = no scope, "none" = the null-projectRoot group, otherwise a projectRoot path.
 *  Roots are absolute paths, so the sentinels can't collide with real values. */
export type ProjectSelection = "all" | "none" | string;

export const PROJECT_SIDEBAR_KEYS = {
  open: "cave:chat:project-sidebar-open",
  expanded: "cave:chat:project-sidebar-expanded",
  selected: "cave:chat:project-selected",
} as const;

export function selectionKey(projectRoot: string | null): string {
  return projectRoot === null ? "none" : projectRoot;
}

/** "all" → groups unchanged (same reference, lets memoized consumers bail);
 *  otherwise the single matching group, or [] when the selection is stale. */
export function applyProjectScope(
  groups: ChatProjectGroup[],
  selection: ProjectSelection,
): ChatProjectGroup[] {
  if (selection === "all") return groups;
  const match = groups.find((g) => selectionKey(g.projectRoot) === selection);
  return match ? [match] : [];
}

/** Falls back to "all" when the selected project no longer exists
 *  (sessions archived, familiar switched). */
export function normalizeSelection(
  selection: ProjectSelection,
  groups: ChatProjectGroup[],
): ProjectSelection {
  if (selection === "all") return "all";
  return groups.some((g) => selectionKey(g.projectRoot) === selection) ? selection : "all";
}

/** localStorage JSON read that survives SSR (no window) and corrupt values. */
export function readPersisted<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --experimental-strip-types src/lib/chat-project-selection.test.ts`
Expected: `chat-project-selection tests passed`

- [ ] **Step 5: Commit (signed)**

```bash
git -C .worktrees/chat-project-sidebar add src/lib/chat-project-selection.ts src/lib/chat-project-selection.test.ts
git -C .worktrees/chat-project-sidebar commit -S -m "$(cat <<'EOF'
feat(chat): project selection helpers for the chats sidebar

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
git -C .worktrees/chat-project-sidebar log -1 --show-signature
```

Expected: good signature.

---

### Task 2: `chatProjectName` in `chat-projects.ts` (TDD)

**Files:**
- Modify: `src/lib/chat-projects.ts` (append one export)
- Modify: `src/lib/chat-projects.test.ts` (append asserts)

The sidebar needs a display name per root. `chat-list.tsx` has a private `repoName()` (lines 42–46) — don't touch it; add the shared variant to the grouping lib where it belongs.

- [ ] **Step 1: Append the failing asserts**

At the end of `src/lib/chat-projects.test.ts` (before any final `console.log` if present; match the file's existing assert style — read it first):

```ts
assert.equal(chatProjectName("/Users/x/repos/coven-cave"), "coven-cave");
assert.equal(chatProjectName("C:\\repos\\open-meow"), "open-meow");
assert.equal(chatProjectName("/trailing/slash/"), "slash");
assert.equal(chatProjectName(null), "No project");
assert.equal(chatProjectName(""), "No project");
```

Add `chatProjectName` to the test's import from `./chat-projects.ts`.

- [ ] **Step 2: Run to verify failure**

Run: `node --experimental-strip-types src/lib/chat-projects.test.ts`
Expected: FAIL — `chatProjectName` is not exported.

- [ ] **Step 3: Implement**

Append to `src/lib/chat-projects.ts`:

```ts
/** Display name for a project group — last path segment, or "No project"
 *  for the null/unscoped group. Mirrors chat-list's local repoName(). */
export function chatProjectName(projectRoot: string | null): string {
  if (!projectRoot) return "No project";
  const parts = projectRoot.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts[parts.length - 1] ?? projectRoot;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `node --experimental-strip-types src/lib/chat-projects.test.ts`
Expected: PASS (existing asserts + new ones).

- [ ] **Step 5: Commit (signed)**

```bash
git -C .worktrees/chat-project-sidebar add src/lib/chat-projects.ts src/lib/chat-projects.test.ts
git -C .worktrees/chat-project-sidebar commit -S -m "$(cat <<'EOF'
feat(chat): chatProjectName display helper on the project grouping lib

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
git -C .worktrees/chat-project-sidebar log -1 --show-signature
```

---

### Task 3: The `ChatProjectSidebar` component

**Files:**
- Create: `src/components/chat-project-sidebar.tsx`

Presentational only — all state lives in ChatList. Valid-HTML note: rows that contain multiple actions are a flex `<div>` with sibling `<button>`s (caret / main / plus), never nested buttons.

- [ ] **Step 1: Write the component**

Create `src/components/chat-project-sidebar.tsx`:

```tsx
"use client";

import type { SessionRow } from "@/lib/types";
import { chatProjectName, type ChatProjectGroup } from "@/lib/chat-projects";
import { selectionKey, type ProjectSelection } from "@/lib/chat-project-selection";
import { stripLeadingTrailingEmoji } from "@/lib/cave-chat-titles";
import { Icon } from "@/lib/icon";

type Props = {
  groups: ChatProjectGroup[];
  selection: ProjectSelection;
  expandedKeys: string[];
  open: boolean;
  activeSessionId?: string | null;
  onSetOpen: (open: boolean) => void;
  onSelect: (selection: ProjectSelection) => void;
  onToggleExpanded: (key: string) => void;
  onOpenSession: (session: SessionRow) => void;
  onNewChat: (projectRoot: string | null) => void;
};

function statusDotClass(status: string): string {
  if (status === "running") return "animate-pulse bg-[var(--color-success)]";
  if (status === "failed") return "bg-[var(--color-danger)]";
  if (status === "queued") return "bg-[var(--color-warning)]";
  return "bg-[var(--text-muted)]";
}

function AccentBar({ tall }: { tall?: boolean }) {
  return (
    <span
      aria-hidden
      className={`absolute left-0 top-1/2 w-[2px] -translate-y-1/2 rounded-r-full bg-[var(--accent-presence)] ${tall ? "h-5" : "h-4"}`}
    />
  );
}

export function ChatProjectSidebar({
  groups,
  selection,
  expandedKeys,
  open,
  activeSessionId,
  onSetOpen,
  onSelect,
  onToggleExpanded,
  onOpenSession,
  onNewChat,
}: Props) {
  if (!open) {
    return (
      <aside className="hidden shrink-0 border-r border-[var(--border-hairline)] lg:flex">
        <button
          type="button"
          onClick={() => onSetOpen(true)}
          title="Show projects"
          aria-label="Show projects"
          aria-expanded={false}
          className="focus-ring flex w-7 flex-col items-center pt-3 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-raised)]/50 hover:text-[var(--text-primary)]"
        >
          <Icon name="ph:sidebar-simple" width={14} aria-hidden />
        </button>
      </aside>
    );
  }

  return (
    <aside className="hidden w-[210px] shrink-0 flex-col border-r border-[var(--border-hairline)] lg:flex">
      <div className="flex shrink-0 items-center justify-between px-3 py-2.5">
        <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--text-muted)]">
          Projects
        </span>
        <button
          type="button"
          onClick={() => onSetOpen(false)}
          title="Hide projects"
          aria-label="Hide projects"
          aria-expanded
          className="focus-ring grid h-5 w-5 place-items-center rounded text-[var(--text-muted)] transition-colors hover:text-[var(--text-primary)]"
        >
          <Icon name="ph:sidebar-simple-fill" width={13} aria-hidden />
        </button>
      </div>

      <nav aria-label="Projects" className="min-h-0 flex-1 overflow-y-auto pb-2">
        <button
          type="button"
          onClick={() => onSelect("all")}
          aria-current={selection === "all" ? "true" : undefined}
          className={[
            "relative flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] transition-colors",
            selection === "all"
              ? "bg-[var(--bg-raised)] text-[var(--text-primary)]"
              : "text-[var(--text-secondary)] hover:bg-[var(--bg-raised)]/50 hover:text-[var(--text-primary)]",
          ].join(" ")}
        >
          {selection === "all" ? <AccentBar tall /> : null}
          <Icon name="ph:chats" width={13} aria-hidden className="shrink-0" />
          <span className="min-w-0 flex-1 truncate">All chats</span>
        </button>

        {groups.map((group) => {
          const key = selectionKey(group.projectRoot);
          const expanded = expandedKeys.includes(key);
          const isSelected = selection === key;
          const label = chatProjectName(group.projectRoot);
          return (
            <div key={key}>
              <div
                className={[
                  "group relative flex w-full items-center gap-1 pr-2 transition-colors",
                  isSelected ? "bg-[var(--bg-raised)]" : "hover:bg-[var(--bg-raised)]/50",
                ].join(" ")}
              >
                {isSelected ? <AccentBar tall /> : null}
                <button
                  type="button"
                  onClick={() => onToggleExpanded(key)}
                  aria-expanded={expanded}
                  aria-label={`${expanded ? "Collapse" : "Expand"} ${label} sessions`}
                  className="focus-ring ml-1 grid h-6 w-4 shrink-0 place-items-center rounded text-[var(--text-muted)] transition-colors hover:text-[var(--text-primary)]"
                >
                  <Icon name={expanded ? "ph:caret-down" : "ph:caret-right"} width={10} aria-hidden />
                </button>
                <button
                  type="button"
                  onClick={() => onSelect(key)}
                  aria-current={isSelected ? "true" : undefined}
                  className={[
                    "flex min-w-0 flex-1 items-center gap-1.5 py-1.5 text-left text-[12px] transition-colors",
                    isSelected
                      ? "text-[var(--text-primary)]"
                      : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]",
                  ].join(" ")}
                >
                  <Icon
                    name={isSelected ? "ph:folder-open" : "ph:folder"}
                    width={13}
                    aria-hidden
                    className="shrink-0 text-[var(--text-muted)]"
                  />
                  <span className="min-w-0 flex-1 truncate">{label}</span>
                  <span className="shrink-0 font-mono text-[10px] text-[var(--text-muted)]">
                    {group.sessions.length}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => onNewChat(group.projectRoot)}
                  title={`New chat in ${label}`}
                  aria-label={`New chat in ${label}`}
                  className="touch-always-visible focus-ring grid h-5 w-5 shrink-0 place-items-center rounded text-[var(--text-muted)] opacity-0 transition-opacity hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)] group-hover:opacity-100"
                >
                  <Icon name="ph:plus" width={11} aria-hidden />
                </button>
              </div>
              {expanded ? (
                <ul>
                  {group.sessions.map((session) => {
                    const isActive = activeSessionId === session.id;
                    return (
                      <li key={session.id}>
                        <button
                          type="button"
                          onClick={() => onOpenSession(session)}
                          aria-current={isActive ? "true" : undefined}
                          className={[
                            "relative flex w-full items-center gap-2 py-1 pl-7 pr-2 text-left text-[11px] transition-colors",
                            isActive
                              ? "bg-[var(--bg-raised)] text-[var(--text-primary)]"
                              : "text-[var(--text-secondary)] hover:bg-[var(--bg-raised)]/50 hover:text-[var(--text-primary)]",
                          ].join(" ")}
                        >
                          {isActive ? <AccentBar /> : null}
                          <span
                            aria-hidden
                            className={`h-1.5 w-1.5 shrink-0 rounded-full ${statusDotClass(session.status)}`}
                          />
                          <span className="min-w-0 flex-1 truncate">
                            {stripLeadingTrailingEmoji(session.title || "(untitled chat)")}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </div>
          );
        })}
      </nav>
    </aside>
  );
}
```

All icons used (`ph:sidebar-simple`, `ph:sidebar-simple-fill`, `ph:chats`, `ph:caret-down`, `ph:caret-right`, `ph:folder`, `ph:folder-open`, `ph:plus`) are verified present in ICON_NAMES (`src/lib/icon.tsx`).

- [ ] **Step 2: Typecheck**

Run: `pnpm --dir .worktrees/chat-project-sidebar typecheck`
Expected: PASS

- [ ] **Step 3: Commit (signed)**

```bash
git -C .worktrees/chat-project-sidebar add src/components/chat-project-sidebar.tsx
git -C .worktrees/chat-project-sidebar commit -S -m "$(cat <<'EOF'
feat(chat): ChatProjectSidebar — collapsible projects/sessions tree

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
git -C .worktrees/chat-project-sidebar log -1 --show-signature
```

---

### Task 4: ChatList integration

**Files:**
- Modify: `src/components/chat-list.tsx` (imports ~1–14, state ~63–68, effects after ~92, derived data ~120–122, render wrapper ~147–148, empty state ~336–347, group map ~349–353, closing tags ~476–478)

Line numbers from main at the branch base — locate by the quoted anchors.

- [ ] **Step 1: Add imports**

After the existing `chat-projects` import block (lines 11–14):

```tsx
import { ChatProjectSidebar } from "@/components/chat-project-sidebar";
import {
  applyProjectScope,
  normalizeSelection,
  readPersisted,
  PROJECT_SIDEBAR_KEYS,
  type ProjectSelection,
} from "@/lib/chat-project-selection";
```

- [ ] **Step 2: Add state**

After `const [activeId, setActiveId] = useState<string | null>(null);` (line 67):

```tsx
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [expandedKeys, setExpandedKeys] = useState<string[]>([]);
  const [selection, setSelection] = useState<ProjectSelection>("all");
  const [sidebarHydrated, setSidebarHydrated] = useState(false);
```

- [ ] **Step 3: Hydrate + persist effects**

After the Cmd+F `useEffect` (ends line 92):

```tsx
  // Sidebar state loads after mount (not in initializers) so SSR markup and
  // first client render agree; persistence is gated until that load lands.
  useEffect(() => {
    setSidebarOpen(readPersisted<unknown>(PROJECT_SIDEBAR_KEYS.open, true) !== false);
    const storedExpanded = readPersisted<unknown>(PROJECT_SIDEBAR_KEYS.expanded, []);
    setExpandedKeys(
      Array.isArray(storedExpanded)
        ? storedExpanded.filter((k): k is string => typeof k === "string")
        : [],
    );
    const storedSelection = readPersisted<unknown>(PROJECT_SIDEBAR_KEYS.selected, "all");
    setSelection(typeof storedSelection === "string" ? storedSelection : "all");
    setSidebarHydrated(true);
  }, []);
  useEffect(() => {
    if (sidebarHydrated) window.localStorage.setItem(PROJECT_SIDEBAR_KEYS.open, JSON.stringify(sidebarOpen));
  }, [sidebarHydrated, sidebarOpen]);
  useEffect(() => {
    if (sidebarHydrated) window.localStorage.setItem(PROJECT_SIDEBAR_KEYS.expanded, JSON.stringify(expandedKeys));
  }, [sidebarHydrated, expandedKeys]);
  useEffect(() => {
    if (sidebarHydrated) window.localStorage.setItem(PROJECT_SIDEBAR_KEYS.selected, JSON.stringify(selection));
  }, [sidebarHydrated, selection]);
```

- [ ] **Step 4: Derived data**

After the `grouped` memo (lines 120–122):

```tsx
  // Sidebar tree builds from familiar-scoped sessions BEFORE search/unreads,
  // so it stays stable while typing. The persisted selection is normalized
  // every render: stale projects degrade to "all" silently.
  const sidebarGroups = useMemo(() => deriveChatProjectGroups(mine), [mine]);
  const effectiveSelection = useMemo(
    () => normalizeSelection(selection, sidebarGroups),
    [selection, sidebarGroups],
  );
  const scopedGroups = useMemo(
    () => applyProjectScope(grouped, effectiveSelection),
    [grouped, effectiveSelection],
  );
  const visibleRows = useMemo(
    () => scopedGroups.reduce((n, g) => n + g.sessions.length, 0),
    [scopedGroups],
  );
```

- [ ] **Step 5: Wrap the render in a flex row with the sidebar**

Replace the opening of the return (lines 147–148):

```tsx
  return (
    <section className="chat-list-surface flex h-full flex-col bg-[var(--bg-base)] text-[var(--text-primary)]">
```

with:

```tsx
  return (
    <div className="flex h-full min-w-0">
      <ChatProjectSidebar
        groups={sidebarGroups}
        selection={effectiveSelection}
        expandedKeys={expandedKeys}
        open={sidebarOpen}
        activeSessionId={activeId}
        onSetOpen={setSidebarOpen}
        onSelect={setSelection}
        onToggleExpanded={(key) =>
          setExpandedKeys((prev) =>
            prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
          )
        }
        onOpenSession={(s) => {
          setActiveId(s.id);
          onOpen(s.id, s.familiarId);
        }}
        onNewChat={(root) => {
          const group = sidebarGroups.find((g) => g.projectRoot === root);
          onNewChat(root ?? undefined, group?.defaultFamiliarId ?? fallbackFamiliarId);
        }}
      />
      <section className="chat-list-surface flex h-full min-w-0 flex-1 flex-col bg-[var(--bg-base)] text-[var(--text-primary)]">
```

And at the end of the component, replace the closing (lines 476–478):

```tsx
    </section>
  );
}
```

with:

```tsx
      </section>
    </div>
  );
}
```

(Re-indenting the section's children is optional — Prettier-style consistency is fine but do not change any other markup while doing it. Smallest-diff option: leave inner indentation as-is.)

- [ ] **Step 6: Scope the list rendering**

Replace `{grouped.map(({ projectRoot, sessions: rows, defaultFamiliarId }) => (` (line 350) with:

```tsx
            {scopedGroups.map(({ projectRoot, sessions: rows, defaultFamiliarId }) => (
```

Replace the header condition `{projectRoot !== null && (` (line 353) with:

```tsx
                {projectRoot !== null && effectiveSelection === "all" && (
```

- [ ] **Step 7: Empty-state covers scope filtering**

Replace the `filtered.length === 0` branch (lines 336–347):

```tsx
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
            <Icon name="ph:magnifying-glass" width={20} className="text-[var(--text-muted)]" />
            <p className="text-sm text-[var(--text-muted)]">No results for "{search}"</p>
            <button
              type="button"
              onClick={() => { setSearch(""); setUnreadsOnly(false); }}
              className="text-[12px] text-[var(--accent-presence)] hover:underline"
            >
              Clear filters
            </button>
          </div>
        ) : (
```

with:

```tsx
        ) : visibleRows === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
            <Icon name="ph:magnifying-glass" width={20} className="text-[var(--text-muted)]" />
            <p className="text-sm text-[var(--text-muted)]">
              {search.trim() ? `No results for "${search}"` : "No chats match the current filters"}
            </p>
            <button
              type="button"
              onClick={() => { setSearch(""); setUnreadsOnly(false); setSelection("all"); }}
              className="text-[12px] text-[var(--accent-presence)] hover:underline"
            >
              Clear filters
            </button>
          </div>
        ) : (
```

- [ ] **Step 8: Typecheck + targeted tests**

```bash
pnpm --dir .worktrees/chat-project-sidebar typecheck
node --experimental-strip-types src/components/chat-list-delete.test.ts
node --experimental-strip-types src/components/chat-list-mobile-command-center.test.ts
node --experimental-strip-types src/lib/chat-projects.test.ts
```

Expected: all PASS. (If `chat-list-delete.test.ts` doesn't exist at the branch base, note and skip.)

- [ ] **Step 9: Commit (signed)**

```bash
git -C .worktrees/chat-project-sidebar add src/components/chat-list.tsx
git -C .worktrees/chat-project-sidebar commit -S -m "$(cat <<'EOF'
feat(chat): wire project sidebar into ChatList as a scope filter

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
git -C .worktrees/chat-project-sidebar log -1 --show-signature
```

---

### Task 5: Register tests + full verification

**Files:**
- Modify: `package.json` (`test:app` script)

- [ ] **Step 1: Register the new test**

Append to the end of the `test:app` script string in `package.json`:

```
 && node --experimental-strip-types src/lib/chat-project-selection.test.ts
```

(Only this one — `chat-projects.test.ts` is already registered in `test:api`/`test:app` by PR #368; verify with grep and don't double-register.)

- [ ] **Step 2: Full suites + build**

```bash
pnpm --dir .worktrees/chat-project-sidebar typecheck
pnpm --dir .worktrees/chat-project-sidebar run test:app
pnpm --dir .worktrees/chat-project-sidebar build
```

Expected: typecheck clean; test:app ends with `chat-project-selection tests passed` (after all existing tests); build succeeds.

- [ ] **Step 3: Manual verification (dev server)**

1. Desktop width: sidebar shows "All chats" + projects with counts; selecting a project scopes the main list flat (no inline headers); "All chats" restores grouped view.
2. Expand a project → sessions listed; click one → chat opens; active accent shown.
3. Hover a project → "+" launches a project-scoped new chat (correct familiar).
4. Collapse the sidebar → slim reopen tab; reload → open/expanded/selected states persist.
5. Select a project, archive/switch familiar so it vanishes → silently back to "All chats".
6. Search while a project is selected → composes; clearing filters resets scope.
7. Below 1024px → no sidebar, page identical to before.

- [ ] **Step 4: Commit + unsigned check**

```bash
git -C .worktrees/chat-project-sidebar add package.json
git -C .worktrees/chat-project-sidebar commit -S -m "$(cat <<'EOF'
test(chat): register chat-project-selection tests in test:app

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
git -C .worktrees/chat-project-sidebar log origin/main..HEAD --pretty='%H %G?' | awk '$2 != "G" {print "UNSIGNED:", $0}'
```

Expected: awk prints nothing.
