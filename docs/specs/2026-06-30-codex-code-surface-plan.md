# Codex Code Surface Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recreate the Code page (`mode === "code"`) to comprehensively emulate the OpenAI Codex cloud experience — a project→thread nav sidebar with Pinned + user footer, a single active conversation with "Worked for Xs"/code blocks/inline file-edit cards, and a Codex composer with permission + model chips.

**Architecture:** Restyle existing chat components (no parallel renderer). Three independently-green PRs against protected `main`: PR1 sidebar, PR2 conversation+composer, PR3 file-edit cards. Net-new pure libs get behavioral unit tests; component changes are pinned by existing source-text tests (`@ts-nocheck` + `readFile` + `assert.match`).

**Tech Stack:** Next.js (App Router), React 19, TypeScript, Tailwind (utility classes inline) + `globals.css` for scoped chrome, `lib/icon` Phosphor registry, node-run `*.test.ts` via `scripts/run-tests.mjs`.

**Spec:** `docs/specs/2026-06-30-codex-code-surface-design.md`

**Worktree:** `.worktrees/codex-code-surface` on branch `kitty/codex-code-surface`. All commits signed (`-S`). Each PR: `git push -u origin <branch>` → `gh pr create --base main` → wait 3 required checks → `gh pr merge --squash`.

---

## Conventions for every task

- **Source-text tests** live next to the component (`foo.test.ts`), start with `// @ts-nocheck`, `readFile` the source, and `assert.match(src, /regex/, "why")`. They assert *that the markup/wiring exists*, not runtime behavior.
- **Pure-lib tests** import the module and assert behavior; they must be SSR/Node-safe (guard `window`).
- **Any new `*.test.ts` MUST be appended to `SUITES.app` in `scripts/run-tests.mjs`** or `check:tests-wired` fails the Frontend build check.
- **Icons** must already exist in the `lib/icon` registry (Phosphor `ph:*`); a name absent from the allowlist renders blank. Prefer names already used in the repo (`ph:pencil-simple`, `ph:magnifying-glass`, `ph:clock`, `ph:plugs`, `ph:push-pin`, `ph:push-pin-fill`, `ph:git-pull-request`, `ph:git-branch`, `ph:microphone`, `ph:shield`, `ph:thumbs-up`, `ph:thumbs-down`, `ph:share-network`, `ph:arrow-counter-clockwise`). Verify each with `grep -n "<name>" src/lib/icon.tsx` before use; if missing, register it in `icon.tsx` as its own step.
- Run a single test: `node --experimental-strip-types scripts/run-tests.mjs app 2>&1 | tail -20` runs the whole app suite; to run one file directly: `node --experimental-strip-types src/components/code-view.test.ts`.

---

# PR1 — Codex sidebar

**Branch:** continue on `kitty/codex-code-surface` (spec already committed here). PR1 = this branch's first feature commits; open the PR after Task 6.

## File Structure (PR1)

- Create `src/lib/session-pins.ts` — pure store for pinned session ids (`cave:session-pins:v1`), mirrors `familiar-quick-switch.ts`.
- Create `src/lib/use-session-pins.ts` — `useSessionPins()` hook via `useSyncExternalStore`.
- Create `src/lib/session-pins.test.ts` — behavioral unit test.
- Modify `src/components/code-sidebar.tsx` — nav block, Pinned section, Show-more, thread icons, pin affordance, user footer, nav wiring.
- Modify `src/components/code-view.test.ts` — pin new sidebar wiring (source-text).
- Modify `scripts/run-tests.mjs` — wire `session-pins.test.ts`.
- Modify `src/components/workspace.tsx` — pass `userName`/`plan`/automations-count + nav callbacks into `CodeSidebar` (props added in Task 5).

---

### Task 1: `session-pins` pure store

**Files:**
- Create: `src/lib/session-pins.ts`
- Test: `src/lib/session-pins.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// @ts-nocheck
import assert from "node:assert/strict";

// Fresh in-memory localStorage stub (module reads window.localStorage).
const store = new Map();
globalThis.window = {
  localStorage: {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  },
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => true,
};

const { getPinnedSessionIds, isSessionPinned, toggleSessionPin, subscribeSessionPins } =
  await import("./session-pins.ts");

// starts empty
assert.deepEqual(getPinnedSessionIds(), [], "no pins by default");
assert.equal(isSessionPinned("s1"), false, "unknown id not pinned");

// toggle on / off
let fired = 0;
const unsub = subscribeSessionPins(() => { fired += 1; });
toggleSessionPin("s1");
assert.deepEqual(getPinnedSessionIds(), ["s1"], "pin adds id");
assert.equal(isSessionPinned("s1"), true, "pinned after toggle");
assert.ok(fired >= 1, "subscribers notified on change");

toggleSessionPin("s2");
assert.deepEqual(getPinnedSessionIds(), ["s1", "s2"], "second pin appended in order");

toggleSessionPin("s1");
assert.deepEqual(getPinnedSessionIds(), ["s2"], "toggle removes existing id");
unsub();

console.log("session-pins ok");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd .worktrees/codex-code-surface && node --experimental-strip-types src/lib/session-pins.test.ts`
Expected: FAIL — `Cannot find module './session-pins.ts'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/session-pins.ts
// Cave-local pinned-session state for the Code sidebar's "Pinned" section.
// UI-only, under the `cave:` namespace, no "use client" — Node/SSR safe.
// Mirrors the proven `familiar-quick-switch` store pattern.

const PINS_KEY = "cave:session-pins:v1";

function rawGet(key: string): string | null {
  if (typeof window === "undefined") return null;
  try { return window.localStorage.getItem(key); } catch { return null; }
}
function rawSet(key: string, value: string): void {
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(key, value); } catch { /* quota */ }
}

const listeners = new Set<() => void>();
function notify() { for (const fn of listeners) fn(); }

export function subscribeSessionPins(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function getPinnedSessionIds(): string[] {
  const raw = rawGet(PINS_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch { return []; }
}

export function isSessionPinned(id: string): boolean {
  return getPinnedSessionIds().includes(id);
}

export function setPinnedSessionIds(ids: string[]): void {
  const unique = Array.from(new Set(ids.filter((x) => typeof x === "string" && x.length > 0)));
  rawSet(PINS_KEY, JSON.stringify(unique));
  notify();
}

export function toggleSessionPin(id: string): void {
  const current = getPinnedSessionIds();
  setPinnedSessionIds(current.includes(id) ? current.filter((x) => x !== id) : [...current, id]);
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key === PINS_KEY) notify();
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --experimental-strip-types src/lib/session-pins.test.ts`
Expected: prints `session-pins ok`, exit 0.

