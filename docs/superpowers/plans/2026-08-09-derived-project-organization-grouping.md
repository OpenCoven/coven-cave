# Derived Project Organization Grouping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a derived organization level above projects in the Chat rail and Projects hub without changing persisted project data.

**Architecture:** A client-safe `project-organizations.ts` module derives organization identity from GitHub owner or parent directory and groups both `CaveProject` and `ChatProjectGroup` values. Existing project/session identity, selection, ordering, drag/drop, and access mutation stay unchanged; React surfaces only compose the new hierarchy.

**Tech Stack:** TypeScript, React 19, Next.js, Tailwind utilities, Node test runner, existing Cave design primitives.

---

## File map

- Create `src/lib/project-organizations.ts`: organization derivation, keys, grouping, and ordering.
- Create `src/lib/project-organizations.test.ts`: pure derivation and ordering tests.
- Modify `src/lib/chat-projects.ts`: attach derived organization metadata to each chat project group.
- Modify `src/lib/chat-projects.test.ts`: pin registered/unregistered grouping behavior.
- Modify `src/lib/chat-project-selection.ts`: persist organization disclosure keys with project keys.
- Modify `src/lib/chat-project-selection.test.ts`: pin default and auto-expansion keys.
- Modify `src/components/chat-project-sidebar.tsx`: render organization → project → chat.
- Modify `src/components/chat-thread-rail.test.ts`: pin nested disclosure, search, and drag contracts.
- Modify `src/components/chat-all-familiars-project-list.test.ts`: pin full-row organization/project accessibility.
- Modify `src/components/projects-view.tsx`: group Grid cards by derived organization.
- Modify `src/components/projects-view.test.ts`: replace workspace/repository section assertions with organization assertions.

### Task 1: Derive and group project organizations

**Files:**
- Create: `src/lib/project-organizations.ts`
- Create: `src/lib/project-organizations.test.ts`

- [ ] **Step 1: Write the failing pure tests**

Create `src/lib/project-organizations.test.ts`:

```ts
// @ts-nocheck
import assert from "node:assert/strict";
import {
  NO_PROJECT_ORGANIZATION,
  chatProjectOrganizationGroups,
  organizationExpansionKey,
  projectOrganization,
  projectOrganizationGroups,
} from "./project-organizations.ts";

const project = (patch = {}) => ({
  id: "p",
  name: "Project",
  root: "/Users/buns/Documents/GitHub/OpenCoven/coven-cave",
  createdAt: "2026-08-09T00:00:00Z",
  updatedAt: "2026-08-09T00:00:00Z",
  ...patch,
});

assert.deepEqual(
  projectOrganization(project({ repoUrl: "https://github.com/OpenCoven/coven-cave" })),
  { key: "opencoven", label: "OpenCoven", source: "github" },
);
assert.deepEqual(
  projectOrganization(project({ repoUrl: undefined })),
  { key: "opencoven", label: "OpenCoven", source: "path" },
);
assert.deepEqual(
  projectOrganization(project({ root: "C:\\repos\\Coven\\app", repoUrl: undefined })),
  { key: "coven", label: "Coven", source: "path" },
);
assert.deepEqual(
  projectOrganization(project({ root: "/app", repoUrl: "not github" })),
  NO_PROJECT_ORGANIZATION,
);
assert.equal(organizationExpansionKey("opencoven"), "org:opencoven");

const groupedProjects = projectOrganizationGroups([
  project({ id: "b", name: "Beta", root: "/work/OpenCoven/beta" }),
  project({ id: "a", name: "Alpha", root: "/work/opencoven/alpha" }),
  project({ id: "none", name: "Root", root: "/root" }),
]);
assert.deepEqual(
  groupedProjects.map((group) => [group.label, group.items.map((item) => item.name)]),
  [["OpenCoven", ["Alpha", "Beta"]], ["No organization", ["Root"]]],
);

const groupedChats = chatProjectOrganizationGroups([
  {
    projectId: "old",
    projectRoot: "/work/OpenCoven/old",
    projectName: "Old",
    projectColor: null,
    sessions: [],
    defaultFamiliarId: null,
    updatedAt: "2026-08-08T00:00:00Z",
    organization: { key: "opencoven", label: "OpenCoven", source: "path" },
  },
  {
    projectId: "new",
    projectRoot: "/work/Elsewhere/new",
    projectName: "New",
    projectColor: null,
    sessions: [],
    defaultFamiliarId: null,
    updatedAt: "2026-08-09T00:00:00Z",
    organization: { key: "elsewhere", label: "Elsewhere", source: "path" },
  },
  {
    projectId: null,
    projectRoot: null,
    projectName: null,
    projectColor: null,
    sessions: [],
    defaultFamiliarId: null,
    updatedAt: "2026-08-10T00:00:00Z",
    organization: NO_PROJECT_ORGANIZATION,
  },
]);
assert.deepEqual(
  groupedChats.map((group) => group.label),
  ["Elsewhere", "OpenCoven", "No organization"],
);

console.log("project-organizations.test.ts: ok");
```

