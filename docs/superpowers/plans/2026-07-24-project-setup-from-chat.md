# Project Setup From a Chat's Unregistered Folder — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a chat runs in an ad-hoc folder that maps to no registered Cave project, offer an in-place "Set up as project" flow (picker row + dismissible banner) that explains what registering entails and lets the human pick access for the chat's familiar and the familiar's access groups.

**Architecture:** A pure eligibility helper (`project-setup-offer.ts`) decides when the offer applies (chat resolved to `NO_PROJECT_ID` with an `unregisteredRoot` that is neither a registered project nor a project worktree). Two chat-view entry points open one new `ProjectSetupModal`, which registers via the existing `useProjects().createProject` (extended to carry `color`/`repoUrl`), grants the familiar via `POST /api/project-grants`, and patches group grants via `PATCH /api/access-groups/[id]` — all from the direct human click the grant routes require. A tiny `remote=1` mode on the existing `/api/changes` GET prefills the GitHub field.

**Tech Stack:** Next.js app router, React client components, node:test-style `*.test.ts` files run by `node scripts/run-tests.mjs`, design-token CSS utility classes, Phosphor icon subset.

**Spec:** `docs/superpowers/specs/2026-07-24-project-setup-from-chat-design.md` (approved).

**Worktree:** `.worktrees/feat-project-setup-from-chat` (branch `feat/project-setup-from-chat`, already created from `origin/main`). Run `pnpm install` there once before starting.

**Repo conventions that bind every task:**
- Tests are plain script files (`// @ts-nocheck`, `node:assert/strict`, `console.log("<name> OK")` at the end). Run one with `node --experimental-strip-types <path>`. Every new `*.test.ts` MUST also be appended to the right suite array in `scripts/run-tests.mjs` or `pnpm check:tests-wired` fails CI.
- Design gates: tokens only (no raw hex/px in render code), `.focus-ring` on interactive elements, reuse `src/components/ui/` primitives.
- Commits: signed (`git -c commit.gpgsign=true commit -S …` or rely on repo config), include the trailer `Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>`.
- Push the branch to origin after every commit (`git push origin feat/project-setup-from-chat`).

---

### Task 1: Pure eligibility helper — `project-setup-offer.ts`

**Files:**
- Create: `src/lib/project-setup-offer.ts`
- Create: `src/lib/project-setup-offer.test.ts`
- Modify: `scripts/run-tests.mjs` (register the test)

- [ ] **Step 1: Write the failing test**

Create `src/lib/project-setup-offer.test.ts`:

```ts
// @ts-nocheck
// The in-place "Set up as project" offer (spec 2026-07-24) applies ONLY to a
// chat actively running in an ad-hoc unregistered folder. Registered projects,
// bare No-project chats (familiar workspaces carry no unregisteredRoot), and
// `.worktrees/` checkouts (they authorize against their parent project) are
// all excluded — this matrix is the contract.
import assert from "node:assert/strict";
import {
  PROJECT_SETUP_COLOR_CHOICES,
  projectSetupCandidateRoot,
  projectSetupDismissKey,
} from "./project-setup-offer.ts";
import { NO_PROJECT_ID } from "./chat-projects.ts";

const projects = [{ id: "p1", name: "cave", root: "/code/cave" }];

// Ad-hoc unregistered root → offered, normalized (trailing slash stripped).
assert.equal(
  projectSetupCandidateRoot(
    { projectId: NO_PROJECT_ID, project: null, unregisteredRoot: "/code/other/" },
    projects,
  ),
  "/code/other",
);

// Backslashes normalize like every other root comparison in chat-projects.
assert.equal(
  projectSetupCandidateRoot(
    { projectId: NO_PROJECT_ID, project: null, unregisteredRoot: "C:\\code\\thing" },
    projects,
  ),
  "C:/code/thing",
);

// A registered-project selection → no offer.
assert.equal(
  projectSetupCandidateRoot({ projectId: "p1", project: projects[0] }, projects),
  null,
);

// Bare No-project (no unregisteredRoot — e.g. the familiar's own workspace,
// whose cwd is never surfaced) → no offer.
assert.equal(
  projectSetupCandidateRoot({ projectId: NO_PROJECT_ID, project: null }, projects),
  null,
);

// A root that IS a registered project (stale selection) → no offer.
assert.equal(
  projectSetupCandidateRoot(
    { projectId: NO_PROJECT_ID, project: null, unregisteredRoot: "/code/cave/" },
    projects,
  ),
  null,
);

// Worktree child of a registered project → no offer (parent-project auth).
assert.equal(
  projectSetupCandidateRoot(
    { projectId: NO_PROJECT_ID, project: null, unregisteredRoot: "/code/cave/.worktrees/feat-x" },
    projects,
  ),
  null,
);

// The `.worktrees` directory itself → no offer either.
assert.equal(
  projectSetupCandidateRoot(
    { projectId: NO_PROJECT_ID, project: null, unregisteredRoot: "/code/cave/.worktrees" },
    projects,
  ),
  null,
);

// A sibling that merely shares a path prefix is NOT a worktree child.
assert.equal(
  projectSetupCandidateRoot(
    { projectId: NO_PROJECT_ID, project: null, unregisteredRoot: "/code/cave-evil" },
    projects,
  ),
  "/code/cave-evil",
);

// Blank/whitespace unregisteredRoot → no offer.
assert.equal(
  projectSetupCandidateRoot(
    { projectId: NO_PROJECT_ID, project: null, unregisteredRoot: "   " },
    projects,
  ),
  null,
);

// Dismissal key is per NORMALIZED root, so `/x/` and `/x` share one dismissal.
assert.equal(projectSetupDismissKey("/code/other/"), "cave:project-setup-dismissed:/code/other");

// Fixed identity palette for the modal's swatch row: the projectTint recipe
// (same lightness/chroma, spread hues) so explicit colors match auto tints.
assert.equal(PROJECT_SETUP_COLOR_CHOICES.length, 6);
for (const color of PROJECT_SETUP_COLOR_CHOICES) {
  assert.match(color, /^oklch\(0\.74 0\.12 \d+\)$/);
}

console.log("project-setup-offer.test.ts OK");
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --experimental-strip-types src/lib/project-setup-offer.test.ts`
Expected: FAIL — `Cannot find module ... project-setup-offer.ts`

- [ ] **Step 3: Write the implementation**

