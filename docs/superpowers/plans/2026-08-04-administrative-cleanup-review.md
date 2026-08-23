# Administrative Cleanup Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a local-only, exact-candidate review path for clean landed branches and worktrees blocked only by missing lifecycle metadata or non-closed Beads.

**Architecture:** Introduce a `review-needed` lifecycle lane that is evaluated only after every hard safety check passes. Extend inventory output with structured Bead evidence, then reuse the existing exact-OID retirement operations through a separate one-candidate review function and CLI that validates a short-lived authorization recorded on a curation Bead. Automatic apply remains limited to `retire-after-gate`.

**Tech Stack:** TypeScript on Node.js, Git CLI, `bd` CLI, GitHub CLI, repository maintenance gate, strict `worktree-guard`, Node `assert` tests.

---

## File Map

- Modify `src/lib/worktree-lifecycle.ts`: add the lane, structured task references, and administrative-only classification.
- Modify `src/lib/worktree-lifecycle.test.ts`: pin classification precedence, rendering, and automatic-retirement separation.
- Modify `scripts/worktree-lifecycle-inventory.ts`: preserve matching Bead title/status/update evidence and merged-PR base information.
- Modify `scripts/worktree-lifecycle-patrol.test.mjs`: test real inventory and human/JSON patrol output.
- Modify `scripts/worktree-lifecycle-retirement.ts`: extract a one-unit retirement primitive, add strict guard execution, and expose reviewed retirement.
- Modify `scripts/worktree-lifecycle-retirement.test.mjs`: test exact selection, drift, strict guard, and partial failures.
- Create `scripts/worktree-lifecycle-review.ts`: parse exact CLI inputs, validate current Bead authorization, acquire the local maintenance lease, reprobe, retire, and verify.
- Create `scripts/worktree-lifecycle-review.test.mjs`: exercise authorization parsing and end-to-end orchestration with injected dependencies.
- Modify `package.json`: expose `pnpm beads:worktrees:review`.
- Modify `scripts/run-tests.mjs`: wire the new test into focused and full suites.
- Modify `.agents/skills/branch-curator/SKILL.md`: document when the review lane is allowed.
- Modify `.agents/skills/branch-curator/references/deletion-proof.md`: make the reviewed administrative override normative and bounded.
- Modify `AGENTS.md` and `CLAUDE.md`: replace the claim that metadata-free worktrees are permanently unretirable with the reviewed local-only path.

### Task 1: Classify Administrative-Only Blockers

**Files:**
- Modify: `src/lib/worktree-lifecycle.ts`
- Test: `src/lib/worktree-lifecycle.test.ts`

- [ ] **Step 1: Write failing lane and precedence tests**

Add `taskRefs` to the test observation helper:

```ts
function taskRef(overrides = {}) {
  return {
    id: "cave-open",
    title: "Open administrative task",
    status: "open",
    updatedAt: "2026-07-29T10:00:00Z",
    ...overrides,
  };
}

function observation(overrides = {}) {
  const head = overrides.head ?? "a".repeat(40);
  return {
    kind: "worktree",
    path: "/repo/.worktrees/feat-x",
    ref: "refs/heads/feat/x",
    branch: "feat/x",
    head,
    isPrimary: false,
    protectedBranch: false,
    changes: [],
    ignoredPaths: [],
    nonDisposableIgnoredPaths: [],
    indexFlags: [],
    processOwners: [],
    claimOwners: [],
    taskIds: [],
    taskRefs: [],
    openPrs: [],
    mergedPr: null,
    activeWorkflowUrls: [],
    headOnDefaultBranch: false,
    remoteRefsContainingHead: ["refs/remotes/origin/feat/x"],
    updatedAtMs: NOW - 2 * DAY,
    probeErrors: [],
    metadata: metadata(),
    metadataErrors: [],
    remoteRef: { ref: "refs/remotes/origin/feat/x", oid: head },
    sessionIds: [],
    ...overrides,
  };
}
```

Add focused cases:

```ts
{
  const item = classifyLifecycleUnit(
    observation({
      metadata: null,
      headOnDefaultBranch: true,
    }),
    NOW,
  );
  assert.equal(item.lane, "review-needed");
  assert.match(item.reasons.join("\n"), /missing structured lifecycle metadata/i);
}

{
  const item = classifyLifecycleUnit(
    observation({
      taskIds: ["cave-open"],
      taskRefs: [taskRef()],
      headOnDefaultBranch: true,
    }),
    NOW,
  );
  assert.equal(item.lane, "review-needed");
  assert.match(item.reasons.join("\n"), /cave-open/);
}

{
  const item = classifyLifecycleUnit(
    observation({
      changes: ["? uncommitted.txt"],
      metadata: null,
      taskIds: ["cave-open"],
      taskRefs: [taskRef()],
      headOnDefaultBranch: true,
    }),
    NOW,
  );
  assert.equal(item.lane, "active", "dirty state outranks administrative review");
}

{
  const item = classifyLifecycleUnit(
    observation({
      metadataErrors: ["duplicate structured metadata"],
      headOnDefaultBranch: true,
    }),
    NOW,
  );
  assert.equal(item.lane, "uncertain", "malformed metadata is never reviewable");
}

{
  const item = classifyLifecycleUnit(
    observation({
      metadata: null,
      branch: "backup/example",
      ref: "refs/heads/backup/example",
      headOnDefaultBranch: true,
    }),
    NOW,
  );
  assert.equal(item.lane, "recovery", "recovery naming outranks missing paperwork");
}
```

- [ ] **Step 2: Run the lifecycle unit test and confirm failure**

Run:

```bash
node --experimental-strip-types src/lib/worktree-lifecycle.test.ts
```

Expected: FAIL because `review-needed` and `taskRefs` are not defined and missing metadata still classifies as `uncertain`.

- [ ] **Step 3: Add the lane and structured Bead reference**

Add these types:

```ts
export type WorktreeLifecycleLane =
  | "active"
  | "recovery"
  | "cooldown"
  | "review-needed"
  | "retire-after-gate"
  | "uncertain"
  | "protected";

export type WorktreeTaskRef = {
  id: string;
  title: string;
  status: "open" | "in_progress" | "blocked" | "deferred";
  updatedAt: string;
};
```

Add `taskRefs: WorktreeTaskRef[]` to `WorktreeLifecycleObservation`, its compatibility fields, and all normalization paths. Add the human label:

```ts
const HUMAN_LANE_LABELS: Record<WorktreeLifecycleLane, string> = {
  active: "active",
  recovery: "recovery",
  cooldown: "cooldown",
  "review-needed": "review-needed",
  "retire-after-gate": "cleanup-ready",
  uncertain: "uncertain",
  protected: "protected",
};
```

- [ ] **Step 4: Separate hard activity from administrative blockers**

Rename `activeReasons` to `hardActiveReasons` and remove the `taskIds` clause. Add:

```ts
function administrativeReasons(observation: WorktreeLifecycleObservation): string[] {
  const reasons: string[] = [];
  if (observation.metadata === null) {
    reasons.push("missing structured lifecycle metadata");
  }
  if (observation.taskRefs.length > 0) {
    reasons.push(
      `non-closed Beads require maintainer review: ${observation.taskRefs
        .map((task) => `${task.id} (${task.status})`)
        .join(", ")}`,
    );
  }
  return reasons;
}
```

Refactor both metadata and metadata-free paths to share a final landed-unit function:

```ts
function classifyLandedUnit(
  observation: WorktreeLifecycleObservation,
  nowMs: number,
  reviewAfter: string[],
): WorktreeLifecycleItem {
  if (observation.updatedAtMs === null || !Number.isFinite(observation.updatedAtMs)) {
    return withReasons(observation, "uncertain", [
      "branch/worktree recency is unavailable",
      ...reviewAfter,
    ]);
  }

  if (nowMs - observation.updatedAtMs < RETIREMENT_COOLDOWN_MS) {
    return withReasons(observation, "cooldown", [
      "landed work remains inside the mandatory 8-hour cooldown",
      ...reviewAfter,
    ]);
  }

  const administrative = administrativeReasons(observation);
  if (administrative.length > 0) {
    return withReasons(observation, "review-needed", [
      ...administrative,
      "local retirement requires exact current maintainer authorization",
      ...reviewAfter,
    ]);
  }

  return withReasons(observation, "retire-after-gate", [
    "clean landed work is older than 8 hours",
    "removal still requires the repository-wide maintenance gate and final deletion proof",
    ...reviewAfter,
  ]);
}
```