- [ ] **Step 5: Wire the test into the runner**

In `scripts/run-tests.mjs`, append to the `SUITES.app` array (near the other `src/lib/*.test.ts` entries):

```js
    "src/lib/session-pins.test.ts",
```

- [ ] **Step 6: Verify wiring guard passes**

Run: `node --experimental-strip-types scripts/run-tests.mjs app 2>&1 | tail -5`
Expected: suite runs including session-pins, exits 0.

- [ ] **Step 7: Commit**

```bash
git add src/lib/session-pins.ts src/lib/session-pins.test.ts scripts/run-tests.mjs
git commit -S -m "feat(code): session-pins store for Codex sidebar Pinned section"
```

---

### Task 2: `useSessionPins` hook

**Files:**
- Create: `src/lib/use-session-pins.ts`

- [ ] **Step 1: Write implementation** (no separate unit test — thin `useSyncExternalStore` wrapper, exercised by the component test in Task 4; mirrors `use-familiar-quick-switch.ts` which also has no standalone test)

```ts
// src/lib/use-session-pins.ts
"use client";

import { useSyncExternalStore } from "react";
import { getPinnedSessionIds, subscribeSessionPins } from "@/lib/session-pins";

const EMPTY: readonly string[] = Object.freeze([]);

/** Subscribe to the pinned-session id list. Re-renders on pin/unpin. */
export function useSessionPins(): string[] {
  return useSyncExternalStore(
    subscribeSessionPins,
    getPinnedSessionIds,
    () => EMPTY as string[],
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep -i "use-session-pins" || echo "clean"`
Expected: `clean`.

- [ ] **Step 3: Commit**

```bash
git add src/lib/use-session-pins.ts
git commit -S -m "feat(code): useSessionPins hook"
```

---

### Task 3: Sidebar PR/branch thread icon + title helper

**Files:**
- Modify: `src/components/code-sidebar.tsx`

This adds a pure helper (in-file) that picks a leading glyph for a thread. Pinning, nav, and footer come in later tasks.

- [ ] **Step 1: Add the source-text assertion to `code-view.test.ts`**

In `src/components/code-view.test.ts`, after the existing `codeSidebar` assertions, add:

```ts
// Codex sidebar: PR/branch threads get a distinct leading glyph.
assert.match(codeSidebar, /ph:git-pull-request|ph:git-branch/, "thread rows show a PR/branch glyph for PR-like titles");
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --experimental-strip-types src/components/code-view.test.ts`
Expected: FAIL — "thread rows show a PR/branch glyph for PR-like titles".

- [ ] **Step 3: Implement the helper + use it**

In `src/components/code-sidebar.tsx`, add near the top-level helpers (after `statusClass`, ~line 28):

```tsx
function threadLeadingIcon(title: string): string | null {
  if (/^\s*resolve\s+pr\b|\bpr\s*#?\d+/i.test(title)) return "ph:git-pull-request";
  if (/\bbranch\b|\bmerge\b|\brebase\b/i.test(title)) return "ph:git-branch";
  return null;
}
```

Then in the thread row (currently the status-dot span at ~line 188), replace the bare dot with a glyph-or-dot:

