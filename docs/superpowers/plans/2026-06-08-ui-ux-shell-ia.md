# Cave shell + IA redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace today's overlapping shell affordances with one clear pattern: avatar rail (who you're with) + sidebar (where you are) + companion rail (about that familiar) + detail (active surface). Remove the dual chat/browser right-strip, the topbar "Chat with Nova" pill, and fold Sessions/Schedules/Plugins/Agents into related surfaces.

**Architecture:** Five phases, each independently shippable: (1) new leftmost avatar rail + reorganized sidebar, (2) unified 3-tab companion rail (Chat/Inspector/Memory), (3) surface folds + mode-router shrink, (4) new topbar + system-banner channel + extended keybindings, (5) polish + dead-code sweep + localStorage migration. Each phase commits multiple times; behavior regressions blocked by source-pattern tests + an end-to-end smoke run.

**Tech Stack:** Next.js 16 (App Router) + Tailwind v4 + TypeScript 5 + Tauri 2 + `react-resizable-panels` for shell chrome. Tests via `node --test --experimental-strip-types` against `.test.ts` files alongside source (source-pattern style: read the file, assert regex matches — see `src/components/sidebar-minimal.test.ts` for the pattern). Phosphor icons via `@iconify-json/ph`.

**Spec:** `docs/superpowers/specs/2026-06-08-ui-ux-shell-ia-design.md`

**Branch:** Work on `feat/shell-ia-redesign` off `main`. Every commit signed with `-S`. Tests must pass at every commit; pre-existing failures recorded in pre-flight.

---

## Pre-flight

- [ ] **Step 0.1: Create the feature branch**

```bash
git checkout main
git pull origin main --ff-only
git checkout -b feat/shell-ia-redesign
```

- [ ] **Step 0.2: Confirm signing config**

```bash
git config --get user.signingkey
git config --get gpg.format
```

Expected: both return non-empty. If either is empty, STOP and ask the user to configure signing — DO NOT proceed with unsigned commits. Per global CLAUDE.md rule, every commit on this branch ships verified to the remote.

- [ ] **Step 0.3: Baseline typecheck + tests**

```bash
pnpm typecheck 2>&1 | tail -5
node --test --experimental-strip-types src/lib/*.test.ts src/components/*.test.ts 2>&1 | tail -15
```

Expected: typecheck clean. Record the pass/fail count and any pre-existing failures. Treat any test passing today that fails later in this plan as a regression.

- [ ] **Step 0.4: Snapshot the current shell for visual diff**

```bash
pnpm dev &
sleep 5
node scripts/screenshot-sessions.mjs --out screenshots/baseline-shell.png 2>/dev/null || \
  echo "screenshot script unavailable — capture manually via the running dev server at http://localhost:3000"
kill %1 2>/dev/null
```

