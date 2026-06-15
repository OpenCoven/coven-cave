# Shell IA Last-Mile PR Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close out the three remaining items from the 2026-06-08 Shell IA spec. The fundamentals shipped quietly across recent PRs; what's left is sidebar list hygiene and one per-familiar persistence wiring.

**Architecture:** Two logically-cohesive commits, each approval-gated. No new primitives. Consumes existing `familiar-memory` helpers (`getRailOpen` / `setRailOpen`) that were exported in earlier work but never wired.

**Tech Stack:** Next.js 16 · React 19 · `node:test` source-grep tests.

**Source spec:** `docs/superpowers/specs/2026-06-08-ui-ux-shell-ia-design.md` (status: "Approved (design); plan pending" — but ~85% executed already).

**Genuinely-remaining items (verified 2026-06-08 against current code):**

1. `roles` is still a sidebar entry. Spec wanted it folded into Settings · Plugins. Status: sidebar entry remains; the `mode === "roles"` route still handles PluginsView with tabs=["roles","workflows"].
2. `capabilities` is still a sidebar entry. Spec didn't explicitly fold it but it's an extra sidebar entry not in the spec's 9-surface list.
3. Companion rail (`agentOpen` in `shell.tsx`) initialises from global pane-widths but does NOT consume `cave:familiar:{id}:rail.open`. The helpers `getRailOpen` / `setRailOpen` exist in `src/lib/familiar-memory.ts` and are exported but have zero callers.

**Explicitly NOT in scope:**
- Removing the `mode === "roles"` and `mode === "capabilities"` route branches in `workspace.tsx`. They stay reachable from `PluginsView`'s internal actions (`setMode("capabilities")` at line 1003–1004). Removing them would require rerouting those actions into Settings sections — a bigger refactor that exceeds "last-mile cleanup." Just drop the sidebar entries.
- The spec's `agents → chat` consolidation. The `agents` ("Familiars") sidebar entry routes to a real surface (roster, glyph picker entry, memory graph). Removing it would be a regression, not cleanup. Out of scope per the controller decision.

---

## Pre-flight

- [ ] **Confirm signing is configured** (CLAUDE.md hard rule)

```bash
git config --get user.signingkey
git config --get gpg.format
```

Expected: non-empty. If empty, stop and surface to user.

- [ ] **Confirm main is current**

```bash
git fetch origin main
git log origin/main --oneline | head -3
```

- [ ] **Create worktree** (per `.wt/<branch>` convention)

```bash
git -C /Users/buns/Documents/GitHub/OpenCoven/coven-cave \
  worktree add -b shell-ia-lastmile .wt/shell-ia-lastmile origin/main
cd /Users/buns/Documents/GitHub/OpenCoven/coven-cave/.wt/shell-ia-lastmile
```

- [ ] **Install + typecheck**

```bash
pnpm install
pnpm typecheck
```

Expected: clean.

- [ ] **Approval gate — confirm scope before any code change**

Surface to user:
> "Worktree up at `<path>`. 2 commits planned: (S1) drop `roles` + `capabilities` sidebar entries; (S2) wire companion rail open/closed state to per-familiar persistence. Proceed?"

Wait for explicit go. Same approval gate applies to every commit, push, and PR step below.

---

## File map

| File | Action | Why |
|---|---|---|
| `src/components/sidebar-minimal.tsx` | modify | drop the `roles` and `capabilities` entries from the SURFACES list |
| `src/components/shell.tsx` | modify | expose `onAgentOpenChange` callback so parent can react to rail toggles |
| `src/components/workspace.tsx` | modify | on `activeId` change, restore rail open via `getRailOpen`; pass `onAgentOpenChange={(open) => activeId && setRailOpen(activeId, open)}` to Shell |
| `src/components/sidebar-minimal.test.ts` | create or modify | source-grep that `roles`/`capabilities` ids are absent from the sidebar list |
| `src/components/companion-rail-persistence.test.ts` | create | source-grep that workspace imports & uses `getRailOpen`/`setRailOpen` and Shell exposes `onAgentOpenChange` |

Tests follow the repo's source-grep convention (`node:assert/strict` + `readFileSync`, run via `npx --yes tsx --test`).