```tsx
{(() => {
  const glyph = threadLeadingIcon(title);
  return glyph ? (
    <Icon name={glyph} width={12} className="shrink-0 text-[var(--text-muted)]" aria-hidden />
  ) : (
    <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${statusClass(session.status)}`} aria-hidden />
  );
})()}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --experimental-strip-types src/components/code-view.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/code-sidebar.tsx src/components/code-view.test.ts
git commit -S -m "feat(code): PR/branch glyphs on Codex sidebar threads"
```

---

### Task 4: Pinned section + per-thread pin affordance + Show-more

**Files:**
- Modify: `src/components/code-sidebar.tsx`
- Modify: `src/components/code-view.test.ts`

- [ ] **Step 1: Add source-text assertions**

In `code-view.test.ts`, after Task 3's assertion:

```ts
assert.match(codeSidebar, /useSessionPins|toggleSessionPin/, "sidebar reads/writes session pins");
assert.match(codeSidebar, /Pinned/, "sidebar renders a Pinned section header");
assert.match(codeSidebar, /Show more|showAll|THREADS_PREVIEW/, "long thread lists collapse behind Show more");
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --experimental-strip-types src/components/code-view.test.ts`
Expected: FAIL on the first new assertion.

- [ ] **Step 3: Implement**

In `src/components/code-sidebar.tsx`:

(a) Imports — add:
```tsx
import { useSessionPins } from "@/lib/use-session-pins";
import { toggleSessionPin } from "@/lib/session-pins";
```

(b) Inside `CodeSidebar`, after `const projects = ...`:
```tsx
const pinnedIds = useSessionPins();
const [showAllByRoot, setShowAllByRoot] = useState<Set<string>>(() => new Set());
const THREADS_PREVIEW = 5;
const pinnedSessions = useMemo(
  () => pinnedIds
    .map((id) => sessions.find((s) => s.id === id))
    .filter((s): s is SessionRow => Boolean(s)),
  [pinnedIds, sessions],
);
```

(c) Before the Projects `<nav>` list, add a Pinned block (only when pins exist). Render it as its own section at the top of the scroll area:
```tsx
{pinnedSessions.length > 0 ? (
  <section aria-label="Pinned threads" className="border-b border-[var(--border-hairline)] py-1">
    <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">Pinned</div>
    <ul>
      {pinnedSessions.map((session) => {
        const title = sessionRailTitle(session);
        const active = activeSessionId === session.id;
        return (
          <li key={`pin-${session.id}`}>
            <button
              type="button"
              aria-current={active ? "page" : undefined}
              onClick={() => onOpenSession(session)}
              className={`focus-ring flex min-h-[32px] w-full items-center gap-1.5 py-1.5 pl-3 pr-2 text-left text-[12px] ${active ? "bg-[var(--bg-raised)] text-[var(--text-primary)]" : "text-[var(--text-secondary)] hover:bg-[var(--bg-raised)]/50 hover:text-[var(--text-primary)]"}`}
            >
              <Icon name="ph:push-pin-fill" width={11} className="shrink-0 text-[var(--text-muted)]" aria-hidden />
              <span className="min-w-0 flex-1 truncate" title={title}>{title}</span>
            </button>
          </li>
        );
      })}
    </ul>
  </section>
) : null}
```

(d) In the project thread `<ul>`, cap the list and add Show more. Replace `projectSessions.map(...)` with a sliced list:
```tsx
{(showAllByRoot.has(project.root) ? projectSessions : projectSessions.slice(0, THREADS_PREVIEW)).map((session) => {
  // ...existing row JSX unchanged...
})}
{projectSessions.length > THREADS_PREVIEW && !showAllByRoot.has(project.root) ? (
  <li>
    <button
      type="button"
      onClick={() => setShowAllByRoot((cur) => new Set(cur).add(project.root))}
      className="focus-ring w-full py-1.5 pl-8 pr-3 text-left text-[11px] text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
    >
      Show more
    </button>
  </li>
) : null}
```

(e) Add a pin toggle button to each thread row (next to the delete button, in the non-confirming branch ~line 222). Insert before the delete `<button>`:
```tsx
<button
  type="button"
  title={isPinnedRow ? "Unpin thread" : "Pin thread"}
  aria-label={isPinnedRow ? `Unpin ${title}` : `Pin ${title}`}
  onClick={() => toggleSessionPin(session.id)}
  className="touch-always-visible focus-ring grid h-5 w-5 shrink-0 place-items-center rounded text-[var(--text-muted)] opacity-0 transition-opacity hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)] focus-visible:opacity-100 group-hover/code-thread:opacity-100"
>
  <Icon name={isPinnedRow ? "ph:push-pin-fill" : "ph:push-pin"} width={11} aria-hidden />
</button>
```
where `const isPinnedRow = pinnedIds.includes(session.id);` is computed at the top of the thread `.map` callback (alongside `const active = ...`).

- [ ] **Step 4: Run to verify it passes**

Run: `node --experimental-strip-types src/components/code-view.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/code-sidebar.tsx src/components/code-view.test.ts
git commit -S -m "feat(code): Pinned section, thread pin toggle, and Show more in Codex sidebar"
```

---

### Task 5: Nav block (New chat / Search / Scheduled N / Plugins) + user footer

**Files:**
- Modify: `src/components/code-sidebar.tsx`
- Modify: `src/components/workspace.tsx`
- Modify: `src/components/code-view.test.ts`

- [ ] **Step 1: Add source-text assertions**

In `code-view.test.ts`:
```ts
assert.match(codeSidebar, /New chat/, "sidebar nav has New chat");
assert.match(codeSidebar, /cave:navigate-mode/, "sidebar deep-links to other surfaces via the nav bus");
assert.match(codeSidebar, /mode:\s*"inbox"/, "Scheduled deep-links to Automations (inbox mode)");
assert.match(codeSidebar, /mode:\s*"roles"/, "Plugins deep-links to the Plugins/Marketplace surface (roles mode)");
assert.match(codeSidebar, /code-sidebar__footer|code-sidebar__user/, "sidebar has a user footer");
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --experimental-strip-types src/components/code-view.test.ts`
Expected: FAIL on "sidebar nav has New chat".

- [ ] **Step 3: Extend `CodeSidebar` props + implement nav block and footer**

(a) In `code-sidebar.tsx`, extend `Props`:
```tsx
type Props = {
  sessions: SessionRow[];
  activeSessionId?: string | null;
  onBack: () => void;
  onOpenSession: (session: SessionRow) => void;
  onNewChat: (projectRoot: string | null) => void;
  onDeleteSession: (session: SessionRow) => Promise<void>;
  userName?: string;
  userPlan?: string;
  scheduledCount?: number;
};
```
Destructure the three new props (with defaults: `userName`, `userPlan = "Pro"`, `scheduledCount`).

(b) Add a nav helper near the top:
```tsx
function navigateMode(mode: string) {
  window.dispatchEvent(new CustomEvent("cave:navigate-mode", { detail: { mode } }));
}
```

(c) Add a `searchRef` for the Search nav action:
```tsx
const searchRef = useRef<HTMLInputElement>(null);
```
(import `useRef`), and set `ref={searchRef}` on the existing search `<input>` (~line 95).

(d) Insert the nav block immediately after `</header>` and before the search `<div>`:
```tsx
<nav aria-label="Code navigation" className="shrink-0 border-b border-[var(--border-hairline)] px-1.5 py-1.5">
  {[
    { key: "new", label: "New chat", icon: "ph:pencil-simple", onClick: () => onNewChat(null) },
    { key: "search", label: "Search", icon: "ph:magnifying-glass", onClick: () => searchRef.current?.focus() },
    { key: "scheduled", label: "Scheduled", icon: "ph:clock", count: scheduledCount, onClick: () => navigateMode("inbox") },
    { key: "plugins", label: "Plugins", icon: "ph:plugs", onClick: () => navigateMode("roles") },
  ].map((item) => (
    <button
      key={item.key}
      type="button"
      onClick={item.onClick}
      className="focus-ring flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] text-[var(--text-secondary)] hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)]"
    >
      <Icon name={item.icon} width={14} className="shrink-0 text-[var(--text-muted)]" aria-hidden />
      <span className="min-w-0 flex-1 truncate">{item.label}</span>
      {typeof item.count === "number" && item.count > 0 ? (
        <span className="shrink-0 rounded-full bg-[var(--bg-raised)] px-1.5 text-[10px] font-mono text-[var(--text-muted)]">{item.count}</span>
      ) : null}
    </button>
  ))}
