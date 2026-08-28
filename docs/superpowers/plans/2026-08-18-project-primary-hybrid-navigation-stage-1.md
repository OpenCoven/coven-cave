# Project-primary Hybrid Navigation Stage 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. **Checkbox state in this document is not evidence of completion. Verify what has shipped against code and merged PRs.**

**Goal:** Add the project/crew/actor context contract, render the hybrid selector in the shared desktop rail, and migrate Home and new-chat launch to that shell-owned context without changing non-pilot surface filtering.

**Architecture:** A pure `workspace-context` module owns reconciliation and actor resolution, a separate storage module persists the project plus per-project crew, and `workspace.tsx` composes those with the existing project registry and project-familiar access hook. The shared rail header remains presentational and reuses extended `ProjectPicker` and `FamiliarSwitcher` primitives. Home stops owning an independent project/familiar pair and receives the resolved shell context; actor-required launches pass through one modal gate.

**Tech Stack:** Next.js App Router, React 19, TypeScript, existing Cave hooks and UI primitives, tokenized CSS, Node assertion tests, Playwright daemon-less E2E.

---

**Commit boundary:** Every commit step below requires Val's explicit
authorization. Without it, execute the code and verification steps but leave the
worktree uncommitted for review.

## Scope

This plan implements **Stage 1 only** from
`docs/superpowers/specs/2026-08-18-project-primary-hybrid-navigation-design.md`.

Included:

- pure project/crew/actor state contract;
- versioned persistence with legacy familiar-scope compatibility;
- fail-closed eligible-crew loading;
- reusable All projects and Project crew labels in existing pickers;
- shared desktop rail project row above the familiar row;
- shell-owned selected project;
- Home and new-chat pilot;
- acting-familiar gate;
- explicit marker that non-pilot surfaces are not yet project-filtered.

Deferred to later plans:

- filtering Chat history, Board, Queue, Calendar, Code, and GitHub by shell project;
- role-room project operations;
- global-surface context treatment;
- mobile and native iOS context sheets;
- removal of local project persistence from migrated-later surfaces.

## File map

### New files

- `src/lib/workspace-context.ts` — pure project scope, crew reconciliation, and acting-familiar resolution.
- `src/lib/workspace-context.test.ts` — exhaustive state-transition coverage.
- `src/lib/workspace-context-storage.ts` — SSR-safe versioned project and per-project crew persistence.
- `src/lib/workspace-context-storage.test.ts` — malformed, legacy, and round-trip storage coverage.
- `src/components/acting-familiar-gate.tsx` — modal that resolves one eligible actor before a launch.
- `src/components/acting-familiar-gate.test.ts` — source contract for explicit actor selection and accessible modal behavior.
- `src/components/workspace-context-switcher.tsx` — presentational project row plus crew row for the shared rail.
- `src/components/workspace-context-switcher.test.ts` — source contract for selector composition and disabled/error states.
- `src/styles/globals/workspace-context-switcher.css` — token-only expanded and collapsed rail layout.
- `tests/project-primary-home.spec.ts` — daemon-less project/crew selection and Home launch coverage.

### Modified files

- `src/lib/use-project-familiars.ts` — expose error and retry while preserving generation guards.
- `src/lib/use-project-familiars.test.ts` — pin fail-closed, error, and retry behavior.
- `src/components/project-picker.tsx` — support an explicit All projects row without widening existing callbacks.
- `src/components/project-picker.test.ts` — cover All projects semantics without changing No project.
- `src/components/familiar-switcher.tsx` — support caller-provided aggregate copy such as Project crew.
- `src/components/familiar-switcher.test.ts` — retain All familiars defaults and test Project crew copy.
- `src/components/sidebar-rail-header.tsx` — replace its single familiar row with `WorkspaceContextSwitcher`.
- `src/components/sidebar-rail-header.test.ts` — preserve shared-header parity with two context rows.
- `src/styles/globals/rail-header.css` — leave New styling here and remove selector-specific ownership.
- `src/app/globals.css` — import the new shared stylesheet.
- `src/components/sidebar-minimal.tsx` — forward shell project context to the shared header.
- `src/components/workspace-sidebar.tsx` — forward the same context without filtering Chat history yet.
- `src/components/workspace.tsx` — own selected project, reconcile crew, persist context, and gate launches.
- `src/components/workspace-familiars-landing.test.ts` — replace legacy direct familiar persistence assertions with the context contract.
- `src/components/home-composer.tsx` — consume project, eligible crew, and actor from the shell.
- `src/components/home-composer.test.ts` — prove Home no longer owns independent scope and launches with visible context.
- `src/components/composer-context-pill.tsx` — let project-primary Home hide the redundant project chip while preserving existing defaults elsewhere.
- `src/components/composer-context-pill.test.ts` — pin the opt-out and existing visible-by-default behavior.
- `scripts/run-tests.mjs` — register all new Node assertion tests.

## Task 1: Build the pure context contract

**Files:**
- Create: `src/lib/workspace-context.ts`
- Create: `src/lib/workspace-context.test.ts`
- Modify: `scripts/run-tests.mjs`

- [ ] **Step 1: Write the failing context tests**

Create `src/lib/workspace-context.test.ts`:

```ts
import assert from "node:assert/strict";
import {
  allProjectsScope,
  projectScope,
  reconcileCrewForProject,
  resolveActingFamiliar,
  type FamiliarScope,
} from "./workspace-context.ts";

const selected = (...ids: string[]): FamiliarScope => ({
  kind: "selected",
  familiarIds: ids,
});

assert.deepEqual(allProjectsScope(), { kind: "all-projects" });
assert.deepEqual(projectScope(" project-a "), {
  kind: "project",
  projectId: "project-a",
});

assert.deepEqual(
  reconcileCrewForProject(selected("cody", "nova"), ["nova", "salem"]),
  selected("nova"),
  "project switches retain only selected familiars with verified access",
);
assert.deepEqual(
  reconcileCrewForProject(selected("cody"), ["nova", "salem"]),
  { kind: "all-eligible" },
  "zero retained members becomes Project crew instead of the first eligible familiar",
);
assert.deepEqual(
  reconcileCrewForProject({ kind: "all-eligible" }, ["cody"]),
  { kind: "all-eligible" },
  "aggregate crew stays aggregate even when its eligible roster changes",
);

assert.deepEqual(
  resolveActingFamiliar(selected("cody"), ["cody", "nova"]),
  { kind: "resolved", familiarId: "cody" },
);
assert.deepEqual(
  resolveActingFamiliar(selected("cody", "nova"), ["cody", "nova"]),
  { kind: "required" },
);
assert.deepEqual(
  resolveActingFamiliar({ kind: "all-eligible" }, ["cody"]),
  { kind: "resolved", familiarId: "cody" },
  "a one-person project crew is unambiguous",
);
assert.deepEqual(
  resolveActingFamiliar({ kind: "all-eligible" }, ["cody", "nova"]),
  { kind: "required" },
  "an aggregate crew with multiple members never silently selects the first",
);
assert.deepEqual(
  resolveActingFamiliar(selected("cody"), []),
  { kind: "required" },
  "an unavailable selected familiar cannot remain the actor",
);

console.log("workspace context contract passed");
```

Append `"src/lib/workspace-context.test.ts"` beside the other workspace tests in
`SUITES.app`.

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
node --experimental-strip-types src/lib/workspace-context.test.ts
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `workspace-context.ts`.

- [ ] **Step 3: Implement the pure context module**

Create `src/lib/workspace-context.ts`:

```ts
export type ProjectScope =
  | { kind: "all-projects" }
  | { kind: "project"; projectId: string };

export type FamiliarScope =
  | { kind: "all-eligible" }
  | { kind: "selected"; familiarIds: readonly string[] };

export type ActingFamiliar =
  | { kind: "resolved"; familiarId: string }
  | { kind: "required" };

function uniqueIds(ids: Iterable<string>): string[] {
  return [...new Set([...ids].map((id) => id.trim()).filter(Boolean))].sort();
}

export function allProjectsScope(): ProjectScope {
  return { kind: "all-projects" };
}

export function projectScope(projectId: string): ProjectScope {
  const normalized = projectId.trim();
  return normalized ? { kind: "project", projectId: normalized } : allProjectsScope();
}

export function familiarScopeFromIds(ids: Iterable<string>): FamiliarScope {
  const familiarIds = uniqueIds(ids);
  return familiarIds.length > 0
    ? { kind: "selected", familiarIds }
    : { kind: "all-eligible" };
}

export function familiarIdsForScope(scope: FamiliarScope): readonly string[] {
  return scope.kind === "selected" ? scope.familiarIds : [];
}

export function reconcileCrewForProject(
  current: FamiliarScope,
  eligibleFamiliarIds: Iterable<string>,
): FamiliarScope {
  if (current.kind === "all-eligible") return current;
  const eligible = new Set(uniqueIds(eligibleFamiliarIds));
  return familiarScopeFromIds(current.familiarIds.filter((id) => eligible.has(id)));
}

export function resolveActingFamiliar(
  scope: FamiliarScope,
  eligibleFamiliarIds: Iterable<string>,
): ActingFamiliar {
  const eligible = new Set(uniqueIds(eligibleFamiliarIds));
  const candidates = scope.kind === "all-eligible"
    ? [...eligible]
    : uniqueIds(scope.familiarIds).filter((id) => eligible.has(id));
  return candidates.length === 1
    ? { kind: "resolved", familiarId: candidates[0]! }
    : { kind: "required" };
}
```

- [ ] **Step 4: Run the test and test-wiring guard**

Run:

```bash
node --experimental-strip-types src/lib/workspace-context.test.ts
pnpm check:tests-wired
```

Expected: `workspace context contract passed`; test wiring exits 0.

- [ ] **Step 5: Commit the pure contract**

```bash
git add src/lib/workspace-context.ts src/lib/workspace-context.test.ts scripts/run-tests.mjs
git commit -m "feat: define workspace context contract"
```

## Task 2: Persist project and per-project crew safely

**Files:**
- Create: `src/lib/workspace-context-storage.ts`
- Create: `src/lib/workspace-context-storage.test.ts`
- Modify: `scripts/run-tests.mjs`

- [ ] **Step 1: Write failing storage tests**

Create `src/lib/workspace-context-storage.test.ts` with an injected storage
object so the test does not depend on a browser:

```ts
import assert from "node:assert/strict";
import {
  readWorkspaceCrew,
  readWorkspaceContext,
  writeWorkspaceContext,
  type StorageLike,
} from "./workspace-context-storage.ts";

function memoryStorage(seed: Record<string, string> = {}): StorageLike {
  const values = new Map(Object.entries(seed));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, value),
    removeItem: (key) => void values.delete(key),
  };
}

const storage = memoryStorage();
writeWorkspaceContext(storage, {
  projectId: "project-a",
  familiarIds: ["nova", "cody", "nova"],
});
assert.deepEqual(readWorkspaceContext(storage, []), {
  projectId: "project-a",
  familiarIds: ["cody", "nova"],
});

const explicitAggregate = memoryStorage({
  "cave:workspace:project-scope:v1": JSON.stringify("project-a"),
  "cave:workspace:familiar-scope-by-project:v1": JSON.stringify({
    "project-a": [],
  }),
});
assert.deepEqual(readWorkspaceContext(explicitAggregate, ["salem"]), {
  projectId: "project-a",
  familiarIds: [],
});
assert.deepEqual(readWorkspaceCrew(explicitAggregate, "project-a"), []);
assert.equal(readWorkspaceCrew(explicitAggregate, "project-b"), null);

const corrupt = memoryStorage({
  "cave:workspace:project-scope:v1": "{",
  "cave:workspace:familiar-scope-by-project:v1": "not-json",
});
assert.deepEqual(readWorkspaceContext(corrupt, ["cody"]), {
  projectId: null,
  familiarIds: ["cody"],
});

const legacy = memoryStorage();
assert.deepEqual(readWorkspaceContext(legacy, ["salem"]), {
  projectId: null,
  familiarIds: ["salem"],
});

console.log("workspace context storage passed");
```

Register the test in `SUITES.app`.

- [ ] **Step 2: Verify the storage test fails**

Run:

```bash
node --experimental-strip-types src/lib/workspace-context-storage.test.ts
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Implement versioned storage**

Create `src/lib/workspace-context-storage.ts`:

```ts
const PROJECT_SCOPE_KEY = "cave:workspace:project-scope:v1";
const CREW_BY_PROJECT_KEY = "cave:workspace:familiar-scope-by-project:v1";
const ALL_PROJECTS_KEY = "__all-projects__";

export type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export type PersistedWorkspaceContext = {
  projectId: string | null;
  familiarIds: string[];
};

function normalizedIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((id): id is string => typeof id === "string")
    .map((id) => id.trim()).filter(Boolean))].sort();
}

function parseJson(raw: string | null): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function contextKey(projectId: string | null): string {
  return projectId ?? ALL_PROJECTS_KEY;
}

export function readWorkspaceCrew(
  storage: StorageLike,
  projectId: string | null,
): string[] | null {
  const byProject = parseJson(storage.getItem(CREW_BY_PROJECT_KEY));
  const record = byProject && typeof byProject === "object"
    ? byProject as Record<string, unknown>
    : {};
  const key = contextKey(projectId);
  return Object.prototype.hasOwnProperty.call(record, key)
    ? normalizedIds(record[key])
    : null;
}

export function readWorkspaceContext(
  storage: StorageLike,
  legacyFamiliarIds: readonly string[],
): PersistedWorkspaceContext {
  const projectValue = parseJson(storage.getItem(PROJECT_SCOPE_KEY));
  const projectId = typeof projectValue === "string" && projectValue.trim()
    ? projectValue.trim()
    : null;
  const storedCrew = readWorkspaceCrew(storage, projectId);
  return {
    projectId,
    familiarIds: storedCrew ?? normalizedIds(legacyFamiliarIds),
  };
}

export function writeWorkspaceContext(
  storage: StorageLike,
  value: PersistedWorkspaceContext,
): void {
  const projectId = value.projectId?.trim() || null;
  const existing = parseJson(storage.getItem(CREW_BY_PROJECT_KEY));
  const byProject = existing && typeof existing === "object"
    ? { ...(existing as Record<string, unknown>) }
    : {};
  byProject[contextKey(projectId)] = normalizedIds(value.familiarIds);
  storage.setItem(PROJECT_SCOPE_KEY, JSON.stringify(projectId));
  storage.setItem(CREW_BY_PROJECT_KEY, JSON.stringify(byProject));
}

export function browserWorkspaceStorage(): StorageLike | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run storage tests and wiring**

Run:

```bash
node --experimental-strip-types src/lib/workspace-context-storage.test.ts
pnpm check:tests-wired
```

Expected: `workspace context storage passed`; wiring exits 0.

- [ ] **Step 5: Commit persistence**

```bash
git add src/lib/workspace-context-storage.ts src/lib/workspace-context-storage.test.ts scripts/run-tests.mjs
git commit -m "feat: persist workspace project crew context"
```

## Task 3: Make project eligibility retryable and fail closed

**Files:**
- Modify: `src/lib/use-project-familiars.ts`
- Modify: `src/lib/use-project-familiars.test.ts`

- [ ] **Step 1: Extend the source contract test**

Add assertions to `src/lib/use-project-familiars.test.ts`:

```ts
assert.match(source, /error: string \| null;/, "single-project eligibility exposes failure");
assert.match(source, /reload: \(\) => void;/, "single-project eligibility exposes retry");
assert.match(
  source,
  /const currentFamiliars = loadedProjectId === projectId \? familiars : EMPTY_FAMILIARS/,
  "a new project synchronously masks the previous project's crew",
);
assert.match(
  source,
  /const currentLoading = Boolean\([\s\S]*loadedProjectId !== projectId/,
  "a new project is synchronously loading before its effect starts",
);
assert.match(
  source,
  /setErrorProjectId\(projectId\)/,
  "request failures are attributed to the project that failed",
);
assert.match(
  source,
  /const reload = \(\) => setReloadEpoch\(\(epoch\) => epoch \+ 1\)/,
  "retry advances an explicit request epoch",
);
```

- [ ] **Step 2: Verify the new assertions fail**

Run:

```bash
node --experimental-strip-types src/lib/use-project-familiars.test.ts
```

Expected: FAIL at `single-project eligibility exposes failure`.

- [ ] **Step 3: Extend the hook state**

Update the single-project state type:

```ts
export type ProjectFamiliarsState = {
  familiars: Familiar[];
  loading: boolean;
  error: string | null;
  loadedSuccessfully: boolean;
  reload: () => void;
};
```

Add:

```ts
const EMPTY_FAMILIARS: Familiar[] = [];
const [errorProjectId, setErrorProjectId] = useState<string | null>(null);
const [reloadEpoch, setReloadEpoch] = useState(0);
const reload = () => setReloadEpoch((epoch) => epoch + 1);
```

At every request start, call `setErrorProjectId(null)`. For non-OK or malformed
payloads, after the existing generation check, call:

```ts
setErrorProjectId(projectId);
```

In `catch`, attribute failure only if the request is still current:

```ts
if (generationRef.current === generation) setErrorProjectId(projectId);
```

Include `reloadEpoch` in the effect dependencies. Before returning, mask stale
crew and error state synchronously:

```ts
const currentFamiliars =
  loadedProjectId === projectId ? familiars : EMPTY_FAMILIARS;
const currentError =
  errorProjectId === projectId ? "Couldn't load project crew" : null;
const currentLoading = Boolean(
  enabled
  && projectId
  && currentError === null
  && (loading || loadedProjectId !== projectId),
);

return {
  familiars: currentFamiliars,
  loading: currentLoading,
  error: currentError,
  loadedSuccessfully:
    enabled && Boolean(projectId) && loadedProjectId === projectId && currentError === null,
  reload,
};
```

- [ ] **Step 4: Run the hook contract and related API tests**

Run:

```bash
node --experimental-strip-types src/lib/use-project-familiars.test.ts
node --experimental-strip-types src/app/api/familiars/route.test.ts
```

Expected: both pass.

- [ ] **Step 5: Commit eligibility behavior**

```bash
git add src/lib/use-project-familiars.ts src/lib/use-project-familiars.test.ts
git commit -m "feat: expose project crew eligibility state"
```

## Task 4: Extend shared selectors without changing existing defaults

**Files:**
- Modify: `src/components/project-picker.tsx`
- Modify: `src/components/project-picker.test.ts`
- Modify: `src/components/familiar-switcher.tsx`
- Modify: `src/components/familiar-switcher.test.ts`

- [ ] **Step 1: Add failing picker assertions**

Add to `project-picker.test.ts`:

```ts
assert.match(src, /allProjectsLabel\?: string;/, "project picker supports an operator-wide row");
assert.match(
  src,
  /onSelectAllProjects\?: \(\) => void;/,
  "project picker exposes All projects without widening existing callbacks",
);
assert.match(
  src,
  /onSelect=\{\(\) => \{ onSelectAllProjects\(\); close\(\); \}\}/,
  "All projects clears the selected project and closes",
);
assert.match(
  src,
  /allowNoProject[\s\S]*NO_PROJECT_ID/,
  "the session-level No project choice remains separate from All projects",
);
```

Add to `familiar-switcher.test.ts`:

```ts
assert.match(source, /aggregateLabel = "All familiars"/, "existing copy stays the default");
assert.match(source, /\{aggregateLabel\}/, "callers can label aggregate scope Project crew");
assert.match(
  source,
  /aggregateDescription \?\? `\$\{familiars\.length\} in your coven`/,
  "aggregate description can explain project eligibility",
);
assert.match(source, /disabled\?: boolean;/, "the crew trigger can fail closed");
assert.match(source, /disabled=\{disabled\}/, "the disabled state reaches the button");
```

- [ ] **Step 2: Verify selector tests fail**

Run:

```bash
node --experimental-strip-types src/components/project-picker.test.ts
node --experimental-strip-types src/components/familiar-switcher.test.ts
```

Expected: both fail on the new props.

- [ ] **Step 3: Add All projects to `ProjectPicker`**

Add these optional props to `ProjectPicker` and `ProjectPickerPopover` while
leaving the existing `onChange: (id: string) => void` contract unchanged:

```ts
allProjectsLabel?: string;
onSelectAllProjects?: () => void;
```

Pass both props into `ProjectPickerPopover`. Before the No project row, render:

```tsx
{allProjectsLabel && onSelectAllProjects ? (
  <PopoverItem
    checked={value === null}
    active={value === null}
    leading={<Icon name="ph:squares-four" width={14} aria-hidden />}
    onSelect={() => { onSelectAllProjects(); close(); }}
  >
    {allProjectsLabel}
  </PopoverItem>
) : null}
```

Use `allProjectsLabel` as the empty trigger copy when present:

```ts
const emptyLabel = allProjectsLabel
  ?? (allowNoProject ? "No project" : "Choose project");
```

Do not remove or rename the existing `NO_PROJECT_ID` path.

- [ ] **Step 4: Add aggregate copy to `FamiliarSwitcher`**

Extend props:

```ts
aggregateLabel?: string;
aggregateDescription?: string;
disabled?: boolean;
```

Default during destructuring:

```ts
aggregateLabel = "All familiars",
aggregateDescription,
disabled = false,
```

Replace hardcoded aggregate display strings with `aggregateLabel`, and render:

```tsx
<span className="familiar-switcher__header-name">{aggregateLabel}</span>
<span className="familiar-switcher__header-role">
  {aggregateDescription ?? `${familiars.length} in your coven`}
</span>
```

The accessible trigger label becomes:

```ts
`Switch familiar — scope: ${aggregateLabel.toLowerCase()}`
```

Pass `disabled={disabled}` to the existing trigger button. Do not alter the
default enabled behavior for existing callers.

- [ ] **Step 5: Run picker tests**

Run:

```bash
node --experimental-strip-types src/components/project-picker.test.ts
node --experimental-strip-types src/components/familiar-switcher.test.ts
```

Expected: both pass, including existing No project and All familiars coverage.

- [ ] **Step 6: Commit selector extensions**

```bash
git add src/components/project-picker.tsx src/components/project-picker.test.ts \
  src/components/familiar-switcher.tsx src/components/familiar-switcher.test.ts
git commit -m "feat: support workspace context selector copy"
```

## Task 5: Build the hybrid rail control

**Files:**
- Create: `src/components/workspace-context-switcher.tsx`
- Create: `src/components/workspace-context-switcher.test.ts`
- Create: `src/styles/globals/workspace-context-switcher.css`
- Modify: `src/components/sidebar-rail-header.tsx`
- Modify: `src/components/sidebar-rail-header.test.ts`
- Modify: `src/styles/globals/rail-header.css`
- Modify: `src/app/globals.css`
- Modify: `scripts/run-tests.mjs`

- [ ] **Step 1: Write the failing composition test**

Create `src/components/workspace-context-switcher.test.ts`:

```ts
// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./workspace-context-switcher.tsx", import.meta.url), "utf8");
const css = readFileSync(
  new URL("../styles/globals/workspace-context-switcher.css", import.meta.url),
  "utf8",
);

assert.match(source, /<ProjectPicker/, "project is the first context control");
assert.match(source, /allProjectsLabel="All projects"/, "the shell exposes operator scope");
assert.match(source, /<FamiliarSwitcher/, "familiar identity remains visible");
assert.match(source, /aggregateLabel=\{project \? "Project crew" : "All familiars"\}/);
assert.match(
  source,
  /disabled=\{projectLoading \|\| Boolean\(projectError\)\}/,
  "project selection fails closed while the registry is unavailable",
);
assert.match(source, /disabled=\{projectCrewLoading \|\| Boolean\(projectCrewError\)\}/);
assert.match(source, /role="alert"/, "crew load failure is visible");
assert.match(source, /onClick=\{reloadProjects\}/, "project registry failure can retry");
assert.match(source, /onClick=\{reloadProjectCrew\}/, "crew load failure can retry");
assert.match(source, /No familiars have access to this project/, "empty crew is explicit");
assert.match(source, /role="note"/, "non-pilot context notices are explicit");
assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b/, "styles use tokens only");
assert.match(css, /\.shell-nav--rail \.workspace-context-switcher/, "collapsed rail is explicit");

console.log("workspace context switcher contract passed");
```

Register it in `SUITES.app`.

Update `sidebar-rail-header.test.ts` to expect
`<WorkspaceContextSwitcher>` inside the one shared header and to assert that
neither sidebar mounts `ProjectPicker` or `FamiliarSwitcher` directly.

- [ ] **Step 2: Verify tests fail**

Run:

```bash
node --experimental-strip-types src/components/workspace-context-switcher.test.ts
node --experimental-strip-types src/components/sidebar-rail-header.test.ts
```

Expected: missing component failure, then missing shared composition.

- [ ] **Step 3: Implement `WorkspaceContextSwitcher`**

Create a presentational component with this public contract:

```tsx
"use client";

import { ProjectPicker } from "@/components/project-picker";
import { FamiliarSwitcher } from "@/components/familiar-switcher";
import { Button } from "@/components/ui/button";
import type { CaveProject } from "@/lib/cave-projects-types";
import type { CreateProjectOptions } from "@/lib/chat-add-project";
import type { ResolvedFamiliar } from "@/lib/familiar-resolve";
import type { SessionRow } from "@/lib/types";

export type WorkspaceContextSwitcherProps = {
  projects: CaveProject[];
  projectId: string | null;
  onProjectChange: (projectId: string | null) => void;
  projectLoading: boolean;
  projectError: string | null;
  reloadProjects: () => void;
  project: CaveProject | null;
  createProjectOrThrow: (
    name: string,
    root: string,
    options?: CreateProjectOptions,
  ) => Promise<CaveProject>;
  allFamiliars: ResolvedFamiliar[];
  projectCrew: ResolvedFamiliar[];
  projectCrewLoading: boolean;
  projectCrewError: string | null;
  reloadProjectCrew: () => void;
  activeFamiliarId: string | null;
  selectedFamiliarIds: ReadonlySet<string>;
  onSelectFamiliar: (id: string | null, opts?: { multi?: boolean }) => void;
  sessions: SessionRow[];
  responseNeeded?: Set<string>;
  contextNotice?: string | null;
};
```

Render the project first:

```tsx
<div className="workspace-context-switcher">
  <div className="workspace-context-switcher__project">
    <ProjectPicker
      projects={projects}
      value={projectId}
      onChange={(nextProjectId) => onProjectChange(nextProjectId)}
      defaultToFirst={false}
      allProjectsLabel="All projects"
      onSelectAllProjects={() => onProjectChange(null)}
      familiarId={activeFamiliarId}
      createProjectOrThrow={createProjectOrThrow}
      ariaLabel="Switch project"
      disabled={projectLoading || Boolean(projectError)}
    />
  </div>
  <div className="workspace-context-switcher__crew">
    <FamiliarSwitcher
      familiars={project ? projectCrew : allFamiliars}
      activeFamiliarId={activeFamiliarId}
      selectedFamiliarIds={selectedFamiliarIds}
      sessions={sessions}
      responseNeeded={responseNeeded}
      contextNotice={contextNotice}
      onSelectFamiliar={onSelectFamiliar}
      aggregateLabel={project ? "Project crew" : "All familiars"}
      aggregateDescription={project ? `${projectCrew.length} with access` : undefined}
      placement="bottom-start"
      labeled
      disabled={projectCrewLoading || Boolean(projectCrewError)}
    />
  </div>
  {projectCrewError ? (
    <div className="workspace-context-switcher__error" role="alert">
      <span>{projectCrewError}</span>
      <Button variant="ghost" size="sm" onClick={reloadProjectCrew}>Retry</Button>
    </div>
  ) : null}
  {project && !projectCrewLoading && !projectCrewError && projectCrew.length === 0 ? (
    <div className="workspace-context-switcher__empty" role="status">
      No familiars have access to this project
    </div>
  ) : null}
  {contextNotice ? (
    <div className="workspace-context-switcher__notice" role="note">
      {contextNotice}
    </div>
  ) : null}
</div>
```

Keep the crew trigger disabled while project eligibility is loading or failed;
the visible Retry action is the only recovery path after a failure.
Render the project-registry failure before the two controls:

```tsx
{projectError ? (
  <div className="workspace-context-switcher__error" role="alert">
    <span>{projectError}</span>
    <Button variant="ghost" size="sm" onClick={reloadProjects}>Retry</Button>
  </div>
) : null}
```

- [ ] **Step 4: Wire it through `SidebarRailHeader`**

Replace direct `FamiliarSwitcher` rendering with:

```tsx
<WorkspaceContextSwitcher
  projects={projects}
  projectId={projectId}
  onProjectChange={onProjectChange}
  projectLoading={projectLoading}
  projectError={projectError}
  reloadProjects={reloadProjects}
  project={project}
  createProjectOrThrow={createProjectOrThrow}
  allFamiliars={familiars}
  projectCrew={projectCrew}
  projectCrewLoading={projectCrewLoading}
  projectCrewError={projectCrewError}
  reloadProjectCrew={reloadProjectCrew}
  activeFamiliarId={activeFamiliarId}
  selectedFamiliarIds={selectedFamiliarIds ?? new Set()}
  sessions={sessions}
  responseNeeded={responseNeeded}
  onSelectFamiliar={onSelectFamiliar}
/>
```

Add matching project, project-creator, eligibility, and `contextNotice` props to
`SidebarRailHeaderProps`.

- [ ] **Step 5: Add tokenized styles**

Move selector-specific layout out of `rail-header.css` into
`workspace-context-switcher.css`. Use:

```css
.workspace-context-switcher {
  display: grid;
  gap: var(--space-1);
  min-width: 0;
}

.workspace-context-switcher__project,
.workspace-context-switcher__crew {
  display: flex;
  min-width: 0;
}

.workspace-context-switcher__project .cave-project-picker__trigger,
.workspace-context-switcher__crew .familiar-switcher__trigger--labeled {
  width: 100%;
  min-width: 0;
  min-height: var(--rail-control);
  justify-content: flex-start;
  border-radius: var(--radius-control);
  padding: 0 calc(var(--rail-lead) - 1px);
}

.workspace-context-switcher__project .cave-project-picker__trigger {
  border: 1px solid var(--border-strong);
  background: var(--bg-subtle);
}

.workspace-context-switcher__crew .familiar-switcher__trigger--labeled {
  border: 1px solid color-mix(in oklch, var(--accent-presence) 38%, var(--border-hairline));
  background: transparent;
}

.workspace-context-switcher__error {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  color: var(--danger-text);
  font-size: var(--text-xs);
}

.workspace-context-switcher__empty {
  color: var(--text-tertiary);
  font-size: var(--text-xs);
}

.workspace-context-switcher__notice {
  color: var(--text-tertiary);
  font-size: var(--text-xs);
}

.shell-nav--rail .workspace-context-switcher {
  justify-items: center;
}

.shell-nav--rail .workspace-context-switcher__error,
.shell-nav--rail .workspace-context-switcher__empty,
.shell-nav--rail .workspace-context-switcher__notice {
  display: none;
}

.shell-nav--rail .workspace-context-switcher__project .cave-project-picker__trigger,
.shell-nav--rail .workspace-context-switcher__crew .familiar-switcher__trigger {
  width: var(--rail-control);
  min-width: var(--rail-control);
  height: var(--rail-control);
  min-height: var(--rail-control);
  padding: 0;
  justify-content: center;
}

.shell-nav--rail .workspace-context-switcher__project .cave-project-picker__trigger-label,
.shell-nav--rail .workspace-context-switcher__project .ph-caret-up-down-bold,
.shell-nav--rail .workspace-context-switcher__crew .familiar-switcher__trigger-label,
.shell-nav--rail .workspace-context-switcher__crew .familiar-switcher__trigger-caret {
  display: none;
}
```

If the generated icon DOM does not expose `.ph-caret-up-down-bold`, add a
specific class to the project caret in `ProjectPicker` and target that class
instead. Import the stylesheet from `src/app/globals.css`.

- [ ] **Step 6: Run selector and design tests**

Run:

```bash
node --experimental-strip-types src/components/workspace-context-switcher.test.ts
node --experimental-strip-types src/components/sidebar-rail-header.test.ts
node --experimental-strip-types src/components/project-picker.test.ts
node --experimental-strip-types src/components/familiar-switcher.test.ts
pnpm codemod:design:check
```

Expected: all pass.

- [ ] **Step 7: Commit shared rail UI**

```bash
git add src/components/workspace-context-switcher.tsx \
  src/components/workspace-context-switcher.test.ts \
  src/components/sidebar-rail-header.tsx \
  src/components/sidebar-rail-header.test.ts \
  src/styles/globals/workspace-context-switcher.css \
  src/styles/globals/rail-header.css src/app/globals.css scripts/run-tests.mjs
git commit -m "feat: add hybrid workspace context switcher"
```

