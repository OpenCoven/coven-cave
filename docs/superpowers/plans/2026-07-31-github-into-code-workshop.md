# GitHub into Code Workshop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the standalone GitHub workspace page while preserving its complete activity, notification, detail, settings, and action coverage inside the coding-role Code Workshop.

**Architecture:** Keep `GitHubView` as the only GitHub implementation and make `surface:code` its only internal host. A focused one-shot module store carries legacy Activity intent or PR/issue targets from Workspace into `CodeRoom`; Code Workshop owns tab selection and acknowledges each request by nonce so stale or superseded targets cannot replay.

**Tech Stack:** React 19, TypeScript 6, Next.js 16 dynamic imports, Node test runner, Playwright, pnpm, Coven Role Surfaces, Coven design tokens.

---

## Source of truth

- Approved design:
  `docs/superpowers/specs/2026-07-31-github-into-code-workshop-design.md`
- Bead: `cave-p2efm`
- Branch: `feat/github-into-code-workshop`
- Worktree: `.worktrees/feat-github-into-code-workshop`

## File map

### Navigation model

- Create `src/lib/pending-code-navigation.ts`: one-shot Code Workshop tab and
  GitHub-item handoff with nonce-aware acknowledgement.
- Create `src/lib/pending-code-navigation.test.ts`: behavioral coverage for
  item-to-tab mapping, replacement, subscriptions, stale acknowledgement, and
  explicit clearing.
- Modify `src/lib/code-surface.ts`: add Activity to the top-tab vocabulary and
  map legacy `ctab=github` to Activity.
- Modify `src/lib/code-surface.test.ts`: pin the five tabs and compatibility
  normalization.
- Modify `scripts/run-tests.mjs`: register the new behavioral test.

### Code Workshop host

- Modify `src/components/role-surfaces/code-room.tsx`: subscribe to both pending
  file opens and pending Code navigation.
- Modify `src/components/code-view.tsx`: add Activity, consume navigation
  requests, select the matching tab, and keep initial GitHub targets one-shot.
- Modify `src/components/github-view.tsx`: acknowledge capture of a host-provided
  initial target without clearing the locally selected detail.
- Modify `src/components/code-surface-mode.test.ts`: pin the room handoff,
  Activity mapping, local lazy boundary, and one-shot detail callback.

### Workspace routing and access boundary

- Modify `src/lib/workspace-mode.ts`: move `github` from canonical mode to a
  compatibility alias targeting `surface:code`.
- Modify `src/lib/workspace-mode.test.ts`: pin GitHub's alias status.
- Modify `src/components/workspace.tsx`: enqueue Code navigation for legacy
  GitHub mode and PR/issue URLs, remove standalone state/rendering, discard
  unconsumed requests on exit, and let `RoleSurfaceHost` show unavailable rooms.
- Modify `src/components/workspace-alias-modes.test.ts`: pin legacy GitHub
  migration through the central mode funnel.
- Modify `src/components/github-native-open.test.ts`: pin native PR/issue
  routing into Code Workshop and browser fallback preservation.

### Dead standalone UI and warmup removal

- Modify `src/lib/workspace-navigation.ts`: remove the GitHub sidebar item.
- Modify `src/components/sidebar-minimal.tsx`: remove GitHub badge and
  conditional-row props.
- Modify `src/components/sidebar-minimal.test.ts`: pin the row's absence and the
  unchanged registry-driven Code room.
- Modify `src/components/lazy-surfaces.tsx`: remove the standalone GitHub
  dynamic export and sidebar preload case.
- Modify `src/lib/surface-warmup-registry.ts`: remove GitHub as a background
  sidebar landing while retaining the GitHub cache resources consumed on
  demand by `GitHubView`.
- Modify `src/lib/use-surface-warmup.ts`: remove GitHub from the background
  warmup order while retaining roster-cache invalidation.
- Modify `src/lib/surface-warmup-registry.test.ts`: pin those boundaries.
- Modify `tests/code-surface.spec.ts`: verify Activity, legacy mode migration,
  notification visibility, and the wrong-role closed-room state in the real
  app.

## Task 1: Establish the pure navigation contracts

**Files:**
- Create: `src/lib/pending-code-navigation.ts`
- Create: `src/lib/pending-code-navigation.test.ts`
- Modify: `src/lib/code-surface.ts`
- Modify: `src/lib/code-surface.test.ts`
- Modify: `scripts/run-tests.mjs`

- [ ] **Step 1: Install this worktree's dependencies**

Run:

```bash
cd .worktrees/feat-github-into-code-workshop
pnpm install --frozen-lockfile
```

Expected: installation succeeds and `git status --short` shows no manifest or
lockfile changes.

- [ ] **Step 2: Write the failing Activity assertions**

Replace the deep-link and tab-vocabulary expectations in
`src/lib/code-surface.test.ts` with:

```ts
test("deep-link parsing falls back to defaults on unknown values", () => {
  const parsed = parseCodeDeepLink(new URLSearchParams("session=abc&ctab=reviews&wtab=files"));
  assert.deepEqual(parsed, { sessionId: "abc", topTab: "reviews", workbenchTab: "files" });
  const legacy = parseCodeDeepLink(new URLSearchParams("ctab=github"));
  assert.equal(legacy.topTab, "activity");
  const fallback = parseCodeDeepLink(new URLSearchParams("ctab=bogus&wtab=nope"));
  assert.deepEqual(fallback, { sessionId: null, topTab: "sessions", workbenchTab: "diff" });
});

test("tab guards accept exactly the fixed vocabularies", () => {
  for (const tab of ["diff", "files", "terminal", "pr"]) assert.ok(isCodeWorkbenchTab(tab));
  for (const tab of ["sessions", "activity", "prs", "issues", "reviews"]) {
    assert.ok(isCodeTopTab(tab));
  }
  for (const tab of ["activity", "prs", "issues", "reviews"]) {
    assert.ok(isCodeGithubTab(tab));
  }
  assert.ok(!isCodeGithubTab("sessions"));
  assert.ok(!isCodeWorkbenchTab("overview"));
  assert.ok(!isCodeTopTab("code"));
  assert.ok(!isCodeTopTab("github"), "github remains compatibility input, not a rendered tab");
  assert.ok(!isCodeWorkbenchTab(null));
  assert.ok(!isCodeTopTab(undefined));
});

test("normalizeCodeTopTab maps legacy + unknown values", () => {
  assert.equal(normalizeCodeTopTab("github"), "activity", "legacy github → Activity");
  assert.equal(normalizeCodeTopTab("activity"), "activity");
  assert.equal(normalizeCodeTopTab("issues"), "issues");
  assert.equal(normalizeCodeTopTab("bogus"), "sessions");
  assert.equal(normalizeCodeTopTab(null), "sessions");
});
```

- [ ] **Step 3: Add the failing one-shot store tests**

Create `src/lib/pending-code-navigation.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  acknowledgePendingCodeNavigation,
  clearPendingCodeNavigation,
  codeTopTabForGitHubTarget,
  enqueuePendingCodeNavigation,
  getPendingCodeNavigation,
  subscribePendingCodeNavigation,
} from "./pending-code-navigation.ts";

const pr = {
  repo: "OpenCoven/coven-cave",
  number: 42,
  kind: "pr" as const,
  url: "https://github.com/OpenCoven/coven-cave/pull/42",
};
const issue = {
  repo: "OpenCoven/coven-cave",
  number: 43,
  kind: "issue" as const,
  url: "https://github.com/OpenCoven/coven-cave/issues/43",
};

test("GitHub item targets select their matching Code Workshop tabs", () => {
  assert.equal(codeTopTabForGitHubTarget(pr), "prs");
  assert.equal(codeTopTabForGitHubTarget(issue), "issues");
});

test("the newest request wins and stale acknowledgement cannot clear it", () => {
  clearPendingCodeNavigation();
  let notifications = 0;
  const unsubscribe = subscribePendingCodeNavigation(() => {
    notifications += 1;
  });

  enqueuePendingCodeNavigation({ kind: "tab", topTab: "activity", nonce: 1 });
  enqueuePendingCodeNavigation({ kind: "github-item", target: pr, nonce: 2 });
  acknowledgePendingCodeNavigation(1);

  assert.deepEqual(getPendingCodeNavigation(), {
    kind: "github-item",
    target: pr,
    nonce: 2,
  });
  assert.equal(notifications, 2);

  acknowledgePendingCodeNavigation(2);
  assert.equal(getPendingCodeNavigation(), null);
  assert.equal(notifications, 3);
  unsubscribe();
});

test("explicit clearing discards an unavailable room's unconsumed request", () => {
  clearPendingCodeNavigation();
  enqueuePendingCodeNavigation({ kind: "github-item", target: issue, nonce: 3 });
  clearPendingCodeNavigation();
  assert.equal(getPendingCodeNavigation(), null);
});
```

Append the new test beside the other Code model tests in the `app` array in
`scripts/run-tests.mjs`:

```js
"src/lib/pending-code-navigation.test.ts",
```

- [ ] **Step 4: Run the tests and verify the new contracts fail**

Run:

```bash
node --experimental-strip-types --test \
  src/lib/code-surface.test.ts \
  src/lib/pending-code-navigation.test.ts
```

Expected: the existing Code tests fail because Activity is absent and legacy
GitHub still maps to PRs; the new test fails because
`pending-code-navigation.ts` does not exist. Workspace mode vocabulary remains
unchanged until Task 3 can update the producer and alias atomically.

- [ ] **Step 5: Add Activity to the pure Code model**

In `src/lib/code-surface.ts`, replace the top-tab definitions and legacy
normalizer with:

```ts
/** Top-level surface tabs: the session workbench followed by GitHub activity. */
export const CODE_TOP_TABS = ["sessions", "activity", "prs", "issues", "reviews"] as const;
export type CodeTopTab = (typeof CODE_TOP_TABS)[number];

export function isCodeTopTab(value: string | null | undefined): value is CodeTopTab {
  return (CODE_TOP_TABS as readonly string[]).includes(value ?? "");
}

/** Every top tab hosted by the shared GitHub view. */
export const CODE_GITHUB_TABS = ["activity", "prs", "issues", "reviews"] as const;
export type CodeGithubTab = (typeof CODE_GITHUB_TABS)[number];

export function isCodeGithubTab(value: string | null | undefined): value is CodeGithubTab {
  return (CODE_GITHUB_TABS as readonly string[]).includes(value ?? "");
}

/** Legacy `ctab=github` links land on Activity, the former all-content feed. */
export function normalizeCodeTopTab(raw: string | null | undefined): CodeTopTab {
  if (isCodeTopTab(raw)) return raw;
  if (raw === "github") return "activity";
  return "sessions";
}
```

- [ ] **Step 6: Implement the one-shot Code navigation store**

Create `src/lib/pending-code-navigation.ts`:

```ts
import type { CodeTopTab } from "./code-surface.ts";
import type { GitHubItemTarget } from "./github-item-url.ts";

export type PendingCodeNavigation =
  | {
      kind: "tab";
      topTab: CodeTopTab;
      nonce: number;
    }
  | {
      kind: "github-item";
      target: GitHubItemTarget;
      nonce: number;
    };

export function codeTopTabForGitHubTarget(
  target: GitHubItemTarget,
): Extract<CodeTopTab, "prs" | "issues"> {
  return target.kind === "pr" ? "prs" : "issues";
}

let pending: PendingCodeNavigation | null = null;
const listeners = new Set<() => void>();

export function enqueuePendingCodeNavigation(request: PendingCodeNavigation): void {
  pending = request;
  for (const listener of listeners) listener();
}

export function acknowledgePendingCodeNavigation(nonce: number): void {
  if (pending?.nonce !== nonce) return;
  pending = null;
  for (const listener of listeners) listener();
}

export function clearPendingCodeNavigation(): void {
  if (pending === null) return;
  pending = null;
  for (const listener of listeners) listener();
}

export function getPendingCodeNavigation(): PendingCodeNavigation | null {
  return pending;
}

export function subscribePendingCodeNavigation(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
```

- [ ] **Step 7: Run the pure tests and registration guard**

Run:

```bash
node --experimental-strip-types --test \
  src/lib/code-surface.test.ts \
  src/lib/pending-code-navigation.test.ts
pnpm check:tests-wired
```

Expected: all tests pass and the test-registration guard reports every test
wired into CI.

- [ ] **Step 8: Commit the navigation model**

Run:

```bash
git add src/lib/pending-code-navigation.ts \
  src/lib/pending-code-navigation.test.ts \
  src/lib/code-surface.ts \
  src/lib/code-surface.test.ts \
  scripts/run-tests.mjs
git commit -S -m "feat: model GitHub navigation in Code Workshop"
```

Expected: a signed commit containing only the pure model, store, tests, and
test registration.

## Task 2: Consume GitHub navigation inside Code Workshop

**Files:**
- Modify: `src/components/role-surfaces/code-room.tsx`
- Modify: `src/components/code-view.tsx`
- Modify: `src/components/github-view.tsx`
- Modify: `src/components/code-surface-mode.test.ts`

- [ ] **Step 1: Write the failing room and target-lifecycle source contracts**

In `src/components/code-surface-mode.test.ts`, read the shared GitHub view and
pending-navigation source:

```ts
const githubView = await readFile(new URL("./github-view.tsx", import.meta.url), "utf8");
const pendingNavigation = await readFile(
  new URL("../lib/pending-code-navigation.ts", import.meta.url),
  "utf8",
);
```

Replace the assertions that require standalone GitHub rendering with:

```ts
assert.match(
  pendingNavigation,
  /export type PendingCodeNavigation =[\s\S]*kind: "tab"[\s\S]*kind: "github-item"/,
  "Code navigation has one shared tab/item handoff contract",
);
assert.match(
  codeRoom,
  /subscribePendingCodeNavigation[\s\S]*getPendingCodeNavigation[\s\S]*navigationRequest=\{pendingNavigation\}[\s\S]*onNavigationHandled=\{acknowledgePendingCodeNavigation\}/,
  "the room consumes pending GitHub navigation after the role surface mounts",
);
assert.match(
  codeView,
  /activity: "all"[\s\S]*prs: "pr"[\s\S]*issues: "issue"[\s\S]*reviews: "review_request"/,
  "Code Workshop preserves the former all feed and each specialized filter",
);
assert.match(
  codeView,
  /onInitialTargetHandled=\{\(\) => setInitialGithubTarget\(null\)\}/,
  "CodeView drops the host target after GitHubView captures it",
);
assert.match(
  githubView,
  /if \(!initialTarget\) return;[\s\S]*setDeepLink\(initialTarget\);[\s\S]*onInitialTargetHandled\?\.\(\)/,
  "clearing the host prop does not erase GitHubView's local deep-linked detail",
);
assert.match(
  codeView,
  /import\("@\/components\/github-view"\)\.then\(\(m\) => m\.GitHubView\)/,
  "GitHub remains lazy-loaded from its sole Code Workshop host",
);
```

- [ ] **Step 2: Run the source contract and verify it fails**

Run:

```bash
node --experimental-strip-types --test src/components/code-surface-mode.test.ts
```

Expected: failures report the absent pending-navigation subscription, Activity
mapping, and one-shot callback.

- [ ] **Step 3: Subscribe to Code navigation in `CodeRoom`**

Add these imports to `src/components/role-surfaces/code-room.tsx`:

```ts
import {
  acknowledgePendingCodeNavigation,
  getPendingCodeNavigation,
  subscribePendingCodeNavigation,
} from "@/lib/pending-code-navigation";
```

Inside `CodeRoom`, add:

```ts
const pendingNavigation = useSyncExternalStore(
  subscribePendingCodeNavigation,
  getPendingCodeNavigation,
  () => null,
);
```

Pass the request beside the existing file-open handoff:

```tsx
<CodeView
  sessions={context.runtimeState.sessions}
  onJumpToSession={(sessionId, familiarId) =>
    context.openSession(sessionId, familiarId ?? undefined)
  }
  onFocusCard={context.focusCard}
  navigationRequest={pendingNavigation}
  onNavigationHandled={acknowledgePendingCodeNavigation}
  pendingOpen={pendingOpen}
  onPendingOpenHandled={clearPendingCodeOpen}
  onTasksRefresh={context.refreshTasks}
/>
```

