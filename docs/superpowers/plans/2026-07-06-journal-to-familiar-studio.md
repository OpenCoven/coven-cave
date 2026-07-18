# Journal → Familiar Studio Tab; Canvas Surface → Feature Branch — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the Journal into a per-familiar tab in Settings → Familiars (Familiar Studio), redirect all old Journal entry points there, and retire the generated-canvas *surface* from `main` (preserved on `feature/journal-canvas-surface`). Backend (`/api/canvas`, `/api/journal`) and chat inline canvas artifacts stay.

**Architecture:** `"journal"` becomes a `FamiliarStudioTab`; a thin wrapper renders the existing `JournalEntries` scoped to the studio's selected familiar. The workspace `setMode` gains a `"journal"` redirect branch (same pattern as the existing `"groupchat"` redirect), so every entry point (sidebar row, ⌘K palette, `?mode=journal`, `cave:navigate-mode`, dashboard links) funnels into Settings → Familiars → Journal. `JournalView` + `CanvasList` are deleted from main.

**Tech Stack:** Next.js/React (pnpm), node:test-style source-scan tests run via `scripts/run-tests.mjs` suites, Playwright e2e (unaffected).

**Spec:** `docs/superpowers/specs/2026-07-06-journal-to-familiar-studio-design.md`

**Repo rules that apply:**
- `main` is protected: all changes land via PR with green `Frontend build`, `Rust check`, `CodeQL`, `E2E (Playwright)` checks; squash-merge via `gh pr merge`.
- Work in a `.worktrees/<branch>` worktree. Push the branch after every commit.
- Every new `*.test.ts` must be wired into the suite lists in `scripts/run-tests.mjs` (enforced by `check-tests-wired`).
- Commits: include `Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>` trailer.

---

### Task 1: Archive branch + worktree setup

**Files:** none (git only)

- [ ] **Step 1: Create the archive feature branch on origin from current main (canvas surface intact)**

```bash
cd /Users/buns/Documents/GitHub/OpenCoven/coven-cave
git fetch origin
git push origin origin/main:refs/heads/feature/journal-canvas-surface
```

Expected: `* [new branch] origin/main -> feature/journal-canvas-surface`. This branch is the preservation copy — nothing more is done to it.

- [ ] **Step 2: Create the working worktree**

```bash
git worktree add -b journal-studio-move .worktrees/journal-studio-move origin/main
cd .worktrees/journal-studio-move && pnpm install
```

Expected: worktree created; `pnpm install` completes (~10s via CAS store). All subsequent tasks run inside `.worktrees/journal-studio-move`.

- [ ] **Step 3: Bring the spec + this plan into the branch and commit**

```bash
mkdir -p docs/superpowers/specs docs/superpowers/plans
cp ../../docs/superpowers/specs/2026-07-06-journal-to-familiar-studio-design.md docs/superpowers/specs/
cp ../../docs/superpowers/plans/2026-07-06-journal-to-familiar-studio.md docs/superpowers/plans/
git add docs/superpowers
git commit -m "docs: journal→familiar-studio spec + plan

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
git push -u origin journal-studio-move
```

---

### Task 2: `"journal"` studio tab type + shared settings-redirect helper

**Files:**
- Modify: `src/lib/familiar-studio-context.tsx`
- Test (new): `src/components/familiar-studio-journal-tab.test.ts`

- [ ] **Step 1: Write the failing test (first slice)**

Create `src/components/familiar-studio-journal-tab.test.ts`:

```ts
// @ts-nocheck
// Journal lives in the Familiar Studio (Settings → Familiars → Journal).
// Source-scan invariants for the tab wiring and the redirect from the old
// top-level Journal surface.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");

const ctx = read("../lib/familiar-studio-context.tsx");

// ── Studio context knows the journal tab ─────────────────────────────────────
assert.match(ctx, /"journal"/, "FamiliarStudioTab union includes journal");
assert.match(
  ctx,
  /STUDIO_TABS[\s\S]*?"journal"/,
  "the persisted-tab restore guard accepts journal",
);
// One shared redirect helper: workspace surfaces and the redirecting provider
// both route through it, so the tab/familiar handoff keys can't drift.
assert.match(
  ctx,
  /export function openFamiliarStudioSettingsTab\(/,
  "context exports the settings-redirect helper",
);
assert.match(
  ctx,
  /openFamiliarStudioSettingsTab\(tab, id\)/,
  "the redirecting provider reuses the helper",
);

console.log("familiar-studio-journal-tab.test.ts: ok");
```

