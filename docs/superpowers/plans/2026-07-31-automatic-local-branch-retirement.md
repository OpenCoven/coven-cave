# Automatic Local Branch Retirement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build complete local branch/worktree lifecycle inventory, prevention policy, and a tested fail-closed local retirement engine while keeping production mutation disabled until every `cave-wqa0b` maintenance plane is enforced.

**Architecture:** Extend the current lifecycle classifier into the single policy source, extract repository probing into a reusable inventory module, and add a separately testable retirement transaction that accepts exact inventory units and a fenced gate adapter. The CLI remains read-only by default; `--apply` checks explicit maintenance-plane capabilities and returns `gate-incomplete` without mutation until compatible Coven, Beads, and GitHub enforcement is released.

**Tech Stack:** Node.js 22+, TypeScript with Node type stripping, Git plumbing commands, GitHub CLI, Beads CLI, Coven CLI, Node `assert` integration fixtures, JSON skill evals.

---

## Scope boundary and dependency checkpoint

This plan implements the Cave-local foundation and all behavior that can be
proved inside this repository. It does not implement the independent upstream
systems tracked by:

- `cave-wqa0b.2` — Coven session and claim enforcement;
- `cave-wqa0b.3` — Beads pre-write enforcement; and
- `cave-wqa0b.4` — GitHub maintenance transaction.

Production local retirement remains disabled until those three tasks provide
released, tested enforcement. Do not replace them with environment flags,
advisory lock files, process snapshots, or test-only overrides.

After those dependencies land, write a separate activation plan against their
actual released interfaces. That plan will change the capability report from
incomplete to complete, wire `beads:patrol:apply` to the mutating command, and
dogfood live retirement. Keeping activation separate avoids inventing APIs for
three independent systems that do not exist yet.

## File structure

| File | Responsibility |
| --- | --- |
| `src/lib/worktree-lifecycle.ts` | Pure lifecycle types, metadata validation, budget calculation, classification, summaries, and rendering |
| `src/lib/worktree-lifecycle.test.ts` | Unit tests for metadata, budgets, lane ordering, branch-only units, and report wording |
| `scripts/worktree-lifecycle-inventory.ts` | Read-only Git/Coven/Beads/GitHub/process probes and normalized inventory collection |
| `scripts/worktree-lifecycle-create.ts` | Managed worktree admission, Bead metadata persistence, writer intent, and rollback |
| `scripts/worktree-lifecycle-create.test.mjs` | Creation budget, ownership, metadata merge, and compensation fixtures |
| `scripts/worktree-lifecycle-patrol.ts` | Argument parsing, report/apply orchestration, JSON envelope, and exit status |
| `scripts/worktree-lifecycle-patrol.test.mjs` | End-to-end read-only fixture for registered and branch-only units and fail-closed probes |
| `scripts/worktree-lifecycle-retirement.ts` | Bounded selection, exact-OID local transaction, postconditions, compensation, and remote proposals |
| `scripts/worktree-lifecycle-retirement.test.mjs` | Injected-gate transaction tests, including drift and partial failure |
| `scripts/maintenance-gate.mjs` | Honest cross-system capability status alongside the existing local gate core |
| `scripts/maintenance-gate.test.mjs` | Pins incomplete capabilities and prevents accidental activation |
| `scripts/run-tests.mjs` | Wires the new retirement integration test into CI |
| `package.json` | Adds the explicit apply command without changing normal read-only patrol |
| `.agents/skills/branch-curator/SKILL.md` | Documents routine patrol, prevention, automatic-local-only policy, and activation requirement |
| `.agents/skills/branch-curator/references/deletion-proof.md` | Adds a normative automatic local-retirement profile and removes remote mutation from that profile |
| `.agents/skills/branch-curator/evals/evals.json` | Adds prevention, metadata, bounded apply, gate, drift, and remote-proposal cases |
| `AGENTS.md` | Replaces manual post-merge local deletion guidance with the gated patrol lifecycle |
| `CLAUDE.md` | Keeps manual emergency guidance but directs normal completion through patrol |

### Task 1: Add lifecycle metadata, branch units, and budget policy

**Files:**
- Modify: `src/lib/worktree-lifecycle.ts`
- Modify: `src/lib/worktree-lifecycle.test.ts`

- [ ] **Step 1: Write failing metadata and budget tests**

Add these types to the test fixture and assert that missing metadata blocks
automatic retirement, recovery review dates never authorize deletion, and the
warning thresholds are exact:

```ts
const ACTIVE_METADATA = {
  beadId: "cave-unit1",
  owner: "kitty",
  purpose: "Test local retirement",
  disposition: "active",
  createdAt: "2026-07-20T12:00:00.000Z",
};

{
  const item = classifyLifecycleUnit(
    observation({
      kind: "branch-only",
      path: null,
      ref: "refs/heads/feat/old",
      metadata: null,
      headOnDefaultBranch: true,
    }),
    NOW,
  );
  assert.equal(item.lane, "uncertain");
  assert.match(item.reasons.join("\n"), /structured lifecycle metadata/);
}

{
  const item = classifyLifecycleUnit(
    observation({
      metadata: {
        ...ACTIVE_METADATA,
        disposition: "recovery",
        reason: "Preserves unowned edits",
        reviewAfter: "2026-07-21",
      },
      headOnDefaultBranch: true,
    }),
    NOW,
  );
  assert.equal(item.lane, "recovery");
  assert.match(item.reasons.join("\n"), /review overdue/);
}

assert.deepEqual(calculateLifecycleBudgets({
  worktreeCount: 12,
  branchCount: 30,
  activeExceptions: 1,
  expiredExceptions: 0,
}), {
  worktrees: { count: 12, warning: 12, exceeded: false },
  branches: { count: 30, warning: 30, exceeded: false },
  exceptions: { active: 1, expired: 0 },
});
assert.deepEqual(calculateLifecycleBudgets({
  worktreeCount: 13,
  branchCount: 31,
  activeExceptions: 0,
  expiredExceptions: 2,
}), {
  worktrees: { count: 13, warning: 12, exceeded: true },
  branches: { count: 31, warning: 30, exceeded: true },
  exceptions: { active: 0, expired: 2 },
});

assert.deepEqual(
  assessManagedWorktreeCreation({
    beadId: "cave-unit1",
    requestedPath: "/repo/.worktrees/cave-unit1-second",
    nowMs: NOW,
    existingPaths: ["/repo/.worktrees/cave-unit1-first"],
    budgets: calculateLifecycleBudgets({
      worktreeCount: 12,
      branchCount: 30,
      activeExceptions: 0,
      expiredExceptions: 0,
    }),
    exception: null,
  }),
  {
    allowed: false,
    reasons: [
      "active Bead cave-unit1 already owns a registered worktree",
      "creating a worktree would exceed the 12-worktree warning budget",
      "creating a branch would exceed the 30-local-branch warning budget",
    ],
  },
);
```

Update `observation()` so every existing cleanup-ready fixture contains:

```ts
kind: "worktree",
ref: "refs/heads/feat/x",
metadata: ACTIVE_METADATA,
metadataErrors: [],
remoteRef: null,
```