</nav>
```

(e) Add the user footer as the last child of the root `<div>` (after the projects `<nav>`):
```tsx
<footer className="code-sidebar__footer code-sidebar__user mt-auto flex shrink-0 items-center gap-2 border-t border-[var(--border-hairline)] px-3 py-2">
  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[var(--bg-raised)] text-[11px] font-semibold text-[var(--text-primary)]" aria-hidden>
    {(userName ?? "You").split(/\s+/).map((p) => p[0]).join("").slice(0, 2).toUpperCase()}
  </span>
  <span className="min-w-0 flex-1">
    <span className="block truncate text-[12px] font-medium text-[var(--text-primary)]">{userName ?? "You"}</span>
    <span className="block truncate text-[10px] text-[var(--text-muted)]">{userPlan}</span>
  </span>
</footer>
```

- [ ] **Step 4: Pass the new props from `workspace.tsx`**

In `workspace.tsx` where `<CodeSidebar ... />` is built (~line 1876-1898), add props. Use existing user/identity context if present; otherwise pass safe fallbacks (render-but-inert per spec):
```tsx
userName={/* existing display-name source, else */ undefined}
userPlan="Pro"
scheduledCount={codeScheduledCount}
```
Add a small fetch for `codeScheduledCount` near the other code-mode state (only when `mode === "code"`), reading `/api/codex-automations`:
```tsx
const [codeScheduledCount, setCodeScheduledCount] = useState<number | undefined>(undefined);
useEffect(() => {
  if (mode !== "code") return;
  let alive = true;
  fetch("/api/codex-automations")
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => { if (alive && Array.isArray(d?.automations)) setCodeScheduledCount(d.automations.length); })
    .catch(() => {});
  return () => { alive = false; };
}, [mode]);
```
(Confirm the response shape with `grep -n "automations" src/app/api/codex-automations/route.ts`; adjust `d?.automations` accordingly. If the shape differs, leave `scheduledCount` undefined — the badge simply won't render.)

- [ ] **Step 5: Run tests**

Run: `node --experimental-strip-types src/components/code-view.test.ts` → PASS.
Run: `npx tsc --noEmit 2>&1 | grep -iE "code-sidebar|workspace" || echo clean` → `clean`.

- [ ] **Step 6: Commit**

```bash
git add src/components/code-sidebar.tsx src/components/workspace.tsx src/components/code-view.test.ts
git commit -S -m "feat(code): Codex sidebar nav block, Scheduled badge, and user footer"
```

---

### Task 6: PR1 styling + verify + open PR

**Files:**
- Modify: `src/app/globals.css` (optional polish — only if nav/footer need spacing the utility classes can't give; otherwise skip)

- [ ] **Step 1: Full app suite + build**

Run: `node --experimental-strip-types scripts/run-tests.mjs app 2>&1 | tail -15`
Expected: all pass.
Run: `pnpm build 2>&1 | tail -20`
Expected: build succeeds, bundle-budget `postbuild` gate passes.

- [ ] **Step 2: Visual verify (run-cave-app, dev mode to avoid stale chunks)**

Use the `run-cave-app` skill (DEV mode per memory `reference_run_cave_app_stale_prod_chunk`), route-mock `/api/sessions/list` + `/api/codex-automations`, navigate to `mode=code`, screenshot the sidebar. Confirm: nav block, Pinned (after pinning a thread), Show more (project with >5 threads), PR glyph on a "Resolve PR #" thread, user footer.

- [ ] **Step 3: Sanity-check signatures, push, open PR**

```bash
git log origin/main..HEAD --pretty='%H %G?' | awk '$2 != "G" {print "UNSIGNED:", $0}'   # must print nothing
git push -u origin kitty/codex-code-surface
gh pr create --base main --head kitty/codex-code-surface \
  --title "feat(code): Codex sidebar — nav, Pinned, Show more, user footer" \
  --body "$(cat <<'EOF'
PR1 of the Codex Code surface arc (spec: docs/specs/2026-06-30-codex-code-surface-design.md).