Update the file header comment: GitHub item opens now enter this room through
the pending Code navigation store.

- [ ] **Step 4: Add Activity and request consumption to `CodeView`**

In `src/components/code-view.tsx`, import:

```ts
import {
  codeTopTabForGitHubTarget,
  type PendingCodeNavigation,
} from "@/lib/pending-code-navigation";
```

Replace the GitHub tab records with:

```ts
const GITHUB_TAB_FILTER: Record<CodeGithubTab, GitHubFilter> = {
  activity: "all",
  prs: "pr",
  issues: "issue",
  reviews: "review_request",
};

const GITHUB_TAB_META: Record<
  CodeGithubTab,
  { label: string; icon: Parameters<typeof Icon>[0]["name"] }
> = {
  activity: { label: "Activity", icon: "ph:bell" },
  prs: { label: "PRs", icon: "ph:git-pull-request" },
  issues: { label: "Issues", icon: "ph:circle-dashed" },
  reviews: { label: "Reviews", icon: "ph:check-circle" },
};
```

Replace `initialTopTab` and `githubTarget` in `CodeViewProps` with:

```ts
navigationRequest?: PendingCodeNavigation | null;
onNavigationHandled?: (nonce: number) => void;
```

Destructure those props and add this helper above the component:

```ts
function topTabForNavigation(request: PendingCodeNavigation): CodeTopTab {
  return request.kind === "github-item"
    ? codeTopTabForGitHubTarget(request.target)
    : request.topTab;
}
```

Replace the top-tab initializer and add local target capture:

```ts
const [topTab, setTopTab] = useState<CodeTopTab>(
  navigationRequest
    ? topTabForNavigation(navigationRequest)
    : deepLink?.topTab ?? "sessions",
);
const [initialGithubTarget, setInitialGithubTarget] = useState<GitHubItemTarget | null>(
  navigationRequest?.kind === "github-item" ? navigationRequest.target : null,
);
const handledNavigationNonceRef = useRef<number | null>(null);

useEffect(() => {
  if (!navigationRequest) return;
  if (handledNavigationNonceRef.current === navigationRequest.nonce) return;
  setTopTab(topTabForNavigation(navigationRequest));
  setInitialGithubTarget(
    navigationRequest.kind === "github-item" ? navigationRequest.target : null,
  );
  handledNavigationNonceRef.current = navigationRequest.nonce;
  onNavigationHandled?.(navigationRequest.nonce);
}, [navigationRequest, onNavigationHandled]);
```

Pass the local target and callback to the lazy GitHub view:

```tsx
<LazyGitHubView
  onJumpToSession={onJumpToSession}
  onFocusCard={onFocusCard}
  initialTarget={initialGithubTarget}
  onInitialTargetHandled={() => setInitialGithubTarget(null)}
  initialFilter={GITHUB_TAB_FILTER[githubTab]}
  onTasksRefresh={onTasksRefresh}
/>
```

- [ ] **Step 5: Make `GitHubView` acknowledge initial-target capture**

Add this prop in `src/components/github-view.tsx`:

```ts
/** Called after the view captures a host target into local detail state. */
onInitialTargetHandled?: () => void;
```

Destructure it in `GitHubView`, then replace the current prop-sync effect with:

```ts
useEffect(() => {
  if (!initialTarget) return;
  setDeepLink(initialTarget);
  onInitialTargetHandled?.();
}, [initialTarget, onInitialTargetHandled]);
```

Keep `useState<GitHubItemTarget | null>(initialTarget ?? null)` unchanged so the
first render already contains the target. Keep `selectRow()` clearing
`deepLink`; a manual selection must still take ownership of the detail pane.

- [ ] **Step 6: Run the focused Code contracts**

Run:

```bash
node --experimental-strip-types --test \
  src/lib/code-surface.test.ts \
  src/lib/pending-code-navigation.test.ts \
  src/components/code-surface-mode.test.ts
```

Expected: the Code model and room contracts pass. Task 3 updates the native
Workspace routing contract and implementation together.

- [ ] **Step 7: Commit the Code Workshop host**

Run:

```bash
git add src/components/role-surfaces/code-room.tsx \
  src/components/code-view.tsx \
  src/components/github-view.tsx \
  src/components/code-surface-mode.test.ts
git commit -S -m "feat: host GitHub activity in Code Workshop"
```

Expected: a signed commit containing the five-tab host and one-shot detail
lifecycle, without Workspace or sidebar removal yet.

## Task 3: Route Workspace GitHub intents into the role-gated room

**Files:**
- Modify: `src/lib/workspace-mode.ts`
- Modify: `src/lib/workspace-mode.test.ts`
- Modify: `src/components/workspace.tsx`
- Modify: `src/components/workspace-alias-modes.test.ts`
- Modify: `src/components/github-native-open.test.ts`
- Modify: `src/components/code-surface-mode.test.ts`

- [ ] **Step 1: Replace standalone routing assertions with failing room-routing assertions**

In `src/components/workspace-alias-modes.test.ts`, replace the standalone
GitHub render assertions with:

```ts
assert.equal(MODE_ALIASES.github, "surface:code");
assert.match(
  workspace,
  /if \(next === "github"\) \{[\s\S]{0,500}?enqueuePendingCodeNavigation\(\{ kind: "tab", topTab: "activity", nonce: Date\.now\(\) \}\)[\s\S]{0,300}?commitMode\(roleSurfaceMode\(CODE_SURFACE_ID\), "github"\)/,
  'setMode migrates legacy "github" requests to Code Workshop Activity',
);
assert.doesNotMatch(
  workspace,
  /mode === "github" \?/,
  "github is compatibility intent, never a standalone render branch",
);
```

