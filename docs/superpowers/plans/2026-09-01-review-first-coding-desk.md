# Review-First Coding Desk Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Coding Desk default to a minimal, actionable queue of human-created sessions in verified GitHub repositories outside familiar workspaces, while preserving explicit access to every other local session.

**Architecture:** Extend the existing bounded session enrichment with sanitized GitHub repository identity and trusted familiar-workspace classification. Build one pure review-queue model that owns eligibility, priority, grouping, and counts; both the session rail and header picker consume that model. Preserve existing deep-link types and GitHub readers while simplifying their presentation into Review, Work, and GitHub layers.

**Tech Stack:** TypeScript, React 19, Next.js 16, Node.js test runner, Playwright, Tailwind utilities, semantic CSS tokens, bounded `git` subprocess enrichment.

---

## File structure

### New files

- `src/lib/code-review-queue.ts`
  - Pure eligibility, exclusion, priority, sorting, repository grouping, and
    selected-session override logic.
- `src/lib/code-review-queue.test.ts`
  - Exhaustive model tests independent of React.
- `src/components/code-review-queue-controls.tsx`
  - Shared Reviewable / All local switch and excluded-session count action.
- `src/components/code-review-queue-controls.test.tsx`
  - Accessible control behavior.

### Modified files

- `src/lib/types.ts`
  - Add sanitized repository identity and familiar-workspace classification to
    session rows.
- `src/lib/session-git-enrich.ts`
  - Resolve and normalize `remote.origin.url` through the existing bounded Git
    runner.
- `src/lib/session-git-enrich.test.ts`
  - Cover GitHub, non-GitHub, malformed, and credential-bearing remotes.
- `src/lib/familiar-workspace-sessions.ts`
  - Add a pure annotation helper in addition to the existing collapse helper.
- `src/lib/familiar-workspace-sessions.test.ts`
  - Cover trusted annotation and relocated roots.
- `src/lib/server/sessions-list.ts`
  - Optionally annotate familiar-workspace membership.
- `src/app/api/sessions/list/route.ts`
  - Parse and cache the classification request.
- `src/lib/server/sessions-list.test.ts`
  - Prove route-facing classification is opt-in and read-only.
- `src/components/workspace.tsx`
  - Request classification for the shared live session list.
- `src/lib/code-session-picker.ts`
  - Consume precomputed review groups instead of independently filtering.
- `src/lib/code-session-picker.test.ts`
  - Prove picker and rail receive identical queue ordering.
- `src/components/code-session-picker.tsx`
  - Render the shared queue mode and compact repository-first rows.
- `src/components/code-session-rail.tsx`
  - Render the same model and queue controls.
- `src/components/code-view.tsx`
  - Own queue mode, simplify top-level navigation, preserve filtered deep-link
    overrides, and add queue keyboard navigation.
- `src/components/code-workbench.tsx`
  - Pass queue state into the picker and use content-aware panel defaults.
- `src/components/code-surface-mode.test.ts`
  - Pin the simplified navigation and shared queue wiring.
- `src/styles/globals/surface-code-room.css`
  - Compact queue controls and rows using existing semantic tokens.
- `tests/code-surface.spec.ts`
  - Exercise default eligibility, All local, repository grouping, top-level
    navigation, and deep-link overrides.
- `scripts/run-tests.mjs`
  - Register new unit/component tests.

## Task 1: Add verified GitHub repository identity

**Files:**
- Modify: `src/lib/types.ts`
- Modify: `src/lib/session-git-enrich.ts`
- Modify: `src/lib/session-git-enrich.test.ts`

- [ ] **Step 1: Write failing enrichment tests**

Add `remote.origin.url` responses to `REPO_SCRIPT` and assert canonical identity:

```ts
const REPO_SCRIPT = {
  "rev-parse --is-inside-work-tree": "true",
  "branch --show-current": "feat/thing",
  "rev-parse --show-toplevel": (root) => root,
  "rev-parse --git-dir": ".git",
  "rev-parse --git-common-dir": ".git",
  "config --get remote.origin.url": "git@github.com:acme/repo-a.git",
  "symbolic-ref --short refs/remotes/origin/HEAD": "origin/main",
  "diff origin/main...feat/thing --shortstat":
    " 3 files changed, 10 insertions(+), 2 deletions(-)",
};

assert.equal(rows[0].git.repositoryUrl, "https://github.com/acme/repo-a");
```

Add separate cases where the runner returns:

```ts
"https://token@github.com/acme/private.git"
"https://gitlab.com/acme/repo-a.git"
"not a remote"
null
```

Each must leave `repositoryUrl` absent while preserving valid branch/worktree
context.

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
node --test --experimental-strip-types src/lib/session-git-enrich.test.ts
```

Expected: FAIL because `SessionGitContext` has no `repositoryUrl` and the
enricher does not query `remote.origin.url`.

- [ ] **Step 3: Add the typed field and bounded origin probe**

In `src/lib/types.ts`:

```ts
export type SessionGitContext = {
  branch?: string | null;
  worktreeRoot?: string | null;
  isWorktree?: boolean;
  repositoryRoot?: string | null;
  /** Canonical GitHub origin; absent for missing, malformed, credential-bearing, or non-GitHub remotes. */
  repositoryUrl?: string | null;
};
```

In `src/lib/session-git-enrich.ts`, import the existing sanitizer:

```ts
import { normalizeGitHubRepoUrl } from "./github-repo-link.ts";
```

Read the independent repository facts together:

```ts
const [currentBranch, worktreeRoot, gitDirRaw, commonDirRaw, originRemote] =
  await Promise.all([
    git(trimmed, ["branch", "--show-current"]),
    git(trimmed, ["rev-parse", "--show-toplevel"]),
    git(trimmed, ["rev-parse", "--git-dir"]),
    git(trimmed, ["rev-parse", "--git-common-dir"]),
    git(trimmed, ["config", "--get", "remote.origin.url"]),
  ]);
const repositoryUrl = normalizeGitHubRepoUrl(originRemote);
```

Return `repositoryUrl` only when normalization succeeds:

```ts
return {
  branch,
  worktreeRoot,
  isWorktree,
  ...(repositoryRoot ? { repositoryRoot } : {}),
  ...(repositoryUrl ? { repositoryUrl } : {}),
};
```

- [ ] **Step 4: Run focused validation**

Run:

```bash
node --test --experimental-strip-types src/lib/session-git-enrich.test.ts
pnpm typecheck
```

Expected: all enrichment tests pass and TypeScript reports no errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/types.ts src/lib/session-git-enrich.ts src/lib/session-git-enrich.test.ts
git commit -m "feat(code): identify GitHub repository sessions"
```

## Task 2: Classify familiar workspace sessions

**Files:**
- Modify: `src/lib/types.ts`
- Modify: `src/lib/familiar-workspace-sessions.ts`
- Modify: `src/lib/familiar-workspace-sessions.test.ts`
- Modify: `src/lib/server/sessions-list.ts`
- Modify: `src/app/api/sessions/list/route.ts`
- Modify: `src/lib/server/sessions-list.test.ts`
- Modify: `src/components/workspace.tsx`

- [ ] **Step 1: Write failing pure classification tests**

Add:

```ts
const classified = classifyFamiliarWorkspaceSessions(
  [
    row("workspace", `${WS_ROOT}/nova`),
    row("relocated", "/opt/coven/nova-ws/notes"),
    row("project", "/home/test/Documents/GitHub/acme/repo"),
    row("rootless", ""),
  ],
  WS_ROOT,
  ["/opt/coven/nova-ws"],
);

assert.deepEqual(
  classified.map(({ id, familiarWorkspace }) => ({ id, familiarWorkspace })),
  [
    { id: "workspace", familiarWorkspace: true },
    { id: "relocated", familiarWorkspace: true },
    { id: "project", familiarWorkspace: false },
    { id: "rootless", familiarWorkspace: false },
  ],
);
```