Keep `screenshots/baseline-shell.png` outside git (it's for your own before/after compare; the existing `screenshots/` is for releases).

---

## File structure (decomposition lock-in)

**New files (8):**

| Path | Purpose |
|---|---|
| `src/lib/familiar-memory.ts` | Per-familiar last-surface + rail open/closed persistence helpers (localStorage); pure functions, no React |
| `src/lib/familiar-memory.test.ts` | Pattern tests for the persistence helpers (get/set/clear, namespaced keys) |
| `src/lib/shell-banners.ts` | `useShellBanners()` hook + context provider for the unified banner channel |
| `src/lib/shell-banners.test.ts` | Pattern tests for the banner channel (push/dismiss/severity ordering) |
| `src/components/familiar-avatar-rail.tsx` | 52px leftmost zone — avatar stack, presence dots, unread badges, `+`/`≡` buttons |
| `src/components/familiar-avatar-rail.test.ts` | Pattern tests: zone width, avatar count, badge rendering, `+`/`≡` handlers |
| `src/components/companion-rail.tsx` | Unified right rail with Chat / Inspector / Memory tabs + per-familiar header |
| `src/components/companion-rail.test.ts` | Pattern tests: 3 tabs, header binding, empty/edge states |

**Modified files (12):**

| Path | What changes |
|---|---|
| `src/lib/workspace-mode.ts` | Shrink `WorkspaceMode` union from 13 to 9 entries |
| `src/components/shell.tsx` | Add `familiarRail` slot before nav; remove `agentExtra`/`agentLabel`/`agentIcon` props |
| `src/components/workspace.tsx` | Remove `IconNavStrip`, `stripLock`, `shellAgentPane`; wire avatar rail + companion rail; new keybindings; mode-router shrinks |
| `src/components/sidebar-minimal.tsx` | Regroup `FOLDER_MODES` into Work / Knowledge / Tools; rename "Tasks" → "Board", "Chats" → "Chat"; move Settings to bottom; remove Sessions / Schedules / Plugins entries |
| `src/components/familiar-rail.tsx` | Demoted — content (configurator panel) moves into Settings · Familiars later; component file deleted in Phase 5 |
| `src/components/agents-view.tsx` | Strip Floor + Memory scopes; renamed/repurposed as `chat-view` (Phase 3) |
| `src/components/agent-panel.tsx` | Strip the internal `FamiliarStrip` (avatar rail handles that now); slim down to just chat |
| `src/components/inspector-pane.tsx` | Add a `<RailInspector>` slim variant export for the rail tab |
| `src/components/agents-memory-view.tsx` | Add a `<RailMemoryList>` slim variant export (no 3D) for the rail tab |
| `src/components/inbox-escalations-view.tsx` | Add `<SchedulesTab>` sub-tab containing today's `automations-view` |
| `src/components/library-view.tsx` | Add `<ProjectsTab>` sub-tab; existing `comux-view` "projects" mode renders inside it |
| `src/components/settings-shell.tsx` | Add Plugins panel (mounting `plugins-view`); add Familiars panel (mounting today's familiar-rail configurator) |

**Renames:**

| Path before | Path after | Why |
|---|---|---|
| `src/components/agents-view.tsx` | `src/components/chat-view.tsx` | "agents" mode → "chat" surface; keep symbol-level diff small by renaming file in Phase 3 commit |
| `src/components/agents-view.test.ts` | `src/components/chat-view.test.ts` | matches rename |
| `src/components/agents-chat-switching.test.ts` | `src/components/chat-switching.test.ts` | matches rename |
| `src/components/agents-memory-graph.test.ts` | unchanged | memory view stays around for the rail's slim variant |

**Deleted files (Phase 5):**

| Path | Why |
|---|---|
| `src/components/familiar-rail.tsx` | Replaced by `familiar-avatar-rail.tsx`; configurator panel moved to Settings · Familiars |
| `src/styles/sessions-view.css` *(if no longer imported)* | Sessions becomes a sub-view of Chat using the chat list styling |

---

## Phase 1 — Avatar rail + sidebar reorg

Adds the leftmost 52px avatar rail, reshuffles the sidebar into Work/Knowledge/Tools, and introduces per-familiar memory. No behavior is removed in this phase — the old `IconNavStrip` and old `SidebarMinimal` modes stay reachable until Phase 3.

### Task 1.1 — Per-familiar memory helpers

**Files:**
- Create: `src/lib/familiar-memory.ts`
- Test: `src/lib/familiar-memory.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/familiar-memory.test.ts
// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./familiar-memory.ts", import.meta.url), "utf8");

assert.match(source, /export function getActiveFamiliar\(\)/);
assert.match(source, /export function setActiveFamiliar\(id: string \| null\)/);
assert.match(source, /export function getLastSurface\(familiarId: string\)/);
assert.match(source, /export function setLastSurface\(familiarId: string, surface: string\)/);
assert.match(source, /export function getRailOpen\(familiarId: string\)/);
assert.match(source, /export function setRailOpen\(familiarId: string, open: boolean\)/);
assert.match(source, /cave:active-familiar/);
assert.match(source, /cave:familiar:\$\{familiarId\}:last-surface/);
assert.match(source, /cave:familiar:\$\{familiarId\}:rail\.open/);
assert.match(
  source,
  /typeof window === "undefined"/,
  "All readers must SSR-guard",
);
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
node --test --experimental-strip-types src/lib/familiar-memory.test.ts 2>&1 | tail -10
```

Expected: FAIL — `familiar-memory.ts` does not exist.

- [ ] **Step 3: Implement the helpers**

```ts
// src/lib/familiar-memory.ts
//
// Per-familiar shell state persistence. All keys live under the `cave:` prefix
// so a future sweep can clean orphans by namespace.
//
// All readers SSR-guard (Next.js renders this code on both server and client).

const ACTIVE_KEY = "cave:active-familiar";

function safeGet(key: string): string | null {
  if (typeof window === "undefined") return null;
  try { return window.localStorage.getItem(key); } catch { return null; }
}

function safeSet(key: string, value: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch { /* quota / strict-privacy — give up silently */ }
}

export function getActiveFamiliar(): string | null {
  return safeGet(ACTIVE_KEY);
}

export function setActiveFamiliar(id: string | null): void {
  safeSet(ACTIVE_KEY, id);
}

export function getLastSurface(familiarId: string): string | null {
  return safeGet(`cave:familiar:${familiarId}:last-surface`);
}

export function setLastSurface(familiarId: string, surface: string): void {
  safeSet(`cave:familiar:${familiarId}:last-surface`, surface);
}

export function getRailOpen(familiarId: string): boolean {
  const raw = safeGet(`cave:familiar:${familiarId}:rail.open`);
  return raw === "1"; // default closed
}

export function setRailOpen(familiarId: string, open: boolean): void {
  safeSet(`cave:familiar:${familiarId}:rail.open`, open ? "1" : "0");
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
node --test --experimental-strip-types src/lib/familiar-memory.test.ts 2>&1 | tail -5
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/familiar-memory.ts src/lib/familiar-memory.test.ts
git commit -S -m "$(cat <<'EOF'
feat(shell): per-familiar memory helpers

Adds cave:active-familiar + per-familiar last-surface and rail-open
keys. Pure functions, SSR-guarded reads. Used by the new avatar rail
in Phase 1 and the unified companion rail in Phase 2.

Spec: docs/superpowers/specs/2026-06-08-ui-ux-shell-ia-design.md

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

Then verify it signed:

```bash
git log -1 --show-signature 2>&1 | head -3
```

Expected output contains `Good "ssh" signature` (or equivalent). If signing failed, STOP — do not proceed until fixed.

### Task 1.2 — Familiar avatar rail component

**Files:**
- Create: `src/components/familiar-avatar-rail.tsx`
- Test: `src/components/familiar-avatar-rail.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/components/familiar-avatar-rail.test.ts
// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./familiar-avatar-rail.tsx", import.meta.url), "utf8");

assert.match(
  source,
  /export function FamiliarAvatarRail/,
  "Component must be named FamiliarAvatarRail",
);
assert.match(
  source,
  /familiar-avatar-rail/,
  "Root element must carry the .familiar-avatar-rail class for CSS hooks",
);
assert.match(
  source,
  /familiar-avatar-rail__avatar/,
  "Avatar buttons must carry the avatar class",
);
assert.match(
  source,
  /familiar-avatar-rail__avatar--active/,
  "Active state must be expressible via class modifier",
);
assert.match(
  source,
  /familiar-avatar-rail__add/,
  "Add (+) button must be present",
);
assert.match(
  source,
  /familiar-avatar-rail__toggle/,
  "Sidebar toggle (≡) button must be present at the bottom",
);
assert.match(
  source,
  /onSelect/,
  "Component must accept an onSelect handler for clicking an avatar",
);
assert.match(
  source,
  /onAddFamiliar/,
  "Component must accept an onAddFamiliar handler for the + button",
);
assert.match(
  source,
  /onToggleSidebar/,
  "Component must accept an onToggleSidebar handler for the ≡ button",
);
assert.match(
  source,
  /aria-label/,
  "Buttons must have aria-labels for screen readers",
);
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
node --test --experimental-strip-types src/components/familiar-avatar-rail.test.ts 2>&1 | tail -10
```

Expected: FAIL — `familiar-avatar-rail.tsx` does not exist.

- [ ] **Step 3: Implement the component**

```tsx
// src/components/familiar-avatar-rail.tsx
"use client";

import { useMemo } from "react";
import { Icon } from "@/lib/icon";
import { FamiliarGlyph } from "@/components/familiar-glyph";
import { resolveFamiliarGlyph } from "@/lib/familiar-glyph";
import { useGlyphOverrides } from "@/lib/cave-glyph-overrides";
import { computePresence, REMOTE_HARNESSES } from "@/lib/presence";
import type { Familiar, SessionRow } from "@/lib/types";

type Props = {
  familiars: Familiar[];
  activeId: string | null;
  sessions: SessionRow[];
  responseNeeded: Set<string>;
  harnessInstalled?: (harnessId: string) => boolean | undefined;
  onSelect: (id: string) => void;
  onAddFamiliar: () => void;
  onToggleSidebar: () => void;
};

export function FamiliarAvatarRail({
  familiars,
  activeId,
  sessions,
  responseNeeded,
  harnessInstalled,
  onSelect,
  onAddFamiliar,
  onToggleSidebar,
}: Props) {
  const overrides = useGlyphOverrides();

  const liveCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of sessions) {
      if (!s.familiarId || s.status !== "running") continue;
      m.set(s.familiarId, (m.get(s.familiarId) ?? 0) + 1);
    }
    return m;
  }, [sessions]);

  return (
    <aside
      className="familiar-avatar-rail"
      aria-label="Familiars"
    >
      <ul className="familiar-avatar-rail__list">
        {familiars.map((f) => {
          const active = f.id === activeId;
          const needsReply = responseNeeded.has(f.id);
          const presence = computePresence({
            familiar: f,
            sessions,
            needsReply,
            harnessInstalled: f.harness ? harnessInstalled?.(f.harness) : undefined,
            isRemoteHarness: f.harness ? REMOTE_HARNESSES.has(f.harness) : false,
          });
          const liveCount = liveCounts.get(f.id) ?? 0;
          return (
            <li key={f.id}>
              <button
                type="button"
                className={`familiar-avatar-rail__avatar${active ? " familiar-avatar-rail__avatar--active" : ""}`}
                aria-label={`${f.display_name}${needsReply ? ` — reply needed` : ""}${liveCount ? ` — ${liveCount} live` : ""}`}
                aria-pressed={active}
                title={`${f.display_name} · ${presence.label}`}
                onClick={() => onSelect(f.id)}
              >
                <FamiliarGlyph
                  glyph={resolveFamiliarGlyph(f, overrides)}
                  size="sm"
                />
                <span
                  className={`familiar-avatar-rail__presence ${presence.dot}`}
                  aria-hidden
                />
                {needsReply ? (
                  <span
                    className="familiar-avatar-rail__unread"
                    aria-hidden
                  >
                    {/* No count shown for v1 — just a dot. Count can come later. */}
                  </span>
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>

      <button
        type="button"
        className="familiar-avatar-rail__add"
        aria-label="Add familiar"
        title="Add familiar"
        onClick={onAddFamiliar}
      >
        <Icon name="ph:plus-bold" width={12} />
      </button>

      <button
        type="button"
        className="familiar-avatar-rail__toggle"
        aria-label="Toggle sidebar"
        title="Toggle sidebar (⌘B)"
        onClick={onToggleSidebar}
      >
        <Icon name="ph:sidebar-simple" width={14} />
      </button>
    </aside>
  );
}
```

- [ ] **Step 4: Add the CSS**

Append the following block to `src/app/globals.css` (search for an existing `.shell-` block as a placement reference — keep these grouped):

```css
/* ────────────────────────────────────────────────
   Familiar avatar rail — leftmost 52px zone
   (Phase 1, shell-ia-redesign)
   ──────────────────────────────────────────────── */

.familiar-avatar-rail {
  width: 52px;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 12px 0;
  gap: 12px;
  background: var(--bg-panel);
  border-right: 1px solid var(--border-hairline);
  user-select: none;
}

.familiar-avatar-rail__list {
  display: flex;
  flex-direction: column;
  gap: 12px;
  overflow-y: auto;
  flex: 1;
  min-height: 0;
  width: 100%;
  align-items: center;
  scrollbar-width: thin;
}

.familiar-avatar-rail__avatar {
  position: relative;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  border: none;
  background: var(--bg-raised);
  display: grid;
  place-items: center;
  cursor: pointer;
  transition: transform var(--duration-fast) var(--ease-standard);
}

.familiar-avatar-rail__avatar:hover {
  transform: scale(1.06);
}

.familiar-avatar-rail__avatar--active::before {
  content: "";
  position: absolute;
  left: -10px;
  top: 6px;
  bottom: 6px;
  width: 3px;
  border-radius: 3px;
  background: var(--accent-presence);
}

.familiar-avatar-rail__presence {
  position: absolute;
  right: -1px;
  bottom: -1px;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  border: 2px solid var(--bg-panel);
}

.familiar-avatar-rail__unread {
  position: absolute;
  right: -2px;
  top: -2px;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--color-danger);
  border: 2px solid var(--bg-panel);
}

.familiar-avatar-rail__add,
.familiar-avatar-rail__toggle {
  width: 26px;
  height: 26px;
  border-radius: 50%;
  background: transparent;
  border: 1px dashed var(--border-strong);
  color: var(--text-muted);
  display: grid;
  place-items: center;
  cursor: pointer;
  transition: color var(--duration-fast) var(--ease-standard),
              background var(--duration-fast) var(--ease-standard);
}

.familiar-avatar-rail__add:hover,
.familiar-avatar-rail__toggle:hover {
  color: var(--text-primary);
  background: var(--bg-hover);
}

.familiar-avatar-rail__toggle {
  border-style: none;
  margin-top: auto;
}
```

- [ ] **Step 5: Run the component test to verify it passes**

```bash
node --test --experimental-strip-types src/components/familiar-avatar-rail.test.ts 2>&1 | tail -5
```

Expected: PASS.

- [ ] **Step 6: Run typecheck**

```bash
pnpm typecheck 2>&1 | tail -10
```

Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add src/components/familiar-avatar-rail.tsx src/components/familiar-avatar-rail.test.ts src/app/globals.css
git commit -S -m "$(cat <<'EOF'
feat(shell): familiar avatar rail component

Adds the leftmost 52px zone: avatar stack with presence dots, unread
badges, active indicator, + button (open onboarding), and ≡ toggle
(sidebar collapse). Not yet wired into the shell — that lands in the
next task.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
git log -1 --show-signature 2>&1 | head -3
```

Verify signature line shows `Good "ssh" signature`.

### Task 1.3 — Add familiarRail slot to Shell

**Files:**
- Modify: `src/components/shell.tsx`

- [ ] **Step 1: Read the current Shell prop list**

```bash
sed -n '92,114p' src/components/shell.tsx
```

You should see the `ShellInner` prop signature starting with `nav`, `iconNav`, `list`, `detail`, `agent`, etc.

- [ ] **Step 2: Add `familiarRail` prop ahead of `nav`**

Edit `src/components/shell.tsx`. In the `ShellInner` function signature, add `familiarRail` to the props type:

```diff
 function ShellInner({
+  familiarRail,
   nav,
   iconNav,
   list,
   detail,
   agent,
   agentLabel,
   agentIcon,
   agentExtra,
   bottom,
   topBar,
 }: {
+  familiarRail?: ReactNode;
   nav: ReactNode;
   iconNav?: ReactNode;
```

- [ ] **Step 3: Render the slot in the layout**

In the same file, find the outermost layout wrapper (search for `flex flex-1 min-h-0` — that's the row container around the horizontal group). Wrap the familiar-rail slot as the first child:

```diff
-      <div className="flex flex-1 min-h-0">
+      <div className="flex flex-1 min-h-0">
+        {familiarRail}
         {/* Left nav tab — persistent full-height strip, mirrors agent tab on the right */}
         {hasIconNav && (
```

The `familiarRail` ReactNode is already a styled `<aside>` from Task 1.2; no extra wrapper needed.

- [ ] **Step 4: Update the SSR fallback path**

Find the `!mounted` branch (around line 215):

```diff
   if (!mounted) {
     return (
       <div className="flex h-full w-full flex-col">
         {topBar}
-        <div className="shell-root flex-1 min-h-0" />
+        <div className="flex flex-1 min-h-0">
+          {familiarRail}
+          <div className="shell-root flex-1 min-h-0" />
+        </div>
       </div>
     );
   }
```

Without this the avatar rail flashes in after hydration.

- [ ] **Step 5: Run typecheck**

```bash
pnpm typecheck 2>&1 | tail -5
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/components/shell.tsx
git commit -S -m "$(cat <<'EOF'
feat(shell): add familiarRail slot to Shell

Adds an optional familiarRail ReactNode prop that renders as the first
child of the shell's row container. Slot lives ahead of the existing
nav-tab and horizontal group, so it persists across all panel
toggles. SSR fallback updated.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
git log -1 --show-signature 2>&1 | head -3
```

### Task 1.4 — Wire avatar rail into Workspace + persistence

**Files:**
- Modify: `src/components/workspace.tsx`

- [ ] **Step 1: Import the new component and memory helpers**

At the top of `src/components/workspace.tsx`, add (next to the other component imports):

```diff
 import { FamiliarGlyphPicker } from "@/components/familiar-glyph-picker";
 import { Shell, type ShellHandle } from "@/components/shell";
+import { FamiliarAvatarRail } from "@/components/familiar-avatar-rail";
+import {
+  getActiveFamiliar,
+  setActiveFamiliar,
+  getLastSurface,
+  setLastSurface,
+} from "@/lib/familiar-memory";
```

- [ ] **Step 2: Hydrate `activeId` from persistence on mount**

Find the existing `const [activeId, setActiveId] = useState<string | null>(null);` line and replace with a lazy initializer:

```diff
-  const [activeId, setActiveId] = useState<string | null>(null);
+  const [activeId, setActiveId] = useState<string | null>(() => getActiveFamiliar());
```

- [ ] **Step 3: Persist active familiar whenever it changes**

Below the existing state declarations, add an effect:

```ts
useEffect(() => {
  setActiveFamiliar(activeId);
}, [activeId]);
```

Place it near the top of the component body, after the state declarations and before the data-loading effects.

- [ ] **Step 4: Build a select handler that restores last-surface**

Add this callback near the other `useCallback`s (after `loadFamiliars`):

```ts
const selectFamiliar = useCallback((id: string) => {
  setActiveId(id);
  const last = getLastSurface(id);
  if (last) setMode(last as WorkspaceMode);
}, []);
```

- [ ] **Step 5: Persist surface changes per-familiar**

Find the existing `setMode(...)` call sites. Add a `useEffect` that records the new surface against the active familiar:

```ts
useEffect(() => {
  if (activeId) setLastSurface(activeId, mode);
}, [activeId, mode]);
```

Place it next to the existing mode-related effects.

- [ ] **Step 6: Render the avatar rail via the new Shell slot**

Find the `<Shell ... />` call at the bottom of `Workspace`. Add the `familiarRail` prop:

```diff
       <Shell
         ref={shellRef}
+        familiarRail={
+          <FamiliarAvatarRail
+            familiars={familiars}
+            activeId={activeId}
+            sessions={sessions}
+            responseNeeded={responseNeeded}
+            onSelect={selectFamiliar}
+            onAddFamiliar={openOnboarding}
+            onToggleSidebar={() => shellRef.current?.toggleNav()}
+          />
+        }
         nav={sidebar}
         iconNav={iconNav}
```

- [ ] **Step 7: Run typecheck**

```bash
pnpm typecheck 2>&1 | tail -5
```

Expected: clean.

- [ ] **Step 8: Manual smoke**

```bash
pnpm dev
```

Open `http://localhost:3000`. You should see the new 52px avatar rail on the far left, with one round avatar per familiar. Clicking one selects it. Click `+` opens onboarding. Click `≡` toggles the sidebar. Refresh — the last active familiar should persist.

Kill the dev server (Ctrl-C) when done.

- [ ] **Step 9: Commit**

```bash
git add src/components/workspace.tsx
git commit -S -m "$(cat <<'EOF'
feat(shell): wire avatar rail into workspace with per-familiar memory

Active familiar is now persisted across sessions. Switching restores
that familiar's last visited surface (or stays on Home if none).
Avatar rail's + button opens onboarding; ≡ toggles the sidebar via
the existing ShellHandle.

The old IconNavStrip + existing FamiliarRail panel are still mounted
in their old places — they will be removed in Phase 3 + Phase 5
respectively to keep this commit reversible.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
git log -1 --show-signature 2>&1 | head -3
```

### Task 1.5 — Reorganize sidebar to Work / Knowledge / Tools

**Files:**
- Modify: `src/components/sidebar-minimal.tsx`
- Modify: `src/components/sidebar-minimal.test.ts`

- [ ] **Step 1: Update the existing tests for the new structure**

Open `src/components/sidebar-minimal.test.ts` and replace the existing assertions that reference the old layout. The key assertions for the new structure:

```ts
// Replace the existing "Sidebar Work section should include..." assertion with:
assert.match(
  source,
  /fm\.id === "chat" \|\| fm\.id === "board" \|\| fm\.id === "calendar" \|\| fm\.id === "inbox"/,
  "Sidebar Work section must include Chat, Board, Calendar, and Inbox after the reorg",
);

assert.match(
  source,
  /\{ id: "library", label: "Library"/,
  "Library remains the sole Knowledge surface",
);

assert.match(
  source,
  /\{ id: "browser", label: "Browser"/,
  "Browser remains a Tools surface",
);

assert.match(
  source,
  /\{ id: "terminal", label: "Terminal"/,
  "Terminal remains a Tools surface",
);

assert.match(
  source,
  /\{ id: "board", label: "Board"/,
  "Tasks is renamed to Board",
);

assert.doesNotMatch(
  source,
  /\{ id: "sessions"/,
  "Sessions row removed — folded into Chat surface as History sub-view",
);

assert.doesNotMatch(
  source,
  /\{ id: "schedules"/,
  "Schedules row removed — folded into Inbox as a tab",
);

assert.doesNotMatch(
  source,
  /\{ id: "plugins"/,
  "Plugins row removed — moved into Settings · Plugins",
);
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
node --test --experimental-strip-types src/components/sidebar-minimal.test.ts 2>&1 | tail -10
```

Expected: FAIL — the source still has the old structure.

- [ ] **Step 3: Update FOLDER_MODES / UTILITY_MODES**

Replace the existing `FOLDER_MODES` and `UTILITY_MODES` constants in `src/components/sidebar-minimal.tsx` with:

```ts
const FOLDER_MODES: Array<{
  id: FolderMode;
  label: string;
  iconName: Parameters<typeof Icon>[0]["name"];
  badge?: (props: SidebarMinimalProps) => string | undefined;
  group: "work" | "knowledge" | "tools" | "addons";
  kbd?: string;
}> = [
  // Work
  { id: "home",     label: "Home",     iconName: "ph:house",            group: "work",      kbd: "⌘1" },
  { id: "chat",     label: "Chat",     iconName: "ph:chats",            group: "work",      kbd: "⌘2" },
  { id: "board",    label: "Board",    iconName: "ph:kanban",           group: "work",      kbd: "⌘3" },
  { id: "calendar", label: "Calendar", iconName: "ph:calendar-blank",   group: "work",      kbd: "⌘4" },
  { id: "inbox",    label: "Inbox",    iconName: "ph:tray",             group: "work",      kbd: "⌘5" },
  // Knowledge
  { id: "library",  label: "Library",  iconName: "ph:books",            group: "knowledge", kbd: "⌘6" },
  // Tools
  { id: "browser",  label: "Browser",  iconName: "ph:globe",            group: "tools",     kbd: "⌘7" },
  { id: "terminal", label: "Terminal", iconName: "ph:terminal-window",  group: "tools",     kbd: "⌘8" },
  // Add-ons (gated)
  { id: "github",   label: "GitHub",   iconName: "ph:github-logo",      group: "addons" },
];

// Empty — Roles/Schedules/Plugins all fold into other surfaces or Settings.
const UTILITY_MODES: Array<never> = [];

export { FOLDER_MODES, UTILITY_MODES };
```

- [ ] **Step 4: Update `FolderMode` type**

Near the top of the file:

```diff
 export type FolderMode =
-  | "agents"
-  | "sessions"
+  | "home"
+  | "chat"
   | "board"
+  | "calendar"
+  | "inbox"
   | "terminal"
-  | "projects"
   | "browser"
   | "github"
   | "library";
```

- [ ] **Step 5: Restructure the render**

Replace the `<nav className="sidebar-minimal">` body with a grouped layout. Remove the `primaryFolderModes` / `toolFolderModes` / `addinFolderModes` filtering and the empty UTILITY_MODES rendering:

```tsx
return (
  <nav className="sidebar-minimal">
    <div className="sidebar-actions sidebar-action-stack">
      <ActionRow
        icon={<Icon name="ph:magnifying-glass" width={14} />}
        label="Search"
        onClick={onOpenSearch}
        trailing={<kbd className="sidebar-action-kbd">⌘K</kbd>}
      />
      <ActionRow
        icon={<Icon name="ph:note-pencil" width={14} />}
        label="New chat"
        onClick={onNewChat}
      />
    </div>

    <div className="sidebar-nav-scroll">
      <SidebarSection label="Work">
        {visibleFolderModes.filter((fm) => fm.group === "work").map((fm) => (
          <FolderRow
            key={fm.id}
            id={fm.id}
            label={fm.label}
            iconName={fm.iconName}
            active={mode === fm.id}
            badge={fm.badge?.(props)}
            kbd={fm.kbd}
            onClick={() => onModeChange(fm.id)}
          />
        ))}
      </SidebarSection>

      <SidebarSection label="Knowledge">
        {visibleFolderModes.filter((fm) => fm.group === "knowledge").map((fm) => (
          <FolderRow
            key={fm.id}
            id={fm.id}
            label={fm.label}
            iconName={fm.iconName}
            active={mode === fm.id}
            badge={fm.badge?.(props)}
            kbd={fm.kbd}
            onClick={() => onModeChange(fm.id)}
          />
        ))}
      </SidebarSection>

      <SidebarSection label="Tools">
        {visibleFolderModes.filter((fm) => fm.group === "tools" || fm.group === "addons").map((fm) => (
          <FolderRow
            key={fm.id}
            id={fm.id}
            label={fm.label}
            iconName={fm.iconName}
            active={mode === fm.id}
            badge={fm.badge?.(props)}
            kbd={fm.kbd}
            onClick={() => onModeChange(fm.id)}
          />
        ))}
      </SidebarSection>
    </div>

    <div className="sidebar-foot">
      {showNotifications ? (
        <div className="sidebar-foot-bell">
          <NotificationBell
            items={inboxItems ?? []}
            familiars={familiars ?? []}
            prefs={inboxPrefs!}
            badgeCount={notificationBadgeCount}
            onOpenInbox={onOpenInbox!}
            onOpenItem={onOpenInboxItem}
            onPrefsChanged={onNotificationPrefsChanged!}
          />
          <span className="sidebar-foot-label">Notifications</span>
        </div>
      ) : null}
      <button
        type="button"
        className="sidebar-foot-btn"
        onClick={onOpenSettings}
        aria-label="Settings"
        title="Settings"
      >
        <span className="sidebar-foot-icon-cell" aria-hidden="true">
          <Icon name="ph:gear-six" width={14} className="sidebar-foot-icon" />
        </span>
        <span className="sidebar-foot-label">Settings</span>
      </button>
    </div>
  </nav>
);
```

- [ ] **Step 6: Update FolderRow to accept and render `kbd`**

```diff
 function FolderRow({
   id,
   label,
   iconName,
   active,
   badge,
+  kbd,
   onClick,
 }: {
   id: string;
   label: string;
   iconName: Parameters<typeof Icon>[0]["name"];
   active: boolean;
   badge?: string;
+  kbd?: string;
   onClick: () => void;
 }) {
   return (
     <button
       type="button"
       className={`sidebar-folder-row${active ? " sidebar-folder-row--active" : ""}`}
       aria-current={active ? "page" : undefined}
       onClick={onClick}
     >
       <Icon name={iconName} width={15} className="sidebar-folder-icon" />
       <span className="sidebar-folder-label">{label}</span>
       {badge && <span className="sidebar-badge">{badge}</span>}
+      {kbd && !badge && <kbd className="sidebar-folder-kbd">{kbd}</kbd>}
     </button>
   );
 }
```

- [ ] **Step 7: Add CSS for the new `kbd` chip**

Append to `src/styles/sidebar-minimal.css`:

```css
.sidebar-folder-kbd {
  margin-left: auto;
  font-family: var(--font-geist-mono);
  font-size: 10px;
  color: var(--text-muted);
  opacity: 0.7;
}

.sidebar-folder-row:hover .sidebar-folder-kbd {
  opacity: 1;
}
```

- [ ] **Step 8: Run the sidebar test**

```bash
node --test --experimental-strip-types src/components/sidebar-minimal.test.ts 2>&1 | tail -10
```

Expected: PASS.

- [ ] **Step 9: Run the full test suite + typecheck**

```bash
pnpm typecheck 2>&1 | tail -5
node --test --experimental-strip-types src/lib/*.test.ts src/components/*.test.ts 2>&1 | tail -15
```

Expected: typecheck clean. Tests: same failures as the baseline from Step 0.3, plus any tests that explicitly named "agents"/"sessions"/"plugins" sidebar entries (which now don't exist — those tests are addressed in later phases when their views move).

Record any new failures — you'll resolve them as part of the matching surface-fold task.

- [ ] **Step 10: Commit**

```bash
git add src/components/sidebar-minimal.tsx src/components/sidebar-minimal.test.ts src/styles/sidebar-minimal.css
git commit -S -m "$(cat <<'EOF'
feat(sidebar): regroup into Work / Knowledge / Tools

Sidebar shrinks from 12 entries to 9 + Settings, grouped by purpose.
"Tasks" → "Board". Sessions/Schedules/Plugins entries removed —
their content folds into Chat/Inbox/Settings in Phase 3. Adds ⌘1–⌘8
keyboard hints; bindings themselves land in Phase 4.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
git log -1 --show-signature 2>&1 | head -3
```

### Task 1.6 — Drop the legacy IconNavStrip wiring

**Files:**
- Modify: `src/components/workspace.tsx`

The new avatar rail now occupies the visual position the old `IconNavStrip` used. Remove `iconNav` from the Shell call but leave the function definition until Phase 5's dead-code sweep (so reverting Phase 1 stays one commit away).

- [ ] **Step 1: Remove the iconNav prop from the Shell call**

Find the `<Shell ... />` call in `Workspace`:

```diff
       <Shell
         ref={shellRef}
         familiarRail={
           ...
         }
         nav={sidebar}
-        iconNav={iconNav}
         list={list}
```

- [ ] **Step 2: Run typecheck and full test suite**

```bash
pnpm typecheck 2>&1 | tail -5
node --test --experimental-strip-types src/lib/*.test.ts src/components/*.test.ts 2>&1 | tail -10
```

Expected: typecheck clean. No new failures vs. Task 1.5 output.

- [ ] **Step 3: Manual smoke**

```bash
pnpm dev
```

Open `http://localhost:3000`. Confirm:

- Avatar rail visible on far left.
- Sidebar now uses Work / Knowledge / Tools grouping.
- Old left-edge icon strip with sidebar-toggle button is gone.
- `≡` button at the bottom of the avatar rail still toggles the sidebar.
- ⌘B keyboard shortcut still toggles the sidebar.

Kill dev server.

- [ ] **Step 4: Commit**

```bash
git add src/components/workspace.tsx
git commit -S -m "$(cat <<'EOF'
chore(shell): stop rendering legacy IconNavStrip

Avatar rail and its bottom ≡ button cover its function. The
IconNavStrip function definition stays in workspace.tsx for one more
phase so a quick revert is possible; it's deleted in Phase 5.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
git log -1 --show-signature 2>&1 | head -3
```

**Phase 1 complete.** Avatar rail, regrouped sidebar, and per-familiar persistence are in. App still builds, no surfaces deleted yet.

---

## Phase 2 — Companion rail unification

The right-side agent pane today is a dual-button strip with a drag-lock that toggles between Chat and Browser. After this phase, the right pane is a unified component with three tabs (Chat / Inspector / Memory), always bound to the active familiar, and Browser is reachable only via the Browser sidebar surface.

### Task 2.1 — CompanionRail component skeleton

**Files:**
- Create: `src/components/companion-rail.tsx`
- Test: `src/components/companion-rail.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/components/companion-rail.test.ts
// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./companion-rail.tsx", import.meta.url), "utf8");

assert.match(source, /export function CompanionRail/);
assert.match(source, /companion-rail__header/);
assert.match(source, /companion-rail__tabs/);
assert.match(
  source,
  /type CompanionTab = "chat" \| "inspector" \| "memory"/,
);
assert.match(
  source,
  /Chat/,
  "Chat label must be rendered",
);
assert.match(
  source,
  /Inspector/,
  "Inspector label must be rendered",
);
assert.match(
  source,
  /Memory/,
  "Memory label must be rendered",
);
assert.match(
  source,
  /No familiar yet/,
  "Empty state copy must be present",
);
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
node --test --experimental-strip-types src/components/companion-rail.test.ts 2>&1 | tail -5
```

Expected: FAIL — file does not exist.

- [ ] **Step 3: Implement the skeleton**

```tsx
// src/components/companion-rail.tsx
"use client";

import { forwardRef, useState, type ReactNode } from "react";
import { Icon } from "@/lib/icon";
import { FamiliarGlyph } from "@/components/familiar-glyph";
import { resolveFamiliarGlyph } from "@/lib/familiar-glyph";
import { useGlyphOverrides } from "@/lib/cave-glyph-overrides";
import type { ChatRouterHandle } from "@/components/chat-router";
import type { Familiar } from "@/lib/types";

export type CompanionTab = "chat" | "inspector" | "memory";

type Props = {
  familiar: Familiar | null;
  defaultTab?: CompanionTab;
  chatSlot: ReactNode;
  inspectorSlot: ReactNode;
  memorySlot: ReactNode;
  onOpenSwitcher?: () => void;
  onCreateFamiliar?: () => void;
  daemonRunning: boolean;
  onTabChange?: (tab: CompanionTab) => void;
};

export const CompanionRail = forwardRef<ChatRouterHandle, Props>(
  function CompanionRail(props, _ref) {
    const {
      familiar,
      defaultTab = "chat",
      chatSlot,
      inspectorSlot,
      memorySlot,
      onOpenSwitcher,
      onCreateFamiliar,
      daemonRunning,
      onTabChange,
    } = props;
    const overrides = useGlyphOverrides();
    const [tab, setTab] = useState<CompanionTab>(defaultTab);

    if (!familiar) {
      return (
        <aside className="companion-rail companion-rail--empty">
          <div className="companion-rail__empty-body">
            <p className="companion-rail__empty-title">No familiar yet</p>
            <p className="companion-rail__empty-sub">
              Pick a familiar from the rail on the left, or create one.
            </p>
            {onCreateFamiliar ? (
              <button
                type="button"
                className="companion-rail__empty-cta"
                onClick={onCreateFamiliar}
              >
                <Icon name="ph:plus-bold" width={11} /> Create familiar
              </button>
            ) : null}
          </div>
        </aside>
      );
    }

    const switchTab = (next: CompanionTab) => {
      setTab(next);
      onTabChange?.(next);
    };

    return (
      <aside className="companion-rail">
        <header className="companion-rail__header">
          <span className="companion-rail__glyph">
            <FamiliarGlyph
              glyph={resolveFamiliarGlyph(familiar, overrides)}
              size="sm"
            />
          </span>
          <button
            type="button"
            className="companion-rail__name"
            onClick={onOpenSwitcher}
            aria-label="Switch familiar"
          >
            <span>{familiar.display_name}</span>
            <Icon name="ph:caret-down" width={10} />
          </button>
          <span
            className={`companion-rail__status${daemonRunning ? "" : " companion-rail__status--off"}`}
            title={daemonRunning ? "Live" : "Daemon offline"}
            aria-hidden
          />
        </header>
        <nav className="companion-rail__tabs" aria-label="Companion sections">
          <button
            type="button"
            className={`companion-rail__tab${tab === "chat" ? " companion-rail__tab--active" : ""}`}
            onClick={() => switchTab("chat")}
            aria-current={tab === "chat"}
          >
            <Icon name="ph:chats" width={11} /> Chat
          </button>
          <button
            type="button"
            className={`companion-rail__tab${tab === "inspector" ? " companion-rail__tab--active" : ""}`}
            onClick={() => switchTab("inspector")}
            aria-current={tab === "inspector"}
          >
            <Icon name="ph:magnifying-glass" width={11} /> Inspector
          </button>
          <button
            type="button"
            className={`companion-rail__tab${tab === "memory" ? " companion-rail__tab--active" : ""}`}
            onClick={() => switchTab("memory")}
            aria-current={tab === "memory"}
          >
            <Icon name="ph:brain" width={11} /> Memory
          </button>
        </nav>
        <div className="companion-rail__body">
          <div hidden={tab !== "chat"} className="companion-rail__pane">
            {chatSlot}
          </div>
          <div hidden={tab !== "inspector"} className="companion-rail__pane">
            {inspectorSlot}
          </div>
          <div hidden={tab !== "memory"} className="companion-rail__pane">
            {memorySlot}
          </div>
        </div>
      </aside>
    );
  },
);
```

(Render each slot under `hidden` rather than conditional so scroll state preserves across tabs.)

- [ ] **Step 4: Add the CSS**

Append to `src/app/globals.css`:

```css
/* ────────────────────────────────────────────────
   Companion rail — right-side per-familiar pane
   (Phase 2, shell-ia-redesign)
   ──────────────────────────────────────────────── */

.companion-rail {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--bg-raised);
  border-left: 1px solid var(--border-hairline);
}

.companion-rail--empty {
  align-items: center;
  justify-content: center;
}

.companion-rail__empty-body {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 24px;
  text-align: center;
}

.companion-rail__empty-title {
  color: var(--text-primary);
  font-weight: 600;
  font-size: var(--text-base);
}

.companion-rail__empty-sub {
  color: var(--text-secondary);
  font-size: var(--text-sm);
  line-height: var(--leading-normal);
}

.companion-rail__empty-cta {
  margin-top: 8px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-radius: var(--radius-control);
  background: var(--bg-elevated);
  color: var(--text-primary);
  border: 1px solid var(--border-hairline);
  font-size: var(--text-sm);
  cursor: pointer;
}

.companion-rail__header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--border-hairline);
}

.companion-rail__glyph {
  width: 24px;
  height: 24px;
  display: grid;
  place-items: center;
}

.companion-rail__name {
  flex: 1;
  background: transparent;
  border: 0;
  padding: 0;
  color: var(--text-primary);
  font-weight: 600;
  font-size: var(--text-base);
  display: inline-flex;
  align-items: center;
  gap: 4px;
  cursor: pointer;
  text-align: left;
}

.companion-rail__status {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--color-success);
}

.companion-rail__status--off {
  background: var(--text-muted);
}

.companion-rail__tabs {
  display: flex;
  gap: 2px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--border-hairline);
  background: var(--bg-panel);
}

.companion-rail__tab {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 5px 10px;
  border-radius: var(--radius-control);
  background: transparent;
  border: 0;
  color: var(--text-secondary);
  font-size: var(--text-sm);
  cursor: pointer;
}

.companion-rail__tab--active {
  background: color-mix(in oklch, var(--accent-presence) 18%, transparent);
  color: var(--text-primary);
}

.companion-rail__body {
  flex: 1;
  min-height: 0;
  position: relative;
  display: flex;
  flex-direction: column;
}

.companion-rail__pane {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.companion-rail__pane[hidden] {
  display: none;
}
```

- [ ] **Step 5: Run the component test + typecheck**

```bash
node --test --experimental-strip-types src/components/companion-rail.test.ts 2>&1 | tail -5
pnpm typecheck 2>&1 | tail -5
```

Expected: PASS + clean.

- [ ] **Step 6: Commit**

```bash
git add src/components/companion-rail.tsx src/components/companion-rail.test.ts src/app/globals.css
git commit -S -m "$(cat <<'EOF'
feat(shell): CompanionRail with Chat/Inspector/Memory tabs

Adds the unified right rail component. Header binds to the active
familiar with an inline switcher caret. Three tabs render their
content via slots (so consumers wire AgentPanel/InspectorPane/
MemoryView). Empty state when no familiar selected.

Not yet mounted — Task 2.2 swaps it in.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
git log -1 --show-signature 2>&1 | head -3
```

### Task 2.2 — Slim rail variants of Inspector + Memory

**Files:**
- Modify: `src/components/inspector-pane.tsx`
- Modify: `src/components/agents-memory-view.tsx`

The full `InspectorPane` and `AgentsMemoryView` are designed for the wide detail pane. The rail pane is 296px — render a slimmer variant.

- [ ] **Step 1: Add `<RailInspector>` export to `inspector-pane.tsx`**

At the bottom of `src/components/inspector-pane.tsx` (after the existing default export), add:

```tsx
// ────────────────────────────────────────────────────────────────────────────
// Rail variant — used by the CompanionRail's Inspector tab.
// Renders the active session's run timeline only — drops side panels and
// padding so it fits in 296px.
// ────────────────────────────────────────────────────────────────────────────

export function RailInspector({
  familiar,
  activeSessionId,
}: {
  familiar: import("@/lib/types").Familiar | null;
  activeSessionId: string | null;
}) {
  if (!familiar) {
    return (
      <div className="rail-empty">
        <p>Pick a familiar.</p>
      </div>
    );
  }
  if (!activeSessionId) {
    return (
      <div className="rail-empty">
        <p className="rail-empty__title">No active session</p>
        <p className="rail-empty__sub">
          Start a chat with {familiar.display_name} to see live tool
          calls and run state here.
        </p>
      </div>
    );
  }
  // Reuse the existing inspector core view but in compact mode.
  // For v1, render the same `InspectorPane` with a compact prop.
  return (
    <div className="rail-inspector">
      <InspectorPane
        familiarId={familiar.id}
        sessionId={activeSessionId}
        compact
      />
    </div>
  );
}
```

(If `InspectorPane` does not currently accept a `compact` prop, add it: `compact?: boolean;` and use it to drop optional side panels.)

Also append the small empty-state CSS to `src/app/globals.css`:

```css
.rail-empty {
  padding: 20px;
  text-align: center;
  color: var(--text-secondary);
  font-size: var(--text-sm);
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.rail-empty__title {
  color: var(--text-primary);
  font-weight: 600;
}

.rail-empty__sub {
  font-size: var(--text-xs);
  color: var(--text-muted);
}
```

- [ ] **Step 2: Add `<RailMemoryList>` export to `agents-memory-view.tsx`**

At the bottom of `src/components/agents-memory-view.tsx`, add:

```tsx
// ────────────────────────────────────────────────────────────────────────────
// Rail variant — most-recent memory writes, no graph.
// The full 3D constellation stays as the detail-pane Memory view; the rail
// tab is a quick "what changed" feed.
// ────────────────────────────────────────────────────────────────────────────

export function RailMemoryList({
  familiar,
  onOpenFullView,
}: {
  familiar: import("@/lib/types").Familiar | null;
  onOpenFullView?: () => void;
}) {
  if (!familiar) {
    return (
      <div className="rail-empty">
        <p>Pick a familiar.</p>
      </div>
    );
  }
  // For v1, render the existing list portion of AgentsMemoryView with
  // its embedded fetch. If the existing component has no list-only
  // mode, add a `mode="list"` prop and use it to drop the graph.
  return (
    <div className="rail-memory">
      <AgentsMemoryView
        familiarId={familiar.id}
        mode="list"
        limit={20}
      />
      {onOpenFullView ? (
        <button
          type="button"
          className="rail-memory__open-full"
          onClick={onOpenFullView}
        >
          Open full memory →
        </button>
      ) : null}
    </div>
  );
}
```

Append to `src/app/globals.css`:

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

- [ ] **Step 3: Run typecheck**

```bash
pnpm typecheck 2>&1 | tail -10
```

Expected: clean. If `compact` / `mode` / `limit` props are flagged, add them to the underlying component types (one-line addition each — they may be no-op for v1 if the components don't yet have a compact rendering branch).

- [ ] **Step 4: Commit**

```bash
git add src/components/inspector-pane.tsx src/components/agents-memory-view.tsx src/app/globals.css
git commit -S -m "$(cat <<'EOF'
feat(rail): slim RailInspector + RailMemoryList variants

Exposes 296px-width-appropriate variants of the existing detail-pane
inspector and memory views. RailInspector renders the active
session's timeline only; RailMemoryList renders the 20 latest memory
writes with a link to the full graph. Used by Task 2.3 to populate
the CompanionRail tabs.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
git log -1 --show-signature 2>&1 | head -3
```

### Task 2.3 — Mount CompanionRail in Workspace

**Files:**
- Modify: `src/components/workspace.tsx`
- Modify: `src/components/shell.tsx`

- [ ] **Step 1: Import the new pieces in workspace.tsx**

```diff
 import { Shell, type ShellHandle } from "@/components/shell";
 import { FamiliarAvatarRail } from "@/components/familiar-avatar-rail";
+import { CompanionRail, type CompanionTab } from "@/components/companion-rail";
+import { RailInspector } from "@/components/inspector-pane";
+import { RailMemoryList } from "@/components/agents-memory-view";
 import {
   getActiveFamiliar,
   setActiveFamiliar,
   getLastSurface,
   setLastSurface,
+  getRailOpen,
+  setRailOpen,
 } from "@/lib/familiar-memory";
```

- [ ] **Step 2: Add rail-tab state**

After the existing state declarations:

```ts
const [railTab, setRailTab] = useState<CompanionTab>(() => {
  if (typeof window === "undefined") return "chat";
  return (window.localStorage.getItem("cave:rail.tab") as CompanionTab) ?? "chat";
});
useEffect(() => {
  if (typeof window !== "undefined") window.localStorage.setItem("cave:rail.tab", railTab);
}, [railTab]);
```

- [ ] **Step 3: Replace the `agent` slot value**

Find the `agent` prop on the `<Shell />` call:

```diff
         agent={
-          mode === "browser" ? undefined : shellAgentPane === "chat" ? (
-            <AgentPanel
-              familiar={active}
-              familiars={familiars}
-              activeId={activeId}
-              sessions={sessions}
-              daemonRunning={daemonRunning}
-              onSessionStarted={loadSessions}
-              onSlashFromChat={(command, args) => {
-                onPaletteIntent({ kind: "slash", command, args });
-                return true;
-              }}
-              onOpenOnboarding={openOnboarding}
-              onFamiliarSelect={setActiveId}
-            />
-          ) : (
-            <BrowserPane label="default" activeFamiliarId={active?.id ?? null} />
-          )
+          mode === "browser" ? undefined : (
+            <CompanionRail
+              familiar={active}
+              defaultTab={railTab}
+              onTabChange={setRailTab}
+              daemonRunning={daemonRunning}
+              onCreateFamiliar={openOnboarding}
+              chatSlot={
+                <AgentPanel
+                  familiar={active}
+                  familiars={familiars}
+                  activeId={activeId}
+                  sessions={sessions}
+                  daemonRunning={daemonRunning}
+                  onSessionStarted={loadSessions}
+                  onSlashFromChat={(command, args) => {
+                    onPaletteIntent({ kind: "slash", command, args });
+                    return true;
+                  }}
+                  onOpenOnboarding={openOnboarding}
+                  onFamiliarSelect={selectFamiliar}
+                />
+              }
+              inspectorSlot={
+                <RailInspector
+                  familiar={active}
+                  activeSessionId={routerRef.current?.currentSessionId() ?? null}
+                />
+              }
+              memorySlot={
+                <RailMemoryList
+                  familiar={active}
+                  onOpenFullView={() => setMode("memory" as WorkspaceMode)}
+                />
+              }
+            />
+          )
         }
```

(`"memory"` isn't a current mode but will be added if/when there's a full-view memory surface; for now `setMode` accepting an unknown string is fine because the router falls through to the default. A dedicated Memory surface is out-of-scope for this spec.)

- [ ] **Step 4: Drop the agent-strip props**

```diff
-        agentLabel={stripLock === "chat" ? "Chat" : "Browser"}
-        agentIcon={stripLock === "chat" ? "ph:chats" : "ph:globe"}
-        agentExtra={
-          <>
-            { /* …drag-handle + bottom chat button… */ }
-          </>
-        }
```

Delete that whole `agentExtra` JSX block. Search for `shell-agent-strip-` in the file and delete every line referencing it.

- [ ] **Step 5: Remove `shellAgentPane` and `stripLock` state**

Delete the declarations and any setters:

```diff
-  const [shellAgentPane, setShellAgentPane] = useState<"browser" | "chat">("browser");
-  const [stripLock, setStripLock] = useState<"browser" | "chat">("browser");
```

Search for `shellAgentPane`, `stripLock`, `setShellAgentPane`, `setStripLock` in the file and remove any remaining references.

- [ ] **Step 6: Slim Shell — remove agentExtra/Label/Icon props**

In `src/components/shell.tsx`, remove the now-unused props:

```diff
   nav: ReactNode;
   iconNav?: ReactNode;
   list?: ReactNode;
   detail: ReactNode;
   agent?: ReactNode;
-  agentLabel?: string;
-  agentIcon?: IconName;
-  agentExtra?: ReactNode;
   bottom?: ReactNode;
```

And remove the `shell-agent-tab` block that rendered the dual buttons (search for `hasAgent && (` near the bottom of `ShellInner` — keep the `Panel` rendering for the agent ReactNode itself, but delete the `<div className="shell-agent-tab">...</div>` wrapper).

- [ ] **Step 7: Run typecheck**

```bash
pnpm typecheck 2>&1 | tail -10
```

Expected: clean. If TypeScript complains about now-unused imports in `workspace.tsx` (e.g. `BrowserPane`), remove them:

```diff
-import { BrowserPane, type BrowserPaneHandle } from "@/components/browser-pane";
+import { BrowserPane } from "@/components/browser-pane";
```

(`BrowserPane` is still used by the Browser sidebar surface, just not by the agent slot.)

- [ ] **Step 8: Run the full test suite**

```bash
node --test --experimental-strip-types src/lib/*.test.ts src/components/*.test.ts 2>&1 | tail -15
```

Expected: same baseline failures, plus possibly the `workspace-inspector-mount.test.ts` if it asserts on the old structure. If new failures appear, audit them — most should be addressable with a one-line test update reflecting the new rail layout. Defer the actual test edits to whichever phase ships the matching change; this commit's only requirement is that nothing was passing-and-now-isn't outside of those expected files.

- [ ] **Step 9: Manual smoke**

```bash
pnpm dev
```

Open `http://localhost:3000`. Confirm:

- The right rail now has a header with the active familiar's name + glyph and three tabs (Chat / Inspector / Memory).
- Clicking each tab switches content; chat scroll position is preserved when you switch away and back.
- The old "chat ↑ / browser ↓" drag-lock buttons are gone.
- `⌘J` still toggles the rail open/closed.
- Switching familiars from the avatar rail updates the rail header.

Kill dev server.

- [ ] **Step 10: Commit**

```bash
git add src/components/workspace.tsx src/components/shell.tsx
git commit -S -m "$(cat <<'EOF'
feat(rail): unify right pane into CompanionRail (3 tabs)

Replaces the chat/browser drag-lock dual-button strip with a single
CompanionRail bound to the active familiar. Three tabs:

- Chat → existing AgentPanel
- Inspector → RailInspector (active session timeline)
- Memory → RailMemoryList (latest 20 writes + link to full)

Drops Shell's agentExtra / agentLabel / agentIcon props and the
workspace.tsx stripLock / shellAgentPane state. Browser is no longer
a rail target — open it via the Browser sidebar surface.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
git log -1 --show-signature 2>&1 | head -3
```

**Phase 2 complete.** The right pane is unified; tools live where they belong.

---

## Phase 3 — Surface folds

Today's mode router has 13 branches. After this phase: 9. Folded:
- `agents` → renamed `chat`; sub-tabs (Floor, Memory) absorbed elsewhere
- `sessions` → sub-view of `chat`
- `schedules` → tab inside `inbox`
- `plugins` → panel inside Settings
- `projects` → sub-tab of `library`

### Task 3.1 — Shrink WorkspaceMode type

**Files:**
- Modify: `src/lib/workspace-mode.ts`

- [ ] **Step 1: Replace the type**

```ts
// src/lib/workspace-mode.ts
export type WorkspaceMode =
  | "home"
  | "chat"
  | "board"
  | "calendar"
  | "inbox"
  | "library"
  | "browser"
  | "terminal"
  | "github";
```

- [ ] **Step 2: Run typecheck**

```bash
pnpm typecheck 2>&1 | tail -20
```

Expected: a flood of failures across `workspace.tsx`, `sidebar-minimal.tsx`, `command-palette.tsx`, and any callers referencing the dropped strings. **Don't fix them all here** — leave them as the failing entry-points and fix per fold task. Record the count.

- [ ] **Step 3: Commit (broken build is OK — Phase 3 ships as a unit)**

```bash
git add src/lib/workspace-mode.ts
git commit -S -m "$(cat <<'EOF'
refactor(types): shrink WorkspaceMode to the 9 surfaces

Drops 'agents', 'sessions', 'schedules', 'plugins', 'projects'.
Subsequent tasks in this phase fix the callers. Intentionally
breaks the build between commits — Phase 3 ships as a sequence.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
git log -1 --show-signature 2>&1 | head -3
```

### Task 3.2 — Rename agents → chat (file + symbol)

**Files:**
- Rename: `src/components/agents-view.tsx` → `src/components/chat-view.tsx`
- Rename: `src/components/agents-view.test.ts` → `src/components/chat-view.test.ts`
- Rename: `src/components/agents-chat-switching.test.ts` → `src/components/chat-switching.test.ts`
- Modify: `src/components/workspace.tsx`

- [ ] **Step 1: Rename the files**

```bash
git mv src/components/agents-view.tsx src/components/chat-view.tsx
git mv src/components/agents-view.test.ts src/components/chat-view.test.ts
git mv src/components/agents-chat-switching.test.ts src/components/chat-switching.test.ts
```

- [ ] **Step 2: Rename the symbol**

In `src/components/chat-view.tsx`, replace the exported symbol:

```bash
sed -i.bak 's/AgentsView/ChatSurface/g' src/components/chat-view.tsx && rm src/components/chat-view.tsx.bak
sed -i.bak 's/AgentsView/ChatSurface/g' src/components/chat-view.test.ts && rm src/components/chat-view.test.ts.bak
```

- [ ] **Step 3: Update import + mode-router branch in workspace.tsx**

In `src/components/workspace.tsx`:

```diff
-import { AgentsView } from "@/components/agents-view";
+import { ChatSurface } from "@/components/chat-view";
```

And the router branch:

```diff
-    ) : mode === "agents" ? (
-      <AgentsView
+    ) : mode === "chat" ? (
+      <ChatSurface
         familiars={familiars}
         sessions={sessions}
         activeFamiliar={active}
         ...
```

- [ ] **Step 4: Update slash handlers in workspace.tsx**

Search for `case "/chats":` and `case "/agents":` in `onPaletteIntent`. Collapse:

```diff
-        case "/chats":
-        case "/agents":
+        case "/chats":
+        case "/agents":
+        case "/chat":
           showAgentChatList();
           return;
```

Also rename the inner setMode call site `setMode("agents")` to `setMode("chat")` (search the file).

- [ ] **Step 5: Update command palette refs**

```bash
grep -rn '"agents"' src/components/command-palette.tsx
```

Replace any `"agents"` strings used as a mode with `"chat"`.

- [ ] **Step 6: Run typecheck**

```bash
pnpm typecheck 2>&1 | tail -10
```

The "agents" branch errors should be gone. Remaining errors will come from `sessions`/`schedules`/`plugins`/`projects` — those land in subsequent tasks.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -S -m "$(cat <<'EOF'
refactor(chat): rename agents → chat (file, symbol, mode, slashes)

agents-view.tsx → chat-view.tsx; AgentsView → ChatSurface;
mode "agents" → "chat"; /agents and /chats slash commands stay as
aliases for /chat.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
git log -1 --show-signature 2>&1 | head -3
```

### Task 3.3 — Fold Sessions into Chat surface (History sub-view)

**Files:**
- Modify: `src/components/chat-view.tsx`
- Modify: `src/components/workspace.tsx`

- [ ] **Step 1: Mount SessionsView inside ChatSurface as the no-thread default**

In `src/components/chat-view.tsx`, find the existing "Chats" tab content that renders when there are no open chats. Add a fallback render:

```tsx
import { SessionsView } from "@/components/sessions-view";
```

In the existing scope `"sessions"` (it was already a tab in agents-view), promote it to be the History sub-view when there's no active session:

```tsx
{activeFamiliarId && !activeSessionId ? (
  <SessionsView
    familiars={familiars}
    sessions={sessions}
    activeFamiliarId={activeFamiliarId}
    activeSessionId={null}
    onOpenSession={(sessionId, familiarId) => onOpenSession?.(sessionId, familiarId)}
    onNewChat={(familiarId) => onNewChat?.(familiarId)}
    onSessionsChanged={onSessionsChanged}
  />
) : null}
```

(The exact placement depends on the existing scope/tab structure in `chat-view.tsx`. The intent: when the Chat surface has no thread open, show the Sessions history as the empty-state body.)

- [ ] **Step 2: Drop the `sessions` mode branch in workspace.tsx**

```diff
-    ) : mode === "sessions" ? (
-      <SessionsView
-        familiars={familiars}
-        sessions={sessions}
-        activeFamiliarId={null}
-        activeSessionId={routerRef.current?.currentSessionId() ?? null}
-        onOpenSession={(sessionId, familiarId) => {
-          openAgentSession(sessionId, familiarId);
-        }}
-        onNewChat={(familiarId) => {
-          startAgentChat(familiarId ?? activeId);
-        }}
-        onSessionsChanged={loadSessions}
-      />
```

- [ ] **Step 3: Update /sessions slash to route to chat**

```diff
-        case "/sessions":
-          setMode("sessions");
+        case "/sessions":
+          setMode("chat");
+          showAgentChatList();
           return;
```

- [ ] **Step 4: Typecheck + tests**

```bash
pnpm typecheck 2>&1 | tail -5
node --test --experimental-strip-types src/components/chat-view.test.ts src/components/workspace-sessions-navigation.test.ts 2>&1 | tail -10
```

Expected: typecheck clean. If `workspace-sessions-navigation.test.ts` asserts on `mode === "sessions"`, update it to assert on `mode === "chat"` plus an active-session-id check.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -S -m "$(cat <<'EOF'
refactor(chat): fold Sessions into Chat surface as history view

Removes the standalone 'sessions' mode. SessionsView now renders
inside the Chat surface when there's no active thread, serving as the
familiar's chat history. /sessions slash routes to Chat.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
git log -1 --show-signature 2>&1 | head -3
```

### Task 3.4 — Fold Schedules into Inbox as a tab

**Files:**
- Modify: `src/components/inbox-escalations-view.tsx`
- Modify: `src/components/workspace.tsx`

- [ ] **Step 1: Add a Schedules tab to InboxEscalationsView**

At the top of the InboxEscalationsView render, add a tab strip:

```tsx
import { AutomationsView } from "@/components/automations-view";

// inside the component:
const [tab, setTab] = useState<"escalations" | "schedules">("escalations");

return (
  <div className="inbox-view">
    <nav className="inbox-view__tabs">
      <button
        type="button"
        className={`inbox-view__tab${tab === "escalations" ? " inbox-view__tab--active" : ""}`}
        onClick={() => setTab("escalations")}
      >Escalations</button>
      <button
        type="button"
        className={`inbox-view__tab${tab === "schedules" ? " inbox-view__tab--active" : ""}`}
        onClick={() => setTab("schedules")}
      >Schedules</button>
    </nav>
    {tab === "escalations" ? (
      <ExistingEscalationsBody ... />
    ) : (
      <AutomationsView
        familiars={familiars}
        onNewReminder={onNewReminder}
        onOpenSession={onOpenSession}
      />
    )}
  </div>
);
```

(Lift the props the surface needs onto `InboxEscalationsView`; pass them through from the workspace caller.)

- [ ] **Step 2: Add tab CSS**

Append to `src/app/globals.css`:

```css
.inbox-view__tabs {
  display: flex;
  gap: 4px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border-hairline);
  background: var(--bg-panel);
}

.inbox-view__tab {
  padding: 6px 12px;
  border-radius: var(--radius-control);
  background: transparent;
  border: 0;
  color: var(--text-secondary);
  font-size: var(--text-sm);
  cursor: pointer;
}

.inbox-view__tab--active {
  background: color-mix(in oklch, var(--accent-presence) 18%, transparent);
  color: var(--text-primary);
}
```

- [ ] **Step 3: Drop the `schedules` mode branch in workspace.tsx**

```diff
-    ) : mode === "schedules" ? (
-      <AutomationsView
-        familiars={familiars}
-        onNewReminder={() => openReminderModal()}
-        onOpenSession={(sessionId, familiarId) => {
-          openAgentSession(sessionId, familiarId);
-        }}
-      />
```

And ensure the `inbox` branch now passes through the schedules-required props:

```diff
     ) : mode === "inbox" ? (
       <InboxEscalationsView
         onOpenSource={(item) => {
           ...
         }}
+        familiars={familiars}
+        onNewReminder={() => openReminderModal()}
+        onOpenSession={(sessionId, familiarId) => {
+          openAgentSession(sessionId, familiarId);
+        }}
       />
```

- [ ] **Step 4: Update the existing schedules-related slash and tray hooks**

Find any `setMode("schedules")` or `setMode("inbox")` calls in the file. `onOpenInbox` callers that go to `setMode("schedules")` should now go to `setMode("inbox")`. Add a `defaultTab` prop on `InboxEscalationsView` if a caller specifically wants the Schedules tab (e.g., the tray's "new reminder" path):

```diff
-        onOpenInbox={() => setMode("schedules")}
+        onOpenInbox={() => setMode("inbox")}
```

- [ ] **Step 5: Typecheck + commit**

```bash
pnpm typecheck 2>&1 | tail -5
git add -A
git commit -S -m "$(cat <<'EOF'
refactor(inbox): fold Schedules into Inbox as a tab

InboxEscalationsView gains an Escalations/Schedules tab strip.
AutomationsView is reused inside the Schedules tab. The standalone
'schedules' mode is removed. Tray + slash routes go to Inbox.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
git log -1 --show-signature 2>&1 | head -3
```

### Task 3.5 — Move Plugins into Settings

**Files:**
- Modify: `src/components/settings-shell.tsx`
- Modify: `src/components/workspace.tsx`

- [ ] **Step 1: Add a Plugins panel to SettingsShell**

In `src/components/settings-shell.tsx`, add a new section/panel rendering `<PluginsView />`. The existing settings shell structure should already have a way to register a panel (tab, section, route). Follow the pattern that exists.

```tsx
import { PluginsView } from "@/components/plugins-view";

// add to the existing panels list:
{
  id: "plugins",
  label: "Plugins",
  icon: "ph:sparkle",
  render: () => (
    <PluginsView
      onOpenChat={onOpenChat}
      onCreateSkill={onCreateChat}
      onCreatePlugin={onCreateChat}
      familiars={familiars.map((f) => ({ id: f.id, display_name: f.display_name }))}
    />
  ),
},
```

Pass `onOpenChat` / `familiars` props down from the surface's caller (settings page in `src/app/settings/page.tsx`).

- [ ] **Step 2: Drop the `plugins` mode branch in workspace.tsx**

```diff
-      <PluginsView
-        onOpenChat={() => {
-          startAgentChat(activeId);
-        }}
-        onCreateSkill={() => {
-          startAgentChat(activeId);
-        }}
-        onCreatePlugin={() => {
-          startAgentChat(activeId);
-        }}
-        familiars={familiars.map((f) => ({ id: f.id, display_name: f.display_name }))}
-      />
```

This was the fall-through `else` — replace with a route to Home so unknown modes don't blank:

```diff
+      <HomeComposer
+        familiars={familiars}
+        activeFamiliarId={activeId}
+        sessions={sessions}
+        onNavigateToChat={(sessionId, fid) => openAgentSession(sessionId, fid)}
+        onNavigateToBoard={() => setMode("board")}
+        onNavigateToInbox={() => setMode("inbox")}
+        onToast={pushToast}
+      />
```

- [ ] **Step 3: Update /plugins slash**

```diff
-        case "/plugins":
-          setMode("plugins");
+        case "/plugins":
+          nextRouter.push("/settings#plugins");
```

(If `/plugins` doesn't exist in the slash list today, no edit needed.)

- [ ] **Step 4: Typecheck + commit**

```bash
pnpm typecheck 2>&1 | tail -5
git add -A
git commit -S -m "$(cat <<'EOF'
refactor(settings): fold Plugins panel into Settings

PluginsView now mounts inside SettingsShell. The standalone 'plugins'
mode is removed; the workspace fallback route is Home. /plugins
slash navigates to Settings · Plugins.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
git log -1 --show-signature 2>&1 | head -3
```

### Task 3.6 — Fold Projects into Library

**Files:**
- Modify: `src/components/library-view.tsx`
- Modify: `src/components/workspace.tsx`

- [ ] **Step 1: Add a Projects sub-tab to LibraryView**

`LibraryView` already has a section/sub-tab system (Bookmarks / Reading / Synthesis / GitHub / etc.). Add a Projects entry that renders the existing `ComuxView view="projects"` content:

```tsx
import { ComuxView } from "@/components/comux-view";

// inside the existing list of library sections:
{
  id: "projects",
  label: "Projects",
  icon: "ph:folder",
  render: () => (
    <ComuxView
      view="projects"
      sessions={sessions}
      onOpenSession={(sessionId, familiarId) => onOpenSession?.(sessionId, familiarId)}
      onNewChat={onNewProjectChat}
    />
  ),
},
```

Pass `sessions`, `onOpenSession`, `onNewProjectChat` through props.

- [ ] **Step 2: Drop the `projects` mode branch in workspace.tsx**

```diff
-    ) : mode === "projects" ? (
-      <ComuxView
-        view="projects"
-        sessions={sessions}
-        onOpenSession={(sessionId, familiarId) => {
-          openAgentSession(sessionId, familiarId);
-        }}
-        onNewChat={openProjectChat}
-      />
```

And update the library mount to pass the new props:

```diff
     ) : mode === "library" ? (
       <LibraryView
         onOpenUrl={(url) => { ... }}
+        sessions={sessions}
+        onOpenSession={openAgentSession}
+        onNewProjectChat={openProjectChat}
       />
```

- [ ] **Step 3: Update /projects slash**

```diff
-        case "/projects":
-          setMode("projects");
+        case "/projects":
+          setMode("library");
+          // Library view picks up the projects tab via URL hash:
+          window.location.hash = "library:projects";
           return;
```

(LibraryView listens for the `library:` hash and selects the matching sub-tab; if it doesn't yet, add a tiny `useEffect` reading `window.location.hash` once on mount.)

- [ ] **Step 4: Typecheck + commit**

```bash
pnpm typecheck 2>&1 | tail -5
git add -A
git commit -S -m "$(cat <<'EOF'
refactor(library): fold Projects mode into Library sub-tab

LibraryView gains a Projects entry that mounts the existing ComuxView
view="projects". Standalone 'projects' mode removed. /projects slash
routes to Library and selects the Projects tab via the existing
library:{id} hash convention.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
git log -1 --show-signature 2>&1 | head -3
```

### Task 3.7 — Move CovenFloor into Home as ambient widget

**Files:**
- Modify: `src/components/home-composer.tsx`

- [ ] **Step 1: Embed coven-floor-mini below the composer**

Open `src/components/home-composer.tsx`. After the existing composer section, add:

```tsx
import { CovenFloorMini } from "@/components/coven-floor-mini";

// inside the render, below the composer:
<section className="home-composer__floor" aria-label="Coven floor">
  <CovenFloorMini familiars={familiars} sessions={sessions} />
</section>
```

- [ ] **Step 2: Style the placement**

Append to `src/styles/home-composer.css`:

```css
.home-composer__floor {
  margin-top: 32px;
  max-width: 720px;
  margin-inline: auto;
  width: 100%;
}
```

- [ ] **Step 3: Drop the Floor sub-tab from the (now Chat) surface**

In `src/components/chat-view.tsx`, find the existing `"floor"` scope and remove it from the scope union + render branches. The relevant lines reference `CovenFloor` and an `AgentsScope === "floor"` test.

- [ ] **Step 4: Typecheck + commit**

```bash
pnpm typecheck 2>&1 | tail -5
git add -A
git commit -S -m "$(cat <<'EOF'
refactor(home): move CovenFloor into Home as ambient widget

CovenFloorMini renders below the composer on Home, giving it
permanent visibility instead of being buried in an Agents sub-tab.
The floor scope is removed from the Chat surface.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
git log -1 --show-signature 2>&1 | head -3
```

### Task 3.8 — Verify the mode router shrank cleanly

- [ ] **Step 1: Count mode branches**

```bash
grep -cE 'mode === "[a-z]+"' src/components/workspace.tsx
```

Expected: 9 (one for each surface in `WorkspaceMode`).

- [ ] **Step 2: Full typecheck + test suite**

```bash
pnpm typecheck 2>&1 | tail -10
node --test --experimental-strip-types src/lib/*.test.ts src/components/*.test.ts 2>&1 | tail -20
```

Expected: typecheck clean. Tests: same as the Phase 1 baseline; any per-fold test updates were already landed inside that fold's task.

- [ ] **Step 3: Manual smoke**

```bash
pnpm dev
```

Open `http://localhost:3000`. For each sidebar surface (Home / Chat / Board / Calendar / Inbox / Library / Browser / Terminal / GitHub), confirm:

- Navigating works.
- The matching breadcrumb (Section 4) — if Phase 4 has shipped — shows the surface name.
- No console errors.

Confirm folded paths:

- Chat surface with no thread shows session history.
- Inbox surface has Escalations + Schedules tabs.
- Settings has a Plugins panel.
- Library has a Projects sub-tab.
- Home has the Floor mini-widget below the composer.

Kill dev server.

**Phase 3 complete.** Router shrunk; surfaces consolidated.

---

## Phase 4 — Topbar + banners + shortcuts

### Task 4.1 — useShellBanners channel

**Files:**
- Create: `src/lib/shell-banners.ts`
- Test: `src/lib/shell-banners.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/shell-banners.test.ts
// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./shell-banners.ts", import.meta.url), "utf8");

assert.match(source, /export type BannerSeverity = "error" \| "warning" \| "info"/);
assert.match(source, /export type ShellBanner/);
assert.match(source, /export function useShellBanners\(\)/);
assert.match(source, /export function ShellBannersProvider/);
assert.match(source, /pushBanner/);
assert.match(source, /dismissBanner/);
assert.match(
  source,
  /sort.*severity|error.*warning.*info/i,
  "Banners must be ordered error -> warning -> info",
);
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
node --test --experimental-strip-types src/lib/shell-banners.test.ts 2>&1 | tail -5
```

Expected: FAIL.

- [ ] **Step 3: Implement the channel**

```tsx
// src/lib/shell-banners.ts
"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

export type BannerSeverity = "error" | "warning" | "info";

export type ShellBanner = {
  id: string;
  severity: BannerSeverity;
  title: string;
  cta?: { label: string; onClick: () => void };
};

type Ctx = {
  banners: ShellBanner[];
  pushBanner: (b: ShellBanner) => void;
  dismissBanner: (id: string) => void;
};

const ShellBannersContext = createContext<Ctx | null>(null);

const SEVERITY_RANK: Record<BannerSeverity, number> = { error: 0, warning: 1, info: 2 };

export function ShellBannersProvider({ children }: { children: ReactNode }) {
  const [banners, setBanners] = useState<ShellBanner[]>([]);

  const value = useMemo<Ctx>(() => ({
    banners: [...banners].sort(
      (a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity],
    ),
    pushBanner: (b) => {
      setBanners((prev) => {
        // dedupe by id
        const without = prev.filter((p) => p.id !== b.id);
        return [...without, b];
      });
    },
    dismissBanner: (id) => {
      setBanners((prev) => prev.filter((p) => p.id !== id));
    },
  }), [banners]);

  return (
    <ShellBannersContext.Provider value={value}>
      {children}
    </ShellBannersContext.Provider>
  );
}

export function useShellBanners(): Ctx {
  const ctx = useContext(ShellBannersContext);
  if (!ctx) throw new Error("useShellBanners must be used inside ShellBannersProvider");
  return ctx;
}
```

- [ ] **Step 4: Run the test + typecheck**

```bash
node --test --experimental-strip-types src/lib/shell-banners.test.ts 2>&1 | tail -5
pnpm typecheck 2>&1 | tail -5
```

Expected: PASS + clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/shell-banners.ts src/lib/shell-banners.test.ts
git commit -S -m "$(cat <<'EOF'
feat(shell): unified banner channel (useShellBanners)

Provider + hook for pushing system banners (daemon offline, sidecar
auth errors, etc.). Severity-sorted (error > warning > info). Deduped
by id so repeated polling doesn't stack duplicates.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
git log -1 --show-signature 2>&1 | head -3
```

### Task 4.2 — Mount the banner channel + render strip

**Files:**
- Modify: `src/components/shell.tsx`
- Modify: `src/app/layout.tsx`
- Modify: `src/app/globals.css`

- [ ] **Step 1: Wrap the root layout with the provider**

```diff
 import { SidecarAuthBridge } from "@/components/security/sidecar-auth-bridge";
+import { ShellBannersProvider } from "@/lib/shell-banners";
```

```diff
       <body className="h-full flex flex-col">
-        <SidecarAuthBridge />
-        {children}
+        <ShellBannersProvider>
+          <SidecarAuthBridge />
+          {children}
+        </ShellBannersProvider>
       </body>
```

- [ ] **Step 2: Render the banner strip above the detail pane in Shell**

In `src/components/shell.tsx`, import the hook:

```diff
 import { Icon, type IconName } from "@/lib/icon";
+import { useShellBanners } from "@/lib/shell-banners";
```

Inside `ShellInner`, just before rendering the `<main className="shell-detail">`, render the banners:

```diff
       <Panel id="detail" className="shell-detail-panel">
-        <main className="shell-detail">{detail}</main>
+        <main className="shell-detail">
+          <ShellBannerStrip />
+          {detail}
+        </main>
       </Panel>
```

Add the helper below `ShellInner`:

```tsx
function ShellBannerStrip() {
  const { banners, dismissBanner } = useShellBanners();
  if (banners.length === 0) return null;
  return (
    <div className="shell-banner-strip">
      {banners.map((b) => (
        <div
          key={b.id}
          className={`shell-banner shell-banner--${b.severity}`}
          role={b.severity === "error" ? "alert" : "status"}
        >
          <span className="shell-banner__title">{b.title}</span>
          {b.cta ? (
            <button
              type="button"
              className="shell-banner__cta"
              onClick={b.cta.onClick}
            >
              {b.cta.label}
            </button>
          ) : null}
          <button
            type="button"
            className="shell-banner__dismiss"
            aria-label="Dismiss"
            onClick={() => dismissBanner(b.id)}
            title="Dismiss"
          >
            <Icon name="ph:x" width={11} />
          </button>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Style the banner strip**

Append to `src/app/globals.css`:

```css
.shell-banner-strip {
  display: flex;
  flex-direction: column;
  gap: 0;
  border-bottom: 1px solid var(--border-hairline);
}

.shell-banner {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 16px;
  font-size: var(--text-sm);
  border-bottom: 1px solid var(--border-hairline);
}

.shell-banner--error {
  background: color-mix(in oklch, var(--color-danger) 12%, var(--bg-base));
  color: var(--color-danger);
}

.shell-banner--warning {
  background: color-mix(in oklch, var(--color-warning) 10%, var(--bg-base));
  color: var(--color-warning);
}

.shell-banner--info {
  background: color-mix(in oklch, var(--accent-presence) 8%, var(--bg-base));
  color: var(--text-primary);
}

.shell-banner__title {
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.shell-banner__cta {
  background: transparent;
  border: 1px solid currentColor;
  color: currentColor;
  border-radius: var(--radius-control);
  padding: 3px 10px;
  font-size: var(--text-xs);
  cursor: pointer;
}

.shell-banner__dismiss {
  background: transparent;
  border: 0;
  color: currentColor;
  opacity: 0.6;
  display: grid;
  place-items: center;
  cursor: pointer;
}

.shell-banner__dismiss:hover {
  opacity: 1;
}
```

- [ ] **Step 4: Typecheck + commit**

```bash
pnpm typecheck 2>&1 | tail -5
git add -A
git commit -S -m "$(cat <<'EOF'
feat(shell): mount banner strip above detail pane

ShellBannersProvider wraps the root layout. Shell renders a banner
strip at the top of the detail pane — error/warning/info severities
with dismiss + optional CTA. Empty when no banners are active.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
git log -1 --show-signature 2>&1 | head -3
```

### Task 4.3 — Migrate daemon-offline banner into the channel

**Files:**
- Modify: `src/components/workspace.tsx`
- Modify: `src/components/chat-view.tsx`

- [ ] **Step 1: Push the daemon-offline banner from workspace.tsx**

In `src/components/workspace.tsx`, near the daemon-status effect:

```tsx
import { useShellBanners } from "@/lib/shell-banners";

// inside Workspace:
const { pushBanner, dismissBanner } = useShellBanners();

useEffect(() => {
  if (daemonRunning) {
    dismissBanner("daemon-offline");
  } else {
    pushBanner({
      id: "daemon-offline",
      severity: "warning",
      title: "Daemon offline — existing sessions visible but new tasks may not start.",
      cta: {
        label: "Start daemon",
        onClick: () => {
          void fetch("/api/daemon/start", { method: "POST" });
        },
      },
    });
  }
}, [daemonRunning, pushBanner, dismissBanner]);
```

- [ ] **Step 2: Remove the inline banner from chat-view.tsx**

Find the existing "Daemon offline" inline banner block in `src/components/chat-view.tsx` (it renders a coloured strip at the top of the Chats scope). Delete the JSX and the styles that only fed it.

- [ ] **Step 3: Manual smoke**

```bash
pnpm dev
```

With the daemon NOT running, open `http://localhost:3000`. Banner appears at the top of every surface (Home, Board, Library, …), not just Chat. Click "Start daemon" → request is fired; once the daemon polls back as `running`, the banner disappears.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -S -m "$(cat <<'EOF'
refactor(shell): migrate daemon-offline banner to shared channel

The inline banner in chat-view.tsx is replaced by a useShellBanners()
push from workspace.tsx, so the warning now follows the user across
every surface — not only Chat.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
git log -1 --show-signature 2>&1 | head -3
```

### Task 4.4 — Topbar redesign

**Files:**
- Create: `src/components/top-bar.tsx`
- Modify: `src/components/workspace.tsx`

- [ ] **Step 1: Implement TopBar**

```tsx
// src/components/top-bar.tsx
"use client";

import { Icon } from "@/lib/icon";
import { NotificationBell } from "@/components/notification-bell";
import type { Familiar } from "@/lib/types";
import type { InboxItem } from "@/lib/cave-inbox";
import type { InboxPrefs } from "@/lib/cave-inbox-prefs";

type Props = {
  surfaceLabel: string;
  subContext?: string;
  onOpenPalette: () => void;
  onOpenInbox: () => void;
  onOpenSettings: () => void;
  inboxItems: InboxItem[];
  familiars: Familiar[];
  inboxPrefs: InboxPrefs;
  inboxBadgeCount: number;
  onOpenInboxItem?: (item: InboxItem) => void;
  onNotificationPrefsChanged: () => void;
};

export function TopBar(props: Props) {
  const {
    surfaceLabel,
    subContext,
    onOpenPalette,
    onOpenInbox,
    onOpenSettings,
    inboxItems,
    familiars,
    inboxPrefs,
    inboxBadgeCount,
    onOpenInboxItem,
    onNotificationPrefsChanged,
  } = props;

  return (
    <header className="top-bar">
      <span className="top-bar__brand">CovenCave</span>
      <span className="top-bar__sep">·</span>
      <span className="top-bar__crumb">
        <span className="top-bar__crumb-surface">{surfaceLabel}</span>
        {subContext ? (
          <>
            <span className="top-bar__crumb-sep">›</span>
            <span className="top-bar__crumb-sub">{subContext}</span>
          </>
        ) : null}
      </span>

      <button
        type="button"
        className="top-bar__search"
        onClick={onOpenPalette}
        aria-label="Search and jump to anything"
      >
        <Icon name="ph:magnifying-glass" width={12} />
        <span>Search · jump to anything</span>
        <kbd>⌘K</kbd>
      </button>

      <div className="top-bar__actions">
        <NotificationBell
          items={inboxItems}
          familiars={familiars}
          prefs={inboxPrefs}
          badgeCount={inboxBadgeCount}
          onOpenInbox={onOpenInbox}
          onOpenItem={onOpenInboxItem}
          onPrefsChanged={onNotificationPrefsChanged}
        />
        <button
          type="button"
          className="top-bar__icon-btn"
          onClick={onOpenSettings}
          aria-label="Settings"
          title="Settings (⌘,)"
        >
          <Icon name="ph:gear-six" width={14} />
        </button>
      </div>
    </header>
  );
}
```

- [ ] **Step 2: Add TopBar CSS**

Append to `src/app/globals.css`:

```css
.top-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 16px;
  height: 36px;
  background: var(--bg-panel);
  border-bottom: 1px solid var(--border-hairline);
  font-size: var(--text-sm);
  user-select: none;
}

.top-bar__brand {
  color: var(--accent-presence);
  font-weight: 600;
}

.top-bar__sep {
  color: var(--text-muted);
}

.top-bar__crumb {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.top-bar__crumb-surface {
  color: var(--text-primary);
}

.top-bar__crumb-sep {
  color: var(--text-muted);
}

.top-bar__crumb-sub {
  color: var(--text-secondary);
}

.top-bar__search {
  margin-left: auto;
  margin-right: 12px;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 5px 12px;
  min-width: 240px;
  background: var(--bg-base);
  border: 1px solid var(--border-hairline);
  border-radius: var(--radius-control);
  color: var(--text-muted);
  font-size: var(--text-sm);
  cursor: pointer;
  transition: border-color var(--duration-fast) var(--ease-standard);
}

.top-bar__search:hover {
  border-color: var(--border-strong);
  color: var(--text-secondary);
}

.top-bar__search kbd {
  margin-left: auto;
  font-family: var(--font-geist-mono);
  font-size: 10px;
  color: var(--text-muted);
}

.top-bar__actions {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.top-bar__icon-btn {
  width: 28px;
  height: 28px;
  border-radius: var(--radius-control);
  border: 0;
  background: transparent;
  color: var(--text-secondary);
  display: grid;
  place-items: center;
  cursor: pointer;
}

.top-bar__icon-btn:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}
```

- [ ] **Step 3: Mount TopBar in workspace.tsx and drop "Chat with Nova" pill**

In `src/components/workspace.tsx`, import:

```diff
+import { TopBar } from "@/components/top-bar";
```

Compute the breadcrumb labels per surface (one map at the top of the component or in a small helper):

```ts
const SURFACE_LABELS: Record<WorkspaceMode, string> = {
  home: "Home",
  chat: "Chat",
  board: "Board",
  calendar: "Calendar",
  inbox: "Inbox",
  library: "Library",
  browser: "Browser",
  terminal: "Terminal",
  github: "GitHub",
};

// inside Workspace:
const surfaceLabel = SURFACE_LABELS[mode] ?? "Home";
const subContext = active ? `${active.display_name}` : undefined;
```

Pass it to Shell via the existing `topBar` prop:

```diff
       <Shell
         ref={shellRef}
+        topBar={
+          <TopBar
+            surfaceLabel={surfaceLabel}
+            subContext={subContext}
+            onOpenPalette={() => setPaletteOpen(true)}
+            onOpenInbox={() => setMode("inbox")}
+            onOpenSettings={() => nextRouter.push("/settings")}
+            inboxItems={inboxItemsWithEphemeral}
+            familiars={familiars}
+            inboxPrefs={inboxPrefs}
+            inboxBadgeCount={inboxBadgeCount}
+            onOpenInboxItem={(item) => {
+              if (item.sessionId) openAgentSession(item.sessionId, item.familiarId);
+              else setMode("inbox");
+            }}
+            onNotificationPrefsChanged={refreshPrefs}
+          />
+        }
         familiarRail={ ... }
```

Find the existing topbar JSX or daemon-bar that renders "CovenCave · Mode" + "Chat with Nova ⌘J" pill — delete it; TopBar replaces it.

Drop the NotificationBell from the sidebar foot (it now lives in TopBar):

```diff
-      <div className="sidebar-foot">
-        {showNotifications ? ( <div className="sidebar-foot-bell">...</div> ) : null}
-        <button ... aria-label="Settings">...</button>
-      </div>
+      <div className="sidebar-foot">
+        <button ... aria-label="Settings">...</button>
+      </div>
```

(Update `sidebar-minimal.tsx` to remove the bell rendering — it's now redundant.)

- [ ] **Step 4: Typecheck + commit**

```bash
pnpm typecheck 2>&1 | tail -5
git add -A
git commit -S -m "$(cat <<'EOF'
feat(shell): new TopBar with brand + breadcrumb + search + bell + settings

Replaces the old "CovenCave · Mode" header and the "Chat with Nova"
pill with a single TopBar component. Surface name comes from a
SURFACE_LABELS map; sub-context shows the active familiar. The
notification bell moves out of the sidebar foot — it lives in the
TopBar so it's reachable from every surface without scrolling.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
git log -1 --show-signature 2>&1 | head -3
```

### Task 4.5 — New keybindings (⌘1–⌘8, ⌥1–⌥9, ⌘↑/⌘↓, ⌘N)

**Files:**
- Modify: `src/components/workspace.tsx`

- [ ] **Step 1: Add the surface-jump and familiar-cycle effects**

Inside `Workspace`, near the existing `onKey` effect that handles `⌘K`:

```ts
useEffect(() => {
  const SURFACE_ORDER: WorkspaceMode[] = [
    "home", "chat", "board", "calendar", "inbox", "library", "browser", "terminal",
  ];

  const onKey = (e: KeyboardEvent) => {
    const meta = e.metaKey || e.ctrlKey;
    const alt = e.altKey;

    // ⌘1..⌘8 → sidebar surface
    if (meta && !alt && /^[1-8]$/.test(e.key)) {
      const idx = parseInt(e.key, 10) - 1;
      const target = SURFACE_ORDER[idx];
      if (target) {
        e.preventDefault();
        setMode(target);
      }
      return;
    }

    // ⌥1..⌥9 → Nth familiar
    if (alt && !meta && /^[1-9]$/.test(e.key)) {
      const idx = parseInt(e.key, 10) - 1;
      const target = familiars[idx];
      if (target) {
        e.preventDefault();
        selectFamiliar(target.id);
      }
      return;
    }

    // ⌘↑ / ⌘↓ → cycle familiars
    if (meta && (e.key === "ArrowUp" || e.key === "ArrowDown") && familiars.length > 0) {
      e.preventDefault();
      const idx = familiars.findIndex((f) => f.id === activeId);
      const step = e.key === "ArrowUp" ? -1 : 1;
      const next = (idx === -1 ? 0 : (idx + step + familiars.length) % familiars.length);
      selectFamiliar(familiars[next].id);
      return;
    }

    // ⌘N → new chat (only on Chat surface)
    if (meta && !alt && e.key.toLowerCase() === "n" && mode === "chat") {
      e.preventDefault();
      startAgentChat(activeId);
      return;
    }
  };

  window.addEventListener("keydown", onKey);
  return () => window.removeEventListener("keydown", onKey);
}, [familiars, activeId, mode, selectFamiliar, startAgentChat]);
```

- [ ] **Step 2: Manual smoke**

```bash
pnpm dev
```

- ⌘1 → Home, ⌘3 → Board, ⌘8 → Terminal.
- ⌥1 → first familiar in rail; ⌥2 → second; up to ⌥9.
- ⌘↑ / ⌘↓ → cycle familiars.
- With Chat surface focused, ⌘N starts a new chat.

Confirm none of these conflict with browser/OS shortcuts on macOS, Windows, Linux. (⌘↑ on macOS scrolls to top in some text contexts — that's why the handler is global with `preventDefault`; you should not be in a text input when invoking.)

- [ ] **Step 3: Commit**

```bash
git add src/components/workspace.tsx
git commit -S -m "$(cat <<'EOF'
feat(shell): ⌘1–⌘8 surfaces, ⌥1–⌥9 familiars, ⌘↑/↓ cycle, ⌘N new chat

Adds the keyboard shortcuts spec'd for the new shell. Existing
⌘B/⌘J/⌃`/⌘K bindings unchanged.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
git log -1 --show-signature 2>&1 | head -3
```

**Phase 4 complete.** Topbar, banner channel, and shortcuts in.

---

## Phase 5 — Polish & cleanup

### Task 5.1 — Avatar rail overflow + per-familiar pinning

**Files:**
- Modify: `src/components/familiar-avatar-rail.tsx`
- Modify: `src/app/globals.css`

- [ ] **Step 1: Add a `pinned` distinction**

For v1 we don't need a full pinning UI — just ensure that when familiars exceed the rail height, the list scrolls vertically with a thin scrollbar and the active familiar is auto-scrolled into view.

In `FamiliarAvatarRail`, after the `useMemo` for liveCounts, add:

```ts
useEffect(() => {
  if (!activeId) return;
  const el = document.querySelector(
    `.familiar-avatar-rail__avatar[data-id="${activeId}"]`,
  );
  el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
}, [activeId]);
```

And add `data-id={f.id}` to each avatar button.

- [ ] **Step 2: Confirm CSS handles scroll**

The Task 1.2 CSS already includes `overflow-y: auto` on `.familiar-avatar-rail__list`. Confirm and skip if so.

- [ ] **Step 3: Manual smoke with 8+ familiars**

If your local Coven has <8 familiars, set `NEXT_PUBLIC_DEMO=true` and use `DEMO_FAMILIARS`. The rail should scroll, and clicking past the visible window scrolls the chosen avatar into view.

- [ ] **Step 4: Commit**

```bash
git add src/components/familiar-avatar-rail.tsx src/app/globals.css
git commit -S -m "$(cat <<'EOF'
feat(rail): scroll active avatar into view on selection

When >7 familiars overflow the rail, switching via keyboard or palette
now scrolls the chosen avatar into view. Tiny but a real annoyance
otherwise on dense Covens.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
git log -1 --show-signature 2>&1 | head -3
```

### Task 5.2 — Bottom slot auto-collapse on Terminal surface

**Files:**
- Modify: `src/components/workspace.tsx`

- [ ] **Step 1: Watch the mode and collapse the bottom panel**

```ts
useEffect(() => {
  if (mode !== "terminal") return;
  // Defer one frame so the navigation completes before the panel collapses.
  requestAnimationFrame(() => {
    // Shell exposes no imperative for the bottom slot today; toggle via the
    // existing ⌃` keystroke ONLY IF the slot is currently open. Use a tiny
    // state read from localStorage:
    const raw = typeof window !== "undefined"
      ? window.localStorage.getItem("cave.shell.bottom.v1")
      : null;
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw);
      const bottomLayout = parsed?.["cave.shell.bottom.v1"]?.layout;
      const bottomSize = Array.isArray(bottomLayout) ? bottomLayout[1] : 0;
      if (bottomSize > 0) {
        window.dispatchEvent(new KeyboardEvent("keydown", {
          key: "`", code: "Backquote", ctrlKey: true, bubbles: true,
        }));
      }
    } catch { /* ignore */ }
  });
}, [mode]);
```

(This re-uses the existing `⌃\`` handler in `Shell` — no new imperative needed.)

- [ ] **Step 2: Manual smoke**

Navigate to Terminal with the bottom slot open. The slot collapses automatically. Reopen with `⌃\``. Navigate to Home — the slot stays open. Navigate back to Terminal — it collapses again.

- [ ] **Step 3: Commit**

```bash
git add src/components/workspace.tsx
git commit -S -m "$(cat <<'EOF'
fix(shell): auto-collapse bottom slot on Terminal surface

Prevents the double-terminal awkwardness where the Terminal surface
and the slide-up PTY both render at once. The slide-up is "quick
command anywhere"; the surface is "live PTY workspace" — they
shouldn't share screen space.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
git log -1 --show-signature 2>&1 | head -3
```

### Task 5.3 — Sidecar-auth banner via channel

**Files:**
- Modify: `src/components/security/sidecar-auth-bridge.tsx`

- [ ] **Step 1: Push auth-error banners**

In `SidecarAuthBridge`, in the handler that today logs / throws on auth failure, instead push a banner:

```diff
+import { useShellBanners } from "@/lib/shell-banners";

 export function SidecarAuthBridge() {
+  const { pushBanner, dismissBanner } = useShellBanners();

   useEffect(() => {
     // existing fetch + handshake logic
     // on failure:
-    console.error("sidecar auth failed", err);
+    pushBanner({
+      id: "sidecar-auth-failed",
+      severity: "error",
+      title: "Sidecar authentication failed — local APIs may not work.",
+      cta: {
+        label: "Open settings",
+        onClick: () => {
+          window.location.href = "/settings";
+        },
+      },
+    });
     // on later success:
-    // (currently nothing)
+    dismissBanner("sidecar-auth-failed");
   }, [pushBanner, dismissBanner]);
 }
```

(Match exact existing structure of the bridge.)

- [ ] **Step 2: Commit**

```bash
git add src/components/security/sidecar-auth-bridge.tsx
git commit -S -m "$(cat <<'EOF'
fix(shell): surface sidecar auth failures via banner channel

Auth failures previously only logged to console. They now surface as
a top-of-detail error banner with a "Open settings" CTA, so the user
can act on a broken handshake instead of silently noticing missing
data.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
git log -1 --show-signature 2>&1 | head -3
```

### Task 5.4 — Move FamiliarRail's configurator into Settings · Familiars

**Files:**
- Modify: `src/components/settings-shell.tsx`
- Create: `src/components/settings-familiars-panel.tsx`

- [ ] **Step 1: Extract the configurator from familiar-rail.tsx into a standalone panel**

```tsx
// src/components/settings-familiars-panel.tsx
"use client";

// Lift the configurator <section> from familiar-rail.tsx wholesale.
// It already shows: glyph, harness + version, model, presence,
// session count, memory freshness. Keep the same dl/dt/dd structure.

// (Engineer: copy the JSX from familiar-rail.tsx lines ~212-263 here,
//  removing the surrounding <aside>/<ul>/<li> wrapper. Accept
//  { familiar, sessions, responseNeeded } as props.)

import type { Familiar, SessionRow } from "@/lib/types";

export function SettingsFamiliarsPanel({
  familiars,
  sessions,
  responseNeeded,
}: {
  familiars: Familiar[];
  sessions: SessionRow[];
  responseNeeded: Set<string>;
}) {
  // … existing configurator JSX, rendered for each familiar in a list …
}
```

- [ ] **Step 2: Register the panel in SettingsShell**

Add it next to the Plugins panel from Task 3.5.

- [ ] **Step 3: Commit**

```bash
git add src/components/settings-shell.tsx src/components/settings-familiars-panel.tsx
git commit -S -m "$(cat <<'EOF'
feat(settings): Familiars panel — full configurator now lives here

Hoists the configurator dl from the old FamiliarRail aside into a
proper Settings panel. The old rail component is now strictly the
narrow leftmost zone; everything else moves where users expect to
find it.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
git log -1 --show-signature 2>&1 | head -3
```

### Task 5.5 — Delete dead code

**Files:**
- Modify: `src/components/workspace.tsx`
- Modify: `src/components/shell.tsx`
- Delete: `src/components/familiar-rail.tsx`

- [ ] **Step 1: Remove IconNavStrip from workspace.tsx**

```diff
-// Icon-only nav strip shown when the sidebar is collapsed
-function IconNavStrip({ mode, onModeChange }: { ... }) { ... }
```

(Search for the function and delete it, along with any remaining unused imports.)

- [ ] **Step 2: Remove the `iconNav` prop from Shell**

```diff
 function ShellInner({
   familiarRail,
   nav,
-  iconNav,
   list,
   detail,
```

And the conditional render block referring to `hasIconNav`.

- [ ] **Step 3: Delete familiar-rail.tsx**

```bash
git rm src/components/familiar-rail.tsx
```

Verify nothing else imports it:

```bash
grep -rn "from \"@/components/familiar-rail\"" src/ 2>&1 | tail -5
```

Expected: no matches (if any remain, they must be deleted/redirected first — fix and re-run).

- [ ] **Step 4: Sweep orphaned localStorage keys**

Add a one-time migration at the top of `Workspace`:

```ts
useEffect(() => {
  if (typeof window === "undefined") return;
  const swept = window.localStorage.getItem("cave:legacy-keys-swept");
  if (swept === "1") return;
  const orphans = [
    "cave:agent-pane-lock",     // stripLock
    "cave:agent-pane",          // shellAgentPane
    "cave:sidebar-icon-strip",  // legacy strip state, if any
  ];
  for (const k of orphans) {
    try { window.localStorage.removeItem(k); } catch { /* ignore */ }
  }
  window.localStorage.setItem("cave:legacy-keys-swept", "1");
}, []);
```

- [ ] **Step 5: Run typecheck + full test suite + manual smoke**

```bash
pnpm typecheck 2>&1 | tail -5
node --test --experimental-strip-types src/lib/*.test.ts src/components/*.test.ts 2>&1 | tail -15
```

Expected: typecheck clean. Tests at the same baseline as Phase 1 (no new failures).

```bash
pnpm dev
```

Full app exercise: cycle every surface, every familiar, the rail tabs, the bottom slot, the palette, the keybindings. No console errors. No visual regressions.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -S -m "$(cat <<'EOF'
chore(shell): delete IconNavStrip, familiar-rail.tsx, and orphan keys

Final dead-code sweep. Removes IconNavStrip (replaced by the avatar
rail in Phase 1), Shell's iconNav prop, the old wide FamiliarRail
aside (replaced by FamiliarAvatarRail + Settings · Familiars panel),
and clears legacy localStorage keys with a one-shot migration.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
git log -1 --show-signature 2>&1 | head -3
```

### Task 5.6 — Sanity check + push

- [ ] **Step 1: Sanity-check all commits on the branch are signed**

```bash
git log origin/main..HEAD --pretty='%H %G?' | awk '$2 != "G" {print "UNSIGNED:", $0}'
```

Expected: no output. If any commit prints, sign it (interactive rebase + `-S` on each, or amend if it's the tip) before pushing.

- [ ] **Step 2: Run the smoke + screenshot diff**

```bash
pnpm dev &
sleep 5
node scripts/screenshot-sessions.mjs --out screenshots/after-shell-ia.png 2>/dev/null || \
  echo "capture manually"
kill %1 2>/dev/null
```

Compare `screenshots/baseline-shell.png` (from pre-flight) vs `screenshots/after-shell-ia.png`. Eyeball every surface for unintended visual change. Anything surprising = a missed task.

- [ ] **Step 3: Push the branch**

```bash
git push -u origin feat/shell-ia-redesign
```

- [ ] **Step 4: Open the PR**

```bash
gh pr create --title "Shell + IA redesign: companion shell, avatar rail, surface folds" --body "$(cat <<'EOF'
## Summary

Replaces today's overlapping shell affordances with a single mental model:
**avatar rail** (who) + **sidebar** (where) + **companion rail** (about that familiar) + **detail** (active surface).

See spec: `docs/superpowers/specs/2026-06-08-ui-ux-shell-ia-design.md`

## Changes by phase

- **Phase 1** — leftmost avatar rail (FamiliarAvatarRail), regrouped sidebar (Work / Knowledge / Tools), per-familiar last-surface memory.
- **Phase 2** — unified companion rail with Chat / Inspector / Memory tabs; dropped the dual chat/browser drag-lock strip; Browser is now sidebar-only.
- **Phase 3** — mode-router shrunk from 13 to 9: Sessions folded into Chat, Schedules into Inbox, Plugins into Settings, Projects into Library, Floor into Home as ambient widget.
- **Phase 4** — new TopBar; shared `useShellBanners()` channel; daemon-offline and sidecar-auth banners now pin to detail across all surfaces; added ⌘1–⌘8 / ⌥1–⌥9 / ⌘↑↓ / ⌘N bindings.
- **Phase 5** — avatar rail overflow polish, bottom-slot auto-collapse on Terminal, dead-code sweep, one-shot localStorage migration.

## Test plan

- [ ] `pnpm typecheck` clean
- [ ] `node --test --experimental-strip-types src/**/*.test.ts` passes at the pre-flight baseline
- [ ] Cycle every surface (Home / Chat / Board / Calendar / Inbox / Library / Browser / Terminal / GitHub) — no console errors, no visual surprises
- [ ] Cycle every familiar via avatar rail and via ⌥1–⌥9; each restores its last surface
- [ ] Open companion rail (⌘J); switch tabs (Chat / Inspector / Memory); scroll state preserves
- [ ] Bottom slot ⌃` works from every surface and auto-collapses on Terminal
- [ ] Stop the daemon → banner appears across all surfaces; restart → banner disappears
- [ ] ⌘K palette, ⌘B sidebar, ⌘, settings, ⌘N new chat all behave per the keymap

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

**All phases complete.** The shell is one pattern; the IA is teachable in a sentence.

---

## Self-review log

After running through every task above, re-skim the spec sections and confirm each requirement maps to a task:

| Spec requirement | Task(s) |
|---|---|
| Avatar rail leftmost (52px, presence, unread, +, ≡) | 1.2, 1.4, 5.1 |
| Sidebar grouped Work / Knowledge / Tools + Settings | 1.5 |
| Companion rail with Chat / Inspector / Memory tabs | 2.1, 2.2, 2.3 |
| Per-familiar last-surface memory | 1.1, 1.4 |
| Sessions → Chat surface (history sub-view) | 3.3 |
| Schedules → Inbox tab | 3.4 |
| Plugins → Settings panel | 3.5 |
| Projects → Library sub-tab | 3.6 |
| Floor → Home ambient widget | 3.7 |
| New TopBar (brand + breadcrumb + ⌘K + bell + settings) | 4.4 |
| Banner strip (error/warning/info) | 4.1, 4.2 |
| Daemon-offline banner cross-surface | 4.3 |
| Sidecar-auth banner cross-surface | 5.3 |
| Bottom slot stays + auto-collapses on Terminal | 5.2 |
| Keyboard: ⌘1–⌘8, ⌥1–⌥9, ⌘↑↓, ⌘N | 4.5 |
| Persistence keys per spec table | 1.1, 2.3, plus the localStorage sweep in 5.5 |
| Delete IconNavStrip, stripLock, agentExtra/Label/Icon | 2.3 (props), 5.5 (function) |
| Promote FamiliarRail's configurator into Settings | 5.4 |

No requirement is unmapped.