Replace the standalone GitHub test in `src/lib/workspace-mode.test.ts` with:

```ts
test("github remains valid only as a Code Workshop compatibility alias", () => {
  assert.ok(!(CANONICAL_WORKSPACE_MODES as readonly string[]).includes("github"));
  assert.ok(isAliasWorkspaceMode("github"));
  assert.equal(MODE_ALIASES.github, "surface:code");
  assert.equal(resolveWorkspaceModeAlias("github"), "surface:code");
});
```

Add this assertion to `"the documented alias landings hold"`:

```ts
assert.equal(MODE_ALIASES.github, "surface:code", "GitHub is an Activity intent inside Code Workshop");
```

In `src/components/github-native-open.test.ts`, read the pending store:

```ts
const pendingNavigation = readFileSync(
  new URL("../lib/pending-code-navigation.ts", import.meta.url),
  "utf8",
);
```

Replace the Workspace routing and stale-state assertions with:

```ts
assert.match(
  workspace,
  /const openGitHubTarget = useCallback\([\s\S]*?parseGitHubItemUrl\(url\)[\s\S]*?enqueuePendingCodeNavigation\(\{ kind: "github-item", target, nonce: Date\.now\(\) \}\);[\s\S]*?setMode\("code"\);[\s\S]*?return true;/,
  "PR/issue URLs enqueue native detail and enter Code Workshop",
);
assert.match(
  pendingNavigation,
  /acknowledgePendingCodeNavigation\(nonce: number\)[\s\S]*pending\?\.nonce !== nonce/,
  "a stale consumer cannot clear a newer GitHub target",
);
assert.match(
  workspace,
  /if \(mode !== roleSurfaceMode\(CODE_SURFACE_ID\)\) clearPendingCodeNavigation\(\);/,
  "leaving Code Workshop discards an unavailable room's unconsumed target",
);
assert.doesNotMatch(workspace, /setGithubTarget|githubTarget/, "Workspace owns no standalone GitHub detail state");
assert.doesNotMatch(workspace, /<GitHubView/, "Workspace never renders GitHubView directly");
```

Keep the existing assertions that reminder and notification links call
`openGitHubTarget()` before `openUrlInAppBrowser()`. They prove unsupported
URLs retain the browser fallback.

In `src/components/code-surface-mode.test.ts`, add:

```ts
assert.doesNotMatch(
  workspace,
  /visibleSurfaces\.some\(\(s\) => s\.id === surfaceId\)\) setMode\("home"\)/,
  "Workspace lets RoleSurfaceHost render the explicit wrong-role closed-room state",
);
```

- [ ] **Step 2: Run the routing contracts and verify they fail**

Run:

```bash
node --experimental-strip-types --test \
  src/lib/workspace-mode.test.ts \
  src/components/workspace-alias-modes.test.ts \
  src/components/github-native-open.test.ts \
  src/components/code-surface-mode.test.ts
```

Expected: failures point to the old `setGithubTarget`, `setMode("github")`,
standalone render branch, and automatic Home redirect.

- [ ] **Step 3: Migrate the mode vocabulary and remove standalone state**

In `src/lib/workspace-mode.ts`:

1. Remove `"github"` from `CanonicalWorkspaceMode`.
2. Remove `"github"` from `CANONICAL_WORKSPACE_MODES`.
3. Add `"github"` to `AliasWorkspaceMode`.
4. Add this mapping to `MODE_ALIASES`:

```ts
github: "surface:code",
```

Update the surrounding comments to describe both `code` and `github` as
rewritten aliases into the coding-role room; `github` additionally requests
Activity in `Workspace.setMode`.

In `src/components/workspace.tsx`:

1. Change the GitHub URL import to:

```ts
import { parseGitHubItemUrl } from "@/lib/github-item-url";
```

2. Add:

```ts
import {
  clearPendingCodeNavigation,
  enqueuePendingCodeNavigation,
} from "@/lib/pending-code-navigation";
```

3. Remove `GitHubView` from the `@/components/lazy-surfaces` import.
4. Delete the `githubTarget` state and its `mode !== "github"` clearing effect.

- [ ] **Step 4: Migrate legacy mode and native URL routing**

Add this branch immediately before the existing `next === "code"` branch in
`setMode`:

```ts
if (next === "github") {
  enqueuePendingCodeNavigation({
    kind: "tab",
    topTab: "activity",
    nonce: Date.now(),
  });
  commitMode(roleSurfaceMode(CODE_SURFACE_ID), "github");
  return;
}
```

Replace `openGitHubTarget` with:

```ts
const openGitHubTarget = useCallback((url: string | null | undefined): boolean => {
  const target = parseGitHubItemUrl(url);
  if (!target) return false;
  enqueuePendingCodeNavigation({
    kind: "github-item",
    target,
    nonce: Date.now(),
  });
  setMode("code");
  return true;
}, [setMode]);
```

Update the comment to say PR/issue URLs open natively in Code Workshop.

- [ ] **Step 5: Discard abandoned requests and expose the closed-room state**

Add this effect after Role Surface session setup:

```ts
useEffect(() => {
  if (mode !== roleSurfaceMode(CODE_SURFACE_ID)) {
    clearPendingCodeNavigation();
  }
}, [mode]);
```

