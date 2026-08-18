# Waste-Free Half Splits Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Make every registered workspace page render in either half of the desktop detail area with pixel-exact, waste-free geometry, honest responsive behavior, and exhaustive rendered verification.

**Architecture:** Add one pure page registry and one normalized pane-request contract, then route primary navigation, drag-to-split, promotion, footer destinations, role surfaces, and companion surfaces through that contract. `DetailSplitHost` owns pane geometry and uniform chrome; every page mounts inside a standard pane-root container, while a container-width fallback turns narrow splits into full-width tabs without unmounting either page.

**Tech Stack:** Next.js 15, React 19, TypeScript, `react-resizable-panels`, CSS container queries, Node's built-in test runner, Playwright 1.61, Tauri 2.

**Approved design:** `docs/superpowers/specs/2026-07-09-waste-free-half-splits-design.md`

**Bead:** `cave-x6rw`

## File structure

New files:

- `src/lib/workspace-page-registry.ts` — exhaustive page identities, aliases, variants, navigation metadata, and dynamic role-surface resolution.
- `src/lib/workspace-page-registry.test.ts` — registry exhaustiveness, alias, split, and landmark contracts.
- `src/lib/workspace-pane-request.ts` — normalized, stable per-pane requests and deduplication keys.
- `src/lib/workspace-pane-request.test.ts` — normalization, coexistence, deduplication, and promotion tests.
- `src/lib/split-geometry.ts` — integer-pixel two-pane geometry and narrow-container mode selection.
- `src/lib/split-geometry.test.ts` — odd/even widths, seam ownership, and responsive thresholds.
- `src/components/workspace-pane-page.tsx` — standard pane root, loading/unavailable state, and pane-local error boundary.
- `src/components/workspace-pane-page.test.ts` — source contracts for fill behavior, landmarks, and isolation.
- `src/components/dashboard/dashboard-surface.tsx` — embeddable dashboard client surface.
- `src/app/api/dashboard/route.ts` — JSON view-model endpoint shared by the embedded surface.
- `tests/workspace-half-split.spec.ts` — exhaustive desktop primary/secondary/left/right geometry matrix.
- `tests/mobile/workspace-half-split.spec.ts` — narrow-container tab fallback and zero-geometry inactive-pane tests.

Modified files:

- `scripts/run-tests.mjs` — wire every new Node test into the app suite.
- `src/lib/page-drag.ts` and `src/lib/page-drag.test.ts` — validate drag sources through the registry instead of exclusions.
- `src/lib/workspace-tiles.ts` and `src/lib/workspace-tiles.test.ts` — key and retain normalized pane requests.
- `src/components/sidebar-minimal.tsx`, `src/components/sidebar-footer.tsx`, and their tests — consume registry metadata and expose draggable footer destinations.
- `src/components/workspace.tsx` — resolve every primary and secondary page through one renderer, mount Flow honestly, and support registry-backed split deep links.
- `src/components/settings-shell.tsx` and `src/app/settings/page.tsx` — support route and embedded modes without route-only Escape/history behavior leaking into a pane.
- `src/app/dashboard/page.tsx`, dashboard tests, and `src/app/api/api-contracts.test.ts` — preserve the standalone route while adding the embedded adapter.
- `src/components/rail-terminal-panel.tsx` and its test — key terminal sessions by pane instance.
- `src/components/detail-split-host.tsx`, `src/components/shell.tsx`, `src/components/detail-split-host.test.ts`, and `src/components/drag-to-split.test.ts` — symmetric pane chrome, integer geometry, container fallback, and no content floor.
- `src/app/globals.css` plus surface styles/components named in Task 9 — standardized fill/min-size/container behavior and removal of horizontal dead-space policy.
- `playwright.config.ts` — add explicit 1440, 1280, and 1024 desktop projects for the matrix.

## Task 1: Establish the exhaustive page registry

**Files:**

- Create: `src/lib/workspace-page-registry.ts`
- Create: `src/lib/workspace-page-registry.test.ts`
- Modify: `scripts/run-tests.mjs`

- [ ] **Step 1: Write the failing registry test and wire it immediately**

Add `src/lib/workspace-page-registry.test.ts` with these assertions:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BUILT_IN_WORKSPACE_PAGE_IDS,
  workspacePageDefinition,
  workspacePageKey,
} from "./workspace-page-registry.ts";

const expected = [
  "agents", "home", "chat", "groupchat", "board", "calendar", "inbox",
  "browser", "github", "roles", "marketplace", "flow", "submissions",
  "capabilities", "familiar-work-queue", "journal", "grimoire",
  "settings", "dashboard", "salem", "memory", "terminal",
] as const;

test("registry enumerates every built-in page exactly once", () => {
  assert.deepEqual(BUILT_IN_WORKSPACE_PAGE_IDS, expected);
  assert.equal(new Set(BUILT_IN_WORKSPACE_PAGE_IDS).size, expected.length);
});

test("aliases preserve their requested variant", () => {
  assert.deepEqual(workspacePageDefinition("groupchat"), {
    id: "groupchat", title: "Group", canonicalId: "chat", variant: "group",
    nav: "hidden", split: "contextual", landmark: "Chat / Group",
  });
  assert.equal(workspacePageDefinition("calendar")?.canonicalId, "inbox");
  assert.equal(workspacePageDefinition("roles")?.canonicalId, "marketplace");
  assert.equal(workspacePageDefinition("journal")?.canonicalId, "grimoire");
});

test("role surfaces are first-class split pages", () => {
  const page = workspacePageDefinition("surface:researcher");
  assert.equal(page.canonicalId, "surface:researcher");
  assert.equal(page.split, true);
  assert.equal(workspacePageKey(page), "surface:researcher:default");
});
```

Append the test path beside the existing workspace library tests in `scripts/run-tests.mjs`:

```js
"src/lib/workspace-page-registry.test.ts",
```

- [ ] **Step 2: Run the test to verify it fails for the missing module**

Run:

```bash
node --experimental-strip-types --test src/lib/workspace-page-registry.test.ts
```

Expected: `ERR_MODULE_NOT_FOUND` for `workspace-page-registry.ts`.

- [ ] **Step 3: Implement the typed registry**

Create `src/lib/workspace-page-registry.ts` with these public contracts and a literal `satisfies Record<WorkspaceMode, WorkspacePageDefinition>` map:

```ts
import type { WorkspaceMode } from "./workspace-mode";
import { isRoleSurfaceMode, type RoleSurfaceMode } from "./role-surfaces";

export type BuiltInWorkspacePageId = WorkspaceMode | "settings" | "dashboard";
export type CompanionPageId = "salem" | "memory" | "terminal";
export type WorkspacePageId = BuiltInWorkspacePageId | CompanionPageId | RoleSurfaceMode;
export type WorkspacePageVariant =
  | "default" | "group" | "queue" | "calendar"
  | "roles" | "capabilities" | "journal";