- [ ] **Step 2: Run the pure test and verify RED**

Run:

```bash
node --test --experimental-strip-types src/lib/familiar-workspace-sessions.test.ts
```

Expected: FAIL because `classifyFamiliarWorkspaceSessions` does not exist.

- [ ] **Step 3: Add the classification field and helper**

In `SessionRow`:

```ts
/** Trusted server classification; true only for configured familiar workspace roots. */
familiarWorkspace?: boolean;
```

In `familiar-workspace-sessions.ts`:

```ts
export function classifyFamiliarWorkspaceSessions(
  sessions: SessionRow[],
  familiarWorkspacesRoot: string,
  declaredWorkspaceRoots: readonly string[] = [],
): SessionRow[] {
  const prefixes = normalizeFamiliarWorkspacePrefixes(
    familiarWorkspacesRoot,
    declaredWorkspaceRoots,
  );
  return sessions.map((session) => ({
    ...session,
    familiarWorkspace: matchesFamiliarWorkspacePrefix(
      session.project_root,
      prefixes,
    ),
  }));
}
```

Refactor `collapseFamiliarWorkspaceSessions()` to call the same normalized
prefix logic without changing its existing result.

- [ ] **Step 4: Write failing sessions-list option tests**

Extend `ComputeSessionsListOptions` test coverage to prove:

```ts
await computeSessionsList(false, "nova", false, {
  classifyFamiliarWorkspace: true,
});
```

returns `familiarWorkspace: true` for a configured familiar workspace and
`false` for a project session, without invoking either archive sweep beyond the
existing defaults.

Also assert the route cache key differs between:

```text
active:nova:full:classified
active:nova:full:unclassified
```

- [ ] **Step 5: Implement opt-in server classification**

Extend the options:

```ts
export type ComputeSessionsListOptions = {
  sweepArchives?: boolean;
  enrichGit?: boolean;
  classifyFamiliarWorkspace?: boolean;
};
```

Add one helper in `sessions-list.ts`:

```ts
async function applyFamiliarWorkspaceClassification(
  sessions: SessionRow[],
  enabled: boolean,
): Promise<SessionRow[]> {
  if (!enabled) return sessions;
  return classifyFamiliarWorkspaceSessions(
    sessions,
    familiarWorkspacesRoot(),
    Array.from((await readFamiliarWorkspaces()).values()),
  );
}
```

Apply it after familiar scoping and before returning both normal and degraded
payloads.

Parse `classifyFamiliarWorkspace=1` in the route, include it in the cache key,
and pass it through the options bag.

- [ ] **Step 6: Request classification from Workspace**

Replace the mutually exclusive query construction with:

```ts
const params = new URLSearchParams({ classifyFamiliarWorkspace: "1" });
if (capturedActiveId) params.set("familiarId", capturedActiveId);
else params.set("collapseFamiliarWorkspace", "1");
const sessionsResult = await fetch(`/api/sessions/list?${params}`, {
  cache: "no-store",
});
```

This adds metadata to scoped views without changing global Chat visibility.

- [ ] **Step 7: Run focused validation**

Run:

```bash
node --test --experimental-strip-types \
  src/lib/familiar-workspace-sessions.test.ts \
  src/lib/server/sessions-list.test.ts
pnpm typecheck
```

Expected: all tests pass.

- [ ] **Step 8: Commit**

```bash
git add src/lib/types.ts src/lib/familiar-workspace-sessions.ts \
  src/lib/familiar-workspace-sessions.test.ts src/lib/server/sessions-list.ts \
  src/app/api/sessions/list/route.ts src/lib/server/sessions-list.test.ts \
  src/components/workspace.tsx
git commit -m "feat(code): classify familiar workspace sessions"
```