Preserve this precedence in `classifyLifecycleUnitInternal`:

1. protected;
2. hard activity;
3. probe errors;
4. metadata errors;
5. detached/recovery/WIP state;
6. exact landing and remote divergence;
7. recency/cooldown;
8. administrative review;
9. automatic cleanup-ready.

- [ ] **Step 5: Update lane ordering, counts, and report summary**

Insert `"review-needed"` between cooldown and cleanup-ready:

```ts
const LANE_ORDER: WorktreeLifecycleLane[] = [
  "active",
  "recovery",
  "cooldown",
  "review-needed",
  "retire-after-gate",
  "uncertain",
  "protected",
];
```

Update the summary sentence to include:

```ts
`${counts["review-needed"]} review-needed`
```

Add a rendering assertion that the report includes the task ID, status, and exact review-needed count.

- [ ] **Step 6: Run the lifecycle unit test**

Run:

```bash
node --experimental-strip-types src/lib/worktree-lifecycle.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit the classifier change**

```bash
git add src/lib/worktree-lifecycle.ts src/lib/worktree-lifecycle.test.ts
git commit -m "feat(worktrees): classify administrative cleanup review"
```

### Task 2: Preserve and Render Exact Bead and PR Evidence

**Files:**
- Modify: `scripts/worktree-lifecycle-inventory.ts`
- Modify: `src/lib/worktree-lifecycle.ts`
- Test: `scripts/worktree-lifecycle-patrol.test.mjs`

- [ ] **Step 1: Write failing inventory tests for Bead details**

Extend the Beads fixture rows in `scripts/worktree-lifecycle-patrol.test.mjs` with `updated_at`. Add a clean landed fixture whose only blocker is a non-closed Bead, then assert:

```js
const reviewItem = report.items.find((item) => item.branch === "feat/review-needed");
assert.equal(reviewItem.lane, "review-needed");
assert.deepEqual(reviewItem.taskRefs, [
  {
    id: "cave-review",
    title: "Review landed legacy work",
    status: "blocked",
    updatedAt: "2026-07-28T12:00:00Z",
  },
]);
```

Add a human-output assertion:

```js
assert.match(stdout, /cave-review \(blocked\): Review landed legacy work/);
assert.match(stdout, /updated 2026-07-28T12:00:00Z/);
```

- [ ] **Step 2: Write failing merged-PR base evidence test**

For a squash-merged fixture whose head is retained only by `refs/pull/912/head`, assert:

```js
assert.deepEqual(reviewItem.mergedPr, {
  number: 912,
  url: "https://github.com/OpenCoven/coven-cave/pull/912",
  headOid: reviewItem.head,
  base: "main",
});
```

- [ ] **Step 3: Run the patrol test and confirm failure**

Run:

```bash
node --experimental-strip-types scripts/worktree-lifecycle-patrol.test.mjs
```

Expected: FAIL because inventory emits only `taskIds` and merged PRs omit `base`.

- [ ] **Step 4: Parse structured Bead details**

Extend `BeadTask`:

```ts
type BeadTask = {
  id: string;
  title: string;
  status: "open" | "in_progress" | "blocked" | "deferred" | "closed";
  updatedAt: string;
  text: string;
  structured: StructuredMetadataRecord[];
  structuredErrors: string[];
};
```

Require a canonical `updated_at` string from `bd list --json`, validate it with the existing RFC3339 parser, and map it to `updatedAt`. Replace `matchingTasks(...): string[]` with:

```ts
function matchingTasks(
  branch: string | null,
  worktreePath: string | null,
  head: string,
  tasks: BeadTask[],
): WorktreeTaskRef[] {
  const matchedBranch =
    branch !== null && !PROTECTED_BRANCHES.has(branch) ? branch : null;
  const branchBeadIds = new Set(matchedBranch ? beadIdsInText(matchedBranch) : []);
  const normalizedWorktreePath =
    worktreePath === null ? null : normalizeAbsoluteWorktreePath(worktreePath);
  const exactOid = new RegExp(`(?:^|[^0-9a-f])${head}(?:$|[^0-9a-f])`, "i");

  return tasks
    .filter((task) => task.status !== "closed")
    .filter(
      (task) =>
        task.structured.some(
          (record) =>
            (matchedBranch !== null && record.branch === matchedBranch) ||
            (normalizedWorktreePath !== null &&
              normalizeAbsoluteWorktreePath(record.path) === normalizedWorktreePath),
        ) ||
        branchBeadIds.has(task.id.toLowerCase()) ||
        exactOid.test(task.text) ||
        (matchedBranch !== null && task.text.includes(matchedBranch)) ||
        (matchedBranch !== null &&
          worktreePath !== null &&
          task.text.includes(worktreePath)),
    )
    .map(({ id, title, status, updatedAt }) => ({
      id,
      title,
      status,
      updatedAt,
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
}
```

At observation construction:

```ts
const taskRefs = matchingTasks(unit.branch, unit.path, unit.head, tasks.tasks);

return {
  taskIds: taskRefs.map((task) => task.id),
  taskRefs,
};
```

- [ ] **Step 5: Include merged PR base**

Extend `WorktreeMergedPrRef`:

```ts
export type WorktreeMergedPrRef = WorktreePrRef & {
  headOid: string;
  base: string;
};
```

Populate it from the already-validated `exactMerged.baseRefName`:

```ts
mergedPr: exactMerged
  ? {
      number: exactMerged.number,
      url: exactMerged.url,
      headOid: exactMerged.headRefOid,
      base: exactMerged.baseRefName,
    }
  : null,
```

- [ ] **Step 6: Render review evidence**

In the report loop, when `item.lane === "review-needed"`, render each structured task:

```ts
for (const task of item.taskRefs) {
  lines.push(
    `  Bead ${task.id} (${task.status}): ${task.title}; updated ${task.updatedAt}`,
  );
}
```

Do not infer that an old timestamp makes the task stale.

- [ ] **Step 7: Run lifecycle and patrol tests**

Run:

```bash
node --experimental-strip-types src/lib/worktree-lifecycle.test.ts
node --experimental-strip-types scripts/worktree-lifecycle-patrol.test.mjs
```

Expected: both PASS.

- [ ] **Step 8: Commit inventory evidence**

```bash
git add scripts/worktree-lifecycle-inventory.ts scripts/worktree-lifecycle-patrol.test.mjs src/lib/worktree-lifecycle.ts
git commit -m "feat(worktrees): report administrative review evidence"
```

### Task 3: Add Strict One-Candidate Reviewed Retirement

**Files:**
- Modify: `scripts/worktree-lifecycle-retirement.ts`
- Test: `scripts/worktree-lifecycle-retirement.test.mjs`

- [ ] **Step 1: Write failing selection tests**

Import `reviewLifecycleUnit` and add:

```js
test("review retirement selects one exact review-needed ref and OID", () => {
  const selected = makeItem({
    ref: "refs/heads/fix/legacy",
    branch: "fix/legacy",
    head: hex("a"),
    lane: "review-needed",
  });
  const unrelated = makeItem({
    ref: "refs/heads/fix/other",
    branch: "fix/other",
    head: hex("b"),
    lane: "review-needed",
  });
  const { calls, operations } = makeOperations();

  const report = reviewLifecycleUnit({
    items: [unrelated, selected],
    expectedRef: selected.ref,
    expectedHead: selected.head,
    gateHandle: { generation: 1, token: "gate-token" },
    operations,
  });

  assert.equal(report.retired.length, 1);
  assert.equal(report.retired[0].ref, selected.ref);
  assert.equal(calls.some(([name, ref]) => name === "deleteLocalRef" && ref === unrelated.ref), false);
});
```

Add refusal tests for:

- no matching ref;
- duplicate matching items;
- wrong expected OID;
- lane `retire-after-gate`;
- reprobe changing to `active`;
- reprobe changing task IDs or metadata state while remaining review-needed.

- [ ] **Step 2: Write failing strict guard tests**

Extend `RetirementOperations` fixtures with:

```js
guardWorktree(item) {
  calls.push(["guardWorktree", item.ref]);
  return overrides.guardWorktree?.(item) ?? { ok: true };
},
```

Assert `guardWorktree` runs immediately before `removeWorktree` and a refusal prevents every destructive operation.

- [ ] **Step 3: Run retirement tests and confirm failure**

Run:

```bash
node --experimental-strip-types scripts/worktree-lifecycle-retirement.test.mjs
```

Expected: FAIL because no review function or guard operation exists.

- [ ] **Step 4: Extract a shared exact-unit transaction**

Refactor the current per-item body into:

```ts
function retireExactLifecycleUnit({
  item,
  expectedLane,
  gateHandle,
  operations,
}: {
  item: WorktreeLifecycleItem;
  expectedLane: "retire-after-gate" | "review-needed";
  gateHandle: RetirementGateHandle;
  operations: RetirementOperations;
}): RetirementReport {
  // Use the existing heartbeat, reprobe, remote precheck, cleanup,
  // compare-delete, restoration, and postcondition sequence.
}
```

Change identity validation to accept an expected lane:

```ts
function retirementIdentityError(
  expected: WorktreeLifecycleItem,
  actual: WorktreeLifecycleItem,
  expectedLane: "retire-after-gate" | "review-needed",
): string | null {
  if (actual.path !== expected.path) return "retirement candidate path changed during final retirement probe";
  if (actual.ref !== expected.ref) return "retirement candidate ref changed during final retirement probe";
  if (actual.head !== expected.head) return "retirement candidate OID changed during final retirement probe";
  if (actual.lane !== expectedLane) return "retirement candidate lane changed during final retirement probe";
  return null;
}
```

Keep `retireLifecycleUnits` filtering only `retire-after-gate`.

- [ ] **Step 5: Implement exact review selection**

Add:

```ts
export function reviewLifecycleUnit({
  items,
  expectedRef,
  expectedHead,
  gateHandle,
  operations,
}: {
  items: WorktreeLifecycleItem[];
  expectedRef: string;
  expectedHead: string;
  gateHandle: RetirementGateHandle;
  operations: RetirementOperations;
}): RetirementReport {
  const matches = items.filter((item) => item.ref === expectedRef);
  if (matches.length !== 1) {
    return blockedReview(expectedRef, expectedHead, "review candidate must resolve to one lifecycle unit");
  }
  const item = matches[0]!;
  if (item.head !== expectedHead) {
    return blockedReview(expectedRef, expectedHead, "review candidate OID does not match authorization");
  }
  if (item.lane !== "review-needed") {
    return blockedReview(expectedRef, expectedHead, "candidate is not in the review-needed lane");
  }
  return retireExactLifecycleUnit({
    item,
    expectedLane: "review-needed",
    gateHandle,
    operations,
  });
}
```

- [ ] **Step 6: Run strict worktree guard before removal**

Add `guardWorktree(item)` to `RetirementOperations`. Call it after the final gate heartbeat and before `removeWorktree`.

In `createGitRetirementOperations`, invoke:

```ts
const args = [
  "scripts/worktree-guard.mjs",
  "--strict-worktree-remove",
  worktreePath,
  "--expected-head",
  item.head,
];

if (!item.headOnDefaultBranch && item.mergedPr) {
  args.push(
    "--retained-by-github-pr",
    "origin",
    repo,
    String(item.mergedPr.number),
    "--expected-base",
    item.mergedPr.base,
  );
}

const guarded = node(normalizedRoot, args, 120_000, {
  WT_GUARD_BYPASS: undefined,
  WT_GUARD_TEST_MODE: undefined,
});
```

Return failure on any nonzero status or malformed success JSON. Never set `WT_GUARD_BYPASS`.

- [ ] **Step 7: Run retirement tests**

Run:

```bash
node --experimental-strip-types scripts/worktree-lifecycle-retirement.test.mjs
```

Expected: PASS, including the assertion that automatic apply ignores review-needed items.

- [ ] **Step 8: Commit the reviewed retirement primitive**

```bash
git add scripts/worktree-lifecycle-retirement.ts scripts/worktree-lifecycle-retirement.test.mjs
git commit -m "feat(worktrees): add exact reviewed local retirement"
```

### Task 4: Build the Authorization-Aware Review CLI

**Files:**
- Create: `scripts/worktree-lifecycle-review.ts`
- Create: `scripts/worktree-lifecycle-review.test.mjs`
- Modify: `package.json`
- Modify: `scripts/run-tests.mjs`

- [ ] **Step 1: Write failing argument and authorization tests**

Define the command:

```text
pnpm beads:worktrees:review \
  --ref refs/heads/fix/legacy \
  --expected-head aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
  --curation-bead cave-123 \
  --confirm-local-administrative-review
```

Test `parseArgs` rejects:

- short branch names instead of `refs/heads/...`;
- `main` and `__dolt_remote_info__`;
- abbreviated or malformed OIDs;
- missing curation Bead;
- missing confirmation;
- any remote-delete argument;
- more than one candidate.

Use this authorization note format:

```text
COVEN_ADMIN_CLEANUP_V1 {"ref":"refs/heads/fix/legacy","oid":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","scope":"local-only","authorizedBy":"BunsDev","authorizedAt":"2026-08-04T21:30:00.000Z","expiresAt":"2026-08-05T21:30:00.000Z","instruction":"lax administrative cleanup for this exact candidate"}
```

Test rejection for malformed JSON, duplicate matching records, mismatched ref/OID, non-local scope, blank author/instruction, future `authorizedAt`, expired authorization, authorization older than 24 hours, closed curation Bead, and candidate-owning Bead used as the curation Bead.

- [ ] **Step 2: Write failing orchestration tests**

Inject dependencies and assert this order:

```js
assert.deepEqual(calls, [
  "read-curation-bead",
  "collect-inventory-before-gate",
  "acquire-maintenance-gate",
  "collect-inventory-under-gate",
  "create-retirement-operations",
  "review-exact-unit",
  "heartbeat-before-post-inventory",
  "verify-before-post-inventory",
  "collect-post-inventory",
  "verify-after-post-inventory",
  "release-maintenance-gate",
]);
```

Add failure tests for lease acquisition, changed inventory fingerprint, candidate no longer review-needed, newly matched task ownership, retirement block, post-inventory failure, and release failure.

- [ ] **Step 3: Run the new test and confirm failure**

Run:

```bash
node --experimental-strip-types scripts/worktree-lifecycle-review.test.mjs
```

Expected: FAIL because the CLI does not exist.

- [ ] **Step 4: Implement strict argument parsing**

Create `scripts/worktree-lifecycle-review.ts` with:

```ts
type ReviewOptions = {
  repo: string;
  root: string;
  ref: string;
  expectedHead: string;
  curationBead: string;
  confirmed: true;
  nowMs: number;
  json: boolean;
};
```

Use `git check-ref-format` plus explicit protected-ref rejection. Require a full 40- or 64-character lowercase hexadecimal OID.

- [ ] **Step 5: Parse and validate current authorization**

Run:

```ts
const result = command("bd", ["show", beadId, "--json"], root);
```

Require one non-closed Bead. Scan `notes` line-by-line for the exact `COVEN_ADMIN_CLEANUP_V1 ` prefix, parse JSON, and validate:

```ts
type AdministrativeCleanupAuthorization = {
  ref: string;
  oid: string;
  scope: "local-only";
  authorizedBy: string;
  authorizedAt: string;
  expiresAt: string;
  instruction: string;
};
```

Require one matching unexpired record, `authorizedAt <= now`, `now - authorizedAt <= 24 hours`, and `expiresAt > now`. Reject if the curation Bead ID appears in the candidate's `taskIds`.

- [ ] **Step 6: Implement the lease-held review transaction**

Follow this sequence:

```ts
const before = collectWorktreeLifecycleInventory({ repo, root, nowMs });
const candidate = exactReviewCandidate(before.items, options.ref, options.expectedHead);
validateAuthorization(curationBead, candidate, nowMs);

const acquired = acquireMaintenanceGate({
  ownerId: `worktree-review-${curationBead.id}`,
  purpose: `administrative local cleanup ${options.ref}@${options.expectedHead}`,
  repoDir: root,
});
if (!acquired.ok) throw new Error(acquired.reason ?? "maintenance lease unavailable");

try {
  const underGate = collectWorktreeLifecycleInventory({ repo, root, nowMs: Date.now() });
  requireUnchangedReviewCandidate(candidate, underGate.items);
  const operations = createGitRetirementOperations({
    root,
    repo,
    gateHandle: acquired.handle,
    nowMs: Date.now,
  });
  const retirement = reviewLifecycleUnit({
    items: underGate.items,
    expectedRef: options.ref,
    expectedHead: options.expectedHead,
    gateHandle: acquired.handle,
    operations,
  });
  // Heartbeat, verify, collect post-inventory, verify again.
  return buildReviewReport(retirement, postInventory);
} finally {
  releaseMaintenanceGate(acquired.handle);
}
```

Return nonzero if retirement is blocked, partial, post-inventory is unavailable, or release fails. Report partial local state explicitly.

- [ ] **Step 7: Wire the command and tests**

Add to `package.json`:

```json
"beads:worktrees:review": "node --experimental-strip-types scripts/worktree-lifecycle-review.ts --repo OpenCoven/coven-cave"
```

Add `scripts/worktree-lifecycle-review.test.mjs` beside the existing patrol and retirement tests in every relevant `scripts/run-tests.mjs` suite.

- [ ] **Step 8: Run focused review tests**

Run:

```bash
node --experimental-strip-types scripts/worktree-lifecycle-review.test.mjs
node --experimental-strip-types scripts/worktree-lifecycle-retirement.test.mjs
node --experimental-strip-types scripts/worktree-lifecycle-patrol.test.mjs
```

Expected: all PASS.

- [ ] **Step 9: Commit the CLI**

```bash
git add package.json scripts/run-tests.mjs scripts/worktree-lifecycle-review.ts scripts/worktree-lifecycle-review.test.mjs
git commit -m "feat(worktrees): add administrative review command"
```

### Task 5: Update Normative Cleanup Documentation

**Files:**
- Modify: `.agents/skills/branch-curator/SKILL.md`
- Modify: `.agents/skills/branch-curator/references/deletion-proof.md`
- Modify: `AGENTS.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Document the new lane in Branch Curator**

Add `review-needed` to the classification table:

```md
| `REVIEW` | Every hard safety proof passed; only missing metadata and/or non-closed Beads remain | Obtain current exact maintainer authorization and run the local-only review command |
```

State explicitly that `REVIEW` is not `DELETE`, never authorizes remote deletion, and cannot override dirty state, active ownership, recovery evidence, recency, or unique work.

- [ ] **Step 2: Add the normative authorization record**

In `deletion-proof.md`, document the exact note:

```text
COVEN_ADMIN_CLEANUP_V1 {"ref":"refs/heads/fix/legacy","oid":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","scope":"local-only","authorizedBy":"BunsDev","authorizedAt":"2026-08-04T21:30:00.000Z","expiresAt":"2026-08-05T21:30:00.000Z","instruction":"Approve local administrative cleanup for this exact candidate"}
```

Require:

- a separate non-closed curation Bead;
- one exact ref and OID;
- current authorization no older than 24 hours;
- local-only scope;
- a held maintenance lease;
- complete fresh proof;
- strict `worktree-guard`;
- no candidate Bead mutation.

- [ ] **Step 3: Replace obsolete permanent-uncertainty wording**

In `AGENTS.md` and `CLAUDE.md`, replace:

```text
pnpm beads:worktrees:apply can never retire it
```

with:

```text
automatic apply cannot retire it. After it is clean, landed, older than the
cooldown, and free of every live-work signal, a maintainer may use the exact
local-only administrative review path. Missing metadata never becomes automatic
deletion authority.
```

Keep the prohibition on hand-writing missing metadata.

- [ ] **Step 4: Commit documentation**

```bash
git add .agents/skills/branch-curator/SKILL.md .agents/skills/branch-curator/references/deletion-proof.md AGENTS.md CLAUDE.md
git commit -m "docs(worktrees): define reviewed administrative cleanup"
```

### Task 6: Run Integrated Verification

**Files:**
- Verify all files changed in Tasks 1-5.

- [ ] **Step 1: Run the focused lifecycle suite**

Run:

```bash
node --experimental-strip-types src/lib/worktree-lifecycle.test.ts
node --experimental-strip-types scripts/worktree-lifecycle-patrol.test.mjs
node --experimental-strip-types scripts/worktree-lifecycle-retirement.test.mjs
node --experimental-strip-types scripts/worktree-lifecycle-review.test.mjs
```

Expected: all PASS.

- [ ] **Step 2: Run test-wiring validation**

Run:

```bash
pnpm check:tests-wired
```

Expected: PASS and the new review test is reported as wired.

- [ ] **Step 3: Run the repository test runner for lifecycle files**

Run:

```bash
pnpm test -- src/lib/worktree-lifecycle.test.ts scripts/worktree-lifecycle-patrol.test.mjs scripts/worktree-lifecycle-retirement.test.mjs scripts/worktree-lifecycle-review.test.mjs
```

Expected: PASS.

- [ ] **Step 4: Run lint and type checks**

Run:

```bash
pnpm lint
pnpm typecheck
```

Expected: both PASS.

- [ ] **Step 5: Exercise read-only patrol output**

Run:

```bash
pnpm beads:worktrees
pnpm beads:worktrees:json > /tmp/cave-worktree-review-report.json
jq '.counts[\"review-needed\"]' /tmp/cave-worktree-review-report.json
```

Expected: patrol succeeds, no mutation occurs, and JSON contains a nonnegative `review-needed` count.

- [ ] **Step 6: Verify automatic apply cannot select review-needed**

Run the retirement unit test assertion directly:

```bash
node --experimental-strip-types scripts/worktree-lifecycle-retirement.test.mjs
```

Expected: PASS with the test proving `retireLifecycleUnits` filters only `retire-after-gate`.

- [ ] **Step 7: Record evidence in the implementation Bead**

```bash
bd update cave-jcdgb --append-notes "Verification: lifecycle, patrol, retirement, and review tests pass; test wiring, lint, and typecheck pass. Administrative review remains exact-candidate, local-only, strict-guarded, and excluded from automatic apply."
```

- [ ] **Step 8: Commit any verification-only fixes**

If verification required source changes, stage only those exact files and commit:

```bash
git add src/lib/worktree-lifecycle.ts src/lib/worktree-lifecycle.test.ts \
  scripts/worktree-lifecycle-inventory.ts scripts/worktree-lifecycle-patrol.ts \
  scripts/worktree-lifecycle-patrol.test.mjs scripts/worktree-lifecycle-retirement.ts \
  scripts/worktree-lifecycle-retirement.test.mjs scripts/worktree-lifecycle-review.ts \
  scripts/worktree-lifecycle-review.test.mjs package.json scripts/run-tests.mjs \
  .agents/skills/branch-curator/SKILL.md \
  .agents/skills/branch-curator/references/deletion-proof.md AGENTS.md CLAUDE.md
git commit -m "fix(worktrees): complete administrative review verification"
```

If no files changed, do not create an empty commit.