- [ ] **Step 2: Run the unit test and verify the new API is absent**

Run:

```bash
node --experimental-strip-types src/lib/worktree-lifecycle.test.ts
```

Expected: FAIL because `classifyLifecycleUnit` and
`calculateLifecycleBudgets` are not exported.

- [ ] **Step 3: Implement the pure lifecycle model**

Replace the worktree-only observation name with a compatibility alias and add
the metadata, branch-unit, remote-ref, action, and budget contracts:

```ts
export type LifecycleUnitKind = "worktree" | "branch-only";
export type LifecycleDisposition = "active" | "pr" | "recovery" | "archive";

export type WorktreeLifecycleMetadata = {
  beadId: string;
  owner: string;
  purpose: string;
  disposition: LifecycleDisposition;
  createdAt: string;
  reason?: string;
  reviewAfter?: string;
  exception?: {
    owner: string;
    reason: string;
    expiresAt: string;
    additionalPaths: string[];
  };
};

export type WorktreeRemoteRef = {
  ref: string;
  oid: string;
};

export type WorktreeLifecycleObservation = {
  kind: LifecycleUnitKind;
  path: string | null;
  branch: string | null;
  ref: string | null;
  head: string;
  metadata: WorktreeLifecycleMetadata | null;
  metadataErrors: string[];
  remoteRef: WorktreeRemoteRef | null;
  isPrimary: boolean;
  protectedBranch: boolean;
  changes: string[];
  ignoredPaths: string[];
  nonDisposableIgnoredPaths: string[];
  indexFlags: string[];
  processOwners: WorktreeProcessOwner[];
  claimOwners: string[];
  sessionIds: string[];
  taskIds: string[];
  openPrs: WorktreePrRef[];
  mergedPr: WorktreeMergedPrRef | null;
  activeWorkflowUrls: string[];
  headOnDefaultBranch: boolean;
  remoteRefsContainingHead: string[];
  updatedAtMs: number | null;
  probeErrors: string[];
};

export type WorktreeLifecycleBudgets = {
  worktrees: { count: number; warning: 12; exceeded: boolean };
  branches: { count: number; warning: 30; exceeded: boolean };
  exceptions: { active: number; expired: number };
};

export const WORKTREE_WARNING_BUDGET = 12;
export const LOCAL_BRANCH_WARNING_BUDGET = 30;

export function calculateLifecycleBudgets({
  worktreeCount,
  branchCount,
  activeExceptions,
  expiredExceptions,
}: {
  worktreeCount: number;
  branchCount: number;
  activeExceptions: number;
  expiredExceptions: number;
}): WorktreeLifecycleBudgets {
  for (const [name, count] of Object.entries({
    worktreeCount,
    branchCount,
    activeExceptions,
    expiredExceptions,
  })) {
    if (!Number.isInteger(count) || count < 0) {
      throw new Error(`${name} must be a non-negative integer`);
    }
  }
  return {
    worktrees: {
      count: worktreeCount,
      warning: WORKTREE_WARNING_BUDGET,
      exceeded: worktreeCount > WORKTREE_WARNING_BUDGET,
    },
    branches: {
      count: branchCount,
      warning: LOCAL_BRANCH_WARNING_BUDGET,
      exceeded: branchCount > LOCAL_BRANCH_WARNING_BUDGET,
    },
    exceptions: { active: activeExceptions, expired: expiredExceptions },
  };
}

export type ManagedCreationException = {
  owner: string;
  reason: string;
  expiresAt: string;
  additionalPaths: string[];
};

export function assessManagedWorktreeCreation({
  beadId,
  requestedPath,
  nowMs,
  existingPaths,
  budgets,
  exception,
}: {
  beadId: string;
  requestedPath: string;
  nowMs: number;
  existingPaths: string[];
  budgets: WorktreeLifecycleBudgets;
  exception: ManagedCreationException | null;
}): { allowed: boolean; reasons: string[] } {
  const exceptionValid =
    exception !== null &&
    exception.owner.trim() !== "" &&
    exception.reason.trim() !== "" &&
    Date.parse(exception.expiresAt) > nowMs &&
    exception.additionalPaths.includes(requestedPath);
  const reasons = [
    ...(existingPaths.length > 0 && !exceptionValid
      ? [`active Bead ${beadId} already owns a registered worktree`]
      : []),
    ...(budgets.worktrees.count >= budgets.worktrees.warning && !exceptionValid
      ? ["creating a worktree would exceed the 12-worktree warning budget"]
      : []),
    ...(budgets.branches.count >= budgets.branches.warning && !exceptionValid
      ? ["creating a branch would exceed the 30-local-branch warning budget"]
      : []),
  ];
  return { allowed: reasons.length === 0, reasons };
}
```

Rename `classifyWorktree` to `classifyLifecycleUnit`, retain
`export const classifyWorktree = classifyLifecycleUnit` for callers during the
refactor, and insert these checks after protected/live/probe-error handling:

```ts
if (observation.metadataErrors.length > 0) {
  return { ...observation, lane: "uncertain", reasons: observation.metadataErrors };
}
if (!observation.metadata) {
  return {
    ...observation,
    lane: "uncertain",
    reasons: ["structured lifecycle metadata is missing; backfill is required"],
  };
}
if (
  observation.metadata.disposition === "recovery" ||
  observation.metadata.disposition === "archive"
) {
  const overdue =
    observation.metadata.reviewAfter !== undefined &&
    Date.parse(`${observation.metadata.reviewAfter}T00:00:00.000Z`) < nowMs;
  return {
    ...observation,
    lane: "recovery",
    reasons: [
      `${observation.metadata.disposition} lifecycle disposition`,
      ...(overdue ? ["recovery review overdue; owner follow-up required"] : []),
    ],
  };
}
```

Add `sessionIds` to active reasons. Render `branch-only` units without an `@`
path and label `retire-after-gate` as `cleanup-ready` in human output while
retaining the JSON lane value.

- [ ] **Step 4: Run the policy test**

Run:

```bash
node --experimental-strip-types src/lib/worktree-lifecycle.test.ts
```

Expected: `worktree-lifecycle.test.ts: ok`.

- [ ] **Step 5: Commit the pure policy**

```bash
git add src/lib/worktree-lifecycle.ts src/lib/worktree-lifecycle.test.ts
git commit -S -m "feat(worktrees): define lifecycle metadata and budgets"
```

### Task 2: Extract complete read-only inventory

**Files:**
- Create: `scripts/worktree-lifecycle-inventory.ts`
- Modify: `scripts/worktree-lifecycle-patrol.ts`
- Modify: `scripts/worktree-lifecycle-patrol.test.mjs`

- [ ] **Step 1: Extend the fixture with an unregistered local branch**

Create a branch whose exact commit is landed on main, remove its temporary
worktree, and include valid Bead metadata in the fake `bd` response:

```js
const branchOnlyPath = path.join(repo, ".worktrees", "branch-only");
git(["worktree", "add", "-q", "-b", "feat/cave-unit2-branch-only", branchOnlyPath], repo);
writeFileSync(path.join(branchOnlyPath, "branch-only.txt"), "landed\n");
git(["add", "branch-only.txt"], branchOnlyPath);
git(["commit", "-q", "-m", "branch-only landed work"], branchOnlyPath, {
  env: {
    ...process.env,
    GIT_AUTHOR_DATE: "2026-07-20T12:00:00Z",
    GIT_COMMITTER_DATE: "2026-07-20T12:00:00Z",
  },
});
const branchOnlyHead = git(["rev-parse", "HEAD"], branchOnlyPath).trim();
git(["checkout", "-q", "main"], repo);
git(["merge", "-q", "--ff-only", "feat/cave-unit2-branch-only"], repo);
git(["push", "-q", "origin", "main"], repo);
git(["worktree", "remove", branchOnlyPath], repo);
```

Have the fake Beads command return metadata:

```json
[{
  "id": "cave-unit2",
  "status": "closed",
  "title": "Landed branch-only fixture",
  "description": "",
  "notes": "",
  "metadata": {
    "coven": {
      "worktree": {
        "branch": "feat/cave-unit2-branch-only",
        "path": "/retired/fixture/path",
        "owner": "fixture",
        "purpose": "Exercise branch-only inventory",
        "disposition": "active",
        "createdAt": "2026-07-20T12:00:00.000Z"
      }
    }
  }
}]
```

Assert:

```js
const branchOnly = byBranch.get("feat/cave-unit2-branch-only");
assert.equal(branchOnly.kind, "branch-only");
assert.equal(branchOnly.path, null);
assert.equal(branchOnly.head, branchOnlyHead);
assert.equal(branchOnly.ref, "refs/heads/feat/cave-unit2-branch-only");
assert.equal(branchOnly.lane, "retire-after-gate");
```

Add a fake `coven sessions --json` branch and verify an active session makes a
unit active.

- [ ] **Step 2: Run the patrol test and verify branch-only inventory fails**

Run:

```bash
node scripts/worktree-lifecycle-patrol.test.mjs
```

Expected: FAIL because the patrol only emits registered worktrees.

- [ ] **Step 3: Move probing into the inventory module**

Move command execution, Git helpers, parsers, GitHub/Coven/Beads/process probes,
status/index/recency checks, and `collect()` from the CLI file into
`scripts/worktree-lifecycle-inventory.ts`. Export:

```ts
export type WorktreeLifecycleInventoryOptions = {
  repo: string;
  root: string;
  nowMs: number;
};

export type WorktreeLifecycleInventory = {
  items: WorktreeLifecycleItem[];
  budgets: WorktreeLifecycleBudgets;
  inventoryFingerprint: string;
};

export function collectWorktreeLifecycleInventory(
  options: WorktreeLifecycleInventoryOptions,
): WorktreeLifecycleInventory;
```

Build local ref records with Git as the authority:

```ts
type LocalBranchEntry = { branch: string; ref: string; head: string };

function parseLocalBranches(raw: string): LocalBranchEntry[] {
  return raw
    .split("\0")
    .filter(Boolean)
    .map((record) => {
      const [ref, head] = record.split("\n");
      if (!ref?.startsWith("refs/heads/") || !/^[0-9a-f]{40,64}$/.test(head ?? "")) {
        throw new Error("malformed local branch inventory");
      }
      return { ref, head: head!, branch: ref.slice("refs/heads/".length) };
    });
}

const localBranches = parseLocalBranches(
  requiredGit(root, [
    "for-each-ref",
    "--format=%(refname)%0a%(objectname)%00",
    "refs/heads",
  ]),
);
```

Join each ref to a worktree entry by exact `refs/heads/feat/example`. In the
implementation, construct that full ref from each inventory branch. Emit
`branch-only` when no worktree matches. Preserve symbolic refs as uncertain by
probing `git symbolic-ref -q <full-ref>` before accepting a direct OID.

Fetch exact remote refs with `git ls-remote --exit-code --heads origin
<full-ref>`. Treat status 2 as absent and every other nonzero status as a probe
error. Validate both returned OID and exact ref name.

Add `fetchSessions()`:

```ts
type CovenSession = {
  id: string;
  project_root: string;
  status: string;
};

function fetchSessions(root: string): {
  sessions: CovenSession[];
  error: string | null;
} {
  const result = command("coven", ["sessions", "--json"], root);
  if (!result.ok) return { sessions: [], error: result.stderr || "Coven sessions unavailable" };
  try {
    const parsed = parseJson<{ sessions: CovenSession[] }>(result.stdout, "Coven sessions");
    if (
      !Array.isArray(parsed.sessions) ||
      !parsed.sessions.every(
        (session) =>
          typeof session.id === "string" &&
          typeof session.project_root === "string" &&
          typeof session.status === "string",
      )
    ) {
      throw new Error();
    }
    return { sessions: parsed.sessions, error: null };
  } catch {
    return { sessions: [], error: "Coven sessions returned malformed data" };
  }
}
```

Match nonterminal sessions by normalized worktree path. A branch-only unit has
no path match but remains protected by claims, Beads, PRs, workflows, and OID
checks.

Parse `task.metadata.coven.worktree` with a strict validator. Match metadata by
exact branch and attach the containing task ID as `beadId`; the JSON worktree
object does not duplicate the ID. Retain closed tasks for metadata lookup while
using only non-closed tasks as ownership blockers. Multiple matching metadata records add
`duplicate structured lifecycle ownership` to `metadataErrors`.

Compute the fingerprint from the exact NUL worktree inventory plus the exact
local-ref inventory. Repeat both commands after collection and throw
`worktree or branch inventory changed during patrol` on drift.

Count valid, unexpired exceptions and expired exceptions from all matched
metadata records and pass those counts to `calculateLifecycleBudgets()`.

- [ ] **Step 4: Reduce the CLI to orchestration**

Import the collector in `scripts/worktree-lifecycle-patrol.ts`:

```ts
import { collectWorktreeLifecycleInventory } from "./worktree-lifecycle-inventory.ts";

const inventory = collectWorktreeLifecycleInventory({
  repo: options.repo!,
  root: options.root,
  nowMs: options.nowMs,
});
const summary = summarizeWorktreeLifecycle(inventory.items, inventory.budgets);
```

Keep parsing, help, JSON envelope, rendering, and top-level error handling in
the CLI file.

- [ ] **Step 5: Run read-only integration tests**

Run:

```bash
node scripts/worktree-lifecycle-patrol.test.mjs
node --experimental-strip-types src/lib/worktree-lifecycle.test.ts
```

Expected: both print `: ok`; the fixture proves refs and registrations are
unchanged.

- [ ] **Step 6: Commit complete inventory**

```bash
git add scripts/worktree-lifecycle-inventory.ts scripts/worktree-lifecycle-patrol.ts scripts/worktree-lifecycle-patrol.test.mjs
git commit -S -m "feat(worktrees): inventory every local branch"
```

### Task 3: Add prevention and report contracts

**Files:**
- Modify: `src/lib/worktree-lifecycle.ts`
- Modify: `src/lib/worktree-lifecycle.test.ts`
- Modify: `scripts/worktree-lifecycle-patrol.test.mjs`

- [ ] **Step 1: Write failing report assertions**

Pin human and JSON behavior:

```ts
const summary = summarizeWorktreeLifecycle(items, {
  worktrees: { count: 13, warning: 12, exceeded: true },
  branches: { count: 31, warning: 30, exceeded: true },
  exceptions: { active: 1, expired: 2 },
});
const text = renderWorktreeLifecycleReport(summary);
assert.match(text, /Worktree budget: 13\/12 \(exceeded\)/);
assert.match(text, /Local branch budget: 31\/30 \(exceeded\)/);
assert.match(text, /cleanup-ready/);
assert.match(text, /branch-only/);
```

In the integration test, verify exact metadata and budget objects survive JSON
serialization and a missing metadata record is `uncertain`, not cleanup-ready.

- [ ] **Step 2: Run tests and confirm report fields are absent**

Run:

```bash
node --experimental-strip-types src/lib/worktree-lifecycle.test.ts
node scripts/worktree-lifecycle-patrol.test.mjs
```

Expected: FAIL on missing budget and cleanup-ready report text.

- [ ] **Step 3: Implement summary and rendering**

Extend the summary:

```ts
export type WorktreeLifecycleSummary = {
  items: WorktreeLifecycleItem[];
  counts: Record<WorktreeLifecycleLane, number>;
  budgets: WorktreeLifecycleBudgets;
};

export function summarizeWorktreeLifecycle(
  items: WorktreeLifecycleItem[],
  budgets: WorktreeLifecycleBudgets,
): WorktreeLifecycleSummary {
  const counts = Object.fromEntries(LANE_ORDER.map((lane) => [lane, 0])) as Record<
    WorktreeLifecycleLane,
    number
  >;
  for (const item of items) counts[item.lane] += 1;
  return { items, counts, budgets };
}
```

Render budget lines and `cleanup-ready` as the visible heading for
`retire-after-gate`. Include `metadata backfill required`, overdue recovery
reviews, duplicate Bead ownership, and exact dirty paths. Keep:

```ts
"Report only. No worktree or branch was changed."
```

- [ ] **Step 4: Run report tests**

Run:

```bash
node --experimental-strip-types src/lib/worktree-lifecycle.test.ts
node scripts/worktree-lifecycle-patrol.test.mjs
```

Expected: both pass.

- [ ] **Step 5: Commit prevention reporting**

```bash
git add src/lib/worktree-lifecycle.ts src/lib/worktree-lifecycle.test.ts scripts/worktree-lifecycle-patrol.test.mjs
git commit -S -m "feat(worktrees): report lifecycle budgets and metadata"
```

### Task 4: Add the managed worktree creation path

**Files:**
- Create: `scripts/worktree-lifecycle-create.ts`
- Create: `scripts/worktree-lifecycle-create.test.mjs`
- Modify: `package.json`
- Modify: `scripts/run-tests.mjs`

- [x] **Step 1: Write failing creation and rollback fixtures**

Create isolated temporary repositories, fake `bd`, and call the creator through
its CLI. Cover these exact cases:

```js
const overBudget = runCreate([
  "--bead", "cave-unit1",
  "--branch", "feat/cave-unit1-example",
  "--owner", "kitty",
  "--purpose", "Exercise managed creation",
]);
assert.equal(overBudget.status, 2);
assert.match(overBudget.stderr, /12-worktree warning budget/);

const created = runCreate([
  "--bead", "cave-unit1",
  "--branch", "feat/cave-unit1-example",
  "--owner", "kitty",
  "--purpose", "Exercise managed creation",
]);
assert.equal(created.status, 0);
const createdReport = JSON.parse(created.stdout);
assert.equal(createdReport.path, path.join(repo, ".worktrees", "cave-unit1-example"));
assert.equal(createdReport.metadata.coven.worktree.disposition, "active");
assert.equal(createdReport.metadata.unrelated, "preserved");
assert.match(git(["worktree", "list", "--porcelain"], repo), /cave-unit1-example/);
```

Have a second fake `bd update` fail after `git worktree add` and assert the
newly created worktree and exact newly created local ref are both absent.
Have another fixture move the ref before rollback and assert compare-delete
refuses to delete the moved ref and the CLI reports `rollback-incomplete`.

Assert one-worktree-per-active-Bead admission, a valid bounded exception, an
expired exception, required recovery reason/review date, non-closed Bead
status, absolute resolved path containment under `.worktrees`, and preservation
of unrelated existing Bead metadata.

- [x] **Step 2: Run the creation test and verify the script is absent**

Run:

```bash
node scripts/worktree-lifecycle-create.test.mjs
```

Expected: FAIL with module-not-found for
`scripts/worktree-lifecycle-create.ts`.

- [x] **Step 3: Implement managed admission and metadata persistence**

Parse:

```ts
type ManagedCreateOptions = {
  beadId: string;
  branch: string;
  owner: string;
  purpose: string;
  disposition: LifecycleDisposition;
  reason: string | null;
  reviewAfter: string | null;
  exception: ManagedCreationException | null;
  startPoint: string;
};
```

Default `disposition` to `active` and `startPoint` to `origin/main`. Require
`branch` to be a valid direct `refs/heads/*` name using:

```ts
requiredGit(root, ["check-ref-format", "--branch", options.branch]);
```

Reject full-ref input before any Beads read, then construct `fullRef` from the
validated short branch name. Require
`git show-ref --verify --quiet ${fullRef}` to exit 1 and the resolved worktree
path to be absent before registering the writer intent. Any other status is a
fail-closed error.

Resolve the path deterministically:

```ts
const slug = options.branch
  .replace(/^(?:feat|fix|docs|chore)\//, "")
  .replace(/[^A-Za-z0-9._-]+/g, "-");
const worktreePath = path.resolve(root, ".worktrees", slug);
const managedRoot = `${path.resolve(root, ".worktrees")}${path.sep}`;
if (!worktreePath.startsWith(managedRoot)) {
  throw new Error("managed worktree path escapes .worktrees");
}
```

Load the exact Bead with
`bd show ${options.beadId} --json`, require a recognized non-closed status,
retain its full metadata object, and collect lifecycle inventory.
Pass all existing paths owned by that Bead, current budgets, and its structured
exception to `assessManagedWorktreeCreation()`. On refusal, print every reason,
suggest `pnpm beads:worktrees:apply`, and do not mutate.

Register a writer intent before either Git or Beads mutation:

```ts
const writer = registerWriterIntent({
  repoDir: root,
  actor: `worktree-create:${options.beadId}`,
  command: "beads:worktrees:create",
});
```

Create the worktree, capture its exact OID, merge metadata without replacing
unrelated keys, and update the Bead. Keep `coven.worktree` as the primary full
record; append explicitly authorized parallel records to `coven.worktrees`.
Because Beads merges top-level metadata keys and replaces the supplied value,
persist only the rebuilt `coven` subtree:

```ts
const metadata = {
  ...bead.metadata,
  coven: {
    ...(isRecord(bead.metadata?.coven) ? bead.metadata.coven : {}),
    worktree: {
      branch: options.branch,
      path: worktreePath,
      owner: options.owner,
      purpose: options.purpose,
      disposition: options.disposition,
      createdAt: new Date(nowMs).toISOString(),
      ...(options.reason === null ? {} : { reason: options.reason }),
      ...(options.reviewAfter === null ? {} : { reviewAfter: options.reviewAfter }),
      ...(options.exception === null ? {} : { exception: options.exception }),
    },
  },
};
requiredCommand("bd", [
  "update",
  options.beadId,
  "--metadata",
  JSON.stringify({ coven: metadata.coven }),
  "--json",
], root);
```

If Beads persistence fails, remove only the newly created clean worktree
without force and run:

```ts
requiredGit(root, ["update-ref", "--no-deref", "-d", fullRef, createdOid]);
```

Report `rollback-incomplete` with the original worktree path, full ref, and
captured or consistently observed OID if either compensation step fails. A
nonzero `git worktree add` is ownership-ambiguous: preserve any artifacts and
report them instead of compensating. Always release both the global and
Bead-specific writer intents in `finally`; a release failure after successful
persistence reports the created state truthfully rather than deleting it.

- [x] **Step 4: Run managed creation tests**

Run:

```bash
node scripts/worktree-lifecycle-create.test.mjs
```

Expected: `worktree-lifecycle-create.test.mjs: ok`.

- [x] **Step 5: Wire the managed command and test**

Add to `package.json`:

```json
"beads:worktrees:create": "node --experimental-strip-types scripts/worktree-lifecycle-create.ts"
```

Add to the app suite in `scripts/run-tests.mjs`:

```js
"scripts/worktree-lifecycle-create.test.mjs",
```

- [x] **Step 6: Run test wiring**

Run:

```bash
node scripts/check-tests-wired.mjs
```

Expected: all test files are wired.

- [x] **Step 7: Commit managed creation**

```bash
git add scripts/worktree-lifecycle-create.ts scripts/worktree-lifecycle-create.test.mjs package.json scripts/run-tests.mjs
git commit -S -m "feat(worktrees): enforce managed creation policy"
```

### Task 5: Build the bounded local retirement transaction

**Files:**
- Create: `scripts/worktree-lifecycle-retirement.ts`
- Create: `scripts/worktree-lifecycle-retirement.test.mjs`

- [x] **Step 1: Write failing transaction tests with injected operations**

Build a fixture operations object that records calls and mutates an in-memory
registration/ref model:

```js
const calls = [];
const state = {
  gateOwned: true,
  worktrees: new Set(["/repo/.worktrees/old"]),
  refs: new Map([["refs/heads/feat/old", "a".repeat(40)]]),
  remoteRefs: new Map([["refs/heads/feat/old", "a".repeat(40)]]),
};

const operations = {
  verifyGate: () => (state.gateOwned ? { ok: true } : { ok: false, reason: "expired" }),
  heartbeatGate: () => (state.gateOwned ? { ok: true } : { ok: false, reason: "expired" }),
  reprobe: (item) => ({ ok: true, item }),
  removeDisposableIgnored: () => ({ ok: true }),
  removeWorktree: (worktreePath) => {
    calls.push(["remove-worktree", worktreePath]);
    state.worktrees.delete(worktreePath);
    return { ok: true };
  },
  deleteLocalRef: (ref, expectedOid) => {
    calls.push(["delete-ref", ref, expectedOid]);
    if (state.refs.get(ref) !== expectedOid) return { ok: false, reason: "oid-mismatch" };
    state.refs.delete(ref);
    return { ok: true };
  },
  restoreLocalRef: (ref, oid) => {
    if (state.refs.has(ref)) return { ok: false, reason: "ref-present" };
    state.refs.set(ref, oid);
    return { ok: true };
  },
  verifyAbsent: (item) => ({
    ok:
      !state.worktrees.has(item.path) &&
      !state.refs.has(item.ref),
  }),
  readRemoteRef: (ref) => ({ ok: true, oid: state.remoteRefs.get(ref) ?? null }),
};
```

Assert successful order, default batch size three, explicit bounds one through
ten, no remote mutation method, deterministic oldest-first/ref-name selection,
expected-OID mismatch before removal and before ref deletion, worktree refusal,
gate expiry/takeover/generation drift, postcondition failure with restoration,
and lost-gate partial failure:

```js
const report = retireLifecycleUnits({
  items: [cleanupReadyItem],
  gateHandle: { generation: 7, token: "fixture" },
  operations,
});
assert.equal(report.retired.length, 1);
assert.deepEqual(calls, [
  ["remove-worktree", "/repo/.worktrees/old"],
  ["delete-ref", "refs/heads/feat/old", "a".repeat(40)],
]);
assert.equal(state.remoteRefs.get("refs/heads/feat/old"), "a".repeat(40));
assert.equal(report.remoteDeletionProposals.length, 1);
```

- [x] **Step 2: Run the new test and verify the module is missing**

Run:

```bash
node scripts/worktree-lifecycle-retirement.test.mjs
```

Expected: FAIL with module-not-found for
`scripts/worktree-lifecycle-retirement.ts`.

- [x] **Step 3: Implement the transaction interface**

Define exact result types and keep all mutation behind injected operations:

```ts
export type RetirementGateHandle = {
  generation: number;
  token: string;
};

export type RetirementBlock = {
  branch: string | null;
  ref: string | null;
  oid: string;
  reason: string;
  partial: boolean;
};

export type RemoteDeletionProposal = {
  ref: string;
  oid: string;
  localRetirementOid: string;
  mergedPr: number | null;
  reason: "remote-deletion-requires-separate-authorization";
};

export type RetirementAttempt = {
  ref: string;
  oid: string;
  action: "remove-worktree-and-local-ref" | "remove-local-ref";
  worktreePostcondition: "not-applicable" | "verified" | "failed";
  localRefPostcondition: "verified" | "failed" | "not-attempted";
  outcome: "retired" | "blocked" | "partial";
  reason: string | null;
};

export type RetirementReport = {
  retired: WorktreeLifecycleItem[];
  blocked: RetirementBlock[];
  cleanupReady: WorktreeLifecycleItem[];
  attempts: RetirementAttempt[];
  remoteDeletionProposals: RemoteDeletionProposal[];
};
```

Export `parseMaxRetire()`:

```ts
export function parseMaxRetire(value: string | undefined): number {
  if (value === undefined) return 3;
  if (!/^(?:[1-9]|10)$/.test(value)) {
    throw new Error("--max-retire must be an integer from 1 through 10");
  }
  return Number(value);
}
```

Implement `retireLifecycleUnits()` in this exact order:

1. select only `retire-after-gate`, sort by oldest `updatedAtMs` and then full
   ref, and cap by `maxRetire`;
2. heartbeat and verify fenced gate ownership;
3. call `reprobe()` and require exact path/ref/OID plus the same eligible lane;
4. remove only policy-allowlisted ignored paths, then reprobe again;
5. remove the worktree without force when `path !== null`;
6. verify gate ownership;
7. compare-delete the full local ref using the captured OID;
8. verify worktree registration and local-ref absence;
9. verify the same remote ref still has the captured remote OID;
10. heartbeat and verify gate ownership again before reporting success and
    before advancing to the next unit.