---

## Task S1: Drop `roles` + `capabilities` from sidebar list

**Why:** Spec wanted `roles` in Settings; `capabilities` was never on the spec's 9-surface list. Both are still sidebar entries (`sidebar-minimal.tsx` lines 80–81). The mode routes stay (PluginsView and CapabilitiesViewSurface still reachable from `setMode(...)` calls inside `PluginsView`) — we're only removing the SIDEBAR ENTRIES so the sidebar matches the spec.

**Files:**
- Modify: `src/components/sidebar-minimal.tsx` (lines ~80–81; the `roles` + `capabilities` entries)
- Modify or create: `src/components/sidebar-minimal.test.ts` (if exists; if not, create)

### Step S1.1 — Inspect

```bash
cd /Users/buns/Documents/GitHub/OpenCoven/coven-cave/.wt/shell-ia-lastmile
sed -n '60,90p' src/components/sidebar-minimal.tsx
ls src/components/sidebar-minimal.test.ts 2>&1
```

Note:
- The exact SURFACES (or `MODES`) array structure
- Whether a `sidebar-minimal.test.ts` already exists and what it asserts. If it exists and already pins the surface list, your test edit aligns with what's there.

### Step S1.2 — Write the failing test

If `src/components/sidebar-minimal.test.ts` exists, ADD the assertions below at the end (before any final `console.log`). If it doesn't exist, create it with this content:

```ts
// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("./sidebar-minimal.tsx", import.meta.url),
  "utf8",
);

// 1. `roles` is no longer a sidebar entry.
assert.doesNotMatch(
  source,
  /\{[^}]*id:\s*"roles"[^}]*\}/,
  "roles is not a sidebar entry",
);

// 2. `capabilities` is no longer a sidebar entry.
assert.doesNotMatch(
  source,
  /\{[^}]*id:\s*"capabilities"[^}]*\}/,
  "capabilities is not a sidebar entry",
);

// 3. The surviving Tools-group entries still include browser + terminal.
assert.match(
  source,
  /id:\s*"browser"[^}]*group:\s*"tools"/,
  "browser stays in Tools",
);
assert.match(
  source,
  /id:\s*"terminal"[^}]*group:\s*"tools"/,
  "terminal stays in Tools",
);

console.log("sidebar-minimal.test.ts (shell-ia-lastmile) OK");
```

### Step S1.3 — Run, confirm FAIL

```bash
npx --yes tsx --test src/components/sidebar-minimal.test.ts
```

Expected: failures on assertions 1 and 2.

### Step S1.4 — Drop the two entries

In `src/components/sidebar-minimal.tsx`, find the SURFACES (or equivalent) array around lines 68–83. **Delete** these two entries verbatim:

```tsx
  { id: "roles", label: "Roles", iconName: "ph:mask-happy", group: "tools" },
  { id: "capabilities", label: "Capabilities", iconName: "ph:lightning-bold", group: "tools" },
```

Preserve every other entry, including `terminal`, `browser`, and any `addons`-group entry (e.g., `github`). The lines may have minor formatting differences from the snippet above; match by `id:` value.

**Do NOT** modify the route handlers in `workspace.tsx` (`mode === "roles"`, `mode === "capabilities"`) — they stay so internal navigation from `PluginsView` (e.g., `onCreatePlugin={() => setMode("capabilities")}`) still works.

### Step S1.5 — Run test, confirm PASS

```bash
npx --yes tsx --test src/components/sidebar-minimal.test.ts
```

Expected: `sidebar-minimal.test.ts (shell-ia-lastmile) OK`. If the test file already contained prior assertions, those should still pass — surface any regression.

### Step S1.6 — Typecheck + build

```bash
pnpm typecheck
pnpm build 2>&1 | tail -10
```

Expected: clean.

### Step S1.7 — Manual smoke (controller will run; implementer skips)

The implementer reports STATUS and stops. Controller runs `pnpm dev`, opens the sidebar, confirms:
- `Roles` and `Capabilities` no longer appear in the sidebar
- All other entries (Home, Chat, Familiars, Board, Calendar, Inbox, Library, Browser, Terminal, GitHub) still appear in the right group
- Existing flows still work: `PluginsView`'s "Create skill" button still routes to capabilities; "Open Plugins" from Settings still works