Create `src/lib/project-setup-offer.ts`:

```ts
/**
 * project-setup-offer.ts
 *
 * Pure eligibility for the in-place "Set up as project" flow (spec
 * 2026-07-24): a chat actively running in an ad-hoc unregistered folder can be
 * promoted to a registered project without re-browsing to it. Deliberately
 * narrow — mirrors the containment discipline in chat-project-access.ts:
 *
 *   - Registered-project chats: nothing to offer.
 *   - Bare No-project chats (no unregisteredRoot): the recorded cwd is the
 *     familiar's own workspace or another dir the UI never re-asserts.
 *   - `.worktrees/<branch>` checkouts under a registered project: they
 *     authorize against the PARENT project by design, never become projects.
 */

import {
  NO_PROJECT_ID,
  normalizeChatProjectRoot,
  projectForRoot,
  type CaveProject,
  type ChatProjectSelection,
} from "./chat-projects.ts";

export function projectSetupCandidateRoot(
  selection: ChatProjectSelection,
  projects: CaveProject[],
): string | null {
  if (selection.projectId !== NO_PROJECT_ID) return null;
  const raw = selection.unregisteredRoot?.trim();
  if (!raw) return null;
  const root = normalizeChatProjectRoot(raw);
  if (projectForRoot(root, projects)) return null;
  const inProjectWorktrees = projects.some((project) => {
    const worktrees = `${normalizeChatProjectRoot(project.root)}/.worktrees`;
    return root === worktrees || root.startsWith(`${worktrees}/`);
  });
  if (inProjectWorktrees) return null;
  return root;
}

/** localStorage key for the banner's per-folder dismissal — normalized, so
 *  `/x` and `/x/` share one dismissal and the same folder never re-nags. */
export function projectSetupDismissKey(root: string): string {
  return `cave:project-setup-dismissed:${normalizeChatProjectRoot(root)}`;
}

/**
 * Fixed identity palette for the setup modal's color swatches. Same recipe as
 * comux-projects' projectTint (`oklch(0.74 0.12 <hue>)`) so explicit picks sit
 * in the same perceptual family as the auto root-hash tint; hues spread evenly
 * so adjacent swatches read as distinct on both themes. Data values (stored as
 * the project's color), not render-time CSS literals.
 */
export const PROJECT_SETUP_COLOR_CHOICES: readonly string[] = [
  25, 85, 145, 205, 265, 325,
].map((hue) => `oklch(0.74 0.12 ${hue})`);
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --experimental-strip-types src/lib/project-setup-offer.test.ts`
Expected: `project-setup-offer.test.ts OK`

- [ ] **Step 5: Register the test in the runner**

In `scripts/run-tests.mjs`, in the `app` suite array, add directly after the line `"src/lib/chat-add-project.test.ts",`:

```js
    "src/lib/project-setup-offer.test.ts",
```

Run: `pnpm check:tests-wired`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/lib/project-setup-offer.ts src/lib/project-setup-offer.test.ts scripts/run-tests.mjs
git commit -m "feat(chat): pure eligibility helper for in-place project setup

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
git push origin feat/project-setup-from-chat
```

---

### Task 2: Thread `color`/`repoUrl` through `CreateProjectOptions`

**Files:**
- Modify: `src/lib/chat-add-project.ts:8` (the `CreateProjectOptions` type)
- Modify: `src/lib/use-projects.ts:131-152` (`requestCreateProject` POST body)
- Modify: `src/lib/use-projects.test.ts` (append source-shape asserts)

`POST /api/projects` already accepts `color` and `repoUrl` (`src/app/api/projects/route.ts:66-82`); only the client hook drops them today.

- [ ] **Step 1: Write the failing test**

Insert above the file's final line (`console.log("use-projects.test.ts: ok");`) in `src/lib/use-projects.test.ts` (the file already reads `use-projects.ts` into `const source`):

```ts
// The setup modal registers with an explicit color and GitHub link in the
// same request — createProject must carry optional color/repoUrl through to
// the POST body the projects route already accepts.
assert.match(
  source,
  /body: JSON\.stringify\(\{\s*name,\s*root,\s*\.\.\.\(options\?\.color \? \{ color: options\.color \} : \{\}\),\s*\.\.\.\(options\?\.repoUrl \? \{ repoUrl: options\.repoUrl \} : \{\}\),\s*\}\)/,
  "createProject threads optional color/repoUrl into the POST body",
);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --experimental-strip-types src/lib/use-projects.test.ts`
Expected: FAIL — "createProject threads optional color/repoUrl into the POST body"

- [ ] **Step 3: Implement**

In `src/lib/chat-add-project.ts`, replace:

```ts
export type CreateProjectOptions = { emitMutation?: boolean };
```

with:

```ts
export type CreateProjectOptions = {
  emitMutation?: boolean;
  /** Explicit identity tint persisted on the project (absent → auto root-hash tint). */
  color?: string;
  /** Canonical GitHub link — callers must pre-normalize via normalizeGitHubRepoUrl. */
  repoUrl?: string;
};
```

In `src/lib/use-projects.ts`, inside `requestCreateProject`, replace:

```ts
        body: JSON.stringify({ name, root }),
```

with:

```ts
        body: JSON.stringify({
          name,
          root,
          ...(options?.color ? { color: options.color } : {}),
          ...(options?.repoUrl ? { repoUrl: options.repoUrl } : {}),
        }),
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --experimental-strip-types src/lib/use-projects.test.ts && node --experimental-strip-types src/lib/chat-add-project.test.ts`
Expected: both print `... OK` (chat-add-project's existing assertions still hold — the options object it checks, `{ emitMutation: false }`, is unchanged).

- [ ] **Step 5: Commit**

```bash
git add src/lib/chat-add-project.ts src/lib/use-projects.ts src/lib/use-projects.test.ts
git commit -m "feat(projects): createProject carries optional color/repoUrl to the API

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
git push origin feat/project-setup-from-chat
```

---

### Task 3: Add the `ph:folder-plus` icon

**Files:**
- Modify: `src/lib/icon.tsx:144` (the `ICON_NAMES` union — alphabetical `folder` cluster)
- Regenerate: the icon subset via `node scripts/generate-icon-subset.mjs` (commit whatever files it rewrites — `icon-subset.test.ts` fails CI otherwise)

- [ ] **Step 1: Add the name**

In `src/lib/icon.tsx`, in the `ICON_NAMES` list, after the line `"ph:folder-open-bold",` add:

```ts
  "ph:folder-plus",