- [ ] **Step 2: Run the test and verify failure**

Run:

```bash
node --experimental-strip-types --import ./scripts/test-alias-register.mjs \
  --test src/lib/project-organizations.test.ts
```

Expected: FAIL because `project-organizations.ts` does not exist.

- [ ] **Step 3: Implement the pure module**

Create `src/lib/project-organizations.ts`:

```ts
import type { CaveProject } from "./cave-projects-types.ts";
import type { ChatProjectGroup } from "./chat-projects.ts";
import { compareProjectsAlphabetically, normalizeProjectRoot } from "./cave-projects-types.ts";
import { gitHubRepoSlug } from "./github-repo-link.ts";

export type ProjectOrganization = {
  key: string;
  label: string;
  source: "github" | "path" | "none";
};

export type ProjectOrganizationGroup<T> = ProjectOrganization & {
  items: T[];
  updatedAt: string | null;
};

export const NO_PROJECT_ORGANIZATION: ProjectOrganization = {
  key: "none",
  label: "No organization",
  source: "none",
};

function organization(label: string, source: "github" | "path"): ProjectOrganization {
  return { key: label.toLowerCase(), label, source };
}

export function projectOrganization(
  project: Pick<CaveProject, "root" | "repoUrl"> | null | undefined,
): ProjectOrganization {
  if (!project) return NO_PROJECT_ORGANIZATION;
  const slug = gitHubRepoSlug(project.repoUrl);
  const owner = slug?.split("/")[0];
  if (owner) return organization(owner, "github");

  const parts = normalizeProjectRoot(project.root).split("/").filter(Boolean);
  const parent = parts.length >= 2 ? parts.at(-2) : null;
  return parent ? organization(parent, "path") : NO_PROJECT_ORGANIZATION;
}

export function organizationExpansionKey(key: string): string {
  return `org:${key}`;
}

export function projectOrganizationGroups(
  projects: readonly CaveProject[],
): ProjectOrganizationGroup<CaveProject>[] {
  const groups = new Map<string, ProjectOrganizationGroup<CaveProject>>();
  for (const project of projects) {
    const org = projectOrganization(project);
    const group = groups.get(org.key) ?? { ...org, items: [], updatedAt: null };
    group.items.push(project);
    groups.set(org.key, group);
  }
  return [...groups.values()]
    .map((group) => ({ ...group, items: group.items.sort(compareProjectsAlphabetically) }))
    .sort((a, b) => {
      if (a.source === "none") return 1;
      if (b.source === "none") return -1;
      return a.label.localeCompare(b.label, undefined, { sensitivity: "base", numeric: true });
    });
}

export function chatProjectOrganizationGroups(
  projectGroups: readonly ChatProjectGroup[],
): ProjectOrganizationGroup<ChatProjectGroup>[] {
  const groups = new Map<string, ProjectOrganizationGroup<ChatProjectGroup>>();
  for (const projectGroup of projectGroups) {
    const org = projectGroup.organization;
    const group = groups.get(org.key) ?? { ...org, items: [], updatedAt: null };
    group.items.push(projectGroup);
    if ((projectGroup.updatedAt ?? "") > (group.updatedAt ?? "")) {
      group.updatedAt = projectGroup.updatedAt;
    }
    groups.set(org.key, group);
  }
  return [...groups.values()].sort((a, b) => {
    if (a.source === "none") return 1;
    if (b.source === "none") return -1;
    const byRecency = (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "");
    return byRecency || a.label.localeCompare(b.label, undefined, { sensitivity: "base" });
  });
}
```

- [ ] **Step 4: Run the pure test**

Run the Step 2 command.

Expected: PASS and `project-organizations.test.ts: ok`.

- [ ] **Step 5: Commit the pure organization module**

```bash
git add src/lib/project-organizations.ts src/lib/project-organizations.test.ts
git commit -m "feat(projects): derive organization groups"
```

### Task 2: Attach organization metadata to chat groups

**Files:**
- Modify: `src/lib/chat-projects.ts`
- Modify: `src/lib/chat-projects.test.ts`