- Nav block: New chat / Search / Scheduled (count badge) / Plugins, deep-linking via cave:navigate-mode.
- Pinned section backed by new session-pins store (cave:session-pins:v1).
- Project threads: PR/branch glyphs, Show more (cap 5), per-thread pin toggle.
- User footer (avatar · name · plan).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 4: Wait for required checks, then squash-merge**

```bash
gh pr checks --watch
gh pr merge --squash   # (do NOT pass --delete-branch — the branch carries PR2/PR3)
```
Note: this arc keeps the branch alive for PR2/PR3. After PR1 merges, rebase the branch on the new `main` before PR2:
```bash
git fetch origin main && git rebase origin/main
```

---

# PR2 — Center conversation + composer

**Branch:** same `kitty/codex-code-surface`, rebased on post-PR1 `main`. Open PR2 after Task 11.

## File Structure (PR2)

- Modify `src/components/chat-view.tsx` — composer Codex card, model chip, permission chip, desktop mic, "Worked for Xs" reasoning summary, send `permissionMode`.
- Modify `src/lib/command-controls.ts` — add permission-mode options + type (persisted alongside thinking/speed).
- Modify `src/components/message-bubble.tsx` — thumbs/share action-row buttons.
- Create `src/lib/message-feedback.ts` + `src/lib/message-feedback.test.ts` — local thumbs store (`cave:msg-feedback:v1`).
- Modify `src/app/globals.css` — Codex composer card + chip styling, scoped to `.cave-code-page`.
- Modify source-text tests: `chat-view-polish.test.ts` (or the nearest existing chat-view source-text test — confirm with `ls src/components/chat-view*.test.ts`), `message-bubble*.test.ts`.
- Modify `scripts/run-tests.mjs` — wire `message-feedback.test.ts`.

---

### Task 7: Permission-mode control type + options

**Files:**
- Modify: `src/lib/command-controls.ts`
- Test: reuse/extend `src/lib/command-controls.test.ts` if it exists (`ls src/lib/command-controls.test.ts`); else add assertions to the chat-view source-text test.

- [ ] **Step 1: Confirm current shape**

Run: `sed -n '1,40p' src/lib/command-controls.ts`
Note the `CommandThinkingEffort` type + options + `readComposerPrefs`/`writeComposerPrefs` keys.

- [ ] **Step 2: Add the permission type + options (TDD via lib test if present)**

If `command-controls.test.ts` exists, add:
```ts
assert.equal(PERMISSION_MODES.find((m) => m.value === "full")?.value, "full", "full access is a permission mode");
assert.equal(DEFAULT_PERMISSION_MODE, "full", "defaults to full access (matches Codex reference)");
```
Then implement in `command-controls.ts`:
```ts
export type CommandPermissionMode = "full" | "read" | "ask";

export const PERMISSION_MODES: { value: CommandPermissionMode; label: string; icon: string }[] = [
  { value: "full", label: "Full access", icon: "ph:shield-warning" },
  { value: "read", label: "Read only", icon: "ph:eye" },
  { value: "ask", label: "Ask first", icon: "ph:hand" },
];

export const DEFAULT_PERMISSION_MODE: CommandPermissionMode = "full";
```
Extend the composer-prefs type/serialization to carry `permissionMode` (find the prefs shape in this file; add the field with a `DEFAULT_PERMISSION_MODE` fallback on read).

- [ ] **Step 3: Run the lib test (or `tsc`)**

Run: `node --experimental-strip-types src/lib/command-controls.test.ts 2>/dev/null || npx tsc --noEmit 2>&1 | grep command-controls || echo clean`
Expected: PASS / `clean`.

- [ ] **Step 4: Commit**

```bash
git add src/lib/command-controls.ts src/lib/command-controls.test.ts
git commit -S -m "feat(chat): permission-mode composer control (full/read/ask)"
```

---

### Task 8: `message-feedback` local store

**Files:**
- Create: `src/lib/message-feedback.ts`
- Test: `src/lib/message-feedback.test.ts`
- Modify: `scripts/run-tests.mjs`

- [ ] **Step 1: Write the failing test**

```ts
// @ts-nocheck
import assert from "node:assert/strict";
const store = new Map();
globalThis.window = {
  localStorage: {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  },
  addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => true,
};
const { getFeedback, setFeedback } = await import("./message-feedback.ts");
assert.equal(getFeedback("m1"), null, "no feedback by default");
setFeedback("m1", "up");
assert.equal(getFeedback("m1"), "up", "thumbs-up persisted");
setFeedback("m1", "up");
assert.equal(getFeedback("m1"), null, "re-applying same vote clears it (toggle)");
setFeedback("m1", "down");
assert.equal(getFeedback("m1"), "down", "switching vote overwrites");
console.log("message-feedback ok");
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --experimental-strip-types src/lib/message-feedback.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/lib/message-feedback.ts
// Local-only per-message feedback (thumbs). UI affordance; no server persistence (spec follow-up).
const KEY = "cave:msg-feedback:v1";
export type Feedback = "up" | "down";

function read(): Record<string, Feedback> {
  if (typeof window === "undefined") return {};
  try { return JSON.parse(window.localStorage.getItem(KEY) || "{}"); } catch { return {}; }
}
function write(map: Record<string, Feedback>): void {
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(KEY, JSON.stringify(map)); } catch { /* quota */ }
}

export function getFeedback(messageId: string): Feedback | null {
  return read()[messageId] ?? null;
}
export function setFeedback(messageId: string, vote: Feedback): void {
  const map = read();
  if (map[messageId] === vote) delete map[messageId];   // toggle off
  else map[messageId] = vote;
  write(map);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --experimental-strip-types src/lib/message-feedback.test.ts`
Expected: `message-feedback ok`.

- [ ] **Step 5: Wire into runner + commit**