```

- [ ] **Step 2: Regenerate the subset**

Run: `node scripts/generate-icon-subset.mjs`
Expected: exits 0 and rewrites the generated subset file(s). Run `git status --porcelain` to see exactly which files changed.

- [ ] **Step 3: Run the subset guard test**

Run: `node --experimental-strip-types src/lib/icon-subset.test.ts`
Expected: exit 0 (this is the guard that fails CI when the committed subset doesn't match `ICON_NAMES`).

- [ ] **Step 4: Commit**

```bash
git add -A src/lib
git commit -m "feat(icons): add ph:folder-plus for the project-setup affordances

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
git push origin feat/project-setup-from-chat
```

---

### Task 4: `remote=1` probe on the changes API

**Files:**
- Modify: `src/app/api/changes/route.ts:422-473` (GET) + new helper below it
- Modify: `src/app/api/changes/route.test.ts` (append asserts)

- [ ] **Step 1: Write the failing test**

Insert above the file's final line (`console.log("changes route.test.ts: ok");`) in `src/app/api/changes/route.test.ts`:

```ts
// remote=1 — read-only origin probe powering the project-setup modal's GitHub
// prefill. Must ride the same resolveRepoRoot containment as every other GET
// mode and go through execFile argv (no shell); an absent origin is a normal
// state (null), never an error.
assert.match(
  source,
  /if \(wantRemote !== null\) return await originRemoteUrl\(root\.repoRoot\);/,
  "remote=1 resolves through the shared resolveRepoRoot containment",
);
assert.match(
  source,
  /\["config", "--get", "remote\.origin\.url"\]/,
  "the origin probe reads git config through argv, not a shell",
);
assert.match(
  source,
  /NextResponse\.json\(\{ ok: true, remoteUrl: remoteUrl \|\| null \}\)/,
  "absent origin remotes resolve to remoteUrl: null, not an error",
);
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --experimental-strip-types src/app/api/changes/route.test.ts`
Expected: FAIL — "remote=1 resolves through the shared resolveRepoRoot containment"

- [ ] **Step 3: Implement**

In `src/app/api/changes/route.ts`, in `GET`, after the line
`const wantBranches = req.nextUrl.searchParams.get("branches");` add:

```ts
  const wantRemote = req.nextUrl.searchParams.get("remote");
```

Inside the `try` block, after `if (wantPr !== null) return await branchPr(root.repoRoot);` add:

```ts
    if (wantRemote !== null) return await originRemoteUrl(root.repoRoot);
```

After the `GET` function's closing brace, add the helper:

```ts
/** Origin remote URL for the repo, or null when no origin is configured —
 *  read-only probe behind the project-setup modal's GitHub prefill. */
async function originRemoteUrl(repoRoot: string): Promise<NextResponse> {
  try {
    const { stdout } = await git(repoRoot, ["config", "--get", "remote.origin.url"]);
    const remoteUrl = stdout.trim();
    return NextResponse.json({ ok: true, remoteUrl: remoteUrl || null });
  } catch {
    // `git config --get` exits 1 when the key is absent — a repo with no
    // origin remote is a normal state, not an error.
    return NextResponse.json({ ok: true, remoteUrl: null });
  }
}
```

(`git(...)` is the route's existing execFile wrapper — do not add imports.)

- [ ] **Step 4: Run to verify it passes**

Run: `node --experimental-strip-types src/app/api/changes/route.test.ts`
Expected: `... OK`

- [ ] **Step 5: Commit**

```bash
git add src/app/api/changes/route.ts src/app/api/changes/route.test.ts
git commit -m "feat(changes): remote=1 probe returns the origin URL for repo prefill

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
git push origin feat/project-setup-from-chat
```

---

### Task 5: `ProjectSetupModal`

**Files:**
- Create: `src/components/project-setup-modal.tsx`
- Create: `src/components/project-setup-modal.test.ts`
- Modify: `scripts/run-tests.mjs` (register the test)

- [ ] **Step 1: Write the failing test**

Create `src/components/project-setup-modal.test.ts`:

```ts
// @ts-nocheck
// ProjectSetupModal — the in-place "register this ad-hoc folder" flow (spec
// 2026-07-24). It must explain what registering entails, default the chat's
// familiar to write (the chat needs to keep running here) and groups to no
// access, honor Supreme's all-access status, and sequence create → familiar
// grant → group patches with a single registry emit — retrying after a
// partial failure without duplicating the project.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("./project-setup-modal.tsx", import.meta.url), "utf8");

// ── Explains what registering entails ──────────────────────────────────────
assert.match(src, /Registering makes this folder a project across the Cave/, "explainer copy present");
assert.match(src, /Familiars can only work in a project after you grant access/, "grant model explained");
assert.match(src, /changed later in Projects and Permissions/, "reversibility called out");

// ── Preference defaults ─────────────────────────────────────────────────────
assert.match(src, /useState<AccessChoice>\("write"\)/, "familiar access defaults to write");
assert.match(src, /groupLevels\[group\.id\] \?\? "none"/, "groups default to no access");
assert.match(src, /familiar\.id === supremeFamiliarId/, "Supreme is detected and grant-skipped");
assert.match(src, /has access to every project/, "Supreme renders as all-access, not a select");

// ── Submit sequence ─────────────────────────────────────────────────────────
assert.match(src, /emitMutation: false/, "creation suppresses its own emit (single fan-out)");
assert.match(src, /"\/api\/project-grants"/, "familiar grant goes to the grants route");
assert.match(src, /targetFamiliarId: familiar\.id/, "grant sends targetFamiliarId (never familiarId)");
assert.match(src, /`\/api\/access-groups\/\$\{group\.id\}`/, "group grants PATCH each group");
assert.match(
  src,
  /\.filter\(\(grant\) => grant\.projectId !== project\.id\)/,
  "group patch replaces any same-project grant instead of duplicating",
);
assert.match(src, /emitProjectRegistryMutation\(\)/, "registry listeners get refreshed");
assert.match(src, /setCreatedProject\(project\)/, "retry after partial failure skips re-creation");

// ── Prefill + validation ────────────────────────────────────────────────────
assert.match(src, /&remote=1/, "GitHub prefill probes the changes remote endpoint");
assert.match(src, /normalizeGitHubRepoUrl/, "repo input validates through the shared normalizer");
assert.match(src, /current\.trim\(\) \? current : /, "prefill never clobbers what the user typed");