- [ ] **Step 1: Extend failing chat-group assertions**

In `src/lib/chat-projects.test.ts`, add:

```ts
assert.deepEqual(
  groups.map((group) => group.organization.label),
  ["OpenCoven", "No organization", "No organization"],
  "registered projects derive organization metadata while unregistered/no-project groups stay explicit",
);
```

Update the `projects` fixture so Alpha includes
`repoUrl: "https://github.com/OpenCoven/alpha"`.

- [ ] **Step 2: Run the focused test**

```bash
node --experimental-strip-types --import ./scripts/test-alias-register.mjs \
  --test src/lib/chat-projects.test.ts
```

Expected: FAIL because `ChatProjectGroup` has no `organization`.

- [ ] **Step 3: Add organization metadata**

In `src/lib/chat-projects.ts`:

```ts
import {
  NO_PROJECT_ORGANIZATION,
  projectOrganization,
  type ProjectOrganization,
} from "./project-organizations.ts";
```

Add to `ChatProjectGroup`:

```ts
organization: ProjectOrganization;
```

In `deriveChatProjectGroups`, include:

```ts
organization: project ? projectOrganization(project) : NO_PROJECT_ORGANIZATION,
```

- [ ] **Step 4: Run both pure tests**

```bash
node --experimental-strip-types --import ./scripts/test-alias-register.mjs \
  --test src/lib/project-organizations.test.ts src/lib/chat-projects.test.ts
```

Expected: both PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/chat-projects.ts src/lib/chat-projects.test.ts
git commit -m "feat(chat): carry project organization metadata"
```

### Task 3: Persist and auto-expand organization disclosure keys

**Files:**
- Modify: `src/lib/chat-project-selection.ts`
- Modify: `src/lib/chat-project-selection.test.ts`

- [ ] **Step 1: Add failing key assertions**

Add tests that expect:

```ts
assert.deepEqual(
  projectSelectionKeys(groups),
  ["org:opencoven", "alpha", "org:none", "none"],
);
assert.deepEqual(
  autoExpandKeysForNewSessions({
    groups,
    knownSessionIds: new Set(),
    knownGroupKeys: new Set(),
    activeSessionId: "new-alpha",
    newSinceMs: 0,
  }),
  ["org:opencoven", "alpha"],
);
```

- [ ] **Step 2: Run the focused test**

```bash
node --experimental-strip-types --import ./scripts/test-alias-register.mjs \
  --test src/lib/chat-project-selection.test.ts
```

Expected: FAIL because only project keys are returned.

- [ ] **Step 3: Include unique organization keys**

Import `organizationExpansionKey`, then replace `projectSelectionKeys` with:

```ts
export function projectSelectionKeys(groups: ChatProjectGroup[]): string[] {
  return [
    ...new Set(
      groups.flatMap((group) => [
        organizationExpansionKey(group.organization.key),
        selectionKey(group.projectId, group.projectRoot),
      ]),
    ),
  ];
}
```

In `autoExpandKeysForNewSessions`, when a group qualifies, push the
organization key before the project key:

```ts
if (newGroup || activeIsFresh) {
  keys.push(organizationExpansionKey(group.organization.key), key);
}
return [...new Set(keys)];
```

- [ ] **Step 4: Run selection tests**

Run the Step 2 command.

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/chat-project-selection.ts src/lib/chat-project-selection.test.ts
git commit -m "feat(chat): persist organization disclosure state"
```

### Task 4: Render organization sections in the Chat rail

**Files:**
- Modify: `src/components/chat-project-sidebar.tsx`
- Modify: `src/components/chat-thread-rail.test.ts`
- Modify: `src/components/chat-all-familiars-project-list.test.ts`

- [ ] **Step 1: Add failing source-contract assertions**

Assert the component:

```ts
assert.match(source, /chatProjectOrganizationGroups\(groups\)/);
assert.match(source, /organizationExpansionKey\(organization\.key\)/);
assert.match(source, /aria-label=\{`\$\{organizationExpanded \? "Collapse" : "Expand"\} \$\{organization\.label\} projects`\}/);
assert.match(source, /organization\.items\.map\(\(group\) => renderProjectGroup\(group\)\)/);
assert.match(source, /hasSearch \|\| organizationExpanded/);
```

Keep all existing drag/drop and project disclosure assertions.

- [ ] **Step 2: Run the rail tests**

```bash
node --experimental-strip-types --import ./scripts/test-alias-register.mjs \
  --test src/components/chat-thread-rail.test.ts \
  src/components/chat-all-familiars-project-list.test.ts
```