- [ ] **Step 2: Run it to verify it fails**

```bash
node --experimental-strip-types src/components/familiar-studio-journal-tab.test.ts
```

Expected: FAIL on the `STUDIO_TABS` assertion.

- [ ] **Step 3: Implement in `src/lib/familiar-studio-context.tsx`**

Change the type line 13 and add a canonical tab list:

```tsx
export type FamiliarStudioTab =
  | "identity" | "look" | "brain" | "lifecycle" | "memory" | "projects" | "contract" | "vault" | "journal";

const STUDIO_TABS: readonly FamiliarStudioTab[] = [
  "identity", "look", "brain", "lifecycle", "memory", "projects", "contract", "vault", "journal",
];
```

Replace the restore-effect's long `stored === "identity" || …` chain (lines 61–76) with:

```tsx
  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = window.localStorage.getItem(TAB_STORAGE_KEY);
    if ((STUDIO_TABS as readonly string[]).includes(stored ?? "")) {
      setActiveTabState(stored as FamiliarStudioTab);
    }
  }, []);
```

Add the exported helper (below `BRAIN_STUDIO_FAMILIAR_KEY`):

```tsx
/**
 * Hard-navigate to Settings → Familiars with an optional studio tab and
 * familiar preselected. This is the single redirect path shared by the
 * workspace-level provider (`redirectToSettings`) and workspace surfaces that
 * retired their own page (e.g. the Journal, now a studio tab).
 */
export function openFamiliarStudioSettingsTab(tab?: FamiliarStudioTab, familiarId?: string): void {
  if (typeof window === "undefined") return;
  try {
    if (familiarId) window.localStorage.setItem(BRAIN_STUDIO_FAMILIAR_KEY, familiarId);
    if (tab) window.localStorage.setItem(TAB_STORAGE_KEY, tab);
  } catch {
    /* storage may be unavailable */
  }
  window.location.assign("/settings#familiars");
}
```

Refactor `openFamiliarStudio`'s redirect branch (lines 87–94) to:

```tsx
      if (redirectToSettings) {
        openFamiliarStudioSettingsTab(tab, id);
        return;
      }
```

and `openFamiliarStudioListView`'s redirect branch (lines 103–108) to:

```tsx
    if (redirectToSettings) {
      openFamiliarStudioSettingsTab("lifecycle");
      return;
    }
```

- [ ] **Step 4: Run test + typecheck**

```bash
node --experimental-strip-types src/components/familiar-studio-journal-tab.test.ts
pnpm typecheck
```

Expected: test PASSES; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/familiar-studio-context.tsx src/components/familiar-studio-journal-tab.test.ts
git commit -m "feat(familiars): journal studio tab type + shared settings-redirect helper

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
git push
```

---

### Task 3: `FamiliarStudioJournalTab` component + inline-panel registration + settings search index

**Files:**
- Create: `src/components/familiar-studio-journal-tab.tsx`
- Modify: `src/components/familiar-studio-inline.tsx`
- Modify: `src/components/settings-sections.ts` (index entry, near line 57)
- Modify: `src/components/settings-search.test.ts` (tab loop, line 44)
- Modify: `src/styles/journal.css` (studio-host sizing)
- Test: `src/components/familiar-studio-journal-tab.test.ts`

- [ ] **Step 1: Extend the test (append before the final `console.log`)**

```ts
const wrapper = read("./familiar-studio-journal-tab.tsx");
const inline = read("./familiar-studio-inline.tsx");
const sections = read("./settings-sections.ts");
const css = read("../styles/journal.css");

// ── Wrapper: reuse JournalEntries pinned to the studio's familiar ────────────
assert.match(wrapper, /import "@\/styles\/journal\.css"/, "wrapper carries the journal styles");
assert.match(wrapper, /<JournalEntries/, "wrapper renders the existing JournalEntries surface");
assert.match(
  wrapper,
  /useMemo\(\(\) => new Set\(\[familiar\.id\]\), \[familiar\.id\]\)/,
  "the multiselect scope is pinned to the one familiar being edited",
);
assert.match(wrapper, /activeFamiliarId=\{familiar\.id\}/, "generation targets the studio familiar");

