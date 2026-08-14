# Orphaned Worktree Metadata Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make lifecycle patrol discover and safely repair non-closed Beads whose structured worktree record points at a missing local branch and missing path.

**Architecture:** Keep metadata-only orphan records outside `WorktreeLifecycleItem`, because they have no trustworthy ref or OID. Inventory reports them separately; a focused repair module performs bounded Bead metadata mutations under the held repository maintenance gate; patrol composes those repairs with existing Git retirement and reports both outcomes.

**Tech Stack:** Node.js 24 TypeScript strip-types scripts, Beads CLI JSON metadata, Git porcelain, repository maintenance gate, Node assertion fixtures.

---

## File map

- Modify `scripts/worktree-lifecycle-inventory.ts`: export orphan record types, detect missing branch/path records on non-closed Beads, and include them in inventory output.
- Create `scripts/worktree-lifecycle-metadata-repair.ts`: plan and execute exact-record Bead metadata repairs with injected operations and production maintenance-gate adapters.
- Modify `scripts/worktree-lifecycle-patrol.ts`: render orphan discovery, run bounded repairs before Git retirement, and include repair outcomes in apply status.
- Modify `scripts/worktree-lifecycle-patrol.test.mjs`: fixture and integration coverage for discovery, blocked evidence, metadata preservation, races, failures, and batch limits.
- Modify `scripts/worktree-lifecycle-create.test.mjs`: end-to-end proof that apply clears the stale record and managed creation then succeeds.
- Modify `AGENTS.md` and `CLAUDE.md`: document that gated apply repairs metadata-only orphans and that present unregistered paths remain manual-preservation cases.

### Task 1: Inventory metadata-only lifecycle records

**Files:**
- Modify: `scripts/worktree-lifecycle-inventory.ts:110-135`
- Modify: `scripts/worktree-lifecycle-inventory.ts:1635-1760`
- Modify: `scripts/worktree-lifecycle-inventory.ts:2460-2895`
- Test: `scripts/worktree-lifecycle-patrol.test.mjs`

- [ ] **Step 1: Add failing patrol fixtures for repairable and blocked metadata-only records**

Extend the fixture Beads stub with an environment-selected payload containing:

```json
[
  {
    "id": "cave-orphan",
    "status": "in_progress",
    "metadata": {
      "unrelated": "preserved",
      "coven": {
        "sibling": "preserved",
        "worktree": {
          "branch": "fix/cave-orphan-old",
          "path": "/ABSENT/.worktrees/cave-orphan-old",
          "owner": "Kitty",
          "purpose": "Missing unit",
          "disposition": "active",
          "createdAt": "2026-08-01T12:00:00Z"
        }
      }
    }
  }
]
```

Add assertions that dry-run JSON reports one repairable entry, closed Beads are omitted, and a present unregistered path is reported with `repairable: false`.

- [ ] **Step 2: Run the patrol test and verify the new assertions fail**

Run:

```bash
node scripts/worktree-lifecycle-patrol.test.mjs
```

Expected: FAIL because `orphanedMetadata` is absent.

- [ ] **Step 3: Export the orphan inventory shape**

Add:

```ts
export type OrphanedWorktreeMetadataRecord = {
  beadId: string;
  beadStatus: string;
  location: "primary" | `additional:${number}`;
  branch: string;
  path: string;
  record: {
    branch: string;
    path: string;
    owner: string;
    purpose: string;
    disposition: WorktreeLifecycleMetadata["disposition"];
    createdAt: string;
    reason?: string;
    reviewAfter?: string;
    exception?: WorktreeLifecycleMetadata["exception"];
  };
  repairable: boolean;
  reasons: string[];
};
```

Retain the full structured record in `StructuredMetadataRecord`, including its primary/additional location, and return:

```ts
{
  items,
  orphanedMetadata,
  budgets,
  globalErrors,
  inventoryFingerprint,
}
```