## Task 3: Build the shared review queue model

**Files:**
- Create: `src/lib/code-review-queue.ts`
- Create: `src/lib/code-review-queue.test.ts`
- Modify: `scripts/run-tests.mjs`

- [ ] **Step 1: Write failing eligibility and ordering tests**

Use a typed fixture with valid GitHub identity:

```ts
function reviewableRow(over: Partial<SessionRow> = {}): SessionRow {
  return row({
    project_root: "/repo/acme-app",
    git: {
      branch: "main",
      worktreeRoot: "/repo/acme-app",
      isWorktree: false,
      repositoryUrl: "https://github.com/acme/app",
    },
    familiarWorkspace: false,
    ...over,
  });
}
```

Assert Reviewable excludes:

```ts
archived_at !== null
generated === true
project_root === ""
git == null
git.repositoryUrl == null
familiarWorkspace !== false
```

The last rule is deliberately fail-closed: missing trusted classification
stays in All local.

Assert linked worktrees remain eligible:

```ts
assert.equal(
  codeSessionEligibility(
    reviewableRow({
      git: {
        branch: "feat/a",
        worktreeRoot: "/repo/app/.worktrees/a",
        isWorktree: true,
        repositoryRoot: "/repo/app",
        repositoryUrl: "https://github.com/acme/app",
      },
    }),
  ).reviewable,
  true,
);
```

Create rows for each priority and assert this order:

```ts
["failed", "open-pr-changed", "running", "changed-idle", "clean-idle"]
```

Assert repository groups use `acme/app`, sort by their best session, and the
selected-session override includes an otherwise excluded deep-linked row with
`outsideCurrentFilter: true`.

- [ ] **Step 2: Run the model test and verify RED**

Run:

```bash
node --test --experimental-strip-types src/lib/code-review-queue.test.ts
```

Expected: FAIL because the model does not exist.

- [ ] **Step 3: Implement the pure model**

Define:

```ts
export type CodeQueueMode = "reviewable" | "all";

export type CodeSessionEligibility = {
  reviewable: boolean;
  reason:
    | "eligible"
    | "archived"
    | "generated"
    | "rootless"
    | "unverified_git"
    | "non_github"
    | "workspace_unclassified"
    | "familiar_workspace";
};

export type CodeReviewQueue = {
  groups: CodeReviewGroup[];
  sessions: SessionRow[];
  reviewableCount: number;
  allLocalCount: number;
  excludedCount: number;
  outsideCurrentFilter: boolean;
};
```

Use `gitHubRepoSlug()` for Reviewable group labels and the existing project
basename behavior for All local.

Priority must be a pure numeric function:

```ts
function reviewPriority(row: SessionRow): number {
  if (codeSessionActivity(row) === "error") return 0;
  if (
    row.pullRequest &&
    (row.pullRequest.state ?? "open").toLowerCase() === "open" &&
    codeSessionDiffstat(row)
  ) return 1;
  if (codeSessionActivity(row) === "running") return 2;
  if (codeSessionDiffstat(row)) return 3;
  return 4;
}
```

Sort by priority, then descending `updated_at`, then stable `id`.

- [ ] **Step 4: Preserve generic Code visibility without a dependency cycle**

Import and call the existing `isCodeRailSession()` from the new queue model.
Do not import `codeReviewQueue()` back into `code-surface.ts`; that would create
a cycle because the queue also uses `codeSessionActivity()` and
`codeSessionDiffstat()`.

The All local branch begins with:

```ts
const allLocal = rows.filter(isCodeRailSession);
const visible =
  mode === "reviewable"
    ? allLocal.filter((row) => codeSessionEligibility(row).reviewable)
    : allLocal;
```

Existing `groupCodeRailSessions()` and its rootless-session tests remain
unchanged for non-Desk callers.

- [ ] **Step 5: Register and run tests**

