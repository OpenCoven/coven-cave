# Unified Chat + Code Workspace — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse the separate Chat and Code surfaces into one chat-centered "morphing workspace" whose right **code rail** (Changes · Files · Terminal) smart-auto-reveals when code is in play and can be pinned/collapsed.

**Architecture:** Evolve in place. Keep the shared `ChatView` (transcript + composer) as the center. Add a pure `resolveCodeRail()` decision function, a `useCodeRail()` hook that feeds it live signals, and a `WorkspaceRail` shell that re-homes the existing `SessionChangesPanel` (Changes), comux file tree (Files), and pty terminal (Terminal). Later PRs unify the two sidebars and retire the `code` mode + `ComuxView` 3-column shell.

**Tech Stack:** Next.js 16 / React 19, TypeScript, node:test (`.test.ts` via `scripts/run-tests.mjs`), Playwright (`tests/*.spec.ts`, daemon-less with `page.route` mocks), CSS in `src/styles/cave-chat.css` + `globals.css`.

**Companion spec:** `docs/specs/2026-07-03-unified-chat-code-workspace-design.md`

**Scope note:** This is a 5-PR arc. **PR 1 below is fully detailed and independently shippable.** PRs 2–5 are specified at task level (files, signatures, tests) and should each be expanded into full TDD steps when reached — do not implement them from the outline alone.

---

## Conventions (read once)

- **Signed commits:** every `git commit` uses `-S` (repo rule).
- **Test wiring:** a new `src/**/*.test.ts` must be added to a `SUITES` array in `scripts/run-tests.mjs` (default: the `app` array, ~line 23) or `check:tests-wired` fails CI. If the test imports from `@/…`, also add its path to the `ALIAS_LOADER` set (~line 748).
- **Run a single unit test:** `node --import ./scripts/test-alias-register.mjs <path>` (alias-loaded) or `node --test <path>` (no `@/` imports).
- **Pure-fn + test pattern to mirror:** `src/lib/split-snap.ts` + `src/lib/split-snap.test.ts`.
- **Reusable diff panel:** `src/components/session-changes-panel.tsx` (`SessionChangesPanel`) already renders `/api/changes?projectRoot=…` diffs + undo and listens for the `cave:changes-refresh` event.
- **The edit signal:** `chat-view.tsx` dispatches `window.dispatchEvent(new CustomEvent("cave:changes-refresh"))` after an edit/undo (line ~5944).

---

## PR 1 — Rail foundation + Changes tab

Ships: a right code rail that auto-reveals to the Changes diff when the AI edits files, with pin/collapse, behind the existing chat surface. `code` mode is left untouched.

### Task 1: `resolveCodeRail()` — the pure decision function

**Files:**
- Create: `src/lib/code-rail.ts`
- Test: `src/lib/code-rail.test.ts`
- Modify: `scripts/run-tests.mjs` (add test to `SUITES.app`)

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/code-rail.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveCodeRail, type CodeRailSignals, type CodeRailState } from "./code-rail.ts";

const base: CodeRailSignals = {
  hasRepo: false, changeCount: 0, terminalActive: false, pinned: false, dismissed: false,
};

test("plain chat → not available, closed", () => {
  const r = resolveCodeRail(base, null);
  assert.equal(r.available, false);
  assert.equal(r.open, false);
});

test("repo session, idle → available, open to Files", () => {
  const r = resolveCodeRail({ ...base, hasRepo: true }, null);
  assert.equal(r.available, true);
  assert.equal(r.open, true);
  assert.equal(r.activeTab, "files");
});

test("new AI edits (0→N) → open to Changes with the count", () => {
  const prev: CodeRailState = { available: true, open: true, activeTab: "files", changeCount: 0 };
  const r = resolveCodeRail({ ...base, hasRepo: true, changeCount: 3 }, prev);
  assert.equal(r.open, true);
  assert.equal(r.activeTab, "changes");
});

test("new AI edits re-reveal even after a manual collapse", () => {
  const prev: CodeRailState = { available: true, open: false, activeTab: "files", changeCount: 0 };
  const r = resolveCodeRail({ ...base, hasRepo: true, changeCount: 2, dismissed: true }, prev);
  assert.equal(r.open, true, "a fresh edit batch overrides dismissal");
  assert.equal(r.activeTab, "changes");
});