Append `"src/lib/message-feedback.test.ts",` to `SUITES.app` in `scripts/run-tests.mjs`.
```bash
git add src/lib/message-feedback.ts src/lib/message-feedback.test.ts scripts/run-tests.mjs
git commit -S -m "feat(chat): local message-feedback (thumbs) store"
```

---

### Task 9: Message action row — thumbs + share

**Files:**
- Modify: `src/components/message-bubble.tsx`
- Modify: the nearest existing `message-bubble*.test.ts` (confirm with `ls src/components/message-bubble*.test.ts`)

- [ ] **Step 1: Add source-text assertions**

In the message-bubble source-text test:
```ts
assert.match(bubble, /ph:thumbs-up/, "assistant action row has thumbs-up");
assert.match(bubble, /ph:thumbs-down/, "assistant action row has thumbs-down");
assert.match(bubble, /ph:share-network/, "assistant action row has share");
```
(`const bubble = await readFile(new URL("./message-bubble.tsx", import.meta.url), "utf8");` — add if not already present.)

- [ ] **Step 2: Run to verify it fails**

Run: `node --experimental-strip-types src/components/message-bubble.test.ts` (use the actual filename)
Expected: FAIL.

- [ ] **Step 3: Implement**

In `message-bubble.tsx`, in the assistant `div.cave-bubble-actions` block (~line 1158), add buttons alongside Copy. Import `getFeedback`/`setFeedback` and `useState`. Pull a stable message id from existing props (use the same id the branch-nav / regenerate handlers key on — inspect `MessageBubbleProps`; if no id prop exists, add `messageId?: string` and pass it from the caller in `chat-view.tsx`). Render:
```tsx
{messageId ? (
  <>
    <button type="button" aria-label="Good response" aria-pressed={vote === "up"}
      onClick={() => { setFeedback(messageId, "up"); setVote(getFeedback(messageId)); }}
      className="cave-bubble-action">
      <Icon name="ph:thumbs-up" width={13} aria-hidden />
    </button>
    <button type="button" aria-label="Bad response" aria-pressed={vote === "down"}
      onClick={() => { setFeedback(messageId, "down"); setVote(getFeedback(messageId)); }}
      className="cave-bubble-action">
      <Icon name="ph:thumbs-down" width={13} aria-hidden />
    </button>
  </>
) : null}
<button type="button" aria-label="Share" onClick={onShare ?? (() => {})}
  className="cave-bubble-action">
  <Icon name="ph:share-network" width={13} aria-hidden />
</button>
```
with `const [vote, setVote] = useState<"up" | "down" | null>(() => (messageId ? getFeedback(messageId) : null));` near the top of the component. Reuse the existing action-button className the row already uses (inspect a sibling button; replace `cave-bubble-action` with that real class). `onShare` is an optional new prop — wire it later or leave inert (spec allows render-but-inert).

- [ ] **Step 4: Run to verify it passes**

Run the message-bubble test → PASS. Also run `npx tsc --noEmit 2>&1 | grep message-bubble || echo clean`.

- [ ] **Step 5: Commit**

```bash
git add src/components/message-bubble.tsx src/components/message-bubble.test.ts
git commit -S -m "feat(chat): thumbs + share on assistant action row"
```

---

### Task 10: "Worked for Xs" reasoning summary

**Files:**
- Modify: `src/components/chat-view.tsx` (`ReasoningBlock` ~line 5294)
- Modify: the chat-view source-text test (confirm filename: `ls src/components/chat-view*.test.ts`)

- [ ] **Step 1: Add source-text assertion**

```ts
assert.match(chatView, /Worked for/, "settled reasoning renders a 'Worked for Xs' summary");
```
(`const chatView = await readFile(new URL("./chat-view.tsx", import.meta.url), "utf8");`)

- [ ] **Step 2: Run to verify it fails**

Expected: FAIL.

- [ ] **Step 3: Implement**