- [ ] **Step 4: Detect metadata-only records conservatively**

After parsing worktrees and local refs, classify only non-closed Bead records not matched by exact branch or normalized registered path:

```ts
const pathPresent = existsSync(record.path);
const branchPresent = localRefByName.has(`refs/heads/${record.branch}`);
const registeredPathPresent = entries.some(
  (entry) =>
    normalizeAbsoluteWorktreePath(entry.path) ===
    normalizeAbsoluteWorktreePath(record.path),
);

return {
  ...snapshot,
  repairable: !branchPresent && !registeredPathPresent && !pathPresent,
  reasons: [
    ...(branchPresent ? ["exact local branch still exists"] : []),
    ...(registeredPathPresent ? ["recorded path is still registered"] : []),
    ...(pathPresent ? ["recorded path still exists on disk"] : []),
  ],
};
```

Do not include closed Beads. Keep malformed or duplicate metadata in existing global error handling.

- [ ] **Step 5: Run the patrol test and verify inventory assertions pass**

Run:

```bash
node scripts/worktree-lifecycle-patrol.test.mjs
```

Expected: PASS through the new dry-run inventory cases.

- [ ] **Step 6: Commit inventory discovery**

```bash
git add scripts/worktree-lifecycle-inventory.ts scripts/worktree-lifecycle-patrol.test.mjs
git commit -m "fix(worktrees): inventory orphaned lifecycle metadata"
```

### Task 2: Implement exact-record metadata repair

**Files:**
- Create: `scripts/worktree-lifecycle-metadata-repair.ts`
- Modify: `scripts/worktree-lifecycle-patrol.test.mjs`

- [ ] **Step 1: Write failing unit-style repair tests with injected operations**

Import the new module from the patrol test and cover:

```js
const report = repairOrphanedWorktreeMetadata({
  candidates: [orphan],
  maxRepairs: 3,
  gateHandle: { generation: 7, token: "token" },
  operations,
});

assert.deepEqual(report.repaired.map((item) => item.beadId), ["cave-orphan"]);
assert.deepEqual(report.blocked, []);
```

Add cases for primary promotion, additional removal, changed reread, new local branch, new registered path, present filesystem path, update failure, verification failure, maintenance-gate heartbeat/ownership failure, and a one-item batch cap.

- [ ] **Step 2: Run the test and verify it fails because the module does not exist**

Run:

```bash
node scripts/worktree-lifecycle-patrol.test.mjs
```

Expected: FAIL with module-not-found or missing export.

- [ ] **Step 3: Define repair reports and injected operations**

Create:

```ts
export type MetadataRepairReport = {
  repaired: OrphanedWorktreeMetadataRecord[];
  blocked: Array<{
    beadId: string;
    location: OrphanedWorktreeMetadataRecord["location"];
    reason: string;
  }>;
  pending: OrphanedWorktreeMetadataRecord[];
};

export interface MetadataRepairOperations {
  heartbeatAndVerifyGate(): { ok: true } | { ok: false; reason: string };
  readBead(beadId: string): ExactBeadResult;
  probeLocal(record: OrphanedWorktreeMetadataRecord): LocalProbeResult;
  persistCoven(beadId: string, coven: JsonRecord): OperationResult;
}
```

The exported orchestrator selects `candidates.filter(candidate => candidate.repairable).slice(0, maxRepairs)` and processes them serially. It heartbeats and verifies the held maintenance gate before the fresh Bead read, immediately before persistence, and before post-persistence verification.

- [ ] **Step 4: Implement pure metadata transformation**

Add a helper that deep-compares the fresh target record, removes exactly that record, promotes the first additional record when needed, and preserves sibling keys:

```ts
export function removeLifecycleRecord(
  coven: JsonRecord,
  location: "primary" | `additional:${number}`,
  expected: JsonRecord,
): JsonRecord {
  const next = structuredClone(coven);
  // Validate current record with isDeepStrictEqual before mutation.
  // Primary removal promotes worktrees.shift(); additional removal splices
  // only the parsed index. Empty worktrees is deleted.
  return next;
}
```