export type WorkspacePageDefinition = {
  id: WorkspacePageId;
  title: string;
  canonicalId: WorkspacePageId;
  variant: WorkspacePageVariant;
  nav: "daily" | "quiet" | "hidden" | "footer" | "companion" | "dynamic";
  split: "always" | "contextual";
  landmark: string;
};

const WORKSPACE_MODE_PAGES = {
  agents: { id: "agents", title: "Familiars", canonicalId: "agents", variant: "default", nav: "hidden", split: "contextual", landmark: "Familiars" },
  home: { id: "home", title: "Home", canonicalId: "home", variant: "default", nav: "daily", split: "always", landmark: "Home" },
  chat: { id: "chat", title: "Chat", canonicalId: "chat", variant: "default", nav: "daily", split: "contextual", landmark: "Chat" },
  groupchat: { id: "groupchat", title: "Group", canonicalId: "chat", variant: "group", nav: "hidden", split: "contextual", landmark: "Chat / Group" },
  board: { id: "board", title: "Tasks", canonicalId: "board", variant: "default", nav: "daily", split: "always", landmark: "Tasks" },
  calendar: { id: "calendar", title: "Calendar", canonicalId: "inbox", variant: "calendar", nav: "hidden", split: "always", landmark: "Schedules / Calendar" },
  inbox: { id: "inbox", title: "Schedules", canonicalId: "inbox", variant: "default", nav: "daily", split: "always", landmark: "Schedules" },
  browser: { id: "browser", title: "Browser", canonicalId: "browser", variant: "default", nav: "hidden", split: "contextual", landmark: "Browser" },
  github: { id: "github", title: "GitHub", canonicalId: "github", variant: "default", nav: "quiet", split: "always", landmark: "GitHub" },
  roles: { id: "roles", title: "Roles", canonicalId: "marketplace", variant: "roles", nav: "hidden", split: "always", landmark: "Marketplace / Roles" },
  marketplace: { id: "marketplace", title: "Marketplace", canonicalId: "marketplace", variant: "default", nav: "quiet", split: "always", landmark: "Marketplace" },
  flow: { id: "flow", title: "Flow", canonicalId: "flow", variant: "default", nav: "hidden", split: "always", landmark: "Flow" },
  submissions: { id: "submissions", title: "Submissions", canonicalId: "submissions", variant: "default", nav: "hidden", split: "contextual", landmark: "Submissions" },
  capabilities: { id: "capabilities", title: "Capabilities", canonicalId: "marketplace", variant: "capabilities", nav: "hidden", split: "always", landmark: "Marketplace / Capabilities" },
  "familiar-work-queue": { id: "familiar-work-queue", title: "Queue", canonicalId: "board", variant: "queue", nav: "hidden", split: "contextual", landmark: "Tasks / Queue" },
  journal: { id: "journal", title: "Journal", canonicalId: "grimoire", variant: "journal", nav: "quiet", split: "contextual", landmark: "Grimoire / Journal" },
  grimoire: { id: "grimoire", title: "Grimoire", canonicalId: "grimoire", variant: "default", nav: "quiet", split: "contextual", landmark: "Grimoire" },
} satisfies Record<WorkspaceMode, WorkspacePageDefinition>;

const SUPPLEMENTAL_PAGES = {
  settings: { id: "settings", title: "Settings", canonicalId: "settings", variant: "default", nav: "footer", split: "always", landmark: "Settings" },
  dashboard: { id: "dashboard", title: "Dashboard", canonicalId: "dashboard", variant: "default", nav: "footer", split: "always", landmark: "Dashboard" },
  salem: { id: "salem", title: "Salem", canonicalId: "salem", variant: "default", nav: "companion", split: "contextual", landmark: "Salem" },
  memory: { id: "memory", title: "Memory", canonicalId: "memory", variant: "default", nav: "companion", split: "contextual", landmark: "Memory" },
  terminal: { id: "terminal", title: "Terminal", canonicalId: "terminal", variant: "default", nav: "companion", split: "contextual", landmark: "Terminal" },
} satisfies Record<"settings" | "dashboard" | CompanionPageId, WorkspacePageDefinition>;
```

Also export `BUILT_IN_WORKSPACE_PAGE_IDS`, `workspacePageDefinition(id)`, `workspacePageKey(definition)`, `isWorkspacePageId(value)`, and registry-derived nav/footer/companion lists. `workspacePageDefinition` must return a `nav: "dynamic"` definition only after `isRoleSurfaceMode(id)` succeeds; it must return `null` for unknown strings.

- [ ] **Step 4: Run the focused test and test-wiring guard**

Run:

```bash
node --experimental-strip-types --test src/lib/workspace-page-registry.test.ts
pnpm check:tests-wired
```

Expected: both commands exit 0.

- [ ] **Step 5: Commit the registry checkpoint**

```bash
git add scripts/run-tests.mjs src/lib/workspace-page-registry.ts src/lib/workspace-page-registry.test.ts
git commit -S -m "feat(workspace): add exhaustive page registry (cave-x6rw)"
```

## Task 2: Normalize pane requests and tile identity

**Files:**

- Create: `src/lib/workspace-pane-request.ts`
- Create: `src/lib/workspace-pane-request.test.ts`
- Modify: `src/lib/workspace-tiles.ts`
- Modify: `src/lib/workspace-tiles.test.ts`
- Modify: `scripts/run-tests.mjs`

- [ ] **Step 1: Write failing normalization and identity tests**

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeWorkspacePaneRequest, workspacePaneRequestKey } from "./workspace-pane-request.ts";

test("normalization retains aliases as explicit variants", () => {
  const group = normalizeWorkspacePaneRequest("pane-group", "groupchat");
  assert.deepEqual(group, {
    instanceId: "pane-group",
    pageId: "chat",
    requestedPageId: "groupchat",
    variant: "group",
  });
});

test("exact page and variant dedupe while variants coexist", () => {
  const direct = normalizeWorkspacePaneRequest("one", "chat");
  const group = normalizeWorkspacePaneRequest("two", "groupchat");
  assert.equal(workspacePaneRequestKey(direct), "chat:default");
  assert.equal(workspacePaneRequestKey(group), "chat:group");
  assert.notEqual(workspacePaneRequestKey(direct), workspacePaneRequestKey(group));
});

test("unknown page ids are rejected", () => {
  assert.equal(normalizeWorkspacePaneRequest("bad", "definitely-missing"), null);
});
```

Wire `src/lib/workspace-pane-request.test.ts` in the app suite.

- [ ] **Step 2: Run the focused test and observe the missing-module failure**

```bash
node --experimental-strip-types --test src/lib/workspace-pane-request.test.ts
```