Add `src/lib/code-review-queue.test.ts` beside the other Code model tests in
`scripts/run-tests.mjs`.

Run:

```bash
node --test --experimental-strip-types \
  src/lib/code-review-queue.test.ts
pnpm check:tests-wired
pnpm typecheck
```

Expected: all tests pass and the new test is wired.

- [ ] **Step 6: Commit**

```bash
git add src/lib/code-review-queue.ts src/lib/code-review-queue.test.ts \
  scripts/run-tests.mjs
git commit -m "feat(code): add review-first session queue"
```

## Task 4: Share queue controls between rail and picker

**Files:**
- Create: `src/components/code-review-queue-controls.tsx`
- Create: `src/components/code-review-queue-controls.test.tsx`
- Modify: `src/lib/code-session-picker.ts`
- Modify: `src/lib/code-session-picker.test.ts`
- Modify: `src/components/code-session-picker.tsx`
- Modify: `src/components/code-session-rail.tsx`
- Modify: `src/components/code-view.tsx`
- Modify: `src/components/code-workbench.tsx`
- Modify: `src/styles/globals/surface-code-room.css`
- Modify: `scripts/run-tests.mjs`

- [ ] **Step 1: Write failing control behavior tests**

Render:

```tsx
<CodeReviewQueueControls
  mode="reviewable"
  reviewableCount={3}
  allLocalCount={7}
  onModeChange={onModeChange}
/>
```

Assert:

- `Reviewable 3` has `aria-pressed="true"`;
- `All local 7` has `aria-pressed="false"`;
- activating All local calls `onModeChange("all")`;
- both buttons have accessible names without relying on icon color.

- [ ] **Step 2: Run the component test and verify RED**

Run:

```bash
node --test --experimental-strip-types src/components/code-review-queue-controls.test.tsx
```

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement the shared control**

Use two compact buttons:

```tsx
export function CodeReviewQueueControls(props: CodeReviewQueueControlsProps) {
  return (
    <div className="code-queue-filter" role="group" aria-label="Session scope">
      <button
        type="button"
        aria-pressed={props.mode === "reviewable"}
        onClick={() => props.onModeChange("reviewable")}
      >
        Reviewable <span>{props.reviewableCount}</span>
      </button>
      <button
        type="button"
        aria-pressed={props.mode === "all"}
        onClick={() => props.onModeChange("all")}
      >
        All local <span>{props.allLocalCount}</span>
      </button>
    </div>
  );
}
```

Use existing focus classes and semantic tokens. Do not add new palette values.

- [ ] **Step 4: Make CodeView own queue state**

Add:

```ts
const [queueMode, setQueueMode] = useState<CodeQueueMode>("reviewable");
const queue = useMemo(
  () => codeReviewQueue(sessions, queueMode, selectedId ?? deepLink?.sessionId ?? null),
  [sessions, queueMode, selectedId, deepLink?.sessionId],
);
```

Replace `groupCodeRailSessions(sessions)` with `queue.groups`, and use those
same groups for auto-selection and pending-open resolution.

Pass `queue`, `queueMode`, and `setQueueMode` to the rail and selected
workbench. Do not persist `queueMode`.

- [ ] **Step 5: Make picker and rail consume the same queue**

Change both components to accept precomputed `CodeReviewQueue`. Neither
component may call `groupCodeRailSessions()` or independently decide
eligibility.

The picker may still apply its text and repository-chip filters to
`queue.sessions`, but it must preserve queue order.

Render `CodeReviewQueueControls`:

- at the top of the open rail;
- below the search field in the picker.

Add `data-code-session-search=""` to the picker input so the queue-level `/`
shortcut has a stable, non-styling focus target.

When `queue.outsideCurrentFilter` is true, render:

```tsx
<span className="code-queue-filter__notice">Outside current filter</span>
```

- [ ] **Step 6: Compact the row hierarchy**