Delete the effect that checks `visibleSurfaces` and calls `setMode("home")` for
an unavailable role surface. Do not add Code-specific unavailable markup:
`RoleSurfaceHost` already renders the correct role-aware closed-room state and
Back action.

- [ ] **Step 6: Remove the standalone Workspace render branch**

Delete:

```tsx
) : mode === "github" ? (
  <GitHubView
    onJumpToSession={openFamiliarSession}
    onFocusCard={focusCardFromRoom}
    onTasksRefresh={refreshTasksFromRoom}
    initialTarget={githubTarget}
  />
```

Join the surrounding conditional branches without changing the next surface's
props. Keep `WORKSPACE_MODE_TITLES.github`; `github` remains accepted
compatibility vocabulary even though `mode` state never retains it.

- [ ] **Step 7: Run the routing and pure-mode tests**

Run:

```bash
node --experimental-strip-types --test \
  src/lib/workspace-mode.test.ts \
  src/lib/code-surface.test.ts \
  src/lib/pending-code-navigation.test.ts \
  src/components/workspace-alias-modes.test.ts \
  src/components/github-native-open.test.ts \
  src/components/code-surface-mode.test.ts
```

Expected: every test passes; valid PR/issue URLs are native Code Workshop
requests, unsupported URLs still fall through to the in-app browser, and
wrong-role rooms are no longer redirected away.

- [ ] **Step 8: Commit Workspace routing**

Run:

```bash
git add src/components/workspace.tsx \
  src/lib/workspace-mode.ts \
  src/lib/workspace-mode.test.ts \
  src/components/workspace-alias-modes.test.ts \
  src/components/github-native-open.test.ts \
  src/components/code-surface-mode.test.ts
git commit -S -m "refactor: route GitHub intents through Code Workshop"
```

Expected: a signed commit containing the compatibility funnel and role-gated
native deep-link behavior.

## Task 4: Remove standalone navigation and warmup plumbing

**Files:**
- Modify: `src/lib/workspace-navigation.ts`
- Modify: `src/components/sidebar-minimal.tsx`
- Modify: `src/components/workspace.tsx`
- Modify: `src/components/sidebar-minimal.test.ts`
- Modify: `src/components/code-surface-mode.test.ts`
- Modify: `src/components/lazy-surfaces.tsx`
- Modify: `src/lib/surface-warmup-registry.ts`
- Modify: `src/lib/use-surface-warmup.ts`
- Modify: `src/lib/surface-warmup-registry.test.ts`
- Modify: `tests/code-surface.spec.ts`

- [ ] **Step 1: Repair the stale sidebar CSS source fixture**

`src/styles/sidebar-minimal.css` is now an import facade, so
`src/components/sidebar-minimal.test.ts` must read the owned modules before
asserting their rules. Replace its `styles` declaration with:

```ts
const styles = [
 readFileSync(new URL("../styles/sidebar-minimal.css", import.meta.url), "utf8"),
 readFileSync(new URL("../styles/sidebar-minimal/shell-chrome.css", import.meta.url), "utf8"),
 readFileSync(new URL("../styles/sidebar-minimal/navigation-recents.css", import.meta.url), "utf8"),
 readFileSync(new URL("../styles/sidebar-minimal/familiars.css", import.meta.url), "utf8"),
 readFileSync(new URL("../styles/sidebar-minimal/activity-rail.css", import.meta.url), "utf8"),
].join("\n");
```

Run:

```bash
node --experimental-strip-types --test src/components/sidebar-minimal.test.ts
```

Expected: the pre-existing compact-row source pin passes before the GitHub row
assertions are changed.

- [ ] **Step 2: Write the failing dead-path and Activity E2E contracts**

In `src/components/sidebar-minimal.test.ts`, replace the conditional-row and
standalone-row assertions with:

```ts
assert.doesNotMatch(
  navigation,
  /\{ id: "github", label: "GitHub"/,
  "GitHub has no standalone workspace navigation row",
);
assert.doesNotMatch(
  source,
  /hideGithubRow|githubAssignedCount|MODE_BADGES[\s\S]*github:/,
  "the sidebar has no standalone GitHub badge or conditional-row plumbing",
);
assert.match(
  source,
  /props\.roleSurfaces!\.map\(\(room\) =>/,
  "Code Workshop remains registry-driven through the active familiar's rooms",
);
```

In `src/components/code-surface-mode.test.ts`, replace lazy/sidebar assertions
with:

```ts
assert.doesNotMatch(
  lazySurfaces,
  /loadGitHubView|export const GitHubView|case "github"/,
  "the standalone GitHub chunk and sidebar preload path are removed",
);
assert.doesNotMatch(
  navigation,
  /\{ id: "github", label: "GitHub"/,
  "GitHub has no peer workspace row",
);
assert.doesNotMatch(
  workspace,
  /hideGithubRow=|githubAssignedCount=/,
  "Workspace no longer carries standalone row props",
);
```

In `src/lib/surface-warmup-registry.test.ts`:

1. Remove `"github"` from the canonical warmup surface loop.
2. Replace the standalone GitHub loader test with:

```ts
test("GitHub cache resources stay demand-loaded without a standalone sidebar warmup", async () => {
  const surfaces = await readFile(new URL("../components/lazy-surfaces.tsx", import.meta.url), "utf8");
  const registry = await source("surface-warmup-registry.ts");
  const coordinator = await source("use-surface-warmup.ts");

  assert.doesNotMatch(surfaces, /loadGitHubView|case "github"/);
  assert.doesNotMatch(registry, /^\s*github:\s*\[/m);
  assert.doesNotMatch(coordinator, /ORDER:[^=]*=\s*\[[^\]]*"github"/);
  assert.match(registry, /defineResource\("github:pat"/);
  assert.match(registry, /"github:activity"[\s\S]*\/api\/github\/activity/);
  assert.match(registry, /defineResource\("github:familiars"/);
  assert.match(
    coordinator,
    /invalidateIfDefined\("github:familiars"\)/,
    "roster writes still invalidate an on-demand GitHub cache",
  );
});
```