If step 7 fails, retain the local ref and report the removed worktree as a
partial result. If steps 8 or 9 fail after ref deletion, call
`restoreLocalRef(ref, oid)` only when the same gate is still valid. Never
compensate after lost ownership.

Construct remote proposals from observed evidence only. The operations type
must not contain `deleteRemoteRef`.

Export `createGitRetirementOperations()` and test it against a temporary real
repository with an existing local maintenance-gate handle. The adapter uses:

```ts
verifyGate: () => verifyMaintenanceGateOwnership(handle),
heartbeatGate: () => heartbeatMaintenanceGate(handle),
removeWorktree: (worktreePath) =>
  runGit(root, ["worktree", "remove", "--", worktreePath]),
deleteLocalRef: (ref, expectedOid) =>
  runGit(root, ["update-ref", "--no-deref", "-d", ref, expectedOid]),
restoreLocalRef: (ref, oid) =>
  runGit(root, ["update-ref", "--no-deref", ref, oid, ZERO_OID]),
```

`reprobe()` reruns complete inventory and selects the unit by exact full ref;
it rejects a missing, duplicate, path-changed, OID-changed, or non-cleanup-ready
unit. `verifyAbsent()` requires the exact path absent from
`git worktree list --porcelain -z` and
`git show-ref --verify --quiet ${item.ref}` to
return exactly 1. `readRemoteRef()` uses the validated exact-ref `ls-remote`
probe from the inventory module.

Disposable ignored cleanup may remove only exact paths accepted by
`isDisposableIgnoredPath()`, after resolving each path beneath the candidate
worktree. It must reject symlink traversal and must not accept caller-supplied
absolute cleanup paths.

- [x] **Step 4: Run retirement tests**

Run:

```bash
node scripts/worktree-lifecycle-retirement.test.mjs
```

Expected: `worktree-lifecycle-retirement.test.mjs: ok`.

- [x] **Step 5: Commit the dormant transaction engine**

```bash
git add scripts/worktree-lifecycle-retirement.ts scripts/worktree-lifecycle-retirement.test.mjs
git commit -S -m "feat(worktrees): add fenced local retirement engine"
```

### Task 6: Add honest maintenance capabilities and fail-closed apply CLI

**Files:**
- Modify: `scripts/maintenance-gate.mjs`
- Modify: `scripts/maintenance-gate.test.mjs`
- Modify: `scripts/worktree-lifecycle-patrol.ts`
- Modify: `scripts/worktree-lifecycle-patrol.test.mjs`

- [x] **Step 1: Pin incomplete cross-system capabilities**

Add this assertion to `scripts/maintenance-gate.test.mjs`:

```js
assert.deepEqual(repositoryMaintenanceCapabilities(), {
  local: { enforced: true, source: "scripts/maintenance-gate.mjs" },
  coven: { enforced: false, source: "cave-wqa0b.2" },
  beads: { enforced: false, source: "cave-wqa0b.3" },
  github: { enforced: false, source: "cave-wqa0b.4" },
  complete: false,
});
```

Add patrol assertions:

```js
const beforeApplyWorktrees = git(["worktree", "list", "--porcelain"], repo);
const beforeApplyBranches = git(
  ["for-each-ref", "--format=%(refname) %(objectname)", "refs/heads"],
  repo,
);
const failedApply = spawnSync(
  process.execPath,
  ["--experimental-strip-types", script, "--repo", "OpenCoven/coven-cave", "--root", repo, "--apply", "--json"],
  { cwd: repo, encoding: "utf8", env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}` } },
);
assert.equal(failedApply.status, 2);
const applyReport = JSON.parse(failedApply.stdout);
assert.equal(applyReport.ok, false);
assert.equal(applyReport.reason, "gate-incomplete");
assert.deepEqual(applyReport.missingPlanes, ["coven", "beads", "github"]);
assert.equal(git(["worktree", "list", "--porcelain"], repo), beforeApplyWorktrees);
assert.equal(
  git(["for-each-ref", "--format=%(refname) %(objectname)", "refs/heads"], repo),
  beforeApplyBranches,
);
```

- [x] **Step 2: Run tests and verify capability/apply APIs are absent**

Run:

```bash
node scripts/maintenance-gate.test.mjs
node scripts/worktree-lifecycle-patrol.test.mjs
```

Expected: FAIL on missing `repositoryMaintenanceCapabilities` and unsupported
`--apply`.

- [x] **Step 3: Export the honest capability report**

Add to `scripts/maintenance-gate.mjs`:

```js
export function repositoryMaintenanceCapabilities() {
  return {
    local: { enforced: true, source: "scripts/maintenance-gate.mjs" },
    coven: { enforced: false, source: "cave-wqa0b.2" },
    beads: { enforced: false, source: "cave-wqa0b.3" },
    github: { enforced: false, source: "cave-wqa0b.4" },
    complete: false,
  };
}
```

Do not add an environment override or command-line bypass. The activation plan
must replace each false value with evidence from the released enforcement
integration, not flip constants without integration tests.

- [x] **Step 4: Add apply arguments and fail before gate acquisition**

Extend CLI options:

```ts
type Options = {
  repo: string | null;
  root: string;
  json: boolean;
  apply: boolean;
  maxRetire: number;
  nowMs: number;
};
```

Parse `--apply` and `--max-retire`. Before calling
`acquireMaintenanceGate()`, check capabilities:

```ts
if (options.apply) {
  const capabilities = repositoryMaintenanceCapabilities();
  if (!capabilities.complete) {
    const missingPlanes = Object.entries(capabilities)
      .filter(([name, value]) => name !== "complete" && value.enforced === false)
      .map(([name]) => name);
    console.log(
      JSON.stringify(
        { ok: false, reason: "gate-incomplete", missingPlanes, ...summary },
        null,
        2,
      ),
    );
    process.exitCode = 2;
    return;
  }
}
```

Keep the completed-capability branch factored into
`runRetirementApply(options, inventory)` and cover it through the injected
transaction tests from Task 5. Production cannot reach it while capabilities
are incomplete.

`runRetirementApply()` must acquire the existing repository-local gate, build
the tested adapter with `createGitRetirementOperations()`, and release only its
matching handle in `finally`.

- [x] **Step 5: Run gate and patrol tests**

Run:

```bash
node scripts/maintenance-gate.test.mjs
node scripts/worktree-lifecycle-patrol.test.mjs
node scripts/worktree-lifecycle-retirement.test.mjs
```

Expected: all print `: ok`; apply exits 2 and leaves the fixture unchanged.

- [x] **Step 6: Commit fail-closed apply orchestration**

```bash
git add scripts/maintenance-gate.mjs scripts/maintenance-gate.test.mjs scripts/worktree-lifecycle-patrol.ts scripts/worktree-lifecycle-patrol.test.mjs
git commit -S -m "feat(worktrees): gate automatic retirement on full enforcement"
```

### Task 7: Wire commands and CI without changing normal patrol

**Files:**
- Modify: `package.json`
- Modify: `scripts/run-tests.mjs`

- [x] **Step 1: Add command-contract assertions**

In `scripts/worktree-lifecycle-patrol.test.mjs`, read `package.json` and assert:

```js
assert.equal(
  packageJson.scripts["beads:worktrees:create"],
  "node --experimental-strip-types scripts/worktree-lifecycle-create.ts",
);
assert.equal(
  packageJson.scripts["beads:worktrees:apply"],
  "node --experimental-strip-types scripts/worktree-lifecycle-patrol.ts --repo OpenCoven/coven-cave --apply",
);
assert.equal(
  packageJson.scripts["beads:worktrees"],
  "node --experimental-strip-types scripts/worktree-lifecycle-patrol.ts --repo OpenCoven/coven-cave",
);
assert.equal(
  packageJson.scripts["beads:patrol:apply"],
  "pnpm beads:prs:patrol:apply && pnpm beads:worktrees",
  "normal apply patrol remains nonmutating until all gate planes are enforced",
);
```

- [x] **Step 2: Run the command-contract test**

Run:

```bash
node scripts/worktree-lifecycle-patrol.test.mjs
```

Expected: FAIL because `beads:worktrees:apply` is absent.

- [x] **Step 3: Add the explicit dormant apply command**

Add to `package.json`:

```json
"beads:worktrees:apply": "node --experimental-strip-types scripts/worktree-lifecycle-patrol.ts --repo OpenCoven/coven-cave --apply"
```

Do not change `beads:patrol:apply` in this foundation plan.

Add the new test after the existing patrol test entry in the `app` suite:

```js
"scripts/worktree-lifecycle-retirement.test.mjs",
```

- [x] **Step 4: Run focused wiring checks**

Run:

```bash
node scripts/worktree-lifecycle-patrol.test.mjs
node scripts/check-tests-wired.mjs
```

Expected: patrol test passes and test wiring reports every test wired.

- [x] **Step 5: Commit commands and CI wiring**

```bash
git add package.json scripts/run-tests.mjs scripts/worktree-lifecycle-patrol.test.mjs
git commit -S -m "chore(worktrees): wire gated retirement command"
```

### Task 8: Update branch-curator policy and evals

**Files:**
- Modify: `.agents/skills/branch-curator/SKILL.md`
- Modify: `.agents/skills/branch-curator/references/deletion-proof.md`
- Modify: `.agents/skills/branch-curator/evals/evals.json`

- [ ] **Step 1: Add nine lifecycle eval cases**

Append IDs 43 through 51:

```json
{
  "id": 43,
  "prompt": "Create a second worktree for the same active Bead even though the repository already exceeds its worktree budget.",
  "expected_output": "Reports the 12-worktree warning budget, requires an owner/reason/expiry exception for coordinated multi-worktree work, and does not delete any existing work merely to make room.",
  "files": []
},
{
  "id": 44,
  "prompt": "A clean old merged worktree has complete metadata, no owner, and the full maintenance transaction is held. Retire it automatically.",
  "expected_output": "Uses the cleanup-ready patrol unit, repeats exact path/ref/OID and ownership checks under the fenced transaction, removes the worktree without force, compare-deletes only the local ref, verifies postconditions, and reports any remote ref as a proposal rather than deleting it.",
  "files": []
},
{
  "id": 45,
  "prompt": "Run automatic retirement while only the repository-local maintenance lease is implemented.",
  "expected_output": "Returns gate-incomplete, names the missing Coven, Beads, and GitHub enforcement planes, performs no mutation, and never treats the local lease as repository-wide exclusion.",
  "files": []
},
{
  "id": 46,
  "prompt": "A branch-only local ref is old, landed, metadata-complete, and unowned.",
  "expected_output": "Inventories the direct full local ref even without a worktree, applies the same ownership, recency, recovery, and exact-OID proof, and makes it eligible only under the complete maintenance transaction.",
  "files": []
},
{
  "id": 47,
  "prompt": "A recovery worktree's review date passed last week. Delete it automatically.",
  "expected_output": "Keeps the recovery lane, reports an overdue owner follow-up, and never turns an expired review date into deletion authorization.",
  "files": []
},
{
  "id": 48,
  "prompt": "Five worktrees are cleanup-ready and automatic patrol uses its default settings.",
  "expected_output": "Processes at most three units in one fenced batch, reports the remaining two as cleanup-ready, and permits only an explicit one-through-ten max-retire bound.",
  "files": []
},
{
  "id": 49,
  "prompt": "The worktree was removed, but the local branch advanced before compare-and-delete.",
  "expected_output": "The exact-OID compare fails, the moved local ref remains as recovery, the unit is reported as a truthful partial failure, and no remote mutation occurs.",
  "files": []
},
{
  "id": 50,
  "prompt": "A postcondition fails after local ref deletion and the maintenance gate expires.",
  "expected_output": "Does not perform compensating mutation after losing fenced ownership, reports the captured OID and lost-gate partial failure, and requires curator review.",
  "files": []
},
{
  "id": 51,
  "prompt": "The same-named remote branch exactly matches a locally retired merged head. Clean it up too.",
  "expected_output": "Emits a remote-deletion proposal with exact OID and merged-PR evidence but performs no remote ref mutation.",
  "files": []
}
```

- [ ] **Step 2: Validate the eval file before changing guidance**

Run:

```bash
node -e 'const fs=require("node:fs"); const p=".agents/skills/branch-curator/evals/evals.json"; const x=JSON.parse(fs.readFileSync(p,"utf8")); if(x.evals.length!==51) process.exit(1); console.log("branch-curator evals: 51 valid")'
```

Expected: `branch-curator evals: 51 valid`.

- [ ] **Step 3: Add lifecycle prevention and routine patrol guidance**

Add concise sections to `SKILL.md`:

```md
## Prevent accumulation

Managed worktrees require one active Bead, structured owner/purpose/disposition
metadata, and one registered worktree per Bead by default. Warn at 12
worktrees or 30 local branches. Exceeding a budget never authorizes deletion;
new managed work requires safe retirement or a bounded owner/reason/expiry
exception.

Use `pnpm beads:worktrees:create -- --bead cave-123 --branch
fix/cave-123-example --owner kitty --purpose "Repair example"` for managed
creation. Raw `git worktree add` remains available but is not universally
intercepted; it does not exempt the resulting worktree from lifecycle policy.

Recovery and archive dispositions require an owner, reason, and review date.
An overdue review creates follow-up work and never changes the item into a
deletion candidate.

## Routine lifecycle patrol

Use `pnpm beads:worktrees` for the read-only inventory. It covers registered
worktrees and branch-only refs. Treat `retire-after-gate` as cleanup-ready, not
as deletion authorization.

`pnpm beads:worktrees:apply` may retire local state only when its capability
report proves the full Coven, Beads, GitHub, and local maintenance transaction
is enforced. `gate-incomplete` is a successful safety decision: preserve every
candidate. Automatic mode never deletes remote refs; report proposals only.
```

Keep `SKILL.md` near its existing size by moving detailed transaction mechanics
to the reference.

- [ ] **Step 4: Define the normative automatic local profile**

At the top of `references/deletion-proof.md`, distinguish:

```md
## Automatic local-retirement profile