Expected: `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Implement the request contract**

```ts
import type { WorkspacePageId, WorkspacePageVariant } from "./workspace-page-registry";
import { workspacePageDefinition } from "./workspace-page-registry";

export type WorkspacePaneRequest = {
  instanceId: string;
  pageId: WorkspacePageId;
  requestedPageId: WorkspacePageId;
  variant: WorkspacePageVariant;
};

export function normalizeWorkspacePaneRequest(
  instanceId: string,
  requestedPageId: string,
): WorkspacePaneRequest | null {
  const definition = workspacePageDefinition(requestedPageId);
  if (!definition) return null;
  return {
    instanceId,
    pageId: definition.canonicalId,
    requestedPageId: definition.id,
    variant: definition.variant,
  };
}

export function workspacePaneRequestKey(request: WorkspacePaneRequest): string {
  return `${request.pageId}:${request.variant}`;
}
```

Update `addSecondaryWorkspaceTile` tests so two requests with the same key replace one another, while `chat:default` and `chat:group` remain separate entries. Keep the four-tile cap.

- [ ] **Step 4: Run the focused suites**

```bash
node --experimental-strip-types --test src/lib/workspace-pane-request.test.ts
node --experimental-strip-types --test src/lib/workspace-tiles.test.ts
pnpm check:tests-wired
```

Expected: all exit 0.

- [ ] **Step 5: Commit normalized pane identity**

```bash
git add scripts/run-tests.mjs src/lib/workspace-pane-request.ts src/lib/workspace-pane-request.test.ts src/lib/workspace-tiles.ts src/lib/workspace-tiles.test.ts
git commit -S -m "feat(workspace): normalize pane requests (cave-x6rw)"
```

## Task 3: Make every navigation source registry-driven

**Files:**

- Modify: `src/lib/page-drag.ts`
- Modify: `src/lib/page-drag.test.ts`
- Modify: `src/components/sidebar-minimal.tsx`
- Modify: `src/components/sidebar-minimal.test.ts`
- Modify: `src/components/sidebar-footer.tsx`
- Modify: `src/components/sidebar-footer.test.ts`
- Modify: `src/components/command-palette.tsx`
- Modify: `src/components/command-palette.test.ts`
- Modify: `src/components/grimoire-view.test.ts`

- [ ] **Step 1: Replace exclusion expectations with positive registry expectations**

Add cases to `page-drag.test.ts`:

```ts
assert.equal(isSplittablePage("terminal"), true);
assert.equal(isSplittablePage("journal"), true);
assert.equal(isSplittablePage("settings"), true);
assert.equal(isSplittablePage("dashboard"), true);
assert.equal(isSplittablePage("surface:researcher"), true);
assert.equal(isSplittablePage("unknown-page"), false);
```

Extend `sidebar-footer.test.ts` to require both footer destinations to use `PAGE_DRAG_MIME`, `emitPageDragStart`, and `emitPageDragEnd` without changing their click destinations.

Extend `command-palette.test.ts` to forbid imports from `sidebar-minimal`, require registry-derived launcher definitions, and assert that hidden, footer, companion, and dynamic role pages can be represented by the `go-to-surface` intent.

Replace `grimoire-view.test.ts`'s assertion about the deleted `FolderMode` union with an assertion that the registry contains both `grimoire` and the `journal` variant.

- [ ] **Step 2: Run focused tests and verify the old exclusions fail**

```bash
node --experimental-strip-types --test src/lib/page-drag.test.ts
node --experimental-strip-types --test src/components/sidebar-footer.test.ts
```

Expected: terminal, journal, role surface, and footer drag assertions fail.

- [ ] **Step 3: Derive split eligibility from the registry**

Replace `NON_SPLITTABLE` with:

```ts
import { workspacePageDefinition } from "./workspace-page-registry";

export function isSplittablePage(mode: string): boolean {
  return workspacePageDefinition(mode) !== null;
}
```

Change `FolderMode` to `WorkspaceMode`, retain presentation-only icon/badge callbacks in `sidebar-minimal.tsx`, and assert each presentation entry resolves through `workspacePageDefinition`. Keep hidden launchers hidden; do not duplicate page identity or alias data.

Extract a small `DraggablePageDestination` helper in `sidebar-footer.tsx`. Use `pageId="dashboard"` on the existing link and `pageId="settings"` on the existing button so clicks remain `/dashboard` and `onOpenSettings`, respectively, while drag data uses the registry ID.

Change the command palette's `go-to-surface` intent to carry `WorkspacePageId`, and build launcher rows from the registry's exported palette definitions instead of importing `FOLDER_MODES`. The workspace intent handler will normalize the selected ID in Task 6.

- [ ] **Step 4: Run all affected tests**

```bash
node --experimental-strip-types --test src/lib/page-drag.test.ts
node --experimental-strip-types --test src/components/sidebar-minimal.test.ts
node --experimental-strip-types --test src/components/sidebar-footer.test.ts
node --experimental-strip-types --test src/components/command-palette.test.ts
node --experimental-strip-types --test src/components/grimoire-view.test.ts
node --experimental-strip-types --test src/components/drag-to-split.test.ts
```

Expected: all exit 0.

- [ ] **Step 5: Commit navigation normalization**

```bash
git add src/lib/page-drag.ts src/lib/page-drag.test.ts src/components/sidebar-minimal.tsx src/components/sidebar-minimal.test.ts src/components/sidebar-footer.tsx src/components/sidebar-footer.test.ts src/components/command-palette.tsx src/components/command-palette.test.ts src/components/grimoire-view.test.ts
git commit -S -m "refactor(workspace): drive split sources from registry (cave-x6rw)"
```

## Task 4: Add the standard pane root and local failure isolation

**Files:**

- Create: `src/components/workspace-pane-page.tsx`
- Create: `src/components/workspace-pane-page.test.ts`
- Modify: `scripts/run-tests.mjs`
- Modify: `src/app/globals.css`

- [ ] **Step 1: Write the failing pane-root source contract**

```ts
// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./workspace-pane-page.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