### Step S1.8 — STOP HERE

Do **not** commit. Do **not** push. Run and include verbatim:

```bash
git status --short
git diff --stat
git diff src/components/sidebar-minimal.tsx
```

### Status reporting

End with one of:
- `STATUS: DONE` — test failing→passing; typecheck + build clean; only the 2 lines deleted from the SURFACES array.
- `STATUS: DONE_WITH_CONCERNS` — explain (e.g., if the existing sidebar test already pinned the surface list and your delta is bigger than 2 entries).
- `STATUS: NEEDS_CONTEXT` — explain.
- `STATUS: BLOCKED` — explain.

**Do NOT run git commit, git push, or any gh mutation command. If a pre-commit hook or any other mechanism creates a commit, report STATUS: BLOCKED with the SHA — do NOT proceed.**

### Step S1.9 — Controller: approval gate, then commit (signed)

After implementer reports DONE, controller shows the user the diff + test output. Wait for explicit user approval before:

```bash
git add src/components/sidebar-minimal.tsx src/components/sidebar-minimal.test.ts
git commit -S -m "$(cat <<'EOF'
feat(ia): drop roles + capabilities from sidebar

The 2026-06-08 Shell IA spec wanted Roles folded into Settings (where
PluginsView already lives via the settings-shell Plugins section).
Capabilities was never on the spec's 9-surface list. Both entries are
removed from the sidebar SURFACES array.

The `mode === "roles"` and `mode === "capabilities"` route branches in
workspace.tsx stay in place — PluginsView's internal actions
(`onCreatePlugin`, `onCreateSkill`) still call `setMode("capabilities")`.
Rerouting those is a larger refactor and out of scope here.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
git log -1 --show-signature
```

Verify `Good "<algorithm>" signature` appears.

---

## Task S2: Wire companion rail open/closed to per-familiar persistence