// ── Inline panel: the tab is registered and rendered ─────────────────────────
assert.match(
  inline,
  /\{ id: "journal", label: "Journal", icon: "ph:book-open" \}/,
  "the studio tab bar includes Journal",
);
assert.match(
  inline,
  /activeTab === "journal" \? <FamiliarStudioJournalTab familiar=\{familiar\} allFamiliars=\{familiars\} \/> : null/,
  "the journal tab body renders the wrapper",
);

// ── Settings search reaches the tab ──────────────────────────────────────────
assert.match(sections, /familiarTab: "journal"/, "the journal studio tab is indexed for settings search");

// ── Studio host gives the master-detail journal a bounded height ─────────────
assert.match(
  css,
  /\.familiar-studio-journal \.journal-list \{[\s\S]*?height:/,
  "journal-list gets an explicit height inside the studio body",
);
```

- [ ] **Step 2: Run to verify the new assertions fail**

```bash
node --experimental-strip-types src/components/familiar-studio-journal-tab.test.ts
```

Expected: FAIL (wrapper file missing).

- [ ] **Step 3: Create `src/components/familiar-studio-journal-tab.tsx`**

```tsx
"use client";

import { useMemo } from "react";
import "@/styles/journal.css";
import { JournalEntries } from "@/components/journal/journal-entries";
import type { ResolvedFamiliar } from "@/lib/familiar-resolve";
import type { Familiar } from "@/lib/types";

/**
 * Familiar Studio → Journal tab: the daily-reflection reader/editor scoped to
 * the familiar being edited. Reuses the full JournalEntries surface (day rail,
 * generate, edit/delete with undo) with the multiselect scope pinned to this
 * one familiar — the Journal's former top-level page redirects here.
 */
export function FamiliarStudioJournalTab({
  familiar,
  allFamiliars,
}: {
  familiar: ResolvedFamiliar;
  allFamiliars: Familiar[];
}) {
  const scope = useMemo(() => new Set([familiar.id]), [familiar.id]);
  return (
    <div className="familiar-studio-journal">
      <JournalEntries
        familiars={allFamiliars}
        activeFamiliarId={familiar.id}
        scopeFamiliarIds={scope}
      />
    </div>
  );
}
```

- [ ] **Step 4: Register in `src/components/familiar-studio-inline.tsx`**

Add import (after the `FamiliarStudioProjectsTab` import, line 14):

```tsx
import { FamiliarStudioJournalTab } from "./familiar-studio-journal-tab";
```

Add to `TABS` after the `memory` entry (line 31):

```tsx
  { id: "journal", label: "Journal", icon: "ph:book-open" },
```

Add the body branch after the `memory` branch (line 169):

```tsx
              {activeTab === "journal" ? <FamiliarStudioJournalTab familiar={familiar} allFamiliars={familiars} /> : null}
```

(`ph:book-open` is already in `ICON_NAMES` — it's used by the sidebar today.)

- [ ] **Step 5: Index entry in `src/components/settings-sections.ts`**

After the `Memory` entry (line 57) add:

```ts
  { section: "familiars", group: "Journal", familiarTab: "journal", keywords: "journal daily reflection reflections diary entries generate" },
```

In `src/components/settings-search.test.ts` line 44, add `"journal"` to the loop:

```ts
for (const tab of ["identity", "look", "brain", "lifecycle", "memory", "projects", "vault", "journal"]) {
```

- [ ] **Step 6: Studio-host sizing in `src/styles/journal.css`**

Append at the end of the file:

```css
/* ── Familiar Studio host ─────────────────────────────────────────────────────
   Inside Settings → Familiars the journal has no full-page flex parent, so the
   master-detail shell gets an explicit bounded height: the day rail and the
   detail pane scroll internally instead of growing the settings page. */
.familiar-studio-journal { display: flex; min-width: 0; }
.familiar-studio-journal .journal-list { height: min(65vh, 720px); }
```

- [ ] **Step 7: Run test + typecheck**

```bash
node --experimental-strip-types src/components/familiar-studio-journal-tab.test.ts
node --experimental-strip-types src/components/settings-search.test.ts
pnpm typecheck
```

Expected: both PASS; typecheck clean.

- [ ] **Step 8: Commit**

```bash
git add src/components/familiar-studio-journal-tab.tsx src/components/familiar-studio-inline.tsx \
  src/components/settings-sections.ts src/components/settings-search.test.ts \
  src/styles/journal.css src/components/familiar-studio-journal-tab.test.ts
git commit -m "feat(familiars): Journal tab in the Familiar Studio

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
git push
```

---

### Task 4: Workspace redirect — every Journal entry point lands on the studio tab

**Files:**
- Modify: `src/components/workspace.tsx` (setMode ~line 271, handleSlashIntent ~line 1681, renderSurface ~line 2021, import line 12)
- Modify: `src/components/sidebar-minimal.tsx` (line 100, description)
- Modify: `src/lib/page-drag.ts` (NON_SPLITTABLE)
- Modify: `src/lib/page-drag.test.ts`
- Modify: `src/lib/slash-commands.ts` (line 45–46)
- Test: `src/components/familiar-studio-journal-tab.test.ts`

- [ ] **Step 1: Extend the test (append before the final `console.log`)**

```ts
const ws = read("./workspace.tsx");
const sidebar = read("./sidebar-minimal.tsx");
const pageDrag = read("../lib/page-drag.ts");
const slash = read("../lib/slash-commands.ts");

// ── Workspace: "journal" is a redirect-only mode (like groupchat) ────────────
assert.match(
  ws,
  /if \(next === "journal"\) \{[\s\S]{0,400}?openFamiliarStudioSettingsTab\("journal"\)/,
  "setMode redirects journal to Settings → Familiars → Journal",
);
assert.doesNotMatch(ws, /import \{ JournalView \}/, "workspace no longer imports JournalView");
assert.doesNotMatch(ws, /mode === "journal" \?/, "no journal surface branch remains");
assert.doesNotMatch(ws, /cave:journal-set-tab/, "the journal tab event plumbing is gone");
assert.match(ws, /case "\/journal":\s*\n\s*setMode\("journal"\)/, "/journal routes through the redirect");

// ── Sidebar: the Journal row stays (redirects on click), minus sketches ─────
assert.match(sidebar, /id: "journal", label: "Journal", iconName: "ph:book-open"/, "sidebar keeps the Journal row");
assert.doesNotMatch(sidebar, /generated sketches/, "sidebar description no longer promises the canvas");

// ── A redirect is not a page: journal can't be dragged into a split ─────────
assert.match(pageDrag, /NON_SPLITTABLE = new Set\(\["terminal", "journal"\]\)/, "journal is excluded from drag-to-split");

// ── Slash palette copy matches the new home ───────────────────────────────────
assert.match(slash, /name: "\/journal"[^}]*Settings/, "/journal description points at Settings");
assert.doesNotMatch(slash, /Journal's Canvas tab/, "/canvas no longer advertises the Canvas page");
```

- [ ] **Step 2: Run to verify the new assertions fail**

```bash
node --experimental-strip-types src/components/familiar-studio-journal-tab.test.ts
```

Expected: FAIL on the setMode-redirect assertion.

- [ ] **Step 3: Implement the workspace redirect** (`src/components/workspace.tsx`)

Add to the imports from `@/lib/familiar-studio-context` (the file already imports `FamiliarStudioProvider` — extend that import): `openFamiliarStudioSettingsTab`.

In `setMode` (line 271), after the `groupchat` branch:

```tsx
    if (next === "journal") {
      // The Journal page retired — it lives in Settings → Familiars → Journal.
      // Every entry point (sidebar row, ⌘K palette, ?mode= deep link,
      // cave:navigate-mode, dashboard links) funnels through setMode, so this
      // one redirect covers them all.
      openFamiliarStudioSettingsTab("journal");
      return;
    }
```

Replace the `/journal` and `/canvas` cases (lines 1681–1690) with:

```tsx
      case "/journal":
        setMode("journal"); // redirects to Settings → Familiars → Journal
        return true;
      case "/canvas":
        // The Canvas page moved to feature/journal-canvas-surface. /canvas is
        // chat-inline now: hand off to a chat where the composer's /canvas
        // handler generates (with a prompt) or shows the usage hint (without).
        startFamiliarChat(activeId);
        return true;
```

Delete the `JournalView` import (line 12) and the renderSurface branch (line 2021):

```tsx
    ) : mode === "journal" ? (
      <JournalView familiars={familiars} activeFamiliarId={activeId} scopeFamiliarIds={scopeIds} />
```

(keep `journal: "Journal"` in the mode-title map, line 141 — `"journal"` stays in the `WorkspaceMode` union as a redirect-only mode, exactly like `groupchat`.)

- [ ] **Step 4: Sidebar description** (`src/components/sidebar-minimal.tsx` line 100)

```tsx
  { id: "journal", label: "Journal", iconName: "ph:book-open", description: "Your familiars' daily reflections — opens in Settings" },
```

- [ ] **Step 5: page-drag** (`src/lib/page-drag.ts`)

```ts
/** Pages that should never be openable in a split (heavy/stateful surfaces,
 *  or modes that redirect out of the workspace — journal → Settings). */
const NON_SPLITTABLE = new Set(["terminal", "journal"]);
```

Update `src/lib/page-drag.test.ts`: remove `"journal"` from the splittable list (line 6) and add:

```ts
test("journal is excluded from drag-to-split (redirects to Settings)", () => {
  assert.equal(isSplittablePage("journal"), false);
});
```

- [ ] **Step 6: Slash palette copy** (`src/lib/slash-commands.ts` lines 45–46)

```ts
  { name: "/journal", hint: "Journal", description: "Open your familiars' journal (Settings → Familiars → Journal).", section: "view" },
  { name: "/canvas", hint: "sketch a UI", description: "Generate a UI artifact inline in chat.", argPlaceholder: "describe a UI…", section: "view" },
```

- [ ] **Step 7: Run tests + typecheck**

```bash
node --experimental-strip-types src/components/familiar-studio-journal-tab.test.ts
node --experimental-strip-types src/lib/page-drag.test.ts
node --experimental-strip-types src/lib/slash-commands.test.ts
pnpm typecheck
```

Expected: all PASS. (workspace still imports `JournalView` — no: it's removed; `journal-view.tsx` still exists until Task 6, so typecheck stays clean.)

- [ ] **Step 8: Commit**

```bash
git add src/components/workspace.tsx src/components/sidebar-minimal.tsx \
  src/lib/page-drag.ts src/lib/page-drag.test.ts src/lib/slash-commands.ts \
  src/components/familiar-studio-journal-tab.test.ts
git commit -m "feat(workspace): journal mode redirects to the Familiar Studio tab

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
git push
```

---

### Task 5: Chat `/canvas` without a prompt shows an inline hint

**Files:**
- Modify: `src/components/chat-view.tsx` (~line 3467)
- Rewrite: `src/components/chat-canvas-command.test.ts`

- [ ] **Step 1: Rewrite the test** (`src/components/chat-canvas-command.test.ts`, full replacement)

```ts
// @ts-nocheck
// /canvas command: chat generates inline with a prompt; without one it shows a
// usage hint (the Canvas page moved to feature/journal-canvas-surface). The
// workspace-level /canvas hands off to a chat.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const chat = readFileSync(new URL("./chat-view.tsx", import.meta.url), "utf8");
const ws = readFileSync(new URL("./workspace.tsx", import.meta.url), "utf8");

assert.match(chat, /command === "\/canvas"/, "chat intercepts /canvas");
assert.match(chat, /buildSketchPrompt/, "chat wraps the prompt with buildSketchPrompt");
assert.match(chat, /promptOverride/, "sendRaw supports a prompt override");
assert.match(
  chat,
  /command === "\/canvas"[\s\S]{0,300}?appendSystem\("Describe what to sketch/,
  "promptless /canvas shows a usage hint instead of opening a page",
);
assert.match(ws, /case "\/canvas":[\s\S]{0,300}?startFamiliarChat\(activeId\)/, "workspace /canvas hands off to a chat");
assert.doesNotMatch(ws, /setMode\("journal"\)[\s\S]{0,80}?cave:journal-set-tab/, "no Canvas-tab navigation remains");

console.log("chat /canvas command wiring: ok");
```

- [ ] **Step 2: Run to verify it fails**

```bash
node --experimental-strip-types src/components/chat-canvas-command.test.ts
```

Expected: FAIL on the usage-hint assertion.

- [ ] **Step 3: Implement in `src/components/chat-view.tsx`** (replace lines 3467–3472's no-args branch)

```tsx
    if (command === "/canvas") {
      if (!args.trim()) {
        // The Canvas page retired — /canvas is inline-only now.
        appendSystem("Describe what to sketch — e.g. /canvas a pricing page with three tiers.");
        setInput("");
        return true;
      }
```

(The with-args branch below stays untouched.)

- [ ] **Step 4: Run test + typecheck**

```bash
node --experimental-strip-types src/components/chat-canvas-command.test.ts
pnpm typecheck
```

Expected: PASS; clean.

- [ ] **Step 5: Commit**

```bash
git add src/components/chat-view.tsx src/components/chat-canvas-command.test.ts
git commit -m "feat(chat): promptless /canvas shows a usage hint

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
git push
```

---

### Task 6: Delete the Canvas surface + JournalView shell; re-home the journal tests

**Files:**
- Delete: `src/components/journal/journal-view.tsx`, `src/components/journal/canvas-list.tsx`, `src/lib/canvas-templates.ts`, `src/lib/canvas-templates.test.ts`
- Rename: `src/components/journal/journal-view.test.ts` → `src/components/journal/journal-entries.test.ts` (trimmed)
- Modify: `src/components/ui/confirm-dialog.test.ts` (line 40), `src/lib/keyboard-shortcuts.ts` (lines 20, 103), `src/styles/journal.css` (prune), `scripts/run-tests.mjs` (suite lists)

- [ ] **Step 1: Confirm `canvas-templates.ts` is dead code (only its test imports it)**

```bash
grep -rn "canvas-templates" src scripts --include="*.ts*" | grep -v "canvas-templates.ts\b\|canvas-templates.test"
```

Expected: no output. (If anything shows up, keep the file and its test, skip its deletion below.)

- [ ] **Step 2: Delete the surface files**

```bash
git rm src/components/journal/journal-view.tsx src/components/journal/canvas-list.tsx \
  src/lib/canvas-templates.ts src/lib/canvas-templates.test.ts
```

- [ ] **Step 3: Re-home the journal test**

```bash
git mv src/components/journal/journal-view.test.ts src/components/journal/journal-entries.test.ts
```

Edit `src/components/journal/journal-entries.test.ts`:

1. Replace the header reads with only:

```ts
// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");

const entries = read("./journal-entries.tsx");
const css = read("../../styles/journal.css");
```

2. **Delete** these assertion blocks in full (identified by their banner comments / subjects):
   - "Mode renamed canvas -> journal" (the `mode` asserts)
   - "Workspace wiring" (the `workspace` asserts)
   - "Sidebar entry renamed" (the `sidebar` asserts)
   - "JournalView is a two-tab shell hosting the Canvas list" (the `view` asserts)
   - Every block asserting on `list` (CanvasList): "CanvasList reuses the artifact pipeline…", the Copy-button block, the fullscreen-dialog block, the canvas aria-current block, the Preview/Code roving-tabs block, and "Canvas tab: async setState guarded against unmount"
   - The three CSS asserts on `.journal-detail__code…` (code-pane wrapping) — the code pane was CanvasList's

3. **Keep** every `entries` assert and the remaining CSS asserts (`.journal-list` min-width, `.journal-detail` overflow, `.journal-entry__sec--nav`, `.journal-next__*`, `.journal-notice`, `.journal-entry-gen`, `.journal-day`, reduced-motion).

4. Change the final line to `console.log("journal-entries.test.ts: ok");`

- [ ] **Step 4: Update cross-cutting references**

`src/components/ui/confirm-dialog.test.ts` line 40: remove `"../journal/canvas-list.tsx"` from the file list.

`src/lib/keyboard-shortcuts.ts`:
- line 20 comment: `- ⌘S save: familiar-daily-notes.tsx + journal/canvas-list.tsx;` → `- ⌘S save: familiar-daily-notes.tsx;`
- line 103: `{ keys: "⌘S", description: "Save (daily notes, journal)" }` → `{ keys: "⌘S", description: "Save (daily notes)" }`

- [ ] **Step 5: Prune canvas-only CSS from `src/styles/journal.css`**

List every journal class the CSS defines, then check each against the two remaining consumers:

```bash
grep -oE '\.journal[a-zA-Z0-9_-]*' src/styles/journal.css | sort -u > /tmp/journal-css-classes.txt
for c in $(sed 's/^\.//' /tmp/journal-css-classes.txt); do
  grep -qE "\b$c\b" src/components/journal/journal-entries.tsx src/components/familiar-studio-journal-tab.tsx || echo "UNUSED: $c"
done
```

Delete the rule blocks (and any `@keyframes`/media-query rules used only by them) for each `UNUSED` class. Expect at minimum: `.journal-view`, `.journal-view__head`, `.journal-view__title`, `.journal-view__panel`, and every `.journal-detail__code*` / canvas-detail class that belonged to `CanvasList`. Keep base classes that child selectors depend on (e.g. `.journal-detail` itself is used by `JournalEntries`). Note: BEM roots count — `journal-list__rail` is "used" because `journal-entries.tsx` contains the literal class; only delete classes whose literal never appears in the two files.

- [ ] **Step 6: Rewire the suites in `scripts/run-tests.mjs`**

In **both** suite lists (~line 255 and ~line 800):
- replace `"src/components/journal/journal-view.test.ts"` with `"src/components/journal/journal-entries.test.ts"`

In the app-suite list only:
- remove `"src/lib/canvas-templates.test.ts"` (~line 247)
- add `"src/components/familiar-studio-journal-tab.test.ts"` next to the other familiar-studio tests (search for `familiar-studio-brain-tab.test.ts` and insert adjacent)

- [ ] **Step 7: Verify — targeted, then wiring guard, then suites**

```bash
node --experimental-strip-types src/components/journal/journal-entries.test.ts
node scripts/check-tests-wired.mjs
pnpm typecheck
pnpm test:app
pnpm test:api
```

Expected: all PASS. If `pnpm test:app` flags another test still reading the deleted files, fix that reference (the enumeration above covers all known ones: `confirm-dialog.test.ts` was the only other reader of `canvas-list.tsx`).

- [ ] **Step 8: Production build**

```bash
pnpm build
```

Expected: clean build (catches any missed import of the deleted modules).

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat!: retire the Canvas surface and the top-level Journal page

The Journal lives in Settings → Familiars → Journal; the generated-canvas
surface (CanvasList + JournalView shell) is preserved on
feature/journal-canvas-surface. Backend routes and chat inline canvas
artifacts are unchanged.

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
git push
```

---

### Task 7: Manual smoke + PR

- [ ] **Step 1: Smoke-check the app** (use the `run-cave-app` skill from the worktree, or `pnpm dev`)

Verify:
1. Settings → Familiars shows a **Journal** tab; selecting it lists that familiar's reflections; day rail scrolls inside the panel.
2. Sidebar **Journal** row navigates to `/settings#familiars` with the Journal tab active.
3. `/journal` in the chat composer does the same; `/canvas` alone shows the hint; `/canvas a login form` generates inline.
4. Settings search for "journal" lands on the tab.

- [ ] **Step 2: Open the PR**

```bash
gh pr create --base main --head journal-studio-move \
  --title "Journal → Familiar Studio tab; retire the Canvas surface" \
  --body "Implements docs/superpowers/specs/2026-07-06-journal-to-familiar-studio-design.md

- Journal is now a per-familiar tab in Settings → Familiars (reuses JournalEntries; scope pinned to the studio familiar)
- All old entry points (sidebar row, /journal, ?mode=journal, palette, dashboard links) redirect via the setMode journal branch
- Canvas surface (CanvasList + JournalView tab shell) removed from main — preserved on feature/journal-canvas-surface
- /canvas is chat-inline only; promptless use shows a hint
- Backend (/api/journal, /api/canvas), chat canvas artifacts, and Flow canvas unchanged"
```

- [ ] **Step 3: Wait for `Frontend build`, `Rust check`, `CodeQL`, `E2E (Playwright)` to go green, then**

```bash
gh pr merge <#> --squash --delete-branch
```

- [ ] **Step 4: Local cleanup (worktree guard rules apply — branch must be merged first)**

```bash
cd /Users/buns/Documents/GitHub/OpenCoven/coven-cave
git worktree remove .worktrees/journal-studio-move
git branch -D journal-studio-move
git worktree list
```

**Do NOT delete `feature/journal-canvas-surface`** — it is the intentional archive of the canvas surface.

---

## Out of scope / handoff notes

- The **popover z-index fix** (`.ui-popover-portal` 60→400 + `popover.test.ts` invariant) sits uncommitted in the primary checkout from an earlier task this session. Ship it as its own small PR (`fix(ui): stack popovers above the board drawer`) — do not fold it into this branch.
- The spec + this plan are also uncommitted in the primary checkout; Task 1 Step 3 copies them into the PR branch, after which the primary-checkout copies can be discarded (`git status` will show them until the PR merges and main is pulled).
- `cave-config.addons.journal` (defaults `false`, currently gates nothing) is untouched — flagged in the spec as out of scope.