assert.match(source, /className="workspace-pane-page"/);
assert.match(source, /aria-label=\{landmark\}/);
assert.match(source, /WorkspacePaneErrorBoundary/);
assert.match(source, /is unavailable in this pane/);
assert.match(source, /Try again/);
assert.match(source, /onRecover/);
assert.match(css, /\.workspace-pane-page\s*\{[\s\S]*container:\s*workspace-pane\s*\/\s*inline-size/);
assert.match(css, /\.workspace-pane-page\s*\{[\s\S]*min-width:\s*0/);
```

Wire it into `scripts/run-tests.mjs`.

- [ ] **Step 2: Run the contract and observe the missing-file failure**

```bash
node --experimental-strip-types --test src/components/workspace-pane-page.test.ts
```

Expected: `ENOENT` for `workspace-pane-page.tsx`.

- [ ] **Step 3: Implement the page root and class boundary**

Create a class error boundary so a secondary page cannot replace the primary page with an error screen. Its fallback must name the registered landmark and provide a `Try again` button that clears only that boundary's error state:

```tsx
type WorkspacePanePageProps = {
  instanceId: string;
  landmark: string;
  status?: "ready" | "loading";
  unavailable?: {
    reason: string;
    recoveryLabel: string;
    onRecover: () => void;
  };
  children: React.ReactNode;
};

export function WorkspacePanePage({
  instanceId,
  landmark,
  status = "ready",
  unavailable,
  children,
}: WorkspacePanePageProps) {
  return (
    <section
      className="workspace-pane-page"
      data-pane-instance={instanceId}
      aria-label={landmark}
    >
      <WorkspacePaneErrorBoundary landmark={landmark}>
        {status === "loading" ? <SkeletonRows count={6} /> : null}
        {unavailable ? (
          <div className="workspace-pane-page__state" role="status">
            <strong>{landmark} is unavailable in this pane.</strong>
            <span>{unavailable.reason}</span>
            <Button onClick={unavailable.onRecover}>{unavailable.recoveryLabel}</Button>
          </div>
        ) : null}
        {status === "ready" && !unavailable ? children : null}
      </WorkspacePaneErrorBoundary>
    </section>
  );
}
```

Add:

```css
.workspace-pane-page {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  container: workspace-pane / inline-size;
}
.workspace-pane-page > * {
  min-width: 0;
  min-height: 0;
}
```

- [ ] **Step 4: Run the focused test and typecheck**

```bash
node --experimental-strip-types --test src/components/workspace-pane-page.test.ts
pnpm typecheck
```

Expected: both exit 0.

- [ ] **Step 5: Commit the pane-root contract**

```bash
git add scripts/run-tests.mjs src/components/workspace-pane-page.tsx src/components/workspace-pane-page.test.ts src/app/globals.css
git commit -S -m "feat(workspace): standardize pane roots (cave-x6rw)"
```

## Task 5: Add embeddable Settings, Dashboard, and Terminal adapters

**Files:**

- Modify: `src/components/settings-shell.tsx`
- Modify: `src/app/settings/page.tsx`
- Modify: `src/components/settings-shell-polish.test.ts`
- Create: `src/components/dashboard/dashboard-surface.tsx`
- Create: `src/app/api/dashboard/route.ts`
- Modify: `src/app/api/api-contracts.test.ts`
- Modify: `src/app/dashboard/page.tsx`
- Modify: `src/app/dashboard-page.test.ts`
- Modify: `src/app/dashboard-runtime-smoke.test.ts`
- Modify: `src/components/rail-terminal-panel.tsx`
- Modify: `src/components/rail-terminal-panel.test.ts`

- [ ] **Step 1: Pin adapter behavior with failing source tests**

Add assertions that:

```ts
assert.match(settings, /embedded\?: boolean/);
assert.match(settings, /if \(!embedded && e\.key === "Escape"\)/);
assert.match(dashboardPage, /<DashboardSurface initialModel=\{model\}/);
assert.match(dashboardSurface, /fetch\("\/api\/dashboard"/);
assert.match(terminal, /paneInstanceId\?: string/);
assert.match(terminal, /`cave\.pane\.\$\{paneInstanceId\}`/);
```

Add `/api/dashboard` to the API contract table with `GET`, JSON success, and guarded server failure behavior.

- [ ] **Step 2: Run the affected tests and see the missing adapter contracts fail**

```bash
node --experimental-strip-types --test src/components/settings-shell-polish.test.ts
node --experimental-strip-types --test src/app/dashboard-page.test.ts
node --experimental-strip-types --test src/components/rail-terminal-panel.test.ts
node --experimental-strip-types --test src/app/api/api-contracts.test.ts
```

Expected: new embedded Settings, DashboardSurface, terminal instance, and API assertions fail.

- [ ] **Step 3: Implement Settings embedded mode**

Use a default-preserving prop:

```tsx
export function SettingsShell({ embedded = false }: { embedded?: boolean }) {
```

In embedded mode, do not call `router.back()` on Escape, do not replace route hashes, and use pane-local section state. Keep `<SettingsShell />` unchanged in `src/app/settings/page.tsx` so route behavior and metadata remain intact.

- [ ] **Step 4: Implement the Dashboard adapter and endpoint**

The endpoint must build the same model as the server page:

```ts
import { NextResponse } from "next/server";
import { loadInbox } from "@/lib/cave-inbox";
import { buildDashboardModel } from "@/lib/dashboard-model";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const inbox = await loadInbox();
    return NextResponse.json({ ok: true, model: buildDashboardModel(inbox.items, new Date()) });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Dashboard unavailable" },
      { status: 500 },
    );
  }
}
```

`DashboardSurface` accepts `initialModel?: DashboardModel`, renders it synchronously when supplied by `/dashboard`, otherwise fetches `/api/dashboard`, and renders explicit loading/unavailable states. Define a wire type with `date: string` for the JSON response and hydrate it before rendering:

```ts
type DashboardModelWire = Omit<DashboardModel, "date"> & { date: string };

function hydrateDashboardModel(model: DashboardModelWire): DashboardModel {
  return { ...model, date: new Date(model.date) };
}
```

The route must render the adapter after its unchanged top bar:

```tsx
<DashboardSurface initialModel={model} />
```

The embedded workspace mounts `<DashboardSurface />` without the route top bar.

- [ ] **Step 5: Make terminal PTYs pane-stable**

Add `paneInstanceId?: string` to `RailTerminalPanel`; derive its terminal thread ID as:

```ts
const terminalThreadId = paneInstanceId
  ? `cave.pane.${paneInstanceId}`
  : `cave.rail.${sessionId}`;
```

Pass `terminalThreadId` to `BottomTerminal`, leaving rail behavior unchanged when the prop is absent.

- [ ] **Step 6: Run adapter and API verification**

```bash
node --experimental-strip-types --test src/components/settings-shell-polish.test.ts
node --experimental-strip-types --test src/app/dashboard-page.test.ts
node --experimental-strip-types --test src/app/dashboard-runtime-smoke.test.ts
node --experimental-strip-types --test src/components/rail-terminal-panel.test.ts
node --experimental-strip-types --test src/app/api/api-contracts.test.ts
pnpm typecheck
```

Expected: all exit 0.

- [ ] **Step 7: Commit embeddable adapters**

```bash
git add src/components/settings-shell.tsx src/app/settings/page.tsx src/components/settings-shell-polish.test.ts src/components/dashboard/dashboard-surface.tsx src/app/api/dashboard/route.ts src/app/api/api-contracts.test.ts src/app/dashboard/page.tsx src/app/dashboard-page.test.ts src/app/dashboard-runtime-smoke.test.ts src/components/rail-terminal-panel.tsx src/components/rail-terminal-panel.test.ts
git commit -S -m "feat(workspace): embed route and companion pages (cave-x6rw)"
```

## Task 6: Route every primary and secondary page through one renderer

**Files:**

- Modify: `src/components/workspace.tsx`
- Modify: `src/components/lazy-surfaces.tsx`
- Modify: `src/components/chat-surface.tsx`
- Modify: `src/components/chat-surface.test.ts`
- Modify: `src/components/workspace-sidebar-wiring.test.ts`
- Modify: `src/components/drag-to-split.test.ts`
- Modify: `src/components/schedules-tabs.test.ts`

- [ ] **Step 1: Add failing renderer coverage**

Extend source tests to require:

```ts
assert.match(workspace, /normalizeWorkspacePaneRequest/);
assert.match(workspace, /workspacePaneRequestKey/);
assert.match(workspace, /case "flow":[\s\S]*<FlowView/);
assert.match(workspace, /case "settings":[\s\S]*<SettingsShell embedded/);
assert.match(workspace, /case "dashboard":[\s\S]*<DashboardSurface/);
assert.match(workspace, /case "terminal":[\s\S]*paneInstanceId=\{request\.instanceId\}/);
assert.match(workspace, /isRoleSurfaceMode\(request\.pageId\)/);
assert.doesNotMatch(workspace, /m as WorkspaceMode/);
assert.doesNotMatch(workspace, /const WORKSPACE_MODE_TITLES: Record/);
assert.doesNotMatch(workspace, /const SURFACE_ORDER: WorkspaceMode\[\]/);
assert.match(chatSurface, /initialScope\?: FamiliarsScope/);
```

Reverse the old Flow assertion in `schedules-tabs.test.ts`: Flow must render `FlowView`, never fall through to Home.

- [ ] **Step 2: Run the source suites and see the old renderer fail**

```bash
node --experimental-strip-types --test src/components/drag-to-split.test.ts
node --experimental-strip-types --test src/components/schedules-tabs.test.ts
node --experimental-strip-types --test src/components/workspace-sidebar-wiring.test.ts
```

Expected: normalized request, Flow, adapters, role surface, and cast-removal assertions fail.

- [ ] **Step 3: Replace `SplitTarget` with `WorkspacePaneRequest`**

Use `crypto.randomUUID()` when available and a monotonic `useRef` fallback to create stable `instanceId` values. `openSplitPage` must reject unknown IDs before mutating state:

```ts
const openSplitPage = useCallback((pageId: string, side: "left" | "right") => {
  const request = normalizeWorkspacePaneRequest(nextPaneInstanceId(), pageId);
  if (!request) return;
  setSplitSide(side);
  setSplitTargets((current) =>
    addSecondaryWorkspaceTile(current, request, workspacePaneRequestKey),
  );
}, [nextPaneInstanceId]);
```

Introduce a stable `primaryPaneRequest` state instead of deriving the primary exclusively from `mode`. Registry-backed navigation replaces that request; legacy session navigation may continue to update the existing mode state before replacing the request. Promotion assigns the complete secondary request as primary, so Settings, Dashboard, Terminal, companions, and aliases can all become the sole page. No path may cast an arbitrary string to `WorkspaceMode`.

Remove `WORKSPACE_MODE_TITLES`, local `VALID_MODES`, and local `SURFACE_ORDER`. Use registry definitions for the hidden heading, URL validation, command-palette navigation, keyboard number shortcuts, and previous/next page cycling. Keep the current daily shortcut order as registry metadata.

- [ ] **Step 4: Implement the exhaustive renderer**

Create a local `renderPaneRequest(request)` switch over `request.pageId`. Before the switch, handle dynamic role surfaces. Every return must be wrapped by:

```tsx
const definition = workspacePageDefinition(request.requestedPageId);
if (!definition) return null;
return (
  <WorkspacePanePage
    instanceId={request.instanceId}
    landmark={definition.landmark}
  >
    {renderRegisteredPage(request)}
  </WorkspacePanePage>
);
```

Map variants explicitly:

- `chat/group` passes `initialScope="coven"` to `ChatSurface`; default Chat passes `initialScope="conversation"`. Add the optional prop to `ChatSurface` and use it as the initial scope so split mounting does not depend on a timeout or global event.
- `board/queue` renders `FamiliarWorkQueueView`.
- `inbox/calendar` renders `CalendarView`; default renders Schedules.
- `marketplace/roles` and `marketplace/capabilities` pass their existing initial section.
- `grimoire/journal` opens the Journal tab without routing to Settings.
- `flow` renders the existing lazy `FlowView`.
- `settings`, `dashboard`, and `terminal` render the adapters from Task 5.
- `salem`, `memory`, and `browser` preserve their existing companion implementations.
- a missing runtime dependency passes `unavailable={{ reason, recoveryLabel, onRecover }}` to `WorkspacePanePage`, with the registered landmark and a context-specific recovery action.

- [ ] **Step 5: Add a registry-backed split deep link**

Parse `mode=<page-id>`, `split=<page-id>`, and `splitSide=left|right` through the registry. `mode` creates the primary request even for Settings, Dashboard, Terminal, companions, and aliases; `split` creates the secondary once. When state changes, serialize each request's `requestedPageId` rather than its canonical alias. These are supported deep links and the deterministic entry point for the rendered matrix.

- [ ] **Step 6: Run focused behavior and type verification**

```bash
node --experimental-strip-types --test src/components/drag-to-split.test.ts
node --experimental-strip-types --test src/components/schedules-tabs.test.ts
node --experimental-strip-types --test src/components/chat-surface.test.ts
node --experimental-strip-types --test src/components/workspace-sidebar-wiring.test.ts
node --experimental-strip-types --test src/lib/workspace-page-registry.test.ts
node --experimental-strip-types --test src/lib/workspace-pane-request.test.ts
pnpm typecheck
```

Expected: all exit 0.

- [ ] **Step 7: Commit the unified renderer**

```bash
git add src/components/workspace.tsx src/components/lazy-surfaces.tsx src/components/chat-surface.tsx src/components/chat-surface.test.ts src/components/workspace-sidebar-wiring.test.ts src/components/drag-to-split.test.ts src/components/schedules-tabs.test.ts
git commit -S -m "refactor(workspace): unify registered page rendering (cave-x6rw)"
```

## Task 7: Make two-pane geometry integer-exact and symmetric

**Files:**

- Create: `src/lib/split-geometry.ts`
- Create: `src/lib/split-geometry.test.ts`
- Modify: `scripts/run-tests.mjs`
- Modify: `src/components/detail-split-host.tsx`
- Modify: `src/components/shell.tsx`
- Modify: `src/components/detail-split-host.test.ts`
- Modify: `src/components/drag-to-split.test.ts`
- Modify: `src/app/globals.css`

- [ ] **Step 1: Write failing integer-geometry tests**

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { halfSplitGeometry, splitPresentation } from "./split-geometry.ts";

test("half geometry consumes every pixel for odd and even hosts", () => {
  for (const hostWidth of [501, 1024, 1279, 1440]) {
    const geometry = halfSplitGeometry(hostWidth, 1);
    assert.ok(Math.abs(geometry.left - geometry.right) <= 1);
    assert.equal(geometry.left + geometry.separator + geometry.right, hostWidth);
  }
});

test("narrow containers use tabs independent of viewport width", () => {
  assert.equal(splitPresentation(719), "tabs");
  assert.equal(splitPresentation(720), "panes");
});
```

Wire `split-geometry.test.ts` in `scripts/run-tests.mjs`.

- [ ] **Step 2: Run the focused test and observe the missing-module failure**

```bash
node --experimental-strip-types --test src/lib/split-geometry.test.ts
```

Expected: `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Implement the geometry helper**

```ts
export const SPLIT_TABS_MAX_WIDTH = 719;

export function halfSplitGeometry(hostWidth: number, separator: number) {
  const usable = Math.max(0, Math.round(hostWidth) - separator);
  const left = Math.floor(usable / 2);
  return { left, separator, right: usable - left };
}

export function splitPresentation(hostWidth: number): "panes" | "tabs" {
  return hostWidth <= SPLIT_TABS_MAX_WIDTH ? "tabs" : "panes";
}
```

- [ ] **Step 4: Give both panes identical split-only chrome**

Change `DetailSplitHostProps` to accept `primaryTile: DetailSplitTile` instead of a bare `primary`. Render both primary and secondary through one `renderPane(tile, options)` function. In solo mode, `Shell` renders the page without pane chrome; in split mode, both sides have the same header height, body class, title treatment, and action slot. Only secondary panes receive close buttons.

Pass the normalized primary title and instance ID from `Workspace` through `Shell`; do not retain the hard-coded `Current` tile. Keep the separator as the sole seam, `SPLIT_DEFAULT_RATIO` at 0.5, double-click reset, resize snapping, close/promotion gestures, and the ResizeObserver refit.

Use `halfSplitGeometry(groupWidth, separatorWidth)` whenever a split first opens and whenever the separator is double-clicked; resize the secondary panel to the returned left or right pixel width according to `secondarySide`. On host resize, use the integer helper only while the selected ratio is 0.5; for every user-selected ratio, reapply that ratio unchanged.

- [ ] **Step 5: Replace viewport fallback with observed host width**

Store the `DetailSplitHost` group width from its existing ResizeObserver and derive `splitPresentation(width)`. In tab mode:

```tsx
<div className="split-host__mobile-switcher" role="tablist" aria-label="Open pages">
  {tiles.map((tile) => (
    <button
      key={tile.id}
      role="tab"
      aria-selected={tile.id === activeTileId}
      onClick={() => setActiveTileId(tile.id)}
    >
      {tile.title}
    </button>
  ))}
</div>
```

Keep every tile mounted; inactive tiles use `visibility: hidden`, `pointer-events: none`, `position: absolute`, `inline-size: 0`, `block-size: 0`, and `overflow: hidden`, while the active tile alone participates in layout. Do not use `display: none`.

Give each switcher tab a minimum 44px block size and preserve the host's existing safe-area padding on phone-sized containers.

- [ ] **Step 6: Remove the content-width floor**

Delete `.split-host__pane-body > * { min-width: 300px; }`, remove `overflow-x: auto` from the generic pane body, and change multi-pane `Panel minSize="300px"` to a proportional minimum that does not force overflow. Update the old source tests to forbid those policies.

- [ ] **Step 7: Run geometry, host, and type verification**

```bash
node --experimental-strip-types --test src/lib/split-geometry.test.ts
node --experimental-strip-types --test src/components/detail-split-host.test.ts
node --experimental-strip-types --test src/components/drag-to-split.test.ts
pnpm typecheck
```

Expected: all exit 0.

- [ ] **Step 8: Commit the geometry checkpoint**

```bash
git add scripts/run-tests.mjs src/lib/split-geometry.ts src/lib/split-geometry.test.ts src/components/detail-split-host.tsx src/components/shell.tsx src/components/detail-split-host.test.ts src/components/drag-to-split.test.ts src/app/globals.css
git commit -S -m "fix(workspace): make half splits waste-free (cave-x6rw)"
```

## Task 8: Make split discovery complete and keyboard-accessible

**Files:**

- Modify: `src/components/detail-split-host.tsx`
- Modify: `src/components/detail-split-host.test.ts`
- Modify: `src/components/workspace.tsx`
- Modify: `src/app/globals.css`

- [ ] **Step 1: Add failing source assertions for the page chooser**

Require `DetailSplitHost` to expose a button named `Open page in split`, a dialog/listbox backed by registry definitions, Escape close behavior, arrow-key navigation, and `onDropPage(page.id, "right")` selection. Require disabled options for exact page+variant duplicates and allow alias variants such as Chat and Group to coexist.

- [ ] **Step 2: Run the host source test and see chooser assertions fail**

```bash
node --experimental-strip-types --test src/components/detail-split-host.test.ts
```

Expected: chooser button, registry options, and keyboard behavior assertions fail.

- [ ] **Step 3: Implement registry-backed split discovery**

Pass `availablePages` from `Workspace` to `DetailSplitHost`. The list combines built-in registry pages, currently registered role surfaces, and companion pages. Keep exact page+variant entries visible but disabled when already open; keep other variants enabled. Add the chooser action to the primary pane header in split mode and as a non-layout-impacting overlay button in solo mode. Selecting a page calls the same normalized `onDropPage` path as drag and deep links.

The chooser must use existing popover/menu primitives, restore focus to its trigger, close on Escape, support ArrowUp/ArrowDown/Home/End, and expose page titles plus canonical variant labels.

- [ ] **Step 4: Run host and accessibility source tests**

```bash
node --experimental-strip-types --test src/components/detail-split-host.test.ts
node --experimental-strip-types --test src/components/drag-to-split.test.ts
node --experimental-strip-types --test src/components/command-palette-a11y.test.ts
pnpm typecheck
```

Expected: all exit 0.

- [ ] **Step 5: Commit complete discovery**

```bash
git add src/components/detail-split-host.tsx src/components/detail-split-host.test.ts src/components/workspace.tsx src/app/globals.css
git commit -S -m "feat(workspace): expose every page to split discovery (cave-x6rw)"
```

## Task 9: Audit every surface for pane-owned responsiveness

**Files:**

- Modify: `src/components/familiars-view.tsx`
- Modify: `src/components/home-composer.tsx`
- Modify: `src/components/chat-view.tsx`
- Modify: `src/components/board-view.tsx`
- Modify: `src/components/calendar-view.tsx`
- Modify: `src/components/browser-pane.tsx`
- Modify: `src/components/github-view.tsx`
- Modify: `src/components/marketplace-view.tsx`
- Modify: `src/components/flow/flow-view.tsx`
- Modify: `src/components/opencoven-submission-panel.tsx`
- Modify: `src/components/familiar-work-queue-view.tsx`
- Modify: `src/components/grimoire-view.tsx`
- Modify: `src/components/role-surface-host.tsx`
- Modify: `src/components/role-surfaces/surface-room.tsx`
- Modify: `src/components/dashboard/dashboard-cockpit.tsx`
- Modify: `src/components/settings-shell.tsx`
- Modify: `src/app/globals.css`
- Modify: `src/components/drag-to-split.test.ts`

- [ ] **Step 1: Turn the surface-fit source audit into a failing positive contract**

In `drag-to-split.test.ts`, read each file above and assert its outer surface uses `h-full`, `min-h-0`, `min-w-0`, or the equivalent named CSS class. Assert no split-capable surface uses viewport breakpoints to choose columns or fixed content widths above 100%.

For CSS-driven surfaces, require their root selector to include:

```css
width: 100%;
height: 100%;
min-width: 0;
min-height: 0;
```

- [ ] **Step 2: Run the audit and record every named failing surface in the Bead**

```bash
node --experimental-strip-types --test src/components/drag-to-split.test.ts
```

Expected: failures name the exact surface files whose roots or grids still depend on the viewport.

Append the resulting file list to `cave-x6rw` before editing those surfaces.

- [ ] **Step 3: Apply the standard pane-root rules to every named surface**

For each file in this task, make the root fill its `WorkspacePanePage`, set intermediate flex/grid wrappers to `min-width: 0; min-height: 0`, and move overflow to the content owner:

- conversation/message lists scroll vertically; composers remain fixed;
- board, schedules, marketplace, submissions, dashboard, and settings content regions scroll vertically;
- Browser and Flow canvases clip to their pane and manage their own internal panning;
- Grimoire editor/preview columns and role rooms collapse through container queries;
- cards, grids, and toolbars use `@container workspace-pane` thresholds rather than viewport media queries.

Use this form for responsive grids:

```css
.surface-grid { grid-template-columns: minmax(0, 1fr); }
@container workspace-pane (min-width: 44rem) {
  .surface-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
```

Do not introduce generic horizontal scrolling on `.workspace-pane-page` or `.split-host__pane-body`.

- [ ] **Step 4: Re-run the full source audit and typecheck**

```bash
node --experimental-strip-types --test src/components/drag-to-split.test.ts
pnpm typecheck
```

Expected: all named surface contracts pass and TypeScript exits 0.

- [ ] **Step 5: Commit the surface-fit checkpoint**

```bash
git add src/components/familiars-view.tsx src/components/home-composer.tsx src/components/chat-view.tsx src/components/board-view.tsx src/components/calendar-view.tsx src/components/browser-pane.tsx src/components/github-view.tsx src/components/marketplace-view.tsx src/components/flow/flow-view.tsx src/components/opencoven-submission-panel.tsx src/components/familiar-work-queue-view.tsx src/components/grimoire-view.tsx src/components/role-surface-host.tsx src/components/role-surfaces/surface-room.tsx src/components/dashboard/dashboard-cockpit.tsx src/components/settings-shell.tsx src/app/globals.css src/components/drag-to-split.test.ts
git commit -S -m "fix(workspace): make surfaces pane-responsive (cave-x6rw)"
```

## Task 10: Build the exhaustive rendered geometry matrix

**Files:**

- Create: `tests/workspace-half-split.spec.ts`
- Create: `tests/mobile/workspace-half-split.spec.ts`
- Modify: `playwright.config.ts`
- Modify: `src/components/role-surfaces/ids.ts`
- Modify: `src/components/role-surfaces/register.tsx`
- Modify: `src/lib/role-surfaces.test.ts`

- [ ] **Step 1: Add explicit desktop viewport projects**

Define projects with exact viewports:

```ts
{
  name: "desktop-1440",
  testMatch: /workspace-half-split\.spec\.ts/,
  testIgnore: /mobile\//,
  use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
},
{
  name: "desktop-1280",
  testMatch: /workspace-half-split\.spec\.ts/,
  testIgnore: /mobile\//,
  use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } },
},
{
  name: "desktop-1024",
  testMatch: /workspace-half-split\.spec\.ts/,
  testIgnore: /mobile\//,
  use: { ...devices["Desktop Chrome"], viewport: { width: 1024, height: 768 } },
},
```

Add `testIgnore: /workspace-half-split\.spec\.ts/` to the generic `desktop` project so the root matrix runs exactly three desktop widths. Leave the existing mobile projects scoped to `tests/mobile`.

- [ ] **Step 2: Write the geometry assertion helper**

```ts
async function expectWasteFreeHalf(page: Page) {
  const geometry = await page.locator(".split-host__group").evaluate((host) => {
    const hostRect = host.getBoundingClientRect();
    const panes = Array.from(host.querySelectorAll<HTMLElement>(":scope > [data-panel]"))
      .map((node) => node.getBoundingClientRect());
    const separator = host.querySelector<HTMLElement>(".split-host__sep")!.getBoundingClientRect();
    return { hostRect, panes, separator };
  });
  expect(geometry.panes).toHaveLength(2);
  expect(Math.abs(geometry.panes[0]!.width - geometry.panes[1]!.width)).toBeLessThanOrEqual(1);
  expect(Math.abs(geometry.panes[0]!.left - geometry.hostRect.left)).toBeLessThanOrEqual(1);
  expect(Math.abs(geometry.panes[1]!.right - geometry.hostRect.right)).toBeLessThanOrEqual(1);
  expect(Math.abs(
    geometry.panes[0]!.width + geometry.separator.width + geometry.panes[1]!.width
      - geometry.hostRect.width,
  )).toBeLessThanOrEqual(1);
}
```

- [ ] **Step 3: Add the exhaustive desktop page matrix**

Import `BUILT_IN_WORKSPACE_PAGE_IDS` into the Playwright spec and test every ID as:

1. primary with a stable reference page as secondary on the right;
2. primary with the reference page as secondary on the left;
3. secondary beside the reference page on the right;
4. secondary beside the reference page on the left.

Use `home` as the reference for every request except `home`; use `github` for `home`. This keeps exact page+variant deduplication intact while preserving one deterministic comparison surface.

For every case, navigate with supported query parameters, wait for both registered landmarks, call `expectWasteFreeHalf`, assert equal body heights, assert no pane-level horizontal scrollbar, and assert exactly one `.split-host__sep`. For each visible `button`, `a`, `input`, `textarea`, and `select` inside a pane, assert its rectangle stays inside the pane body; for touch-sized controls, retain the repository's existing 44px mobile target contract.

Export the built-in role-room manifest from `src/components/role-surfaces/ids.ts` and make both registration tests and the rendered matrix consume it:

```ts
export const BUILT_IN_ROLE_SURFACE_IDS = [
  RESEARCHER_SURFACE_ID,
  MESSENGER_SURFACE_ID,
  INDEXER_SURFACE_ID,
] as const;
```

Add one case for every `surface:${id}` in that manifest. Seed deterministic familiar-role data so each room is visible, and mock API-heavy surfaces to deterministic empty/success responses. The existing role-surface unit suite must assert that every manifest ID is registered exactly once. The terminal case asserts its pane remains mounted while switching narrow tabs; Browser and Flow assert their canvas root stays inside the pane rectangle.

- [ ] **Step 4: Add narrow-container lifecycle tests**

In `tests/mobile/workspace-half-split.spec.ts`, open Home + Terminal, assert the tablist appears, assert the active page fills the host, and assert the inactive page remains mounted with zero interactive geometry. Switch tabs twice and assert the same terminal pane instance ID remains present.

- [ ] **Step 5: Run the matrix and capture genuine failures**

```bash
pnpm exec playwright test tests/workspace-half-split.spec.ts --project=desktop-1440 --project=desktop-1280 --project=desktop-1024
pnpm exec playwright test tests/mobile/workspace-half-split.spec.ts --project=pixel-5 --project=iphone-13
node --experimental-strip-types --test src/lib/role-surfaces.test.ts
```

Expected on first run: any remaining page-specific overflow or landmark defect fails with the page ID in the test title. Fix only the named surface contract, then rerun the failing case and the entire matrix.

- [ ] **Step 6: Verify all rendered cases pass**

Run the three commands from Step 5 again.

Expected: every project exits 0 with no retries required on the final run.

- [ ] **Step 7: Commit the rendered matrix**

```bash
git add tests/workspace-half-split.spec.ts tests/mobile/workspace-half-split.spec.ts playwright.config.ts src/components/role-surfaces/ids.ts src/components/role-surfaces/register.tsx src/lib/role-surfaces.test.ts
git commit -S -m "test(workspace): cover every half-split page (cave-x6rw)"
```

## Task 11: Run native desktop acceptance

**Files:**

- Modify only files implicated by a native acceptance failure.

- [ ] **Step 1: Start the Tauri desktop app in the foreground**

Run from the feature worktree:

```bash
bash scripts/dev-app.sh
```

Expected early output: a selected free port, `Ready on http://127.0.0.1:<port>`, and Cargo `Running DevCommand`. Compilation output is progress.