## Task 6: Wire shell-owned project, crew, and actor state

**Files:**
- Modify: `src/components/workspace.tsx`
- Modify: `src/components/sidebar-minimal.tsx`
- Modify: `src/components/workspace-sidebar.tsx`
- Modify: `src/components/workspace-familiars-landing.test.ts`

- [ ] **Step 1: Add failing workspace wiring assertions**

In `workspace-familiars-landing.test.ts`, replace the direct familiar-storage
assertions with:

```ts
assert.match(
  workspace,
  /readWorkspaceContext\(storage, getFamiliarScope\(\)\)/,
  "workspace restores project plus per-project crew after mount",
);
assert.match(
  workspace,
  /writeWorkspaceContext\(storage, \{[\s\S]*projectId: selectedWorkspaceProjectId,[\s\S]*familiarIds: \[\.\.\.scopeIds\],[\s\S]*\}\)/,
  "workspace persists the visible project/crew pair",
);
assert.match(
  workspace,
  /useProjectFamiliars\(\{ projectId: selectedWorkspaceProjectId \}\)/,
  "workspace loads verified crew for the selected project",
);
assert.match(
  workspace,
  /reconcileCrewForProject\([\s\S]*scopeIds[\s\S]*projectCrewRecords\.map\(\(familiar\) => familiar\.id\)/,
  "workspace removes ineligible selected familiars only after verified eligibility",
);
assert.match(
  workspace,
  /resolveActingFamiliar\(workspaceFamiliarScope, eligibleFamiliarIds\)/,
  "workspace derives one actor without a first-member fallback",
);
assert.match(
  workspace,
  /readWorkspaceCrew\(storage, projectId\)/,
  "switching projects restores that project's saved crew",
);
assert.doesNotMatch(
  workspace,
  /if \(!id\) return;[\s\S]*getLastSurface\(id\)/,
  "main context selection no longer restores an unrelated familiar surface",
);
assert.match(
  workspace,
  /This view is not filtered by project yet/,
  "non-pilot surfaces do not imply filtering that Stage 1 has not implemented",
);
```

Add assertions that both `SidebarMinimal` and `WorkspaceSidebar` receive
`projectId`, `project`, project registry, and crew-state props.

- [ ] **Step 2: Verify workspace wiring test fails**

Run:

```bash
node --experimental-strip-types src/components/workspace-familiars-landing.test.ts
```

Expected: FAIL at workspace context restoration.

- [ ] **Step 3: Restore and persist shell context after mount**

In `workspace.tsx`, add imports from the new context modules and
`useProjectFamiliars`.

Add state:

```ts
const [selectedWorkspaceProjectId, setSelectedWorkspaceProjectId] =
  useState<string | null>(null);
const [workspaceContextHydrated, setWorkspaceContextHydrated] = useState(false);
```

Replace the existing familiar-only mount restore with:

```ts
useEffect(() => {
  const storage = browserWorkspaceStorage();
  const restored = storage
    ? readWorkspaceContext(storage, getFamiliarScope())
    : { projectId: null, familiarIds: getFamiliarScope() };
  setSelectedWorkspaceProjectId(restored.projectId);
  setScopeIds(new Set(restored.familiarIds));
  setActiveFamiliarHydrated(true);
  setWorkspaceContextHydrated(true);
}, []);
```

Persist without deleting the legacy familiar keys:

```ts
useEffect(() => {
  if (!workspaceContextHydrated) return;
  const storage = browserWorkspaceStorage();
  if (storage) {
    writeWorkspaceContext(storage, {
      projectId: selectedWorkspaceProjectId,
      familiarIds: [...scopeIds],
    });
  }
  setFamiliarScope([...scopeIds]);
}, [selectedWorkspaceProjectId, scopeIds, workspaceContextHydrated]);
```

- [ ] **Step 4: Reconcile verified project crew**

Resolve the selected project from `registeredProjects`; if a settled registry
no longer contains the persisted id, announce and clear to All projects.

Load eligibility:

```ts
const selectedWorkspaceProject =
  registeredProjects.find((project) => project.id === selectedWorkspaceProjectId) ?? null;
const {
  familiars: projectCrewRecords,
  loading: projectCrewLoading,
  error: projectCrewError,
  loadedSuccessfully: projectCrewLoadedSuccessfully,
  reload: reloadProjectCrew,
} = useProjectFamiliars({ projectId: selectedWorkspaceProjectId });
const resolvedProjectCrew = useResolvedFamiliars(projectCrewRecords);
```

After `projectCrewLoadedSuccessfully`, reconcile:

```ts
useEffect(() => {
  if (!selectedWorkspaceProjectId || !projectCrewLoadedSuccessfully) return;
  const currentScope = familiarScopeFromIds(scopeIds);
  const nextScope = reconcileCrewForProject(
    currentScope,
    projectCrewRecords.map((familiar) => familiar.id),
  );
  if (nextScope.kind === "selected") {
    setScopeIds(new Set(nextScope.familiarIds));
  } else if (scopeIds.size > 0) {
    setScopeIds(new Set());
  }
}, [selectedWorkspaceProjectId, projectCrewRecords, projectCrewLoadedSuccessfully, scopeIds]);
```

Use an array-content/set equality guard before writing state so this effect does
not loop.

Derive:

```ts
const workspaceFamiliarScope = familiarScopeFromIds(scopeIds);
const eligibleFamiliarIds = selectedWorkspaceProject
  ? projectCrewRecords.map((familiar) => familiar.id)
  : resolvedFamiliars.map((familiar) => familiar.id);
const actingFamiliar = resolveActingFamiliar(
  workspaceFamiliarScope,
  eligibleFamiliarIds,
);
```

- [ ] **Step 5: Preserve surfaces on context changes**

Remove familiar-last-surface restoration from `selectFamiliarScope`. Keep its
role-surface suppression behavior and state update, but end after `setScopeIds`.
Context selection must not call `getLastSurface` or `setMode`.

Restore the saved crew for the destination project in the same transition. A
missing entry defaults to aggregate eligible crew, represented by an empty set:

```ts
const selectWorkspaceProject = useCallback((projectId: string | null) => {
  const storage = browserWorkspaceStorage();
  const storedCrew = storage ? readWorkspaceCrew(storage, projectId) : null;
  setScopeIds(new Set(storedCrew ?? []));
  setSelectedWorkspaceProjectId(projectId);
  announce(projectId
    ? `Project changed to ${registeredProjects.find((project) => project.id === projectId)?.name ?? "selected project"}`
    : "Showing all projects");
}, [announce, registeredProjects]);
```

Clear a deleted or unavailable project only after the operator registry settles:

```ts
useEffect(() => {
  if (!projectsLoadedSuccessfully || !selectedWorkspaceProjectId) return;
  if (registeredProjects.some((project) => project.id === selectedWorkspaceProjectId)) return;
  setSelectedWorkspaceProjectId(null);
  announce("Selected project is no longer available. Showing all projects.");
}, [
  announce,
  projectsLoadedSuccessfully,
  registeredProjects,
  selectedWorkspaceProjectId,
]);
```

- [ ] **Step 6: Forward context through both rails**

Add matching props to `SidebarMinimalProps` and `WorkspaceSidebarProps`, then
pass them unchanged into `SidebarRailHeader`.

Derive the notice in `workspace.tsx`:

```ts
const workspaceContextNotice =
  mode === "home" || mode === "chat"
    ? null
    : "Applies to new chats. This view is not filtered by project yet.";
```

At both workspace mount sites, pass:

```tsx
projects={registeredProjects}
projectId={selectedWorkspaceProjectId}
project={selectedWorkspaceProject}
projectLoading={projectsLoading}
projectError={projectsError}
reloadProjects={reloadProjects}
onProjectChange={selectWorkspaceProject}
createProjectOrThrow={createProjectOrThrow}
projectCrew={resolvedProjectCrew}
projectCrewLoading={projectCrewLoading}
projectCrewError={projectCrewError}
reloadProjectCrew={reloadProjectCrew}
contextNotice={workspaceContextNotice}
```

Do not filter Chat rows, Board cards, Queue work, Calendar items, or Code state
in this task.

- [ ] **Step 7: Run workspace and rail tests**

Run:

```bash
node --experimental-strip-types src/components/workspace-familiars-landing.test.ts
node --experimental-strip-types src/components/sidebar-minimal.test.ts
node --experimental-strip-types src/components/sidebar-rail-header.test.ts
node --experimental-strip-types src/components/workspace-sidebar-wiring.test.ts
```

Expected: all pass.

- [ ] **Step 8: Commit shell context**

```bash
git add src/components/workspace.tsx src/components/sidebar-minimal.tsx \
  src/components/workspace-sidebar.tsx \
  src/components/workspace-familiars-landing.test.ts
git commit -m "feat: own project crew context in workspace shell"
```

## Task 7: Gate actor-required launches

**Files:**
- Create: `src/components/acting-familiar-gate.tsx`
- Create: `src/components/acting-familiar-gate.test.ts`
- Modify: `src/components/workspace.tsx`
- Modify: `scripts/run-tests.mjs`

- [ ] **Step 1: Write the failing gate contract**

Create `src/components/acting-familiar-gate.test.ts`:

```ts
// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./acting-familiar-gate.tsx", import.meta.url), "utf8");

assert.match(source, /<Modal/, "actor selection is a focus-trapped modal");
assert.match(source, /breadcrumb=\{\[actionLabel, "Choose familiar"\]\}/);
assert.match(source, /eligibleFamiliars\.map/, "only verified project crew is listed");
assert.match(source, /onChoose\(familiar\.id\)/, "selection returns an explicit actor");
assert.match(source, /No familiars have access to this project/);
assert.match(source, /No familiars are available/);
assert.doesNotMatch(source, /eligibleFamiliars\[0\]/, "the gate never selects the first actor");

console.log("acting familiar gate contract passed");
```

Register it in `SUITES.app`.

- [ ] **Step 2: Verify the gate test fails**

Run:

```bash
node --experimental-strip-types src/components/acting-familiar-gate.test.ts
```

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement the modal**

Create `acting-familiar-gate.tsx` using `Modal`, `Button`,
`FamiliarAvatar`, and `EmptyState`:

```tsx
"use client";

import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { FamiliarAvatar } from "@/components/familiar-avatar";
import type { ResolvedFamiliar } from "@/lib/familiar-resolve";

export function ActingFamiliarGate({
  open,
  actionLabel,
  eligibleFamiliars,
  projectName,
  onChoose,
  onClose,
}: {
  open: boolean;
  actionLabel: string;
  eligibleFamiliars: ResolvedFamiliar[];
  projectName: string | null;
  onChoose: (familiarId: string) => void;
  onClose: () => void;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      breadcrumb={[actionLabel, "Choose familiar"]}
      footerActions={<Button variant="secondary" onClick={onClose}>Cancel</Button>}
    >
      {eligibleFamiliars.length === 0 ? (
        <EmptyState
          icon="ph:user-circle"
          headline={projectName
            ? "No familiars have access to this project"
            : "No familiars are available"}
          subtitle={projectName
            ? `Manage access for ${projectName} before continuing.`
            : "Summon a familiar before continuing."}
        />
      ) : (
        <div className="ui-list" role="list" aria-label="Eligible familiars">
          {eligibleFamiliars.map((familiar) => (
            <Button
              key={familiar.id}
              variant="ghost"
              fullWidth
              onClick={() => onChoose(familiar.id)}
            >
              <FamiliarAvatar familiar={familiar} size="sm" />
              <span>{familiar.display_name}</span>
            </Button>
          ))}
        </div>
      )}
    </Modal>
  );
}
```

`Button` accepts arbitrary children, so keep the avatar and name as children;
`leadingIcon` only accepts an `IconName` and must not receive `FamiliarAvatar`.

- [ ] **Step 4: Add one promise-based actor request**

In `workspace.tsx`, add request state and a resolver ref:

```ts
const [actingFamiliarRequestLabel, setActingFamiliarRequestLabel] =
  useState<string | null>(null);
const actingFamiliarRequestRef = useRef<{
  resolve: (familiarId: string | null) => void;
} | null>(null);
```

Add one request function. A second request cancels the first rather than leaving
an unresolved promise:

```ts
const requestActingFamiliar = useCallback((actionLabel: string) => {
  if (actingFamiliar.kind === "resolved") {
    return Promise.resolve(actingFamiliar.familiarId);
  }
  if (
    selectedWorkspaceProject
    && (!projectCrewLoadedSuccessfully || projectCrewError)
  ) {
    announce(projectCrewError ?? "Project crew is still loading");
    return Promise.resolve(null);
  }
  if (!selectedWorkspaceProject && !familiarRosterLoadedSuccessfully) {
    announce("Familiar roster is still loading");
    return Promise.resolve(null);
  }
  actingFamiliarRequestRef.current?.resolve(null);
  setActingFamiliarRequestLabel(actionLabel);
  return new Promise<string | null>((resolve) => {
    actingFamiliarRequestRef.current = { resolve };
  });
}, [
  actingFamiliar,
  announce,
  familiarRosterLoadedSuccessfully,
  projectCrewError,
  projectCrewLoadedSuccessfully,
  selectedWorkspaceProject,
]);

const finishActingFamiliarRequest = useCallback((familiarId: string | null) => {
  const pending = actingFamiliarRequestRef.current;
  actingFamiliarRequestRef.current = null;
  setActingFamiliarRequestLabel(null);
  pending?.resolve(familiarId);
}, []);

useEffect(() => () => {
  actingFamiliarRequestRef.current?.resolve(null);
  actingFamiliarRequestRef.current = null;
}, []);
```

Gate both shared rail New actions:

```ts
const startWorkspaceChat = useCallback(() => {
  void requestActingFamiliar("New chat").then((familiarId) => {
    if (!familiarId) return;
    startFamiliarChat(familiarId, selectedWorkspaceProject?.root ?? null);
  });
}, [requestActingFamiliar, selectedWorkspaceProject, startFamiliarChat]);
```

Render the gate once near the workspace root:

```tsx
<ActingFamiliarGate
  open={actingFamiliarRequestLabel !== null}
  actionLabel={actingFamiliarRequestLabel ?? "Choose familiar"}
  eligibleFamiliars={
    selectedWorkspaceProject ? resolvedProjectCrew : resolvedFamiliars
  }
  projectName={selectedWorkspaceProject?.name ?? null}
  onChoose={(familiarId) => finishActingFamiliarRequest(familiarId)}
  onClose={() => finishActingFamiliarRequest(null)}
/>
```

- [ ] **Step 5: Run gate and workspace tests**

Run:

```bash
node --experimental-strip-types src/components/acting-familiar-gate.test.ts
node --experimental-strip-types src/components/workspace-familiars-landing.test.ts
pnpm check:tests-wired
```

Expected: all pass.

- [ ] **Step 6: Commit actor gate**

```bash
git add src/components/acting-familiar-gate.tsx \
  src/components/acting-familiar-gate.test.ts \
  src/components/workspace.tsx scripts/run-tests.mjs
git commit -m "feat: require an explicit familiar for launches"
```

## Task 8: Migrate Home to shell context

**Files:**
- Modify: `src/components/home-composer.tsx`
- Modify: `src/components/home-composer.test.ts`
- Modify: `src/components/workspace.tsx`
- Modify: `src/lib/home-composer-context.ts`
- Modify: `src/lib/home-composer-context.test.ts`
- Modify: `src/components/composer-context-pill.tsx`
- Modify: `src/components/composer-context-pill.test.ts`

- [ ] **Step 1: Replace Home's local-scope assertions**

Update `home-composer.test.ts` to assert:

```ts
assert.match(source, /project: CaveProject \| null;/, "Home receives the shell project");
assert.match(source, /actingFamiliarId: string \| null;/, "Home receives the resolved actor");
assert.match(
  source,
  /onRequestActingFamiliar: \(actionLabel: string\) => Promise<string \| null>;/,
  "Home requests one actor before an aggregate mutation",
);
assert.doesNotMatch(
  source,
  /useProjects\(\{[\s\S]*familiarId: selectedFamiliarId/,
  "Home no longer creates a second familiar-scoped project authority",
);
assert.doesNotMatch(
  source,
  /const \[selectedProjectId, setSelectedProjectId\]/,
  "Home no longer persists an independent project selection",
);
assert.match(
  source,
  /await resolveActionFamiliar\("Send message"\)/,
  "aggregate Home launch asks the shared actor gate to resolve ownership",
);
assert.match(
  source,
  /<ComposerContextChips[\s\S]*showProject=\{false\}/,
  "Home does not duplicate the project-primary rail selector",
);
```