Expected: FAIL because no organization UI exists.

- [ ] **Step 3: Compose organization groups**

Import:

```ts
import {
  chatProjectOrganizationGroups,
  organizationExpansionKey,
} from "@/lib/project-organizations";
```

Add:

```ts
const organizationGroups = useMemo(
  () => chatProjectOrganizationGroups(groups),
  [groups],
);
```

Extract the existing project-folder JSX into a local
`renderProjectGroup(group: ChatProjectGroup)` function without changing its
selection, drag/drop, session ordering, plus button, or `FolderDroppable`
behavior.

Replace the open project-mode `groups.map(...)` with:

```tsx
{organizationGroups.map((organization) => {
  const organizationKey = organizationExpansionKey(organization.key);
  const organizationExpanded = expandedKeys.includes(organizationKey);
  return (
    <section key={organization.key} aria-label={organization.label}>
      <button
        type="button"
        className="focus-ring flex min-h-8 w-full items-center gap-2 border-b border-[var(--border-hairline)] bg-[var(--bg-panel)] px-2 py-1 text-left"
        aria-expanded={organizationExpanded}
        aria-label={`${organizationExpanded ? "Collapse" : "Expand"} ${organization.label} projects`}
        onClick={() => onToggleExpanded(organizationKey)}
      >
        <Icon
          name={organizationExpanded ? "ph:caret-down" : "ph:caret-right"}
          width={10}
          aria-hidden
        />
        <span className="min-w-0 flex-1 truncate font-mono text-[length:var(--text-2xs)] font-bold uppercase tracking-[0.08em] text-[var(--text-secondary)]">
          {organization.label}
        </span>
        <span className="text-[length:var(--text-2xs)] text-[var(--text-muted)]">
          {organization.items.length}
        </span>
      </button>
      {hasSearch || organizationExpanded
        ? organization.items.map((group) => renderProjectGroup(group))
        : null}
    </section>
  );
})}
```

Do not nest organization sections in the collapsed 56px rail; keep the existing
project identity tiles there.

- [ ] **Step 4: Run rail tests**

Run the Step 2 command.

Expected: PASS.

- [ ] **Step 5: Run lint on the modified component**

```bash
pnpm exec eslint src/components/chat-project-sidebar.tsx --max-warnings=0
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/chat-project-sidebar.tsx \
  src/components/chat-thread-rail.test.ts \
  src/components/chat-all-familiars-project-list.test.ts
git commit -m "feat(chat): nest projects under organizations"
```

### Task 5: Group Projects hub cards by organization

**Files:**
- Modify: `src/components/projects-view.tsx`
- Modify: `src/components/projects-view.test.ts`

- [ ] **Step 1: Replace the old section assertions**

Remove the assertion requiring `sectionModels(filtered, true)` and add:

```ts
assert.match(view, /projectOrganizationGroups\(filtered\)/);
assert.match(view, /organizationSections\.map\(\(section\) =>/);
assert.match(view, /aria-label=\{section\.label\}/);
assert.match(view, /section\.items\.map\(\(project\) => rowsById\.get\(project\.id\)\)/);
assert.match(view, /projectKind\(project\.root\)/, "cards retain repository/workspace semantics");
```

- [ ] **Step 2: Run the Projects source test**

```bash
node --experimental-strip-types --import ./scripts/test-alias-register.mjs \
  --test src/components/projects-view.test.ts
```

Expected: FAIL because Grid still uses workspace/repository sections.

- [ ] **Step 3: Replace Grid section derivation**

Import:

```ts
import { projectOrganizationGroups } from "@/lib/project-organizations";
```

Remove `sectionModels` from the access-page import if it has no remaining
callers in this component.

Add:

```ts
const organizationSections = useMemo(
  () => projectOrganizationGroups(filtered),
  [filtered],
);
```

In Grid mode, replace `sections.map` with:

```tsx
{organizationSections.map((section) => {
  const rows = section.items
    .map((project) => rowsById.get(project.id))
    .filter((row): row is (typeof viewRows)[number] => Boolean(row));
  const isCollapsed = collapsed.has(section.key);
  return (
    <section key={section.key} className="projects-access-section" aria-label={section.label}>
      <header className="projects-access-section-head">
        <button
          type="button"
          className="projects-access-section-toggle focus-ring"
          aria-expanded={!isCollapsed}
          onClick={() => toggleSection(section.key)}
        >
          <Icon
            className={`projects-access-caret${isCollapsed ? " is-closed" : ""}`}
            name="ph:caret-down"
            width={10}
            aria-hidden
          />
          <span className="projects-access-section-title">{section.label}</span>
          <span className="projects-access-section-count">{rows.length}</span>
          {isCollapsed ? (
            <>
              <span className="projects-access-peek">{sectionPeek(rows.map((row) => row.name))}</span>
              <span className="projects-access-mix">
                {sectionMix(rows.map((row) => row.state)).map((mix) => (
                  <span key={mix.state} className={`is-${mix.state}`}>
                    {mix.count} {mix.label}
                  </span>
                ))}
              </span>
            </>
          ) : null}
        </button>
      </header>
      {!isCollapsed ? <ul className="projects-access-grid">{rows.map(renderCard)}</ul> : null}
    </section>
  );
})}
```

Keep Rows and Tree modes unchanged.

- [ ] **Step 4: Run Projects tests and lint**

```bash
node --experimental-strip-types --import ./scripts/test-alias-register.mjs \
  --test src/components/projects-view.test.ts
pnpm exec eslint src/components/projects-view.tsx --max-warnings=0
```

Expected: both PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/projects-view.tsx src/components/projects-view.test.ts
git commit -m "feat(projects): group cards by organization"
```

### Task 6: Run repository verification and visual checks

**Files:**
- Verify only.

- [ ] **Step 1: Run focused tests**

```bash
node --experimental-strip-types --import ./scripts/test-alias-register.mjs --test \
  src/lib/project-organizations.test.ts \
  src/lib/chat-projects.test.ts \
  src/lib/chat-project-selection.test.ts \
  src/components/chat-thread-rail.test.ts \
  src/components/chat-all-familiars-project-list.test.ts \
  src/components/projects-view.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run design and type gates**

```bash
pnpm lint
pnpm typecheck
pnpm check:tests-wired
```

Expected: all PASS.

- [ ] **Step 3: Run the app suite and build**

```bash
pnpm test:app
pnpm build
```

Expected: PASS.

- [ ] **Step 4: Verify real UI**

Invoke the project `run-cave-app` skill. Open Chat and Projects with demo data
containing at least two organizations plus an unregistered/no-project group.
Capture dark and light screenshots and confirm:

- organization disclosure order and counts,
- `No organization` and `No project` are last,
- project and organization keyboard focus rings,
- search reveals a match inside a collapsed organization,
- project-to-project chat drag still works.

- [ ] **Step 5: Record verification on the Bead**

```bash
bd comments add cave-1vpy \
  "Implemented derived GitHub-owner/parent-folder organization grouping on feat/cave-1vpy-project-org-grouping. Verification: focused organization/chat/project tests, pnpm lint, pnpm typecheck, pnpm check:tests-wired, pnpm test:app, pnpm build, and dark/light Chat + Projects browser evidence."
```

### Task 7: Open, review, merge, and close the PR

- [ ] **Step 1: Review the final diff**

```bash
git status --short
git diff origin/main...HEAD --stat
git diff origin/main...HEAD --check
```

Expected: only the spec/plans and project-grouping implementation are present.

- [ ] **Step 2: Push and open the PR**

```bash
git push -u origin feat/cave-1vpy-project-org-grouping
gh pr create \
  --base main \
  --head feat/cave-1vpy-project-org-grouping \
  --title "feat(projects): group projects by organization" \
  --body "## Summary
- derive organization identity from GitHub owner or parent folder
- nest Chat projects beneath organization disclosures
- group Projects grid cards by the same organization model

## Verification
- focused project/chat organization tests
- pnpm lint
- pnpm typecheck
- pnpm check:tests-wired
- pnpm test:app
- pnpm build

Closes cave-1vpy"
```

- [ ] **Step 3: Wait for required checks and inspect review threads**

```bash
gh pr checks --required --watch
```

Then query every review-thread page and fix any real findings before merging.

- [ ] **Step 4: Exact-head squash merge**

```bash
expected_head=$(git rev-parse HEAD)
actual_head=$(gh pr view --json headRefOid --jq .headRefOid)
test "$actual_head" = "$expected_head"
gh pr checks --required
gh pr merge --squash --match-head-commit "$expected_head"
```

- [ ] **Step 5: Record merge evidence and close**

```bash
pr_url=$(gh pr view --json url --jq .url)
bd update cave-1vpy --external-ref "$pr_url"
bd comments add cave-1vpy "Merged exact verified head $expected_head via $pr_url."
bd close cave-1vpy --reason "Derived organization grouping merged through the protected PR path."
pnpm beads:worktrees
```

Record the worktree disposition reported by the patrol before any retirement.