// ── Primitives + a11y ───────────────────────────────────────────────────────
assert.match(src, /<Modal\b/, "built on the shared Modal (focus trap + return)");
assert.match(src, /useAnnouncer\(\)/, "completion is announced");
assert.match(src, /StandardSelect/, "access levels use the shared select primitive");
assert.match(src, /aria-pressed=/, "color swatches expose pressed state");
assert.match(src, /PROJECT_SETUP_COLOR_CHOICES/, "swatch palette comes from the lib, not render literals");

console.log("project-setup-modal.test.ts OK");
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --experimental-strip-types src/components/project-setup-modal.test.ts`
Expected: FAIL — cannot read `project-setup-modal.tsx`

- [ ] **Step 3: Write the component**

Create `src/components/project-setup-modal.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";

import { Icon } from "@/lib/icon";
import type { CaveProject } from "@/lib/cave-projects-types";
import { projectNameForRoot, type CreateProjectOptions } from "@/lib/chat-add-project";
import { projectTint } from "@/lib/comux-projects";
import { normalizeGitHubRepoUrl } from "@/lib/github-repo-link";
import type { ProjectAccessLevel } from "@/lib/project-access-levels";
import { emitProjectRegistryMutation } from "@/lib/project-registry-events";
import { PROJECT_SETUP_COLOR_CHOICES } from "@/lib/project-setup-offer";
import { Button } from "@/components/ui/button";
import { useAnnouncer } from "@/components/ui/live-region";
import { Modal } from "@/components/ui/modal";
import { StandardSelect, type StandardSelectOption } from "@/components/ui/select";

type AccessChoice = "none" | ProjectAccessLevel;

type SetupAccessGroup = {
  id: string;
  name: string;
  memberFamiliarIds: string[];
  projectGrants: { projectId: string; access?: ProjectAccessLevel }[];
};

const ACCESS_OPTIONS: StandardSelectOption<AccessChoice>[] = [
  { value: "none", label: "No access" },
  { value: "read", label: "Read" },
  { value: "write", label: "Write" },
];

/**
 * "Set up as project" — registers an ad-hoc chat folder as a Cave project in
 * place (spec 2026-07-24). One human-confirmed submit sequences: create the
 * project (with optional color + GitHub link) → grant the chat's familiar →
 * patch each chosen access group — every request fired from the direct click
 * the grant routes require (they reject relayed approvals). A partial failure
 * keeps the modal open naming the failed step; retry reuses the already
 * created project instead of duplicating it (addChatProject's two-step
 * semantics, including the partial-mutation registry emit).
 */