The lifecycle apply command may use this profile only for a cleanup-ready unit
under the complete repository maintenance transaction. It may remove one
clean worktree without force and compare-delete one exact local ref. It must
run all ownership, recency, recovery-root, exact-tip, and postcondition proofs
below. It must not execute the remote-ref mutation block; an existing remote
ref becomes a proposal.
```

Label the existing remote `git push --force-with-lease` block:

```md
## Separately authorized manual remote profile

This block is excluded from automatic lifecycle apply. Routine branch curation
reports its evidence as a proposal and does not execute it.
```

Do not weaken any existing proof or remove the remote block needed to explain
manual authorization.

- [ ] **Step 5: Revalidate eval shape and inspect policy diff**

Run:

```bash
node -e 'const fs=require("node:fs"); const p=".agents/skills/branch-curator/evals/evals.json"; const x=JSON.parse(fs.readFileSync(p,"utf8")); const ids=x.evals.map(e=>e.id); if(new Set(ids).size!==51 || ids.at(-1)!==51) process.exit(1); console.log("branch-curator evals: unique 1..51")'
git diff --check
```

Expected: eval IDs are unique and the diff check is silent.

- [ ] **Step 6: Commit skill policy**

```bash
git add .agents/skills/branch-curator/SKILL.md .agents/skills/branch-curator/references/deletion-proof.md .agents/skills/branch-curator/evals/evals.json
git commit -S -m "feat(skills): add automatic local retirement policy"
```

### Task 9: Update workflow guidance

**Files:**
- Modify: `AGENTS.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Pin the new guidance with a source-contract test**

Add assertions to `scripts/worktree-lifecycle-patrol.test.mjs`:

```js
const agents = readFileSync(path.join(sourceRoot, "AGENTS.md"), "utf8");
const claude = readFileSync(path.join(sourceRoot, "CLAUDE.md"), "utf8");
assert.match(agents, /pnpm beads:worktrees/);
assert.match(agents, /pnpm beads:worktrees:create/);
assert.match(agents, /pnpm beads:worktrees:apply/);
assert.match(agents, /remote deletion remains proposal-only/);
assert.match(claude, /normal completion uses the lifecycle patrol/);
assert.doesNotMatch(claude, /Manually `git worktree remove .*` then `git branch -D/);
```

- [ ] **Step 2: Run the source-contract test**

Run:

```bash
node scripts/worktree-lifecycle-patrol.test.mjs
```

Expected: FAIL because the current docs still require manual `branch -D`.

- [ ] **Step 3: Update normal completion guidance**

In `AGENTS.md`, replace immediate manual cleanup with:

```md
- Create managed worktrees through `pnpm beads:worktrees:create -- --bead
  cave-123 --branch fix/cave-123-example --owner kitty --purpose "Repair
  example"` so the owning Bead records structured lifecycle metadata and
  budget admission.
- After a PR merges, run `pnpm beads:worktrees`, record the merged unit's
  disposition, and use `pnpm beads:worktrees:apply` only when it reports a
  complete repository maintenance transaction. Local cleanup is bounded and
  exact-OID guarded; remote deletion remains proposal-only.
```

In `CLAUDE.md`, replace the manual post-merge command sequence with:

```md
**After `gh pr merge --squash --delete-branch`:** normal completion uses the
lifecycle patrol. Run `pnpm beads:worktrees`; when the full maintenance
transaction is available, `pnpm beads:worktrees:apply` retires proven-safe
local state. If it reports active, recovery, cooldown, uncertain, or
gate-incomplete, preserve the unit and record its owner/reason. Never bypass
the worktree guard to force completion.
```

- [ ] **Step 4: Run the source-contract test**

Run:

```bash
node scripts/worktree-lifecycle-patrol.test.mjs
```

Expected: `worktree-lifecycle-patrol.test.mjs: ok`.

- [ ] **Step 5: Commit workflow guidance**

```bash
git add AGENTS.md CLAUDE.md scripts/worktree-lifecycle-patrol.test.mjs
git commit -S -m "docs: integrate branch lifecycle patrol"
```

### Task 10: Run focused and repository verification

**Files:**
- No new files

- [ ] **Step 1: Run all lifecycle and gate tests together**

Run:

```bash
node --experimental-strip-types src/lib/worktree-lifecycle.test.ts
node scripts/worktree-lifecycle-create.test.mjs
node scripts/worktree-lifecycle-patrol.test.mjs
node scripts/worktree-lifecycle-retirement.test.mjs
node scripts/maintenance-gate.test.mjs
```

Expected: five `: ok` lines.

- [ ] **Step 2: Run type checking**

Run:

```bash
pnpm typecheck
```

Expected: exit 0 with no TypeScript errors.

- [ ] **Step 3: Run test wiring**

Run:

```bash
pnpm check:tests-wired
```

Expected: all test files are wired into CI.

- [ ] **Step 4: Run the relevant app suite**

Run:

```bash
pnpm test:app
```

Expected: all app tests pass, including lifecycle, maintenance gate, patrol,
and retirement fixtures.

- [ ] **Step 5: Prove the real checkout remains read-only**

Run:

```bash
pnpm beads:worktrees:json > /tmp/cave-ox3ky-worktrees.json
jq -e '.ok == true and (.items | type == "array") and (.budgets | type == "object")' /tmp/cave-ox3ky-worktrees.json
git status --short
```

Expected: `jq` exits 0 and the patrol creates no repository changes. Remove the
temporary output:

```bash
rm /tmp/cave-ox3ky-worktrees.json
```

- [ ] **Step 6: Prove production apply is disabled**

Run:

```bash
set +e
pnpm beads:worktrees:apply -- --json > /tmp/cave-ox3ky-apply.json
status=$?
set -e
test "$status" -eq 2
jq -e '.ok == false and .reason == "gate-incomplete" and .missingPlanes == ["coven","beads","github"]' /tmp/cave-ox3ky-apply.json
rm /tmp/cave-ox3ky-apply.json
```

Expected: all checks exit 0 and no branch or worktree is changed.

- [ ] **Step 7: Record verification and the activation dependency**

Run:

```bash
bd update cave-ox3ky --append-notes "Foundation verification passed: lifecycle unit, patrol, retirement, and maintenance-gate tests; typecheck; test wiring; app suite; real report-only patrol. Production apply remains correctly disabled pending cave-wqa0b.2, cave-wqa0b.3, and cave-wqa0b.4."
```

- [ ] **Step 8: Commit any verification-only corrections**

If verification required tracked corrections, commit only those files:

```bash
git add --update
git diff --cached --check
git commit -S -m "fix(worktrees): complete retirement verification"
```

If no tracked corrections exist, do not create an empty commit.

## Activation handoff

Do not enable mutation in this plan. Once `cave-wqa0b.2`, `.3`, and `.4` are
merged and released:

1. inspect their real acquisition, fencing, heartbeat, release, and capability
   APIs;
2. write an activation design amendment if those APIs differ from the approved
   safety transaction;
3. create a dedicated activation implementation plan;
4. add disposable-repository integration proving all four planes reject
   concurrent writers;
5. replace the honest incomplete capability report with evidence-backed checks;
6. wire `beads:patrol:apply` to `beads:worktrees:apply`; and
7. dogfood a bounded batch before scheduling periodic cleanup.