In `home-composer-context.test.ts`, remove tests for resolving an independent
selected project and its familiar-scoped launch-readiness message. Retain model,
runtime, and recent-content helper coverage that is independent of workspace
context.

In `composer-context-pill.test.ts`, add:

```ts
assert.match(source, /showProject\?: boolean;/, "callers can suppress a redundant project chip");
assert.match(
  source,
  /const showProject = props\.showProject \?\? true;/,
  "existing chat composers keep the project chip by default",
);
assert.match(
  source,
  /\{showProject \? \([\s\S]*aria-label=\{`Project:/,
  "the project trigger is omitted only when explicitly disabled",
);
```

- [ ] **Step 2: Verify Home tests fail**

Run:

```bash
node --experimental-strip-types src/components/home-composer.test.ts
node --experimental-strip-types src/lib/home-composer-context.test.ts
```

Expected: failures showing Home still owns `useProjects` and
`selectedProjectId`.

- [ ] **Step 3: Change the Home props**

Replace `activeFamiliarId` and `onSetActiveFamiliar` as Home's context authority
with:

```ts
project: CaveProject | null;
actingFamiliarId: string | null;
onRequestActingFamiliar: (actionLabel: string) => Promise<string | null>;
```

Keep `familiars` only for display lookup and recent-content rendering where
needed.

Remove:

- Home's `useProjects` call;
- `selectedProjectId`;
- recent-project fallback for new Home work;
- local project picker wiring from `ComposerContextChips`;
- local familiar switching from the Home composer;
- `projectLaunchReady` and `projectLaunchMessage`, because verified eligibility
  and retry now belong to `requestActingFamiliar` in the shell.

Derive:

```ts
const selectedFamiliar =
  familiars.find((familiar) => familiar.id === actingFamiliarId) ?? null;
const selectedProjectRoot = project?.root ?? "";
const resolveActionFamiliar = useCallback(
  (actionLabel: string) => actingFamiliarId
    ? Promise.resolve(actingFamiliarId)
    : onRequestActingFamiliar(actionLabel),
  [actingFamiliarId, onRequestActingFamiliar],
);
```

Keep model/runtime state keyed to the resolved acting familiar.

In `composer-context-pill.tsx`, add this property to `ComposerContextProps`:

```ts
showProject?: boolean;
```

Inside `ComposerContextChips`, immediately after `menu`, add:

```ts
const showProject = props.showProject ?? true;
```

Wrap the existing project trigger with this conditional, preserving its current
contents exactly:

```tsx
{showProject ? (
  <button
    ref={projectRef}
    type="button"
    className="cave-context-chip focus-ring"
    disabled={props.disabled}
    aria-haspopup="dialog"
    aria-expanded={menu === "project"}
    aria-label={`Project: ${projectLabel} — change project`}
    title={
      context.selectedProject
        ? `${context.selectedProject.root}${projectAccess ? ` · ${projectAccess} access` : ""}`
        : context.emptyProjectLabel
    }
    onClick={() => setMenu((current) => current === "project" ? null : "project")}
  >
    <span className="cave-context-chip__lead" aria-hidden>
      {context.selectedProject ? (
        <ProjectAvatar
          name={context.selectedProject.name}
          root={context.selectedProject.root}
          color={context.selectedProject.color}
          size="sm"
        />
      ) : (
        <Icon name="ph:folder" width={13} aria-hidden />
      )}
    </span>
    <span className="cave-context-chip__text">{projectLabel}</span>
    <Icon name="ph:caret-down" width={9} aria-hidden className="cave-context-chip__chevron" />
  </button>
) : null}
```

Leave the worktree, branch, and model controls in their current positions. Wrap
the existing `ProjectPickerPopover` separately:

```tsx
{showProject ? (
  <ProjectPickerPopover
    open={menu === "project"}
    onOpenChange={(open) => setMenu(open ? "project" : null)}
    anchorRef={projectRef}
    projects={context.config.projects}
    value={context.config.projectValue}
    onChange={context.config.onProjectChange}
    allowNoProject={context.config.allowNoProject}
    onAddProject={context.canAddProject ? context.addFlow.beginAddProject : undefined}
    addingProject={context.addFlow.adding}
    registerCurrentRoot={context.config.registerCurrentRoot}
    onRegisterCurrentRoot={context.config.onRegisterCurrentRoot}
    placement={context.config.popoverPlacement === "bottom-start" ? "bottom-start" : undefined}
    ariaLabel="Choose project"
  />
) : null}
```

- [ ] **Step 4: Gate Home actions**

In `invokeSkill`, replace its `!selectedFamiliarId` early return and use the
resolved id for the launch:

```ts
const actionFamiliarId = await resolveActionFamiliar("Run skill");
if (!actionFamiliarId) return;
if (!(await waitForRuntimeWrite())) {
  onToast("Runtime selection could not be saved; chat was not started.");
  return;
}
setText("");
onStartChat(buildSkillPrompt(skill, args), actionFamiliarId, selectedProjectRoot, {
  initialControls: initialChatControls,
});
```

In the slash-command launch path, resolve before clearing the draft:

```ts
const actionFamiliarId = await resolveActionFamiliar("Run command");
if (!actionFamiliarId) return;
if (!(await waitForRuntimeWrite())) {
  onToast("Runtime selection could not be saved; chat was not started.");
  return;
}
pushHistory(prompt);
setText("");
clearDraft();
clearAttachments();
onStartChat(prompt, actionFamiliarId, selectedProjectRoot, {
  initialControls: initialChatControls,
});
```

For the normal destination path, resolve once after prompt validation and before
the runtime-host branch or `switch (destination)`:

```ts
const actionLabel = destination === "board" ? "Create task" : "Send message";
const actionFamiliarId = await resolveActionFamiliar(actionLabel);
if (!actionFamiliarId) return;
```

Use `actionFamiliarId` in the Omnigent call, Chat `onStartChat`, and Board POST:

```ts
const outgoing: ChatAttachment[] | undefined =
  attachments.length ? attachments : undefined;
onStartChat(prompt, actionFamiliarId, project?.root ?? null, {
  initialControls: initialChatControls,
  initialAttachments: outgoing,
});
```

```ts
body: JSON.stringify({
  title: prompt,
  familiarId: actionFamiliarId,
  cwd: project?.root ?? null,
  projectId: project?.id ?? null,
  attachments: attachments.length ? attachments : undefined,
}),
```

For Voice, make `onSelect` async and request the actor before mutating:

```ts
onSelect: async () => {
  if (voiceCallPending) return;
  const actionFamiliarId = await resolveActionFamiliar("Start voice call");
  if (!actionFamiliarId) return;
  setVoiceCallPending(true);
  try {
    await onStartVoiceCall(actionFamiliarId, project?.root ?? null);
  } finally {
    setVoiceCallPending(false);
  }
},
```

Remove `!projectLaunchReady` from the Voice action's `disabled` expression and
from Chat submission guards. The shell request returns `null` while eligibility
is loading or failed, and only opens the actor gate after a verified response.

The actor request happens before `setText`, `clearDraft`, `clearAttachments`, or
the Board POST, so canceling the modal preserves the draft and staged files.

- [ ] **Step 5: Forward shell context to Home**

At the `HomeComposer` mount:

```tsx
project={selectedWorkspaceProject}
actingFamiliarId={
  actingFamiliar.kind === "resolved" ? actingFamiliar.familiarId : null
}
onRequestActingFamiliar={requestActingFamiliar}
```

At Home's `ComposerContextChips` call, keep its runtime/model props and pass
`showProject={false}`. The primary rail is the single project selector; Home
must not render a second project authority.

- [ ] **Step 6: Run Home and launch tests**

Run:

```bash
node --experimental-strip-types src/components/home-composer.test.ts
node --experimental-strip-types src/lib/home-composer-context.test.ts
node --experimental-strip-types src/components/home-chat-handoff.test.ts
node --experimental-strip-types src/components/voice-new-chat.test.ts
node --experimental-strip-types src/components/workspace-chat-handoff.test.ts
```

Expected: all pass.

- [ ] **Step 7: Commit Home pilot**

```bash
git add src/components/home-composer.tsx src/components/home-composer.test.ts \
  src/components/workspace.tsx src/lib/home-composer-context.ts \
  src/lib/home-composer-context.test.ts