export function ProjectSetupModal({
  root,
  familiar,
  createProject,
  onClose,
  onCreated,
}: {
  /** Normalized ad-hoc folder being registered; null keeps the modal closed. */
  root: string | null;
  familiar: { id: string | null; name: string };
  /** From the caller's useProjects() so its local list updates in place. */
  createProject: (
    name: string,
    root: string,
    options?: CreateProjectOptions,
  ) => Promise<CaveProject | null>;
  onClose: () => void;
  onCreated: (projectId: string) => void;
}) {
  const { announce } = useAnnouncer();
  const [name, setName] = useState("");
  const [color, setColor] = useState<string | null>(null);
  const [repoDraft, setRepoDraft] = useState("");
  const [familiarAccess, setFamiliarAccess] = useState<AccessChoice>("write");
  const [groupLevels, setGroupLevels] = useState<Record<string, AccessChoice>>({});
  const [groups, setGroups] = useState<SetupAccessGroup[]>([]);
  const [supremeFamiliarId, setSupremeFamiliarId] = useState<string | null>(null);
  const [createdProject, setCreatedProject] = useState<CaveProject | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-seed per folder: prefill the name from the leaf, probe groups +
  // supreme (one grants fetch) and the git origin (GitHub prefill). Both
  // probes are best-effort — a failure leaves its section blank/hidden and
  // never blocks setup.
  useEffect(() => {
    if (!root) return;
    setName(projectNameForRoot(root));
    setColor(null);
    setRepoDraft("");
    setFamiliarAccess("write");
    setGroupLevels({});
    setCreatedProject(null);
    setBusy(false);
    setError(null);
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/project-grants", { cache: "no-store" });
        const data = (await res.json()) as {
          accessGroups?: SetupAccessGroup[];
          supremeFamiliarId?: string;
        };
        if (cancelled) return;
        setGroups(Array.isArray(data?.accessGroups) ? data.accessGroups : []);
        setSupremeFamiliarId(
          typeof data?.supremeFamiliarId === "string" ? data.supremeFamiliarId : null,
        );
      } catch {
        /* group section stays hidden; direct grant + creation still work */
      }
    })();
    void (async () => {
      try {
        const res = await fetch(
          `/api/changes?projectRoot=${encodeURIComponent(root)}&remote=1`,
          { cache: "no-store" },
        );
        const data = (await res.json()) as { remoteUrl?: string | null };
        if (cancelled) return;
        const normalized =
          typeof data?.remoteUrl === "string" ? normalizeGitHubRepoUrl(data.remoteUrl) : null;
        if (normalized) setRepoDraft((current) => (current.trim() ? current : normalized));
      } catch {
        /* prefill only — never blocks */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [root]);

  if (!root) return null;

  const isSupremeFamiliar = Boolean(familiar.id) && familiar.id === supremeFamiliarId;
  const memberGroups = familiar.id
    ? groups.filter((group) => group.memberFamiliarIds.includes(familiar.id as string))
    : [];

  const submit = async () => {
    if (busy) return;
    const trimmedName = name.trim() || projectNameForRoot(root);
    const trimmedRepo = repoDraft.trim();
    const normalizedRepo = trimmedRepo ? normalizeGitHubRepoUrl(trimmedRepo) : null;
    if (trimmedRepo && !normalizedRepo) {
      setError(
        "That doesn’t look like a GitHub repository. Try owner/repo or a https://github.com/owner/repo link.",
      );
      return;
    }
    setBusy(true);
    setError(null);
    // Creation succeeded but a later grant failed → the project exists, so
    // fan the partial registry mutation out before surfacing the error
    // (mirrors addChatProject).
    const failAfterCreate = (message: string) => {
      emitProjectRegistryMutation();
      setError(message);
    };
    try {
      let project = createdProject;
      if (!project) {
        project = await createProject(trimmedName, root, {
          emitMutation: false,
          ...(color ? { color } : {}),
          ...(normalizedRepo ? { repoUrl: normalizedRepo } : {}),
        });
        if (!project) {
          setError("Couldn’t register the project. Is the desktop reachable?");
          return;
        }
        setCreatedProject(project);
      }
      if (familiar.id && familiarAccess !== "none" && !isSupremeFamiliar) {
        const res = await fetch("/api/project-grants", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            targetFamiliarId: familiar.id,
            projectId: project.id,
            access: familiarAccess,
          }),
        });
        if (!res.ok) {
          failAfterCreate(`Project registered, but granting ${familiar.name} failed — retry, or grant it from Permissions.`);
          return;
        }
      }
      for (const group of memberGroups) {
        const level = groupLevels[group.id] ?? "none";
        if (level === "none") continue;
        const projectGrants = group.projectGrants
          .filter((grant) => grant.projectId !== project.id)
          .map((grant) => ({ projectId: grant.projectId, access: grant.access ?? "write" }));
        projectGrants.push({ projectId: project.id, access: level });
        const res = await fetch(`/api/access-groups/${group.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ projectGrants }),
        });
        if (!res.ok) {
          failAfterCreate(`Project registered, but granting the ${group.name} group failed — retry, or grant it from Permissions.`);
          return;
        }
      }
      emitProjectRegistryMutation();
      announce("Project created.");
      onCreated(project.id);
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      breadcrumb={["Projects", "Set up project"]}
      footerActions={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void submit()} loading={busy}>
            {busy ? "Creating…" : "Create project"}
          </Button>
        </>
      }
    >
      <div className="mb-3 flex items-center gap-2 text-[length:var(--text-xs)] text-[var(--text-muted)]">
        <Icon name="ph:folder-plus" width={13} aria-hidden />
        <span className="truncate" title={root}>
          {root}
        </span>
      </div>

      <p className="mb-4 text-[length:var(--text-sm)] leading-relaxed text-[var(--text-secondary)]">
        Registering makes this folder a project across the Cave — it shows up in project
        pickers, the Board, and chat rails. Familiars can only work in a project after you
        grant access; choose who starts with access below. Everything here can be changed
        later in Projects and Permissions.
      </p>

      <label className="block">
        <div className="mb-1.5 text-[length:var(--text-2xs)] uppercase tracking-widest text-[var(--text-muted)]">
          Project name
        </div>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-label="Project name"
          spellCheck={false}
          className="focus-ring w-full rounded-[var(--radius-control)] border border-[var(--border-hairline)] bg-[var(--bg-base)] px-3 py-2 text-[length:var(--text-sm)] text-[var(--text-primary)] outline-none"
        />
      </label>

      <div className="mt-4">
        <div className="mb-1.5 text-[length:var(--text-2xs)] uppercase tracking-widest text-[var(--text-muted)]">
          Color
        </div>
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Project color">
          <button
            type="button"
            onClick={() => setColor(null)}
            aria-pressed={color === null}
            aria-label="Automatic color from the folder path"
            title="Auto"
            className={`focus-ring h-6 w-6 rounded-md transition-transform hover:scale-110 ${
              color === null ? "ring-2 ring-[var(--accent-presence)]" : "ring-1 ring-[var(--border-strong)]"
            }`}
            style={{ background: projectTint(root) }}
          />
          {PROJECT_SETUP_COLOR_CHOICES.map((choice) => (
            <button
              key={choice}
              type="button"
              onClick={() => setColor(choice)}
              aria-pressed={color === choice}
              aria-label={`Use ${choice}`}
              title={choice}
              className={`focus-ring h-6 w-6 rounded-md transition-transform hover:scale-110 ${
                color === choice ? "ring-2 ring-[var(--accent-presence)]" : "ring-1 ring-[var(--border-strong)]"
              }`}
              style={{ background: choice }}
            />
          ))}
        </div>
        <p className="mt-1.5 text-[length:var(--text-xs)] text-[var(--text-muted)]">
          Auto derives a stable tint from the folder path.
        </p>
      </div>

      <label className="mt-4 block">
        <div className="mb-1.5 text-[length:var(--text-2xs)] uppercase tracking-widest text-[var(--text-muted)]">
          GitHub repository
        </div>
        <input
          value={repoDraft}
          onChange={(e) => {
            setRepoDraft(e.target.value);
            setError(null);
          }}
          placeholder="owner/repo or https://github.com/owner/repo"
          aria-label="GitHub repository"
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          className="focus-ring w-full rounded-[var(--radius-control)] border border-[var(--border-hairline)] bg-[var(--bg-base)] px-3 py-2 text-[length:var(--text-sm)] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"
        />
      </label>
      <p className="mt-1.5 text-[length:var(--text-xs)] text-[var(--text-muted)]">
        Optional — ties the project to a repository. Leave empty to skip.
      </p>

      <div className="mt-4">
        <div className="mb-1.5 text-[length:var(--text-2xs)] uppercase tracking-widest text-[var(--text-muted)]">
          {familiar.name}’s access
        </div>
        {isSupremeFamiliar ? (
          <p className="text-[length:var(--text-sm)] text-[var(--text-secondary)]">
            {familiar.name} has access to every project.
          </p>
        ) : familiar.id ? (
          <>
            <StandardSelect
              label={`${familiar.name}'s access`}
              value={familiarAccess}
              onChange={setFamiliarAccess}
              options={ACCESS_OPTIONS}
            />
            <p className="mt-1.5 text-[length:var(--text-xs)] text-[var(--text-muted)]">
              Write lets {familiar.name} run chats and edit files here; Read is read-only.
            </p>
          </>
        ) : (
          <p className="text-[length:var(--text-sm)] text-[var(--text-muted)]">
            No familiar in this chat — grant access from Permissions later.
          </p>
        )}
      </div>

      {memberGroups.length > 0 ? (
        <div className="mt-4">
          <div className="mb-1.5 text-[length:var(--text-2xs)] uppercase tracking-widest text-[var(--text-muted)]">
            {familiar.name}’s groups
          </div>
          <div className="flex flex-col gap-2">
            {memberGroups.map((group) => (
              <div key={group.id} className="flex items-center justify-between gap-3">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[length:var(--text-sm)] text-[var(--text-primary)]">
                    {group.name}
                  </span>
                  <span className="block text-[length:var(--text-2xs)] text-[var(--text-muted)]">
                    {group.memberFamiliarIds.length}{" "}
                    {group.memberFamiliarIds.length === 1 ? "member" : "members"}
                  </span>
                </span>
                <StandardSelect
                  label={`${group.name} group access`}
                  value={groupLevels[group.id] ?? "none"}
                  onChange={(level) =>
                    setGroupLevels((prev) => ({ ...prev, [group.id]: level }))
                  }
                  options={ACCESS_OPTIONS}
                />
              </div>
            ))}
          </div>
          <p className="mt-1.5 text-[length:var(--text-xs)] text-[var(--text-muted)]">
            Applies to every member of the group.
          </p>
        </div>
      ) : null}

      {error ? (
        <p
          className="mt-4 rounded-[var(--radius-control)] border border-[var(--danger-border)] bg-[var(--danger-bg)] px-3 py-1.5 text-[length:var(--text-xs)] text-[var(--danger-text)]"
          role="alert"
        >
          {error}
        </p>
      ) : null}
    </Modal>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --experimental-strip-types src/components/project-setup-modal.test.ts`
Expected: `project-setup-modal.test.ts OK`

- [ ] **Step 5: Register the test in the runner**

In `scripts/run-tests.mjs`, `app` suite, add directly after `"src/components/project-picker.test.ts",` (line ~650):

```js
    "src/components/project-setup-modal.test.ts",
```

Run: `pnpm check:tests-wired`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/components/project-setup-modal.tsx src/components/project-setup-modal.test.ts scripts/run-tests.mjs
git commit -m "feat(chat): ProjectSetupModal — register an ad-hoc folder with access prefs

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
git push origin feat/project-setup-from-chat
```

---

### Task 6: "Register this folder" row in `ProjectPickerPopover`

**Files:**
- Modify: `src/components/project-picker.tsx:112-240` (`ProjectPickerPopover`)
- Modify: `src/components/project-picker.test.ts` (append asserts)

- [ ] **Step 1: Write the failing test**

Append to `src/components/project-picker.test.ts`, above the final `console.log(...)`:

```ts
// ── In-place registration row (spec 2026-07-24) ─────────────────────────────
// A chat running in an ad-hoc unregistered folder offers to register THAT
// folder — no directory re-browse — above the generic Add-project row.
assert.match(src, /registerCurrentRoot\?: string;/, "picker takes the candidate root");
assert.match(src, /onRegisterCurrentRoot\?: \(\) => void;/, "and the setup-open callback");
assert.match(src, /Register this folder as a project…/, "in-place registration row");
assert.match(src, /ph:folder-plus/, "register row carries the folder-plus icon");
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --experimental-strip-types src/components/project-picker.test.ts`
Expected: FAIL — "picker takes the candidate root"

- [ ] **Step 3: Implement**

In `src/components/project-picker.tsx`, `ProjectPickerPopover`:

Add to the destructured props (after `onAddProject,`):

```tsx
  registerCurrentRoot,
  onRegisterCurrentRoot,
```

Add to the props type (after the `onAddProject?: () => void;` line and its comment):

```tsx
  /** Ad-hoc root the current chat runs in (spec 2026-07-24) — presence with
   *  onRegisterCurrentRoot enables the in-place "Register this folder" row. */
  registerCurrentRoot?: string;
  onRegisterCurrentRoot?: () => void;
```

Replace the footer block:

```tsx
        {onAddProject ? (
          <>
            <PopoverSeparator />
            <PopoverItem
              icon="ph:plus"
              disabled={addingProject}
              onSelect={() => {
                close();
                onAddProject();
              }}
            >
              {addingProject ? "Adding project…" : "Add project…"}
            </PopoverItem>
          </>
        ) : null}
```

with:

```tsx
        {(onRegisterCurrentRoot && registerCurrentRoot) || onAddProject ? (
          <PopoverSeparator />
        ) : null}
        {onRegisterCurrentRoot && registerCurrentRoot ? (
          <PopoverItem
            icon="ph:folder-plus"
            onSelect={() => {
              close();
              onRegisterCurrentRoot();
            }}
          >
            <span className="cave-project-picker__option">
              <span className="cave-project-picker__option-name">
                Register this folder as a project…
              </span>
              <span className="cave-project-picker__option-root">{registerCurrentRoot}</span>
            </span>
          </PopoverItem>
        ) : null}
        {onAddProject ? (
          <PopoverItem
            icon="ph:plus"
            disabled={addingProject}
            onSelect={() => {
              close();
              onAddProject();
            }}
          >
            {addingProject ? "Adding project…" : "Add project…"}
          </PopoverItem>
        ) : null}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --experimental-strip-types src/components/project-picker.test.ts`
Expected: `project-picker.test.ts OK`

- [ ] **Step 5: Commit**

```bash
git add src/components/project-picker.tsx src/components/project-picker.test.ts
git commit -m "feat(chat): in-place 'Register this folder' row in the project picker

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
git push origin feat/project-setup-from-chat
```

---

### Task 7: Pass-through props on the composer chips and session kebab

**Files:**
- Modify: `src/components/composer-context-pill.tsx:33-59` (props type) and both `<ProjectPickerPopover …>` instances (lines ~148 and ~266)
- Modify: `src/components/chat-session-header.tsx:18-155` (`SessionOverflowMenu`)

No new test file — Task 8's chat-view assertions cover the wiring end-to-end.

- [ ] **Step 1: Extend `ComposerContextProps`**

In `src/components/composer-context-pill.tsx`, add to `ComposerContextProps` (after the `createProject?:` member):

```tsx
  /** Ad-hoc root the chat runs in — enables the picker's in-place
   *  "Register this folder" row (spec 2026-07-24). */
  registerCurrentRoot?: string;
  onRegisterCurrentRoot?: () => void;
```

Add to **both** `<ProjectPickerPopover …>` usages in this file (one in `ComposerContextPickers`, one in `ComposerContextChips`), alongside `onAddProject={…}`:

```tsx
        registerCurrentRoot={context.config.registerCurrentRoot}
        onRegisterCurrentRoot={context.config.onRegisterCurrentRoot}
```

- [ ] **Step 2: Extend `SessionOverflowMenu`**

In `src/components/chat-session-header.tsx`, add to `SessionOverflowMenu`'s destructured props (after `onAddProject,`) and its props type (after the `onAddProject?: () => void;` member):

```tsx
  registerCurrentRoot,
  onRegisterCurrentRoot,
```

```tsx
  /** Ad-hoc root the chat runs in — enables the picker's in-place
   *  "Register this folder" row (spec 2026-07-24). */
  registerCurrentRoot?: string;
  onRegisterCurrentRoot?: () => void;
```

Add to its `<ProjectPickerPopover …>` (after `onAddProject={onAddProject}`):

```tsx
        registerCurrentRoot={registerCurrentRoot}
        onRegisterCurrentRoot={onRegisterCurrentRoot}
```

- [ ] **Step 3: Verify nothing broke**

Run: `node --experimental-strip-types src/components/project-picker.test.ts && node --experimental-strip-types src/components/composer-actions-menu.test.ts && node --experimental-strip-types src/components/composer-add-menu.test.ts`
Expected: all `... OK` (props are optional; existing call sites unchanged).

- [ ] **Step 4: Commit**

```bash
git add src/components/composer-context-pill.tsx src/components/chat-session-header.tsx
git commit -m "feat(chat): thread register-current-folder affordance to picker hosts

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
git push origin feat/project-setup-from-chat
```

---

### Task 8: Wire the offer into `chat-view` (candidate memo, banner, modal)

**Files:**
- Modify: `src/components/chat-view.tsx` — imports (~line 147/172), state after the `overflowAddProject` block (~line 2126), banner before `<div className="cave-composer-shell">` (~line 5843), kebab props (~line 5579), modal mount after `{overflowAddProject.addProjectModal}` (~line 5592), `ComposerContextChips` props (~line 6351)
- Modify: `src/components/chat-view.test.ts` (append asserts; the file reads chat-view.tsx into `source`)

- [ ] **Step 1: Write the failing test**

Append at the very end of `src/components/chat-view.test.ts` (the file ends with an `assert.match(...)`, not a `console.log`):

```ts
// ── In-place project setup for ad-hoc chat homes (spec 2026-07-24) ──────────
// Eligibility comes from the pure helper on the RESOLVED selection — so
// registered projects, familiar workspaces (no unregisteredRoot), and
// project worktrees never see the offer.
assert.match(
  source,
  /projectSetupCandidateRoot\(projectSelection, projects\)/,
  "the setup offer derives from the resolved selection via the pure helper",
);
// Banner dismissal persists per normalized root, so one folder never re-nags.
assert.match(
  source,
  /projectSetupDismissKey\(setupCandidateRoot\)/,
  "banner dismissal keys on the shared per-root helper",
);
assert.match(
  source,
  /Set up as project…/,
  "the banner offers setup in one click",
);
// Success rescopes the chat to the new project — same contract as the shared
// add flow (draft set + registry reload).
assert.match(
  source,
  /<ProjectSetupModal[\s\S]*?onCreated=\{\(newProjectId\) => \{\s*setProjectIdDraft\(newProjectId\);\s*reloadProjects\(\);/,
  "a created project becomes the chat's next-send selection",
);
// Both picker hosts (composer chips + session kebab) surface the register row.
assert.match(
  source,
  /<ComposerContextChips[\s\S]*?registerCurrentRoot=\{setupCandidateRoot \?\? undefined\}/,
  "composer chips carry the register-current-folder affordance",
);
assert.match(
  source,
  /<SessionOverflowMenu[\s\S]*?registerCurrentRoot=\{setupCandidateRoot \?\? undefined\}/,
  "the session kebab picker carries it too",
);
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --experimental-strip-types src/components/chat-view.test.ts`
Expected: FAIL — "the setup offer derives from the resolved selection via the pure helper"

- [ ] **Step 3: Add imports**

In `src/components/chat-view.tsx` add (near the existing `@/lib/chat-projects` import at ~line 147 and the `useAddProjectFlow` import at ~line 172):

```tsx
import { projectNameForRoot } from "@/lib/chat-add-project";
import { projectSetupCandidateRoot, projectSetupDismissKey } from "@/lib/project-setup-offer";
import { ProjectSetupModal } from "@/components/project-setup-modal";
```

(`Button`, `Icon`, `useState`, `useEffect` are already imported.)

- [ ] **Step 4: Add state**

Directly after the `overflowAddProject` `useAddProjectFlow({...});` block (~line 2126), add (plain const, not `useMemo` — `projectSelection` is a fresh object each render, so memoizing on it buys nothing):

```tsx
  // In-place registration for ad-hoc chat homes (spec 2026-07-24): a chat
  // running in an unregistered folder — not a project worktree, not a
  // familiar workspace — can be promoted to a registered project without
  // re-browsing to it. Pure eligibility lives in project-setup-offer.ts.
  const setupCandidateRoot = projectSetupCandidateRoot(projectSelection, projects);
  const [projectSetupRoot, setProjectSetupRoot] = useState<string | null>(null);
  // Default dismissed until the per-root localStorage read says otherwise, so
  // the banner never flashes for an already-dismissed folder.
  const [setupBannerDismissed, setSetupBannerDismissed] = useState(true);
  useEffect(() => {
    if (!setupCandidateRoot) {
      setSetupBannerDismissed(true);
      return;
    }
    try {
      setSetupBannerDismissed(
        localStorage.getItem(projectSetupDismissKey(setupCandidateRoot)) === "1",
      );
    } catch {
      setSetupBannerDismissed(true);
    }
  }, [setupCandidateRoot]);
  const dismissSetupBanner = () => {
    if (setupCandidateRoot) {
      try {
        localStorage.setItem(projectSetupDismissKey(setupCandidateRoot), "1");
      } catch {
        /* banner-only state — session dismissal still applies */
      }
    }
    setSetupBannerDismissed(true);
  };
```

- [ ] **Step 5: Render the banner**

Immediately before `<div className="cave-composer-shell">` (~line 5843), add:

```tsx
        {setupCandidateRoot && !setupBannerDismissed ? (
          <div
            role="status"
            className="mb-2 flex items-center gap-2 rounded-[var(--radius-control)] border border-[var(--border-hairline)] bg-[var(--bg-raised)] px-3 py-2 text-[length:var(--text-sm)] text-[var(--text-secondary)]"
          >
            <Icon
              name="ph:folder-plus"
              width={14}
              aria-hidden
              className="shrink-0 text-[var(--text-muted)]"
            />
            <span className="min-w-0 flex-1 truncate" title={setupCandidateRoot}>
              This chat runs in{" "}
              <span className="font-medium text-[var(--text-primary)]">
                {projectNameForRoot(setupCandidateRoot)}
              </span>
              , which isn’t a registered project.
            </span>
            <Button variant="ghost" onClick={() => setProjectSetupRoot(setupCandidateRoot)}>
              Set up as project…
            </Button>
            <button
              type="button"
              className="focus-ring grid h-5 w-5 shrink-0 place-items-center rounded text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
              aria-label="Dismiss project setup suggestion"
              onClick={dismissSetupBanner}
            >
              <Icon name="ph:x" width={11} aria-hidden />
            </button>
          </div>
        ) : null}
```

- [ ] **Step 6: Mount the modal and thread the pickers**

After `{overflowAddProject.addProjectModal}` (~line 5592), add:

```tsx
            <ProjectSetupModal
              root={projectSetupRoot}
              familiar={{ id: familiar.id ?? null, name: familiar.display_name }}
              createProject={createProject}
              onClose={() => setProjectSetupRoot(null)}
              onCreated={(newProjectId) => {
                setProjectIdDraft(newProjectId);
                reloadProjects();
              }}
            />
```

Add to the `<SessionOverflowMenu …>` props (~line 5579, after `onAddProject={…}`):

```tsx
                registerCurrentRoot={setupCandidateRoot ?? undefined}
                onRegisterCurrentRoot={
                  setupCandidateRoot ? () => setProjectSetupRoot(setupCandidateRoot) : undefined
                }
```

Add the same two props to `<ComposerContextChips …>` (~line 6351, after `createProject={createProject}`):

```tsx
                  registerCurrentRoot={setupCandidateRoot ?? undefined}
                  onRegisterCurrentRoot={
                    setupCandidateRoot ? () => setProjectSetupRoot(setupCandidateRoot) : undefined
                  }
```

- [ ] **Step 7: Run to verify it passes**

Run: `node --experimental-strip-types src/components/chat-view.test.ts`
Expected: `... OK` (all pre-existing assertions too).

If `reloadProjects` is not in scope at the modal mount, check what the `useProjects()` destructure in chat-view names it (`grep -n "reloadProjects\|reload" src/components/chat-view.tsx | head`) and use that binding — it is already used by `overflowAddProject`'s `onAdded`.

- [ ] **Step 8: Commit**

```bash
git add src/components/chat-view.tsx src/components/chat-view.test.ts
git commit -m "feat(chat): offer in-place project setup when a chat runs in an ad-hoc folder

Banner + picker rows gated on the pure eligibility helper; setup modal
registers the folder, grants the chat's familiar, and patches its access
groups, then rescopes the chat to the new project (spec 2026-07-24).

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
git push origin feat/project-setup-from-chat
```

---

### Task 9: Full gates + PR

**Files:** none new — verification only.

- [ ] **Step 1: Design + lint gates**

Run: `pnpm lint && pnpm codemod:design:check`
Expected: exit 0. If the design ESLint gate flags the swatch `style={{ background: … }}`: these are dynamic values (allowed by `no-static-inline-style`); a static-literal flag means a swatch got hardcoded — move the value back to `PROJECT_SETUP_COLOR_CHOICES`.

- [ ] **Step 2: Targeted test sweep**

Run:

```bash
node --experimental-strip-types src/lib/project-setup-offer.test.ts \
&& node --experimental-strip-types src/lib/use-projects.test.ts \
&& node --experimental-strip-types src/lib/chat-add-project.test.ts \
&& node --experimental-strip-types src/app/api/changes/route.test.ts \
&& node --experimental-strip-types src/components/project-setup-modal.test.ts \
&& node --experimental-strip-types src/components/project-picker.test.ts \
&& node --experimental-strip-types src/components/chat-view.test.ts \
&& node --experimental-strip-types src/components/composer-actions-menu.test.ts \
&& node --experimental-strip-types src/components/composer-add-menu.test.ts \
&& node --experimental-strip-types src/components/chat-view-polish-attachments-mentions.test.ts \
&& node --experimental-strip-types src/components/task-chat-cwd.test.ts \
&& pnpm check:tests-wired
```

Expected: every file prints `... OK`, wired-check exits 0.

- [ ] **Step 3: Full app suite + build**

Run: `node scripts/run-tests.mjs app` (long — expect several minutes) and `pnpm build` if the repo's PR checklist expects a local build (`Frontend build` is a required PR check either way).
Expected: exit 0.

- [ ] **Step 4: Open the PR**

```bash
gh pr create --base main --head feat/project-setup-from-chat \
  --title "feat(chat): set up an ad-hoc chat folder as a project, with familiar + group access" \
  --body "$(cat <<'EOF'
When a conversation opens in a folder that isn't a registered project (ad-hoc
opener cwd), the chat now offers to register it in place:

- **Eligibility** (`project-setup-offer.ts`, pure): resolved No-project selection
  with an `unregisteredRoot` that isn't a registered project or a project
  `.worktrees/` checkout. Familiar workspaces are never offered.
- **Entry points:** "Register this folder as a project…" row in the chat's
  project pickers (composer chip + session kebab), plus a per-folder
  dismissible banner above the composer.
- **Setup modal:** explains what registering entails; name (prefilled from the
  leaf), color (auto tint or fixed oklch palette), GitHub repo (prefilled from
  the new `/api/changes?remote=1` origin probe), access level for the chat's
  familiar (default write; Supreme shown as all-access), and per-group grants
  for the familiar's access groups (default none).
- **Submit:** create → familiar grant → group patches → single registry emit;
  partial failure keeps the modal open and retries without duplicating the
  project. All mutations ride the direct human click the grant routes require.
- Chat rescopes to the new project on success.

Spec: docs/superpowers/specs/2026-07-24-project-setup-from-chat-design.md (local).
EOF
)"
```

Wait for the required checks (`Frontend build`, `Rust check`, `E2E (Playwright)`, `Cross-environment required`, `Sidecar runtime required`, `CodeQL`), then:

```bash
gh pr merge <#> --squash --delete-branch
git worktree remove .worktrees/feat-project-setup-from-chat
git branch -D feat/project-setup-from-chat
```