- [ ] **Step 2: Exercise representative native-only cases**

In the Tauri window verify:

- Home + Terminal opens at a visually even seam and preserves the PTY through narrow tab switches;
- Flow + Browser fill both halves without a trailing strip;
- Settings + Dashboard scroll within their own panes;
- a registered role surface opens on both left and right;
- collapsing/expanding the navigation refits the split without changing the chosen ratio;
- double-clicking the separator returns to exactly half;
- dragging past close/promote thresholds preserves the intended page and variant.

Capture the Tauri window only to `/tmp/cave-x6rw-native-split.png` using the macOS window-screenshot selector, inspect that image at original resolution, and confirm the outer edges, single seam, equal pane headers, and absence of a trailing strip. Do not capture the full desktop.

- [ ] **Step 3: Record native evidence in the Bead and stop cleanly**

Record chosen port, tested pairs, window size, and observed results in `cave-x6rw`. Stop the foreground wrapper with `Ctrl-C` and confirm both Next and Tauri child processes exit.

- [ ] **Step 4: Commit any native-only correction**

If Step 2 required a correction, stage only the implicated files and commit:

```bash
git commit -S -m "fix(desktop): preserve exact split geometry (cave-x6rw)"
```

If no correction was required, do not create an empty commit.

## Task 12: Full verification, review, PR, merge, and cleanup