For open rail rows:

```tsx
<span className="code-session-row__title">{title}</span>
<span className="code-session-row__meta">
  {branch}
  {diffstat}
  {row.pullRequest ? <PrChip ... /> : null}
  <span>{relativeTime(row.updated_at)}</span>
</span>
```

Use one textual status treatment in the accessible name. Remove the open-row
activity dot; retain a small state mark only in the collapsed icon rail where
there is no room for text.

- [ ] **Step 7: Update focused tests**

Add picker-model parity assertions:

```ts
assert.deepEqual(
  picker.groups.flatMap((group) => group.sessions.map((row) => row.id)),
  queue.sessions.map((row) => row.id),
);
```

Run:

```bash
node --test --experimental-strip-types \
  src/components/code-review-queue-controls.test.tsx \
  src/lib/code-session-picker.test.ts \
  src/components/code-surface-mode.test.ts
pnpm lint:design
pnpm typecheck
```

Expected: all tests pass with no lint warnings.

- [ ] **Step 8: Commit**

```bash
git add src/components/code-review-queue-controls.tsx \
  src/components/code-review-queue-controls.test.tsx \
  src/lib/code-session-picker.ts src/lib/code-session-picker.test.ts \
  src/components/code-session-picker.tsx src/components/code-session-rail.tsx \
  src/components/code-view.tsx src/components/code-workbench.tsx \
  src/styles/globals/surface-code-room.css scripts/run-tests.mjs
git commit -m "feat(code): share review queue across the desk"
```

## Task 5: Simplify top-level navigation

**Files:**
- Modify: `src/components/code-view.tsx`
- Modify: `src/components/code-surface-mode.test.ts`
- Modify: `tests/code-surface.spec.ts`

- [ ] **Step 1: Write failing navigation tests**

Assert the top tablist exposes only:

```text
Review
Work
GitHub
```

When GitHub is selected, assert a secondary tablist named `GitHub filter`
contains:

```text
Activity
PRs
Issues
Reviews
```

Assert deep links with `ctab=prs`, `ctab=issues`, and `ctab=reviews` select the
GitHub top-level tab and the corresponding secondary filter.

- [ ] **Step 2: Run the tests and verify RED**

Run:

```bash
node --test --experimental-strip-types src/components/code-surface-mode.test.ts
pnpm exec playwright test tests/code-surface.spec.ts --project=chromium --grep "top tabs"
```

Expected: FAIL because six top-level tabs are still rendered.

- [ ] **Step 3: Render three primary destinations**

Keep the existing `CodeTopTab` values to preserve URL compatibility. Render:

```tsx
<PrimaryTab selected={topTab === "sessions"} onSelect={() => setTopTab("sessions")}>
  Review
</PrimaryTab>
<PrimaryTab selected={topTab === "work"} onSelect={() => setTopTab("work")}>
  Work
</PrimaryTab>
<PrimaryTab
  selected={githubTab !== null}
  onSelect={() => setTopTab(githubTab ?? "activity")}
>
  GitHub
</PrimaryTab>
```

When `githubTab` is non-null, render the existing `CODE_GITHUB_TABS` as a
secondary tablist and continue passing `GITHUB_TAB_FILTER[githubTab]` to
`GitHubView`.

- [ ] **Step 4: Preserve pending navigation**

Do not change `topTabForNavigation()`, `parseCodeDeepLink()`, or
`codeTopTabForGitHubTarget()`. Their existing values continue to select the
secondary GitHub filter.

- [ ] **Step 5: Run focused validation**

Run:

```bash
node --test --experimental-strip-types src/components/code-surface-mode.test.ts
pnpm exec playwright test tests/code-surface.spec.ts --project=chromium \
  --grep "code surface|legacy GitHub mode"
pnpm typecheck
```

Expected: all focused tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/components/code-view.tsx \
  src/components/code-surface-mode.test.ts tests/code-surface.spec.ts