In `tests/code-surface.spec.ts`, change `base` to accept a familiar type:

```ts
async function base(
  page: Page,
  sessions: unknown[] = [NEWEST, OLDER],
  familiarType = "coding",
) {
```

Replace the familiar route with:

```ts
await page.route("**/api/familiars**", (route) =>
  route.fulfill({
    json: {
      ok: true,
      familiars: [{
        id: "nova",
        display_name: "Nova",
        role: "Orchestrator",
        familiarType,
        status: "active",
        icon: "ph:sparkle-fill",
      }],
    },
  }),
);
```

Add Activity to the landing tab assertions:

```ts
await expect(topTabs.getByRole("tab", { name: "Activity" })).toBeVisible();
```

Add this helper below `base`:

```ts
async function mockGitHubActivity(page: Page) {
  const complete = {
    status: "complete",
    shown: 0,
    total: 0,
    hasMore: false,
    incomplete: false,
    githubIncomplete: false,
  };
  await page.route("**/api/github/pat**", (route) =>
    route.fulfill({ json: { hasPat: true, login: "val" } }),
  );
  await page.route("**/api/github/activity**", (route) =>
    route.fulfill({
      json: {
        ok: true,
        authed: true,
        login: "val",
        organizations: ["OpenCoven"],
        collections: {
          authored: complete,
          reviewRequests: complete,
          assignedIssues: complete,
        },
        items: [{
          kind: "notification",
          id: "notification:release-alert",
          title: "Release alert",
          repo: "OpenCoven/coven-cave",
          url: "https://github.com/OpenCoven/coven-cave/releases",
          updatedAt: NEW_ISO,
        }],
        rateLimit: { remaining: 100, limit: 5000 },
      },
    }),
  );
  await page.route("**/api/board**", (route) =>
    route.fulfill({ json: { ok: true, cards: [] } }),
  );
}
```

Add these tests:

```ts
test("legacy GitHub mode lands on Activity and preserves notifications", async ({ page }) => {
  await base(page);
  await mockGitHubActivity(page);
  await page.goto("/?mode=github");

  const topTabs = page.getByRole("tablist", { name: "Code surface" });
  await expect(topTabs.getByRole("tab", { name: "Activity" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.getByText("Release alert")).toBeVisible({ timeout: 30_000 });
});

test("a non-coding familiar sees the closed Code Workshop door", async ({ page }) => {
  await base(page, [NEWEST, OLDER], "general");
  await page.goto("/?mode=github");

  await expect(
    page.getByText("Nova doesn't hold the coder role, so this room stays closed."),
  ).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("button", { name: "Back to the Cave" })).toBeVisible();
});
```

- [ ] **Step 3: Run the source tests and verify the old plumbing fails**

Run:

```bash
node --experimental-strip-types --test \
  src/components/sidebar-minimal.test.ts \
  src/components/code-surface-mode.test.ts \
  src/lib/surface-warmup-registry.test.ts
```

Expected: failures identify the GitHub row, row props, standalone lazy export,
preload case, and background warmup entry.

- [ ] **Step 4: Remove the GitHub sidebar row and badge state**

Delete the GitHub item from `WORKSPACE_NAV_ITEMS` in
`src/lib/workspace-navigation.ts`.

In `src/components/sidebar-minimal.tsx`:

1. Remove `githubAssignedCount` and `hideGithubRow` from
   `SidebarMinimalProps`.
2. Remove the `github` entry from `MODE_BADGES`.
3. Replace the conditional filtered list with:

```tsx
{VISIBLE_WORKSPACE_NAV_ITEMS.map((fm: WorkspaceNavItem, i, rows) => (
```

4. Update the nearby quiet-row comment so it refers only to `navHidden` rows.

In `src/components/workspace.tsx`:

1. Remove `githubAssignedCount` state.
2. Remove `setGithubAssignedCount()` from `loadGitHubTasks`; keep the task
   normalization and session enrichment.
3. Remove `githubAssignedCount` and `hideGithubRow` from the
   `SidebarMinimal` props.

- [ ] **Step 5: Remove the standalone lazy export and background warm**

In `src/components/lazy-surfaces.tsx`, remove:

- `loadGitHubView`;
- `"github"` from `WarmableSidebarSurface`;
- the exported dynamic `GitHubView`;
- the `case "github"` branch in `preloadSidebarSurface`;
- comments describing standalone GitHub warmup.

Do not change the local `dynamic()` import in `code-view.tsx`.

In `src/lib/surface-warmup-registry.ts`:

1. Remove `GITHUB_WARMUP_REMAINING_FLOOR`.
2. Remove the `github` entry from `surfaceWarmupResources`.
3. Remove the `resource === "github:activity"` remaining-floor branch from
   `warmSurface`.
4. Keep the `github:pat`, `github:activity`, and `github:familiars` resource
   definitions, `readSurfaceResource`, invalidation, and rate-limit error
   handling because the on-demand `GitHubView` still consumes them.

In `src/lib/use-surface-warmup.ts`, change the order to:

```ts
const ORDER: readonly SurfaceWarmupSurface[] = [
  "board",
  "schedules",
  "marketplace",
  "grimoire",
  "agents",
];
```

Keep `onFamiliarsRefresh`; it invalidates an already-read GitHub roster cache
even though that cache is no longer prewarmed.

- [ ] **Step 6: Run the focused source and unit tests**

Run:

```bash
node --experimental-strip-types --test \
  src/lib/workspace-mode.test.ts \
  src/lib/code-surface.test.ts \
  src/lib/pending-code-navigation.test.ts \
  src/lib/surface-warmup-registry.test.ts \
  src/components/workspace-alias-modes.test.ts \
  src/components/github-native-open.test.ts \
  src/components/sidebar-minimal.test.ts \
  src/components/code-surface-mode.test.ts
```

Expected: every focused test passes with no standalone GitHub row, render
branch, lazy export, or background landing.

- [ ] **Step 7: Run the Code Workshop browser tests**

Run:

```bash
pnpm exec playwright test tests/code-surface.spec.ts --project=desktop
```

Expected: the Code Workshop suite passes, including:

- Sessions, Activity, PRs, Issues, and Reviews are visible;
- `?mode=github` selects Activity;
- a notification appears in Activity;
- a general familiar remains on the closed-room state.

- [ ] **Step 8: Commit standalone-path removal**

Run:

```bash
git add src/lib/workspace-navigation.ts \
  src/components/sidebar-minimal.tsx \
  src/components/workspace.tsx \
  src/components/sidebar-minimal.test.ts \
  src/components/code-surface-mode.test.ts \
  src/components/lazy-surfaces.tsx \
  src/lib/surface-warmup-registry.ts \
  src/lib/use-surface-warmup.ts \
  src/lib/surface-warmup-registry.test.ts \
  tests/code-surface.spec.ts
git commit -S -m "refactor: remove standalone GitHub surface"
```

Expected: a signed commit removing only the obsolete peer-page plumbing while
retaining the shared GitHub implementation and cache resources.

## Task 5: Verify complete coverage and record the handoff

**Files:**
- Verify all files changed in Tasks 1-4.
- Update Bead `cave-p2efm` notes.

- [ ] **Step 1: Check the complete diff and stale references**

Run:

```bash
git diff --check origin/main...HEAD
git grep -n -E 'hideGithubRow|setGithubTarget|githubTarget|mode === "github"|export const GitHubView|case "github"' \
  -- src/components/workspace.tsx \
  src/components/sidebar-minimal.tsx \
  src/components/lazy-surfaces.tsx || true
git status --short
```

Expected:

- no whitespace errors;
- no standalone state, render, row-hiding, lazy export, or preload case;
- any remaining `githubTarget` text appears only in historical comments that
  should be corrected before continuing;
- the worktree is clean.

- [ ] **Step 2: Run registration, type, and design gates**

Run:

```bash
pnpm check:tests-wired
pnpm typecheck
pnpm lint
node --experimental-strip-types --import ./scripts/test-alias-register.mjs \
  src/lib/design-token-drift.test.ts
```

Expected: every command passes; no design-token baseline change or new icon
subset is required.

- [ ] **Step 3: Run the complete app suite**

Run:

```bash
pnpm test:app
```

Expected: the full app suite passes, including all GitHub behavior tests,
workspace compatibility tests, Code Workshop contracts, and warmup tests.

- [ ] **Step 4: Run the production build and budgets**

Run:

```bash
pnpm build
```

Expected: Next.js build, server build, bundle budget, and standalone budget all
pass. `GitHubView` remains a lazy Code Workshop chunk and does not join the boot
bundle.

- [ ] **Step 5: Verify the real app**

Invoke the project `run-cave-app` skill and inspect:

1. A coding familiar opening Code Workshop.
2. The five-tab strip at desktop and narrow widths.
3. Activity showing mixed/notification content.
4. PRs, Issues, and Reviews retaining their filtered lists and controls.
5. Search, organization/repository filters, grouping, sorting, PAT controls,
   organization settings, subscriptions, detail, actions, and linked work.
6. A PR notification opening the PRs detail.
7. An issue notification opening the Issues detail.
8. An unsupported GitHub URL opening in the in-app browser.
9. A general familiar following a legacy GitHub request and seeing the
   closed-room state without a familiar switch or external navigation.
10. Coven dark, Coven light, and one non-default palette.

Expected: no standalone GitHub row exists; all former GitHub workflows are
reachable inside Code Workshop; tab overflow, keyboard focus, and closed-room
copy remain usable at narrow width.

- [ ] **Step 6: Record verification evidence in Beads**

Run:

```bash
bd update cave-p2efm --append-notes \
  "Implementation completed on feat/github-into-code-workshop in .worktrees/feat-github-into-code-workshop. Verification: focused navigation/Workspace/sidebar/warmup tests, Code Workshop Playwright suite, test registration, typecheck, lint/design gates, design-token drift, full app suite, production build/budgets, and real-app coverage of Activity/PRs/Issues/Reviews, deep links, unsupported URL fallback, narrow layout, themes, and wrong-role closed-room behavior."
```

Expected: Bead `cave-p2efm` remains in progress until merge or explicit
completion criteria, with branch, worktree, owner, and verification evidence
recorded.

- [ ] **Step 7: Run the worktree lifecycle report before PR handoff**

Run:

```bash
pnpm beads:worktrees
git status --short --branch
```

Expected: the report classifies every local worktree; this feature worktree is
recorded as intentionally preserved for PR review, and the branch is clean.