**Files:**

- Modify: Bead `cave-x6rw` metadata and notes only.

- [ ] **Step 1: Run the complete local quality gate**

```bash
pnpm check:tests-wired
pnpm typecheck
pnpm test:app
pnpm test:api
pnpm test:mobile
pnpm build
pnpm test:e2e
pnpm exec playwright test tests/workspace-half-split.spec.ts --project=desktop-1440 --project=desktop-1280 --project=desktop-1024
pnpm exec playwright test tests/mobile/workspace-half-split.spec.ts --project=pixel-5 --project=iphone-13
git diff --check origin/main...HEAD
git status --short
```

Expected: every command exits 0; the final status contains no untracked generated assets or unstaged implementation files.

- [ ] **Step 2: Use the required verification and review skills**

Invoke `verification-before-completion`, then `requesting-code-review`. Review the full `origin/main...HEAD` diff against the approved design and this plan. Resolve every high- and medium-severity finding; rerun the focused test for each correction plus the complete gate from Step 1.

- [ ] **Step 3: Update the Bead with delivery evidence**

Record branch, worktree, commits, full gate output summary, rendered viewport matrix, native test evidence, and review disposition. Leave `cave-x6rw` open until merge.

- [ ] **Step 4: Publish a PR-shaped branch**

Fetch current `origin/main`, rebase only if required and safe, rerun the affected gate after any rebase, then push `feat/waste-free-half-splits` and open a draft PR. The PR body must link `cave-x6rw`, summarize registry/rendering/geometry changes, list all verification commands, and state that every registered page is covered in both split positions.

- [ ] **Step 5: Wait for required checks and squash-merge under standing authorization**

Inspect every required check to a terminal green state. Do not treat duplicate CI runs or transient flakes as proof of failure without reading their logs. Squash-merge only when all required checks are green; preserve any human contributor trailers in the squash message.

- [ ] **Step 6: Verify merge from remote state**

Run:

```bash
git fetch origin main
git log -1 --oneline origin/main
```

Expected: `origin/main` contains the squash commit for this PR.

- [ ] **Step 7: Close the Bead and remove PR transport**

Close `cave-x6rw` with the merged PR and squash SHA as evidence. Delete the remote feature branch, remove `.worktrees/feat-waste-free-half-splits`, and delete the local feature branch. Do not mutate or clean unrelated files in the primary checkout.

- [ ] **Step 8: Final handoff**

Report the merged PR, squash SHA, closed Bead, verification summary, and cleanup result. Mark the persistent goal complete only after all four are confirmed from current state.