Return an explicit error for a missing, moved, or changed record.

- [ ] **Step 5: Implement production operations**

Use `heartbeatMaintenanceGate` and `verifyMaintenanceGateOwnership` from
`scripts/maintenance-gate.mjs`. Do not acquire writer intents: they are the
pre-maintenance protocol and are deliberately rejected while a gate is held.
Use:

```bash
bd show <bead> --json
git worktree list --porcelain -z
git show-ref --verify --quiet refs/heads/<branch>
```

Persist with `command("bd", ["update", beadId, "--metadata", JSON.stringify({ coven }), "--json"], root)`.
Reject NULs, non-absolute paths, command stderr on successful JSON reads, ambiguous Bead shapes, and any failed post-update reread.

- [ ] **Step 6: Run the patrol test and verify repair tests pass**

Run:

```bash
node scripts/worktree-lifecycle-patrol.test.mjs
```

Expected: PASS through pure and production-adapter repair cases.

- [ ] **Step 7: Commit the repair engine**

```bash
git add scripts/worktree-lifecycle-metadata-repair.ts scripts/worktree-lifecycle-patrol.test.mjs
git commit -m "fix(worktrees): safely repair orphaned bead metadata"
```

### Task 3: Integrate repair into patrol apply and reporting

**Files:**
- Modify: `scripts/worktree-lifecycle-patrol.ts:30-535`
- Modify: `scripts/worktree-lifecycle-patrol.test.mjs`

- [ ] **Step 1: Add failing reporting and apply integration assertions**

Assert dry-run human output contains:

```text
Orphaned metadata (1)
- cave-orphan primary fix/cave-orphan-old at /repo/.worktrees/cave-orphan-old; repairable by gated apply
```

Assert apply JSON contains:

```json
{
  "metadataRepair": {
    "repaired": [{ "beadId": "cave-orphan" }],
    "blocked": [],
    "pending": []
  }
}
```

Also assert a blocked repair makes apply exit `1` and reason includes `metadata-repair-blocked`.

- [ ] **Step 2: Run the patrol test and verify integration assertions fail**

Run:

```bash
node scripts/worktree-lifecycle-patrol.test.mjs
```

Expected: FAIL because patrol does not render or invoke metadata repair.

- [ ] **Step 3: Extend patrol result and outcome types**

Add `metadataRepair` to `RetirementApplyResult`, and define failures without enumerating every combination:

```ts
type ApplyFailureReason =
  | "metadata-repair-blocked"
  | "retirement-blocked"
  | "maintenance-gate-release-failed"
  | "post-apply-inventory-failed";

type RetirementApplyOutcomeReason = string;
```

Build `RetirementApplyOutcomeReason` only by joining the ordered,
deduplicated `ApplyFailureReason[]` with `-and-`.

Calculate the remaining Git retirement budget as:

```ts
const repairLimit = Math.min(options.maxRetire, repairableOrphans.length);
const gitLimit = options.maxRetire - repairLimit;
```

Run metadata repair first; pass at least `1` to Git retirement only when
`gitLimit > 0`, otherwise return all Git candidates as cleanup-ready without
mutating them.

- [ ] **Step 4: Render dry-run and apply output**

Add `orphanedMetadata` and `orphanedMetadataCount` to JSON. Add human sections for orphan discovery, repaired entries, blocked entries, and pending entries. Update CLI help to state that `--apply` also repairs proven metadata-only orphans.

- [ ] **Step 5: Re-inventory after both mutation phases**

Keep the existing post-apply inventory under the maintenance gate. A repaired record must disappear from `orphanedMetadata`; otherwise set `postInventoryError` and fail the apply outcome.

- [ ] **Step 6: Run focused lifecycle tests**

Run:

```bash
node scripts/worktree-lifecycle-retirement.test.mjs
node scripts/worktree-lifecycle-patrol.test.mjs
```

Expected: both print their `: ok` completion lines.

- [ ] **Step 7: Commit patrol integration**

```bash
git add scripts/worktree-lifecycle-patrol.ts scripts/worktree-lifecycle-patrol.test.mjs
git commit -m "fix(worktrees): repair orphan metadata during gated apply"
```

### Task 4: Prove creation recovers after apply

**Files:**
- Modify: `scripts/worktree-lifecycle-create.test.mjs:1180-1240`
- Modify: `scripts/worktree-lifecycle-patrol.test.mjs`

- [ ] **Step 1: Replace the permanent-refusal fixture with an end-to-end recovery fixture**

Build a fixture Bead with a stale primary record and no corresponding branch or path. Run patrol apply with all maintenance planes enabled, then run creation:

```js
const repaired = runPatrol(fixture, ["--apply", "--max-retire", "1"], {
  LIFECYCLE_ORPHANED_METADATA: "1",
  COVEN_MAINTENANCE_LOCAL_ENFORCED: "1",
  COVEN_MAINTENANCE_COVEN_ENFORCED: "1",
  COVEN_MAINTENANCE_BEADS_ENFORCED: "1",
  COVEN_MAINTENANCE_GITHUB_ENFORCED: "1",
});
assert.equal(repaired.status, 0, repaired.stderr);

const created = runCreate(
  fixture,
  createArgs({ branch: "fix/cave-unit1-stale-replacement" }),
);
assert.equal(created.status, 0, created.stderr);
```

- [ ] **Step 2: Run creation and patrol tests**

Run:

```bash
node scripts/worktree-lifecycle-create.test.mjs
node scripts/worktree-lifecycle-patrol.test.mjs
```

Expected: both print their `: ok` completion lines.

- [ ] **Step 3: Confirm the original fail-closed guard remains**

Keep a separate test where the stale record's path still exists or branch still exists. Assert creation exits `2` with `primary structured worktree metadata is not currently registered`, proving repair—not silent admission—remains required.

- [ ] **Step 4: Commit the recovery proof**

```bash
git add scripts/worktree-lifecycle-create.test.mjs scripts/worktree-lifecycle-patrol.test.mjs
git commit -m "test(worktrees): prove orphan repair restores managed creation"
```

### Task 5: Update operational documentation and validate

**Files:**
- Modify: `AGENTS.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Document the repaired failure mode**

Add concise guidance beside the exit-2 stale-metadata discussion:

```markdown
If the refusal says the primary structured metadata is not registered, run
`pnpm beads:worktrees` and inspect "Orphaned metadata". A record is eligible
for `pnpm beads:worktrees:apply` only when both its exact local branch and path
are absent. A present unregistered path is preserved and requires investigation.
```

- [ ] **Step 2: Run documentation contract and focused lifecycle tests**

Run:

```bash
node scripts/beads-familiar-workflow.test.mjs
node scripts/worktree-lifecycle-retirement.test.mjs
node scripts/worktree-lifecycle-patrol.test.mjs
node scripts/worktree-lifecycle-create.test.mjs
```

Expected: every command exits `0` and prints its `: ok` line.

- [ ] **Step 3: Run repository type and test wiring gates**

Run:

```bash
pnpm typecheck
pnpm check:tests-wired
git diff --check
```

Expected: all commands exit `0`.

- [ ] **Step 4: Commit documentation**

```bash
git add AGENTS.md CLAUDE.md
git commit -m "docs(worktrees): explain orphan metadata recovery"
```

- [ ] **Step 5: Record Bead verification evidence**

Run:

```bash
bd update cave-525id --append-notes "Implemented on fix/cave-525id-orphaned-worktree-metadata. Verified lifecycle retirement, patrol, creation, workflow contract, typecheck, and test wiring."
```

Expected: Bead remains `in_progress` until the PR merges.