git commit -m "refactor(code): simplify Coding Desk navigation"
```

## Task 6: Add content-aware panel defaults and queue keyboard flow

**Files:**
- Modify: `src/components/code-view.tsx`
- Modify: `src/components/code-workbench.tsx`
- Modify: `src/components/code-surface-mode.test.ts`
- Modify: `tests/code-surface.spec.ts`

- [ ] **Step 1: Write failing queue keyboard tests**

In `code-surface-mode.test.ts`, assert `CodeView`:

- imports the existing `isCodeShortcutTarget()` guard;
- opens `.code-picker__trigger` and focuses `[data-code-session-search]` for
  `/`;
- moves DOM focus between `[data-code-session-id]` rows for `j` and `k`;
- toggles Reviewable / All local for `Shift+A`;
- returns before handling keys when `isCodeShortcutTarget()` rejects the
  target.

In Playwright, focus the queue, press `j`, `k`, and `Enter`, then assert the
expected row opens. Focus the session-search input and assert typing `j`, `k`,
and `/` changes the query rather than navigating.

- [ ] **Step 2: Run keyboard tests and verify RED**

Run:

```bash
node --test --experimental-strip-types src/components/code-surface-mode.test.ts
pnpm exec playwright test tests/code-surface.spec.ts --project=chromium \
  --grep "queue keyboard"
```

Expected: FAIL because CodeView has no queue-level keyboard handler.

- [ ] **Step 3: Implement queue keyboard navigation**

In `CodeView`, reuse `isCodeShortcutTarget()` and handle only unmodified `/`,
`j`, `k`, plus `Shift+A`. Open the picker before focusing its search:

```ts
if (event.key === "/" && !event.metaKey && !event.ctrlKey && !event.altKey) {
  event.preventDefault();
  roomRef.current
    ?.querySelector<HTMLButtonElement>(".code-picker__trigger")
    ?.click();
  requestAnimationFrame(() => {
    roomRef.current
      ?.querySelector<HTMLInputElement>("[data-code-session-search]")
      ?.focus();
  });
} else if (event.key.toLowerCase() === "j" && !event.shiftKey) {
  moveQueueFocus(1);
} else if (event.key.toLowerCase() === "k" && !event.shiftKey) {
  moveQueueFocus(-1);
} else if (event.key.toLowerCase() === "a" && event.shiftKey) {
  setQueueMode((mode) => (mode === "reviewable" ? "all" : "reviewable"));
}
```

`moveQueueFocus()` queries visible `[data-code-session-id]` buttons, moves from
the active row with wraparound, and calls `.focus()`. Rail rows retain native
button Enter behavior, which uses the existing `onSelect()` path.

- [ ] **Step 4: Write failing panel-default tests**

Assert:

- a clean session with no pull request initializes `railOpen` false;
- a session with `diff` or an open pull request initializes `railOpen` true;
- an explicit user toggle is remembered per session ID;
- terminal open state is remembered per session ID;
- routed file/diff navigation still overrides the stored state and opens the
  required panel.

- [ ] **Step 5: Implement per-session panel state**

Use refs keyed by session ID:

```ts
const railOpenBySession = useRef(new Map<string, boolean>());
const terminalOpenBySession = useRef(new Map<string, boolean>());

function defaultRailOpen(session: SessionRow): boolean {
  return Boolean(codeSessionDiffstat(session) || session.pullRequest);
}
```

On session change, read the stored value or `defaultRailOpen(row)`. Every
explicit rail/terminal toggle writes the current session's value. Existing
routed-open effects remain authoritative.

- [ ] **Step 6: Run focused validation**

Run:

```bash
node --test --experimental-strip-types \
  src/components/code-surface-mode.test.ts
pnpm exec playwright test tests/code-surface.spec.ts --project=chromium \
  --grep "queue|review rail|terminal"