In `ReasoningBlock`, the component takes the reasoning text today and shows a word count. Thread the settled turn's `durationMs` to it (the caller at the `ReasoningBlock` render site has `turn`). Add an optional prop `durationMs?: number` and render the `<summary>` label as:
```tsx
<summary ...>
  <Icon name="ph:brain" ... />
  {typeof durationMs === "number" && durationMs > 0
    ? `Worked for ${fmtDuration(durationMs)}`
    : `Thinking · ${wordCount} words`}
</summary>
```
(`fmtDuration` already exists in this file — confirm it's in scope where `ReasoningBlock` is defined; if not, lift it or pass the formatted string in.) At the call site, pass `durationMs={turn.durationMs}`.

- [ ] **Step 4: Run to verify it passes** → PASS. `tsc` clean.

- [ ] **Step 5: Commit**

```bash
git add src/components/chat-view.tsx src/components/chat-view-polish.test.ts
git commit -S -m "feat(chat): 'Worked for Xs' reasoning summary on settled turns"
```

---

### Task 11: Codex composer — card, model chip, permission chip, mic + open PR2

**Files:**
- Modify: `src/components/chat-view.tsx` (composer footer ~line 4803)
- Modify: `src/app/globals.css`
- Modify: chat-view source-text test

- [ ] **Step 1: Add source-text assertions**

```ts
assert.match(chatView, /Ask for follow-up changes/, "code-surface composer uses the Codex follow-up placeholder");
assert.match(chatView, /PERMISSION_MODES|permissionMode/, "composer has a permission-mode chip");
assert.match(chatView, /ph:microphone|onVoice/, "desktop composer exposes a mic/voice control");
assert.match(globals, /\.cave-code-page[\s\S]*?cave-composer/, "Codex composer card styling is scoped to the code page");
```

- [ ] **Step 2: Run to verify it fails** → FAIL.

- [ ] **Step 3: Implement**

(a) Placeholder: where the composer `<textarea>` placeholder is set (~line 4727), make it surface-aware:
```tsx
placeholder={surface === "code" ? "Ask for follow-up changes" : /* existing placeholder */ }
```
(Confirm `surface` is in scope in `ChatView`; the Props include it via `chat-router`. If not threaded, add `surface?: string` to Props and pass from `chat-router.tsx:425`.)

(b) Permission chip: add a third `ComposerControlSelect` in the `cave-composer-settings-row` (~line 4845) bound to `PERMISSION_MODES`, reading/writing the new `permissionMode` composer pref (Task 7). Show the icon + current label (`⚠ Full access`).

(c) Model chip: add a `ComposerControlSelect`-style chip in the same row showing `effectiveModel` label + thinking-effort (`⚡ {modelLabel} {Effort}`). For the model list, reuse `modelSlashOptions`; selecting calls the existing `handleSelectModel`. (This consolidates the existing `/model` picker into a visible chip — keep the `/model` slash working too.)

(d) Send wiring: include `permissionMode` in the `/api/chat/send` body in `sendRaw()` (~line 3349, alongside `reasoningEffort`/`responseSpeed`):
```tsx
permissionMode: composerControls.permissionMode ?? DEFAULT_PERMISSION_MODE,
```

(e) Desktop mic: in `cave-composer-action-row` (~line 4804), add a voice button that opens the existing `VoiceCallOverlay` (reuse the mobile `onVoice` handler — it already exists; just render the trigger on desktop too):
```tsx
<button type="button" aria-label="Voice" onClick={() => setVoiceOpen(true)} className="cave-composer-btn">
  <Icon name="ph:microphone" width={15} aria-hidden />
</button>
```
(Use the actual state setter that drives `VoiceCallOverlay` at ~line 4902 — inspect its current trigger; reuse `cave-composer-btn` or the real sibling-button class.)

(f) `globals.css`: scope a Codex composer card under `.cave-code-page .cave-composer` (rounded container, chip pill styling). Keep non-code surfaces unchanged.

- [ ] **Step 4: Run tests + build + visual verify**

`node --experimental-strip-types scripts/run-tests.mjs app 2>&1 | tail -15` → pass.
`pnpm build 2>&1 | tail -20` → pass.
`run-cave-app` (dev mode) → open a code thread, screenshot the composer: rounded card, "Ask for follow-up changes", permission chip, model chip, mic, send.

- [ ] **Step 5: Signatures, push, open PR2**

```bash
git log origin/main..HEAD --pretty='%H %G?' | awk '$2 != "G" {print "UNSIGNED:", $0}'
git push
gh pr create --base main --head kitty/codex-code-surface \
  --title "feat(code): Codex conversation + composer (model/permission chips, Worked-for-Xs, action row)" \
  --body "PR2 of the Codex Code surface arc. See docs/specs/2026-06-30-codex-code-surface-design.md.

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
gh pr checks --watch && gh pr merge --squash
git fetch origin main && git rebase origin/main
```

---

# PR3 — Inline file-edit cards

**Branch:** same branch, rebased on post-PR2 `main`.

## File Structure (PR3)

- Create `src/lib/tool-edit-stat.ts` + `src/lib/tool-edit-stat.test.ts` — derive `{ insertions, deletions }` from `toolInputAsDiff`.
- Modify `src/components/chat-view.tsx` — render mutation tools as Codex edit cards.
- Modify `src/app/globals.css` — edit-card styling.
- Modify chat-view source-text test.
- Modify `scripts/run-tests.mjs`.

---

### Task 12: `tool-edit-stat` diff-stat helper

**Files:**
- Create: `src/lib/tool-edit-stat.ts`
- Test: `src/lib/tool-edit-stat.test.ts`
- Modify: `scripts/run-tests.mjs`

- [ ] **Step 1: Write the failing test**

```ts
// @ts-nocheck
import assert from "node:assert/strict";
const { diffStat } = await import("./tool-edit-stat.ts");
const diff = ["@@ -1,2 +1,3 @@", " ctx", "-old line", "+new line", "+extra line"].join("\n");
assert.deepEqual(diffStat(diff), { insertions: 2, deletions: 1 }, "counts +/- non-header lines");
assert.deepEqual(diffStat(""), { insertions: 0, deletions: 0 }, "empty diff is zero");
assert.deepEqual(diffStat("+++ b/x\n--- a/x\n+real"), { insertions: 1, deletions: 0 }, "ignores +++/--- file headers");
console.log("tool-edit-stat ok");
```

- [ ] **Step 2: Run to verify it fails** → module not found.

- [ ] **Step 3: Implement**

```ts
// src/lib/tool-edit-stat.ts
// Count insertions/deletions from a unified-diff string (output of toolInputAsDiff).
export function diffStat(diff: string): { insertions: number; deletions: number } {
  let insertions = 0, deletions = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++") || line.startsWith("---")) continue; // file headers
    if (line.startsWith("+")) insertions += 1;
    else if (line.startsWith("-")) deletions += 1;
  }
  return { insertions, deletions };
}
```

- [ ] **Step 4: Run to verify it passes** → `tool-edit-stat ok`.

- [ ] **Step 5: Wire + commit**

Append `"src/lib/tool-edit-stat.test.ts",` to `SUITES.app`.
```bash
git add src/lib/tool-edit-stat.ts src/lib/tool-edit-stat.test.ts scripts/run-tests.mjs
git commit -S -m "feat(code): diffStat helper for inline edit cards"
```

---

### Task 13: Render mutation tools as Codex edit cards + open PR3

**Files:**
- Modify: `src/components/chat-view.tsx` (`ToolBlock` ~line 5444)
- Modify: `src/app/globals.css`
- Modify: chat-view source-text test

- [ ] **Step 1: Add source-text assertions**

```ts
assert.match(chatView, /diffStat|cave-edit-card/, "mutation tools render as inline edit cards with a diff stat");
assert.match(chatView, /cave:open-file-diff/, "edit card Review opens the comux diff");
assert.match(chatView, /Review/, "edit card has a Review action");
```
(`cave:open-file-diff` already exists in chat-view per the explore map — this assertion just guards it stays.)

- [ ] **Step 2: Run to verify it fails** → FAIL on `cave-edit-card`.

- [ ] **Step 3: Implement**

In `ToolBlock` (chat-view.tsx ~5444), it already computes `toolInputAsDiff(name, input)` and `toolTargetFile`. When the tool is a mutation (`MUTATION_TOOLS.has(name)`) and a target file exists, render a Codex edit card instead of the default `<details>`:
```tsx
if (MUTATION_TOOLS.has(name) && targetFile) {
  const stat = diffStat(diffText);   // import { diffStat } from "@/lib/tool-edit-stat";
  const base = targetFile.split("/").pop() || targetFile;
  return (
    <div className="cave-edit-card flex items-center gap-2 rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-raised)]/40 px-3 py-2">
      <Icon name="ph:pencil-simple-line" width={16} className="shrink-0 text-[var(--text-muted)]" aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium text-[var(--text-primary)]">Edited {base}</span>
        <span className="block text-[12px] font-mono">
          <span className="text-[var(--color-success)]">+{stat.insertions}</span>{" "}
          <span className="text-[var(--color-danger)]">−{stat.deletions}</span>
        </span>
      </span>
      <button type="button" onClick={() => window.dispatchEvent(new CustomEvent("cave:open-file-diff", { detail: { path: targetFile } }))}
        className="focus-ring rounded-md border border-[var(--border-hairline)] px-2.5 py-1 text-[12px] text-[var(--text-secondary)] hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)]">
        Review
      </button>
    </div>
  );
}
```
(Confirm the existing `cave:open-file-diff` detail shape at the dispatch site already in chat-view ~line 5463 and match it exactly — reuse the same payload key, likely `{ path }` or `{ file }`.)
Note: **Undo is deferred** — the spec allows render-but-inert, and a reliable per-file revert needs the `/api/changes` entry to exist for the path. Ship Review-only in PR3; file Undo as a follow-up (keeps PR3 small and green). Update the spec's PR3 scope note if Undo is dropped.

(b) `globals.css`: add `.cave-edit-card` polish if needed (the inline utilities may suffice — only add CSS if spacing/hover needs it).

- [ ] **Step 2 check / Step 4: Run tests + build + visual**

`node --experimental-strip-types scripts/run-tests.mjs app 2>&1 | tail -15` → pass.
`pnpm build` → pass.
`run-cave-app` → open a thread containing an Edit tool call → screenshot the edit card (`Edited <file>  +N −M  Review`).

- [ ] **Step 5: Signatures, push, open PR3, merge, clean up**

```bash
git log origin/main..HEAD --pretty='%H %G?' | awk '$2 != "G" {print "UNSIGNED:", $0}'
git push
gh pr create --base main --head kitty/codex-code-surface \
  --title "feat(code): inline Codex file-edit cards (Edited <file> +N −M · Review)" \
  --body "PR3 of the Codex Code surface arc. See docs/specs/2026-06-30-codex-code-surface-design.md. Undo deferred (follow-up).

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
gh pr checks --watch && gh pr merge --squash --delete-branch
```
Local cleanup (per CLAUDE.md):
```bash
cd /Users/buns/Documents/GitHub/OpenCoven/coven-cave
git worktree remove .worktrees/codex-code-surface
git branch -D kitty/codex-code-surface
git worktree list
```

---

## Self-Review

**Spec coverage:**
- Sidebar nav (New chat/Search/Scheduled/Plugins) → Task 5 ✓
- Pinned section → Tasks 1,2,4 ✓
- Projects→threads + Show more + PR icons → Tasks 3,4 ✓
- User footer → Task 5 ✓
- Composer card + "Ask for follow-up changes" → Task 11 ✓
- Model chip → Task 11 ✓
- Permission chip → Tasks 7,11 ✓
- Mic → Task 11 ✓
- "Worked for Xs" → Task 10 ✓
- Action row thumbs/share → Tasks 8,9 ✓
- Inline file-edit cards (Review) → Tasks 12,13 ✓
- Undo → **deferred** (Task 13 note + spec follow-up) — explicit, not a gap.
- Scheduled count → Task 5 ✓
- Deep-links via `cave:navigate-mode` → Task 5 ✓

**Placeholder scan:** No "TBD/TODO". Three steps say "confirm the exact class/payload/filename with grep/ls" — these are deliberate verification steps against existing code whose exact tokens can't be known without reading, not vague placeholders; each gives the grep/ls command and the fallback.

**Type consistency:** `session-pins` exports (`getPinnedSessionIds`/`isSessionPinned`/`toggleSessionPin`/`subscribeSessionPins`) match across Tasks 1/2/4. `PERMISSION_MODES`/`DEFAULT_PERMISSION_MODE`/`CommandPermissionMode` consistent across Tasks 7/11. `diffStat` signature consistent across Tasks 12/13. `getFeedback`/`setFeedback` consistent across Tasks 8/9.

**Scope:** Three PRs, each independently green and shippable.