test("dismissed with no new edits → stays closed but available", () => {
  const prev: CodeRailState = { available: true, open: true, activeTab: "files", changeCount: 2 };
  const r = resolveCodeRail({ ...base, hasRepo: true, changeCount: 2, dismissed: true }, prev);
  assert.equal(r.available, true);
  assert.equal(r.open, false);
});

test("pinned → open even when dismissed, keeps last tab", () => {
  const prev: CodeRailState = { available: true, open: false, activeTab: "terminal", changeCount: 0 };
  const r = resolveCodeRail({ ...base, hasRepo: true, pinned: true, dismissed: true }, prev);
  assert.equal(r.open, true);
  assert.equal(r.activeTab, "terminal");
});

test("reason clears (no repo/changes/terminal) and not pinned → auto-hide", () => {
  const prev: CodeRailState = { available: true, open: true, activeTab: "changes", changeCount: 1 };
  const r = resolveCodeRail(base, prev);
  assert.equal(r.available, false);
  assert.equal(r.open, false);
});

test("terminal alone makes it available", () => {
  const r = resolveCodeRail({ ...base, terminalActive: true }, null);
  assert.equal(r.available, true);
  assert.equal(r.open, true);
  assert.equal(r.activeTab, "terminal");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/lib/code-rail.test.ts`
Expected: FAIL — `Cannot find module './code-rail.ts'`.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/code-rail.ts
export type CodeRailTab = "changes" | "files" | "terminal";

export type CodeRailSignals = {
  /** Active session is linked to a project/repo (session.project_root set). */
  hasRepo: boolean;
  /** Number of pending AI edits (from /api/changes). 0 = none. */
  changeCount: number;
  /** A pty/terminal session is running for this conversation. */
  terminalActive: boolean;
  /** User pinned the rail open (persisted preference). */
  pinned: boolean;
  /** User collapsed the rail for the current reason. */
  dismissed: boolean;
};

export type CodeRailState = {
  /** Rail is rendered at all (there is something to show). */
  available: boolean;
  open: boolean;
  activeTab: CodeRailTab;
  /** Echoed so the caller can feed it back as `prev` next tick. */
  changeCount: number;
};

/**
 * Pure reveal/hide/tab decision for the code rail. `prev` is the last resolved
 * state (or null on first render) — used to detect a fresh 0→N edit batch, which
 * re-reveals the rail even after a manual collapse.
 */
export function resolveCodeRail(
  signals: CodeRailSignals,
  prev: CodeRailState | null,
): CodeRailState {
  const { hasRepo, changeCount, terminalActive, pinned, dismissed } = signals;
  const available = hasRepo || changeCount > 0 || terminalActive;

  if (!available) {
    return { available: false, open: false, activeTab: prev?.activeTab ?? "files", changeCount: 0 };
  }

  // A fresh edit batch: changes went from 0 (or unknown) to > 0.
  const newEdits = changeCount > 0 && (prev == null || prev.changeCount === 0);

  const open = pinned ? true : newEdits ? true : dismissed ? false : true;

  let activeTab: CodeRailTab;
  if (newEdits) activeTab = "changes";
  else if (prev?.activeTab) activeTab = prev.activeTab;
  else if (changeCount > 0) activeTab = "changes";
  else if (hasRepo) activeTab = "files";
  else activeTab = "terminal";

  return { available, open, activeTab, changeCount };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test src/lib/code-rail.test.ts`
Expected: PASS — `# pass 8  # fail 0`.

- [ ] **Step 5: Wire the test into CI**

In `scripts/run-tests.mjs`, add to the `SUITES.app` array (near `"src/lib/split-snap.test.ts"`):

```js
    "src/lib/code-rail.test.ts",
```

Then verify wiring: `pnpm run check:tests-wired` → Expected: `✓ all … test files wired`.

- [ ] **Step 6: Commit**

```bash
git add src/lib/code-rail.ts src/lib/code-rail.test.ts scripts/run-tests.mjs
git commit -S -m "feat(code-rail): pure resolveCodeRail() reveal/tab decision"
```

### Task 2: `useCodeRail()` hook — feed the resolver live signals

**Files:**
- Create: `src/lib/use-code-rail.ts`
- Test: `src/lib/use-code-rail.test.ts` (behavioral, via the pure helpers it exports)
- Modify: `scripts/run-tests.mjs` (`SUITES.app` + `ALIAS_LOADER` — it imports `@/lib/code-rail`)

The hook owns React state and side effects; keep all decision logic in `resolveCodeRail`. Export a small pure helper `readPinned()/writePinned()` (localStorage, key `cave:code-rail:pinned:v1`) so the storage round-trip is unit-testable without a DOM.

- [ ] **Step 1: Write the failing test** (pin persistence round-trip)

```ts
// src/lib/use-code-rail.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { CODE_RAIL_PIN_KEY, parsePinned, serializePinned } from "./use-code-rail.ts";

test("pin key is versioned", () => {
  assert.equal(CODE_RAIL_PIN_KEY, "cave:code-rail:pinned:v1");
});
test("parsePinned tolerates junk", () => {
  assert.equal(parsePinned("true"), true);
  assert.equal(parsePinned("false"), false);
  assert.equal(parsePinned(null), false);
  assert.equal(parsePinned("garbage"), false);
});
test("serializePinned round-trips", () => {
  assert.equal(parsePinned(serializePinned(true)), true);
  assert.equal(parsePinned(serializePinned(false)), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import ./scripts/test-alias-register.mjs src/lib/use-code-rail.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the hook + helpers**

```ts
// src/lib/use-code-rail.ts
"use client";
import { useEffect, useRef, useState } from "react";
import { resolveCodeRail, type CodeRailState, type CodeRailTab } from "@/lib/code-rail";

export const CODE_RAIL_PIN_KEY = "cave:code-rail:pinned:v1";
export function parsePinned(raw: string | null): boolean {
  return raw === "true";
}
export function serializePinned(pinned: boolean): string {
  return pinned ? "true" : "false";
}

export type UseCodeRailArgs = {
  /** Active session's project_root (null/undefined = not repo-linked). */
  projectRoot: string | null | undefined;
  /** Pending edit count for this session (0 = none). Caller polls /api/changes. */
  changeCount: number;
  terminalActive: boolean;
};

export function useCodeRail({ projectRoot, changeCount, terminalActive }: UseCodeRailArgs) {
  const [pinned, setPinned] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [activeTab, setActiveTab] = useState<CodeRailTab>("files");
  const prevRef = useRef<CodeRailState | null>(null);

  // Hydrate pin after mount (SSR-safe).
  useEffect(() => {
    setPinned(parsePinned(window.localStorage.getItem(CODE_RAIL_PIN_KEY)));
  }, []);

  const state = resolveCodeRail(
    { hasRepo: Boolean(projectRoot), changeCount, terminalActive, pinned, dismissed },
    prevRef.current,
  );
  // Keep the resolved tab in sync so tab clicks persist while open.
  useEffect(() => {
    if (state.available && state.activeTab !== activeTab) setActiveTab(state.activeTab);
    prevRef.current = state;
    // Reset the per-reason dismissal when a fresh edit batch reveals the rail.
    if (state.open && dismissed) setDismissed(false);
  }, [state.available, state.open, state.activeTab]); // eslint-disable-line react-hooks/exhaustive-deps

  const togglePin = () => {
    setPinned((p) => {
      const next = !p;
      window.localStorage.setItem(CODE_RAIL_PIN_KEY, serializePinned(next));
      if (next) setDismissed(false);
      return next;
    });
  };
  const collapse = () => setDismissed(true);
  const reopen = () => setDismissed(false);

  return {
    available: state.available,
    open: state.open,
    pinned,
    activeTab,
    setActiveTab,
    togglePin,
    collapse,
    reopen,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import ./scripts/test-alias-register.mjs src/lib/use-code-rail.test.ts`
Expected: PASS — `# pass 3`.

- [ ] **Step 5: Wire into CI** — add `"src/lib/use-code-rail.test.ts"` to `SUITES.app` AND to the `ALIAS_LOADER` set (it imports `@/lib/code-rail`). Run `pnpm run check:tests-wired`.

- [ ] **Step 6: Typecheck + commit**

```bash
pnpm exec tsc --noEmit
git add src/lib/use-code-rail.ts src/lib/use-code-rail.test.ts scripts/run-tests.mjs
git commit -S -m "feat(code-rail): useCodeRail hook + persisted pin"
```

### Task 3: `WorkspaceRail` shell — tab strip + Changes panel

**Files:**
- Create: `src/components/workspace-rail.tsx`
- Create/append CSS: `src/styles/cave-chat.css` (`.workspace-rail*` block)
- Test: `src/components/workspace-rail.test.ts` (source-text)
- Modify: `scripts/run-tests.mjs` (`SUITES.app`)

The rail renders a vertical tab strip (Changes · Files · Terminal), a header with the change badge + pin + collapse, and the active panel. **PR 1 only wires the Changes panel** (reuse `SessionChangesPanel`); Files/Terminal tabs render a "Coming in the next step" placeholder so the shell is complete but honest.

- [ ] **Step 1: Write the failing source-text test**

```ts
// src/components/workspace-rail.test.ts
// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const src = readFileSync(new URL("./workspace-rail.tsx", import.meta.url), "utf8");

assert.match(src, /export function WorkspaceRail\(/, "exports WorkspaceRail");
assert.match(src, /className="workspace-rail"/, "root class");
assert.match(src, /aria-label="Code rail"/, "labels the rail region");
// Vertical tab strip with the three tabs.
for (const t of ["Changes", "Files", "Terminal"]) {
  assert.match(src, new RegExp(`aria-label="${t}"`), `has a ${t} tab`);
}
// Changes tab reuses the existing diff panel.
assert.match(src, /SessionChangesPanel/, "Changes tab reuses SessionChangesPanel");
// Pin + collapse controls, wired to props.
assert.match(src, /onTogglePin/, "pin control wired");
assert.match(src, /onCollapse/, "collapse control wired");
assert.match(src, /changeCount > 0/, "shows a change-count badge");
console.log("workspace-rail.test.ts OK");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node src/components/workspace-rail.test.ts` → Expected: FAIL (file missing).

- [ ] **Step 3: Write the component**

```tsx
// src/components/workspace-rail.tsx
"use client";
import { Icon, type IconName } from "@/lib/icon";
import { SessionChangesPanel } from "@/components/session-changes-panel";
import type { CodeRailTab } from "@/lib/code-rail";

const TABS: { id: CodeRailTab; label: string; icon: IconName }[] = [
  { id: "changes", label: "Changes", icon: "ph:git-diff" },
  { id: "files", label: "Files", icon: "ph:folder" },
  { id: "terminal", label: "Terminal", icon: "ph:terminal-window" },
];

export function WorkspaceRail({
  projectRoot,
  changeCount,
  activeTab,
  pinned,
  onSelectTab,
  onTogglePin,
  onCollapse,
}: {
  projectRoot: string | null;
  changeCount: number;
  activeTab: CodeRailTab;
  pinned: boolean;
  onSelectTab: (tab: CodeRailTab) => void;
  onTogglePin: () => void;
  onCollapse: () => void;
}) {
  return (
    <section className="workspace-rail" aria-label="Code rail">
      <nav className="workspace-rail__strip" aria-label="Code rail tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            aria-label={t.label}
            aria-pressed={activeTab === t.id}
            className={`workspace-rail__tab focus-ring${activeTab === t.id ? " is-active" : ""}`}
            onClick={() => onSelectTab(t.id)}
          >
            <Icon name={t.icon} width={16} aria-hidden />
            {t.id === "changes" && changeCount > 0 ? (
              <span className="workspace-rail__badge">{changeCount}</span>
            ) : null}
          </button>
        ))}
      </nav>
      <div className="workspace-rail__body">
        <header className="workspace-rail__head">
          <span className="workspace-rail__title">{TABS.find((t) => t.id === activeTab)?.label}</span>
          <span className="workspace-rail__actions">
            <button type="button" className={`workspace-rail__btn focus-ring${pinned ? " is-on" : ""}`}
              aria-label={pinned ? "Unpin code rail" : "Pin code rail open"} aria-pressed={pinned} onClick={onTogglePin}>
              <Icon name={pinned ? "ph:push-pin-fill" : "ph:push-pin"} width={13} aria-hidden />
            </button>
            <button type="button" className="workspace-rail__btn focus-ring"
              aria-label="Collapse code rail" onClick={onCollapse}>
              <Icon name="ph:caret-right" width={13} aria-hidden />
            </button>
          </span>
        </header>
        <div className="workspace-rail__pane">
          {activeTab === "changes" ? (
            <SessionChangesPanel projectRoot={projectRoot} />
          ) : (
            <p className="workspace-rail__soon">
              {activeTab === "files" ? "Files" : "Terminal"} arrives in the next step.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
```

> Note: confirm the exact `SessionChangesPanel` prop name for the project root by reading `src/components/session-changes-panel.tsx` (it queries `/api/changes?projectRoot=…`); adjust the prop passed above to match its actual signature.

- [ ] **Step 4: Add CSS** — append a `.workspace-rail*` block to `src/styles/cave-chat.css` (strip = 34px vertical tab column; `.workspace-rail__badge` gold pill; `.is-active` gold like the composer pills; `.workspace-rail__soon` muted). Match the `.cnav`/composer visual language (gold accents via `--composer-pill-gold`, hairline borders).

- [ ] **Step 5: Run test to verify it passes**

Run: `node src/components/workspace-rail.test.ts` → Expected: `workspace-rail.test.ts OK`. Add it to `SUITES.app` and run `pnpm run check:tests-wired`.

- [ ] **Step 6: Typecheck + commit**

```bash
pnpm exec tsc --noEmit
git add src/components/workspace-rail.tsx src/components/workspace-rail.test.ts src/styles/cave-chat.css scripts/run-tests.mjs
git commit -S -m "feat(code-rail): WorkspaceRail shell with Changes tab"
```

### Task 4: Mount the rail beside ChatView + auto-reveal

**Files:**
- Modify: `src/components/chat-surface.tsx` (render `WorkspaceRail` in a resizable `Panel` to the right of the chat `Panel` when `useCodeRail().available`, wired to a `changeCount` polled from `/api/changes` and refreshed on `cave:changes-refresh`)
- Test: `src/components/workspace-rail-wiring.test.ts` (source-text: chat-surface imports + mounts `WorkspaceRail`, subscribes to `cave:changes-refresh`)
- Test (e2e): `tests/code-rail.spec.ts`
- Modify: `scripts/run-tests.mjs`

- [ ] **Step 1: Wiring source-text test** — assert `chat-surface.tsx` imports `WorkspaceRail` and `useCodeRail`, mounts the rail in a `Panel` guarded by `available`, and listens for `cave:changes-refresh` to refresh `changeCount`.
- [ ] **Step 2: Run → fails.**
- [ ] **Step 3: Implement** — in `chat-surface.tsx`: add `useCodeRail(...)`; poll `/api/changes?projectRoot=…` for `changeCount` (reuse `SessionChangesPanel`'s fetch shape) and re-poll on the `cave:changes-refresh` window event; when `available`, render a `<Separator/>` + `<Panel id="code-rail">` holding `<WorkspaceRail …/>`; when collapsed-but-available, render the slim reopen strip that calls `reopen()`.
- [ ] **Step 4: Run wiring test → passes.**
- [ ] **Step 5: E2E** `tests/code-rail.spec.ts` (daemon-less; mock `/api/sessions/list`, `/api/changes`): (a) plain chat → `.workspace-rail` absent; (b) repo session → `.workspace-rail` visible, Files tab; (c) dispatch `window.dispatchEvent(new CustomEvent("cave:changes-refresh"))` with mocked `/api/changes` returning 2 files → rail shows Changes with badge `2`; (d) click Collapse → rail hidden, slim strip present; (e) reload with pin set → rail open.
- [ ] **Step 6: Full local gate + commit**

```bash
pnpm exec tsc --noEmit && pnpm run check:tests-wired && pnpm test:app && pnpm build
git add -A
git commit -S -m "feat(code-rail): auto-reveal the rail beside chat on edits"
```

- [ ] **Step 7: PR** — push branch, open PR, wait for the six required checks green, squash-merge.

---

## PR 2 — Files + Terminal tabs

Ships the two remaining tabs, reusing comux internals.

- **Files tab:** extract comux's file-tree + file-preview into a reusable `RailFilesPanel` (`src/components/rail-files-panel.tsx`) reading the existing project-tree API; wire into `WorkspaceRail` for `activeTab === "files"`. Test: source-text + e2e (tree renders, click file → preview).
- **Terminal tab:** `RailTerminalPanel` wrapping the existing pty terminal (see `comux-view-terminal`), **lazy-mounted** — only instantiate the pty when Terminal is first selected (`useState` "hasMountedTerminal"). Offline/no-daemon → offline placeholder. Test: source-text (lazy mount guard) + e2e (tab present, pty not created until clicked).
- Replace the Task 3 "arrives in the next step" placeholders.
- Signal `terminalActive` in `useCodeRail` becomes true once the terminal pty is live.

### Task-level breakdown (expand to TDD when implementing)
1. `RailFilesPanel` + test (reuse tree/preview; do not re-implement fetching).
2. `RailTerminalPanel` + lazy-mount test.
3. Wire both into `WorkspaceRail`; remove placeholders; update `workspace-rail.test.ts` (drop the "soon" assertions, add real panel assertions).
4. E2E for Files preview + Terminal lazy mount. Full gate + PR.

---

## PR 3 — Nav coupling + polish

- When `useCodeRail().open`, soft-collapse the shell's left nav to its icon rail (reuse `.shell-nav--rail` / `cave:toggle-left-panel`), **unless** the user explicitly expanded it (track a `userExpandedNav` flag). Restore on rail close.
- Hover-to-peek on the collapsed nav (existing shell affordance).
- Rail open/close + tab-switch transitions (respect `prefers-reduced-motion`).
- **Mobile:** below the shell's mobile breakpoint, render the rail as a full-height slide-over sheet over full-screen chat (a toggle button in the composer/header), not a third column.
- Tests: source-text for the nav-coupling wiring; e2e for mobile sheet (Pixel-5 project) — rail opens as an overlay, closes on backdrop.

---

## PR 4 — Unify the two sidebars

- Create `src/components/workspace-sidebar.tsx` from the shared `.cnav` structure; list **all** conversations; repo-linked conversations get a repo glyph; keep the Scheduled/Plugins shortcuts from `code-sidebar`.
- Data: union of `deriveChatProjectGroups` (chat) and `deriveComuxProjects` (code) sources — a repo-linked chat and a code session on the same root collapse into one group.
- Replace both `chat-sidebar.tsx` and `code-sidebar.tsx` usages in `workspace.tsx` with `WorkspaceSidebar`; keep the collapsed-rail behavior.
- Migrate the pinned strings from `chat-sidebar-wiring.test.ts` and the `chat-sidebar-nav.spec.ts` e2e (searchbox aria-label, folder-toggle labels, "New chat in …", register-as-project, "No threads match your search.") onto the unified component so those specs still pass.
- Delete the two old sidebars once nothing imports them; unwire their tests from `run-tests.mjs`.

---

## PR 5 — Retire the `code` mode + 3-column shell

- In `workspace.tsx` `renderSurface`, fold the `code` mode into the unified chat surface: a repo conversation opens in the chat surface with `useCodeRail` available (rail auto-reveals). Remove the `mode === "code"` branch and the `CodeView`/`ComuxView` 3-column wrapper mount.
- Deep-link compat: `cave:navigate-mode { mode: "code" }` and any `code`-mode routes resolve to opening the most-recent/relevant repo conversation with the rail up (add a small resolver + test).
- Delete `code-view.tsx` and the now-unused `ComuxView` 3-column shell path (keep its internals now living in the rail). Remove dead CSS.
- Update/retire tests that pinned the old code surface (`code-view.test.ts`, `code-surface-familiar-scope.test.ts`, comux 3-column source-text tests) — re-point or delete as their surface no longer exists.
- Final full gate; PR; verify on `main`.

---

## Definition of done (whole arc)

- One surface: no `code` `WorkspaceMode`; plain chats show no rail; repo conversations morph in the rail.
- `resolveCodeRail` fully unit-covered; hook + rail + sidebar source-text wired; e2e covers reveal/collapse/pin/mobile.
- The two sidebars are one; `CodeView`/comux 3-column shell deleted; no dead imports.
- All six required checks green on each PR; new tests wired into `scripts/run-tests.mjs`.