pnpm lint:design
pnpm typecheck
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/components/code-view.tsx src/components/code-workbench.tsx \
  src/components/code-surface-mode.test.ts tests/code-surface.spec.ts
git commit -m "feat(code): streamline Coding Desk review flow"
```

## Task 7: End-to-end acceptance and documentation

**Files:**
- Modify: `tests/code-surface.spec.ts`
- Modify: `docs/role-surfaces.md`
- Modify: `docs/superpowers/specs/2026-09-01-review-first-coding-desk-design.md`

- [ ] **Step 1: Add the complete E2E fixture matrix**

Create sessions for:

```ts
const reviewable = mkSession({
  id: "reviewable",
  project_root: "/repo/alpha",
  git: {
    branch: "feat/alpha",
    worktreeRoot: "/repo/alpha/.worktrees/alpha",
    isWorktree: true,
    repositoryRoot: "/repo/alpha",
    repositoryUrl: "https://github.com/acme/alpha",
  },
  familiarWorkspace: false,
});

const familiarWorkspace = mkSession({
  id: "workspace",
  project_root: "/home/test/.coven/workspaces/familiars/nova",
  familiarWorkspace: true,
});

const nonGithub = mkSession({
  id: "gitlab",
  project_root: "/repo/gitlab",
  git: { branch: "main", isWorktree: false },
  familiarWorkspace: false,
});

const rootless = mkSession({ id: "rootless", project_root: "" });
```

- [ ] **Step 2: Assert the default and explicit escape hatch**

Verify:

- only `reviewable` appears on initial load;
- the repository heading is `acme/alpha`;
- `All local` reveals workspace, non-GitHub, and rootless sessions;
- returning to Reviewable hides them;
- a deep link to `gitlab` opens it with `Outside current filter`;
- reloading resets to Reviewable.

- [ ] **Step 3: Update product documentation**

Document in `docs/role-surfaces.md`:

```md
The Coding Desk opens in Reviewable mode. A reviewable session is active,
human-created, outside configured familiar workspaces, inside a Git work tree,
and attached to a canonical GitHub origin. All local sessions remain available
through the explicit All local scope.
```

Update the design document only if implementation names differ; preserve every
eligibility and fail-closed rule.

- [ ] **Step 4: Run the complete targeted gate**

Run:

```bash
pnpm check:tests-wired
pnpm test:app
pnpm exec playwright test tests/code-surface.spec.ts --project=chromium
pnpm lint
pnpm typecheck
pnpm build
git diff --check
```

Expected: every command succeeds with no new warnings.

- [ ] **Step 5: Request code review**

Review the full branch diff from `origin/main` through `HEAD`, specifically for:

- sessions incorrectly hidden from All local;
- non-GitHub or credential-bearing remotes entering Reviewable;
- familiar-workspace classification bypass;
- deep links that become unreachable;
- keyboard handlers stealing input or terminal keys;
- panel state leaking between sessions;
- mobile/narrow layout regressions.

- [ ] **Step 6: Commit acceptance updates**

```bash
git add tests/code-surface.spec.ts docs/role-surfaces.md \
  docs/superpowers/specs/2026-09-01-review-first-coding-desk-design.md
git commit -m "test(code): verify review-first Coding Desk"
```

## Completion criteria

- Reviewable is the non-persisted default on every Coding Desk entry.
- Reviewable contains only active, human-created sessions with trusted
  non-workspace classification and canonical GitHub origin.
- Linked Git worktrees remain visible.
- All local preserves every session allowed by the previous generic Code
  visibility rule.
- Rail and picker use one queue result and cannot drift.
- Review ordering reflects actionable state before recency.
- Review, Work, and GitHub are the only primary destinations.
- Existing GitHub deep links and pending file/diff navigation remain valid.
- Empty panels do not consume full-width space by default.
- Queue shortcuts never capture text-entry or terminal keystrokes.
- Focused unit, E2E, lint, typecheck, and build gates pass.