**Why:** `cave:familiar:{id}:rail.open` is the spec's persistence key for "this familiar prefers their companion rail open/closed." Helpers `getRailOpen(id)` and `setRailOpen(id, open)` exist in `src/lib/familiar-memory.ts` but no caller exists. Today the rail's open state is global (from `cave.shell.widths.v1`'s pane sizes). The fix: bridge Shell's `agentOpen` to workspace's `activeId`-aware persistence.

**Pattern (mirrors the K2 `sidebarOpen` plumbing that PR #280 shipped):**
- `Shell` gains an `onAgentOpenChange?: (open: boolean) => void` prop. Fires once on mount with the initial state, then on every toggle.
- `Workspace` passes `onAgentOpenChange={(open) => activeId && setRailOpen(activeId, open)}`.
- `Workspace` also adds an effect on `activeId` change that reads `getRailOpen(activeId)` and calls `shellRef.current?.openAgent()` or `closeAgent()` to match.

**Files:**
- Modify: `src/components/shell.tsx`
- Modify: `src/components/workspace.tsx`
- Create: `src/components/companion-rail-persistence.test.ts`

### Step S2.1 — Inspect

```bash
cd /Users/buns/Documents/GitHub/OpenCoven/coven-cave/.wt/shell-ia-lastmile
grep -n "agentOpen\|setAgentOpen\|openAgent\|closeAgent\|toggleAgent\|onNavOpenChange\|ShellInner" src/components/shell.tsx | head -20
grep -n "openAgent\|closeAgent\|toggleAgent\|getRailOpen\|setRailOpen\|setActiveFamiliar\|setLastSurface" src/components/workspace.tsx | head -15
```

Note:
- The `agentOpen` state declaration line (~line 159) and where `setAgentOpen` is called
- How `onNavOpenChange` was wired in PR #280 (mirror the pattern for `onAgentOpenChange`)
- The `useEffect` that runs on `activeId` change (likely near `setActiveFamiliar(activeId)` ~line 131)

### Step S2.2 — Write the failing test

Create `src/components/companion-rail-persistence.test.ts`:

```ts
// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// 1. Shell exposes onAgentOpenChange prop and fires it on agentOpen state changes.
{
  const src = readFileSync(
    new URL("./shell.tsx", import.meta.url),
    "utf8",
  );
  assert.match(
    src,
    /onAgentOpenChange\?:\s*\(open:\s*boolean\)\s*=>\s*void/,
    "Shell declares onAgentOpenChange prop",
  );
  assert.match(
    src,
    /onAgentOpenChange\?\.\(agentOpen\)/,
    "Shell calls onAgentOpenChange(agentOpen) in an effect",
  );
}

// 2. Workspace imports getRailOpen + setRailOpen from familiar-memory.
{
  const src = readFileSync(
    new URL("./workspace.tsx", import.meta.url),
    "utf8",
  );
  assert.match(
    src,
    /import\s+\{[\s\S]*?getRailOpen[\s\S]*?\}\s+from\s+["']@\/lib\/familiar-memory["']/,
    "Workspace imports getRailOpen",
  );
  assert.match(
    src,
    /import\s+\{[\s\S]*?setRailOpen[\s\S]*?\}\s+from\s+["']@\/lib\/familiar-memory["']/,
    "Workspace imports setRailOpen",
  );

  // 3. Workspace passes onAgentOpenChange to Shell.
  assert.match(
    src,
    /onAgentOpenChange=\{/,
    "Workspace passes onAgentOpenChange to Shell",
  );
  // The callback persists per-familiar.
  assert.match(
    src,
    /setRailOpen\(/,
    "Workspace calls setRailOpen(...) somewhere",
  );

  // 4. Workspace restores rail state on activeId change.
  assert.match(
    src,
    /getRailOpen\(/,
    "Workspace calls getRailOpen(...) somewhere (for restore)",
  );
}

console.log("companion-rail-persistence.test.ts OK");
```

### Step S2.3 — Run, confirm FAIL

```bash
npx --yes tsx --test src/components/companion-rail-persistence.test.ts
```

Expected: every assertion fails.

### Step S2.4 — Add `onAgentOpenChange` to Shell

In `src/components/shell.tsx`:

a. Find the `ShellInner` props (~line 94 area, where `familiarRail` lives). Add a new prop type alongside `onNavOpenChange` (which PR #280 added):

```tsx
  onAgentOpenChange?: (open: boolean) => void;
```

…in BOTH the destructure of props AND the inline type annotation. After:

```tsx
function ShellInner({
  familiarRail,
  nav,
  list,
  detail,
  agent,
  bottom,
  topBar,
  onNavOpenChange,
  onAgentOpenChange,
}: {
  familiarRail?: ReactNode;
  nav: ReactNode;
  list: ReactNode;
  detail: ReactNode;
  agent?: ReactNode;
  bottom?: ReactNode;
  topBar?: ReactNode;
  onNavOpenChange?: (open: boolean) => void;
  onAgentOpenChange?: (open: boolean) => void;
}, ref: ForwardedRef<ShellHandle>) {
```

(Adapt to actual prop order; only add the two new lines.)

b. Mirror the existing `onNavOpenChange` effect. Find the effect that fires `onNavOpenChange?.(navOpen)` (PR #280 added ~lines 169–171) and add a parallel one for `agentOpen`:

```tsx
useEffect(() => {
  onAgentOpenChange?.(agentOpen);
}, [agentOpen, onAgentOpenChange]);
```

Place it immediately after the existing `onNavOpenChange` effect for symmetry.

c. Verify the public `Shell` (the `forwardRef` wrapper around `ShellInner`) also surfaces the new prop. If `Shell` simply forwards `props` via spread, no extra change is needed; if it explicitly enumerates props, add `onAgentOpenChange` to the type and pass it through.

### Step S2.5 — Wire workspace.tsx

In `src/components/workspace.tsx`:

a. Extend the `familiar-memory` import (~line 25). Currently:

```tsx
import {
  getActiveFamiliar,
  setActiveFamiliar,
  getLastSurface,
  setLastSurface,
} from "@/lib/familiar-memory";
```

Add the two helpers:

```tsx
import {
  getActiveFamiliar,
  setActiveFamiliar,
  getLastSurface,
  setLastSurface,
  getRailOpen,
  setRailOpen,
} from "@/lib/familiar-memory";
```

b. Add an effect that restores rail state on `activeId` change. Place it near the existing `activeId`-watching effects (around line 131 where `setActiveFamiliar(activeId)` is called):

```tsx
useEffect(() => {
  if (!activeId) return;
  const desired = getRailOpen(activeId);
  // Use a microtask so shellRef is mounted.
  queueMicrotask(() => {
    if (desired) shellRef.current?.openAgent();
    else shellRef.current?.closeAgent();
  });
}, [activeId]);
```

c. On the `<Shell ...>` element (around line 1043 — the same place PR #280 added `onNavOpenChange={setNavOpen}`), add the persistence callback:

```tsx
onAgentOpenChange={(open) => {
  if (activeId) setRailOpen(activeId, open);
}}
```

### Step S2.6 — Run test, confirm PASS

```bash
npx --yes tsx --test src/components/companion-rail-persistence.test.ts
```

Expected: `companion-rail-persistence.test.ts OK`.

### Step S2.7 — Regression: S1 + other shell tests still pass

```bash
npx --yes tsx --test \
  src/components/sidebar-minimal.test.ts \
  src/lib/familiar-memory.test.ts
```

Expected: both pass.

### Step S2.8 — Typecheck + build

```bash
pnpm typecheck
pnpm build 2>&1 | tail -10
```

Expected: clean.

### Step S2.9 — STOP HERE

Do **not** commit. Do **not** push. Run and include:

```bash
git status --short
git diff --stat
git diff src/components/shell.tsx
git diff src/components/workspace.tsx
```

In the report:
- The exact line where the `onAgentOpenChange` effect was placed (relative to `onNavOpenChange`)
- The exact line where the activeId-restore effect was placed
- Confirmation that the existing `agentOpen` initialization (from pane-widths) was NOT modified — we only ADD the persistence bridge

### Status reporting

End with `STATUS: DONE` (or DONE_WITH_CONCERNS / NEEDS_CONTEXT / BLOCKED with explanation). Same forbidden-command rules as S1.

### Step S2.10 — Controller: approval gate + manual smoke + commit (signed)

After implementer reports DONE, controller surfaces diff + test output. Optional manual smoke:
- `pnpm dev`, open the app
- Switch between two familiars; close the rail on one, open it on the other; switch back and forth and confirm the rail state is restored per-familiar

Wait for explicit user approval before:

```bash
git add src/components/shell.tsx src/components/workspace.tsx src/components/companion-rail-persistence.test.ts
git commit -S -m "$(cat <<'EOF'
feat(ia): companion rail open/closed persists per-familiar

Wires the cave:familiar:{id}:rail.open helpers from familiar-memory that
have been exported but had no caller. Shell gains an onAgentOpenChange
prop that mirrors PR #280's onNavOpenChange — fires on every agentOpen
state change. Workspace passes it to setRailOpen(activeId, open), and an
activeId-change effect restores the desired state via getRailOpen +
shellRef.openAgent()/closeAgent().

The global pane-width store (cave.shell.widths.v1) still drives initial
geometry; the per-familiar key only overrides open/closed when an
active familiar is known.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
git log -1 --show-signature
```

Verify signed.

---

## Task S3: Verify, ask before push, ask before PR

**Default posture:** stop and ask. Verification is unconditional; push and PR each block on user OK.

### Step S3.1 — Run every relevant test + full typecheck + build

```bash
cd /Users/buns/Documents/GitHub/OpenCoven/coven-cave/.wt/shell-ia-lastmile
pnpm typecheck
npx --yes tsx --test \
  src/components/sidebar-minimal.test.ts \
  src/components/companion-rail-persistence.test.ts \
  src/lib/familiar-memory.test.ts
pnpm build 2>&1 | tail -10
```

Expected: clean typecheck; 3 test files pass; build clean.

### Step S3.2 — Verify every commit is signed

```bash
git log origin/main..HEAD --pretty='%H %G? %s' | awk '$2 != "G" {print "UNSIGNED:", $0}'
```

Expected: empty. If anything prints, do NOT push. Surface to user and rebase to sign before continuing.

### Step S3.3 — Approval gate, then push

Surface to user:
- Commit list: `git log --oneline origin/main..HEAD`
- All checks green
- Every commit signed

Ask: **"Push `shell-ia-lastmile` to origin?"** Wait for explicit yes. Do NOT push silently.

```bash
git push -u origin shell-ia-lastmile
```

### Step S3.4 — Approval gate, then open the PR

Draft the body locally. Show to user. Ask: **"Open the PR with this body?"** Wait for yes.

```bash
gh pr create --title "feat(ia): shell IA spec last-mile — sidebar cleanup + rail persistence" --body "$(cat <<'EOF'
## Summary
Closes the three remaining items from the 2026-06-08 Shell IA spec; the fundamentals shipped quietly across recent PRs.

- **Sidebar:** drop `Roles` and `Capabilities` entries. The `mode === "roles"` and `mode === "capabilities"` route branches stay so PluginsView's internal navigation (`setMode("capabilities")` on "Create skill") still works — rerouting those into Settings sections is out of scope here.
- **Companion rail per-familiar persistence:** wires the `cave:familiar:{id}:rail.open` helpers from `familiar-memory.ts` that were exported but never consumed. Shell gains `onAgentOpenChange` (mirrors `onNavOpenChange` from #280); Workspace persists via `setRailOpen(activeId, open)` and restores on activeId change.

## Explicitly NOT in scope
- The spec's `agents → chat` consolidation. The "Familiars" sidebar entry routes to a real surface (roster, glyph picker entry, memory graph). Removing it would be a regression.
- Rerouting `PluginsView`'s internal `setMode("capabilities")` actions into Settings sections. Bigger refactor; future cleanup.

## Test plan
- [x] `pnpm typecheck` clean.
- [x] `pnpm build` clean.
- [x] Source-grep tests pass: `sidebar-minimal.test.ts` (no roles/capabilities entries), `companion-rail-persistence.test.ts` (Shell + Workspace wiring).
- [x] Every commit signed.
- [ ] Manual: sidebar no longer shows Roles/Capabilities. PluginsView's "Create skill"/"Create plugin" still navigates correctly. Switching familiars restores each one's preferred rail open/closed state.

## Source
- Spec: `docs/superpowers/specs/2026-06-08-ui-ux-shell-ia-design.md` (gitignored).
- Plan: `docs/superpowers/plans/2026-06-08-shell-ia-lastmile.md` (gitignored).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Return the PR URL. Do not merge.

---

## Self-review

**Spec coverage** — for each genuinely-undone item from the verification pass:

| Item | Task |
|---|---|
| roles still in sidebar | S1 ✓ |
| capabilities still in sidebar | S1 ✓ |
| `cave:familiar:{id}:rail.open` unwired | S2 ✓ |

Explicitly deferred (called out in scope + PR body): the `agents → chat` consolidation (regression risk), rerouting PluginsView's `setMode("capabilities")` actions into Settings (bigger refactor).

**Placeholder scan** — no TBDs / "similar to" placeholders.

**Type consistency** — `onAgentOpenChange?: (open: boolean) => void` matches the existing `onNavOpenChange` signature from PR #280. `getRailOpen` / `setRailOpen` signatures from `familiar-memory.ts` are `(familiarId: string) => boolean` and `(familiarId: string, open: boolean) => void` respectively.

**Risk** —
- S1 is mechanical (2 lines deleted) — extremely low risk.
- S2 plumbs state through Shell → Workspace. The `queueMicrotask` in the activeId-restore effect avoids a race with shellRef mounting. If for some reason `shellRef.current` is still null when the microtask runs, the restore is a no-op — the global pane-widths still drive geometry, so the rail won't appear in a broken state.

**Test framing** — source-grep tests verify pattern landed. Behavioural verification is the optional manual smoke in S2.10 (switching familiars and confirming rail state restoration). Local invariant checks per the project test convention.

**Approval discipline** — every commit step gated. Push and PR each have their own explicit gate in S3.

**Subagent safety** — implementer prompts include explicit prohibitions on `git commit`, `git push`, `gh` mutations after the C1 implementer breach. Implementer's task ends at `git status --short` + diff stat output.