git commit -m "feat: launch Home work from shell context"
```

## Task 9: Add daemon-less end-to-end coverage

**Files:**
- Create: `tests/project-primary-home.spec.ts`

- [ ] **Step 1: Write the failing E2E test**

Create `tests/project-primary-home.spec.ts`:

```ts
import { expect, test, type Page, type Route } from "@playwright/test";

const CODY = {
  id: "cody",
  display_name: "Cody",
  role: "Coding",
  status: "active",
  icon: "ph:code",
};
const NOVA = {
  id: "nova",
  display_name: "Nova",
  role: "Orchestrator",
  status: "active",
  icon: "ph:sparkle-fill",
};
const PROJECTS = [
  { id: "project-a", name: "Project A", root: "/repo/a", access: "write" },
  { id: "project-b", name: "Project B", root: "/repo/b", access: "write" },
];

function fulfillSse(route: Route) {
  return route.fulfill({
    status: 200,
    contentType: "text/event-stream",
    body: [
      `data: ${JSON.stringify({ kind: "assistant_chunk", text: "Ready." })}`,
      "",
      `data: ${JSON.stringify({ kind: "done", sessionId: "session-project-b" })}`,
      "",
      "",
    ].join("\n"),
  });
}

async function seed(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.setItem("cave:onboarding:dismissed", "1");
  });
  await page.route("**/api/familiars**", (route) => {
    const projectId = new URL(route.request().url()).searchParams.get("projectId");
    const familiars = projectId === "project-a" ? [CODY] : [CODY, NOVA];
    return route.fulfill({ json: { ok: true, familiars } });
  });
  await page.route("**/api/projects**", (route) =>
    route.fulfill({ json: { ok: true, projects: PROJECTS } }),
  );
  await page.route("**/api/sessions/list**", (route) =>
    route.fulfill({ json: { ok: true, sessions: [] } }),
  );
  await page.route("**/api/board**", (route) =>
    route.fulfill({ json: { ok: true, cards: [] } }),
  );
}

test("project scope, aggregate crew, and explicit actor reach one launch", async ({ page }) => {
  await seed(page);
  let launchBody: Record<string, unknown> | null = null;
  await page.route("**/api/chat/send", (route) => {
    launchBody = route.request().postDataJSON() as Record<string, unknown>;
    return fulfillSse(route);
  });

  await page.goto("/?mode=home");
  const projectTrigger = page.getByRole("button", { name: /Switch project/ }).first();
  await expect(projectTrigger).toBeVisible({ timeout: 45_000 });
  await projectTrigger.click();
  await page.getByText("Project B", { exact: true }).last().click();
  await expect(
    page.getByRole("button", { name: /Switch project.*Project B/ }).first(),
  ).toBeVisible();

  const crewTrigger = page.getByRole("button", { name: /scope: project crew/i }).first();
  await crewTrigger.click();
  await page.getByRole("option", { name: /Cody/ })
    .locator(".familiar-switcher__checkbox")
    .click();
  await page.getByRole("option", { name: /Nova/ })
    .locator(".familiar-switcher__checkbox")
    .click();
  await expect(page.getByRole("button", { name: /scope: 2 familiars/i }).first()).toBeVisible();

  await page.getByRole("button", { name: "New chat" }).first().click();
  const gate = page.getByRole("dialog", { name: /New chat.*Choose familiar/ });
  await expect(gate).toBeVisible();
  await gate.getByRole("button", { name: /Nova/ }).click();

  const composer = page.getByRole("textbox", { name: "Message" });
  await expect(composer).toBeVisible({ timeout: 45_000 });
  await composer.fill("Ship the project-primary launch.");
  await page.getByRole("button", { name: "Send" }).click();
  await expect.poll(() => launchBody).not.toBeNull();
  expect(launchBody?.familiarId).toBe("nova");
  expect(launchBody?.projectRoot).toBe("/repo/b");
});
```

- [ ] **Step 2: Run the E2E test and observe failure**

```bash
pnpm exec playwright test tests/project-primary-home.spec.ts
```

Expected: FAIL before final wiring, naming the first missing selector or modal.

- [ ] **Step 3: Fix only contract mismatches exposed by the test**

If the failure shows that the pending New-chat intent lost either actor or
project root, fix `ActingFamiliarGate` resumption in `workspace.tsx`. If it shows
an accessible-name mismatch, align the implementation to the names asserted
above. Do not weaken the assertions or add Chat/Board/Queue filtering.

- [ ] **Step 4: Run the E2E test again**

```bash
pnpm exec playwright test tests/project-primary-home.spec.ts
```

Expected: one passing spec with no daemon.

- [ ] **Step 5: Commit E2E coverage**

```bash
git add tests/project-primary-home.spec.ts
git commit -m "test: cover project crew Home launch"
```

## Task 10: Validate the Stage 1 slice

**Files:**
- Modify only files required by failures directly caused by this Stage 1 work

- [ ] **Step 1: Run targeted tests together**

```bash
node --experimental-strip-types src/lib/workspace-context.test.ts
node --experimental-strip-types src/lib/workspace-context-storage.test.ts
node --experimental-strip-types src/lib/use-project-familiars.test.ts
node --experimental-strip-types src/components/project-picker.test.ts
node --experimental-strip-types src/components/familiar-switcher.test.ts
node --experimental-strip-types src/components/workspace-context-switcher.test.ts
node --experimental-strip-types src/components/sidebar-rail-header.test.ts
node --experimental-strip-types src/components/acting-familiar-gate.test.ts
node --experimental-strip-types src/components/workspace-familiars-landing.test.ts
node --experimental-strip-types src/components/home-composer.test.ts
node --experimental-strip-types src/components/composer-context-pill.test.ts
node --experimental-strip-types src/lib/home-composer-context.test.ts
pnpm exec playwright test tests/project-primary-home.spec.ts
```

Expected: all pass.

- [ ] **Step 2: Run repository gates**

```bash
pnpm check:tests-wired
pnpm lint
pnpm typecheck
pnpm test:app
pnpm build
```

Expected: all exit 0.

- [ ] **Step 3: Run the desktop app for real-shell verification**

```bash
bash scripts/dev-app.sh
```

Verify:

- project row appears above crew in Home and Chat rails;
- Home/Chat toggle does not move or restyle either selector;
- Project B selection preserves the current room;
- collapsed rail shows project, crew, and New as stable squares;
- hover-peek reveals labels without relocation;
- Project crew with multiple selected members opens the actor gate on New;
- choosing an actor launches in the selected project;
- eligibility failure shows Retry and never exposes the previous project's crew;
- keyboard focus returns to selector triggers and the actor gate opener;
- reduced motion removes nonessential transitions.

Stop with Ctrl-C after verification.

- [ ] **Step 4: Inspect the final diff**

```bash
git diff --check
git status --short
git diff --stat origin/main...HEAD
```

Expected: no whitespace errors; only Stage 1 files are changed.

- [ ] **Step 5: Record Bead evidence**

```bash
bd update cave-gxntm --append-notes \
  "Stage 1 implementation verified in the managed worktree: context/storage unit tests, selector and Home integration tests, daemon-less Playwright, lint, typecheck, app suite, build, and real desktop rail check passed. Git status records whether the verified result remains uncommitted or has an explicitly authorized commit."
```

- [ ] **Step 6: Re-run the owning task after any correction**

When validation exposes a Stage 1 defect, return to the task that owns that
file, apply the correction there, and repeat that task's targeted test plus
Steps 1–4 above. Do not create an empty or catch-all validation commit.

## Stage 1 completion boundary

Stage 1 is complete only when:

- the shell visibly owns project and crew context;
- Home and shared New launch use the shell project;
- aggregate crew launches require an explicit actor;
- the previous project's crew cannot flash or remain selectable;
- context changes preserve the current compatible room;
- non-pilot surfaces have not been deceptively filtered;
- all targeted and repository gates pass;
- the desktop shell behavior has been checked in the Tauri app.

Create separate implementation plans for Stage 2 work-surface migration, Stage
3 role/global behavior, and Stage 4 mobile/iOS parity after Stage 1 lands and
its context API is stable.
