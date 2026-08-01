# Research Final Artifacts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Research missions durably save all four final artifacts (primary deliverable, findings, source ledger, research log) — auto-published to the Grimoire Vault on completion, manually publishable when settled, and viewable/downloadable from the Desk and Library.

**Architecture:** Every mission carries four `ResearchArtifactRef`s (legacy missions backfilled at store-read time). The runner's complete path publishes each unpublished ref with per-artifact failure isolation; a new `publish-artifact` action retries individual refs; a new read-only files API serves ref-backed file bytes to a shared View/Download/Publish UI component.

**Tech Stack:** Next.js App Router (API routes), TypeScript, node:test (`--experimental-strip-types`), React 19 client components, CSS tokens per `docs/coven-design-language.md`.

**Spec:** `docs/specs/2026-07-24-research-final-artifacts-design.md` (approved — read it first).

---

## Orientation (read before Task 1)

- **Run one test file:** `node --experimental-strip-types --import ./scripts/test-alias-register.mjs <file>` (the alias register resolves `@/` imports).
- **Suites:** `node scripts/run-tests.mjs app` and `node scripts/run-tests.mjs api`. Both use **explicit file manifests** inside `scripts/run-tests.mjs` — a new test file that isn't appended to a manifest array never runs. App-suite lib/component files are listed near lines 40–70; server files near line 226; API route files near lines 1018–1022.
- **Gates:** `pnpm typecheck` (tsc --noEmit), `pnpm lint` (design ESLint + `pnpm codemod:design:check`).
- **Commits:** signed (`git commit -S`), each ending with the trailer `Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>`.
- **Test styles in this repo:** server/lib code gets behavioral node:test tests with fake `ResearchMissionRunnerDeps`; **API routes and JSX components get source-scan tests** (`readFileSync(new URL("./route.ts", import.meta.url), "utf8")` + regex asserts) because JSX can't import under node:test.
- **Mission workspace layout:** `<root>/<missionId>/` contains `mission.json`, `research-state.yaml`, `findings.md`, `research-log.md`, `sources.json`, `artifacts/primary.md`. Root is `caveHome()/research-missions`, overridable via `COVEN_RESEARCH_MISSIONS_DIR` (store line ~30).

### File map

| File | Role in this plan |
| --- | --- |
| `src/lib/research-artifact-contract.ts` | + `renderSourceLedgerMarkdown` (Task 1) |
| `src/lib/research-missions.ts` | + `researchArtifactKindForMode`, `STANDARD_RESEARCH_ARTIFACTS`, `ensureStandardArtifactRefs`, `publish-artifact` action type (Tasks 2, 5) |
| `src/lib/server/research-mission-lifecycle.ts` | `createMissionRecord` registers 4 refs (Task 3) |
| `src/lib/server/research-mission-store.ts` | read-time backfill in `loadResearchMission` (Task 3) |
| `src/lib/server/research-mission-runner.ts` | multi-publish on complete, `finish` publishes, `publish-artifact` branch (Tasks 4, 5) |
| `src/app/api/research/missions/[id]/actions/route.ts` | ACTIONS + VALIDATION_ERRORS + 409 (Task 5) |
| `src/app/api/research/missions/[id]/files/[key]/route.ts` | **new** read-only files endpoint (Task 6) |
| `src/lib/research-mission-client.ts` | + `getResearchMissionFile` (Task 6) |
| `src/components/role-surfaces/research-artifact-actions.tsx` | **new** shared View/Download/Grimoire/Publish component (Task 7) |
| `src/styles/globals/surface-research-desk.css` | actions-row + viewer styles (Task 7) |
| `src/components/role-surfaces/research-mission-detail.tsx` | rail actions, saved summary (Task 8) |
| `src/components/role-surfaces/research-evidence-ledger.tsx` | checkpoint-surface actions (Task 8) |
| `src/components/role-surfaces/research-tab-library.tsx` | unpublished-card actions, stale comment (Task 9) |
| `scripts/run-tests.mjs` | register the 3 new test files (Tasks 3, 6, 7) |

---

### Task 0: Worktree + commit the spec

`main` is protected — all work happens on a branch in a worktree.

- [ ] **Step 0.1: Create the worktree**

```bash
cd /Users/<someone>/Documents/GitHub/OpenCoven/coven-cave
git worktree add -b research-final-artifacts .worktrees/research-final-artifacts origin/main
cp docs/specs/2026-07-24-research-final-artifacts-design.md .worktrees/research-final-artifacts/docs/specs/
mkdir -p .worktrees/research-final-artifacts/docs/superpowers/plans
cp docs/superpowers/plans/2026-07-24-research-final-artifacts.md .worktrees/research-final-artifacts/docs/superpowers/plans/
cd .worktrees/research-final-artifacts && pnpm install
```

(The spec + plan were authored in the primary checkout while uncommitted; the `cp` carries them onto the branch.)

- [ ] **Step 0.2: Commit spec + plan**

```bash
git add docs/specs/2026-07-24-research-final-artifacts-design.md docs/superpowers/plans/2026-07-24-research-final-artifacts.md
git commit -S -m "docs: research final-artifacts design spec and implementation plan

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
git push -u origin research-final-artifacts
```

All later tasks run inside `.worktrees/research-final-artifacts/`.

---

### Task 1: `renderSourceLedgerMarkdown`

The Vault can't ingest raw `sources.json`; this pure function renders the mission's merged `ResearchSourceRef[]` as a markdown ledger (list format, not tables — spec §2).

**Files:**
- Modify: `src/lib/research-artifact-contract.ts` (append near `researchKnowledgeEntry`, end of file)
- Test: `src/lib/research-artifact-contract.test.ts` (exists; already in the app manifest)

- [ ] **Step 1.1: Write the failing tests** — append to `src/lib/research-artifact-contract.test.ts` (add `renderSourceLedgerMarkdown` to its existing import from `./research-artifact-contract.ts`):

```ts
test("renderSourceLedgerMarkdown renders an empty ledger honestly", () => {
  const markdown = renderSourceLedgerMarkdown([]);
  assert.match(markdown, /^# Source ledger\n/);
  assert.match(markdown, /No sources were recorded for this mission\./);
});

test("renderSourceLedgerMarkdown renders every source with status and evidence fields", () => {
  const markdown = renderSourceLedgerMarkdown([
    {
      id: "s1",
      title: "SQLite WAL docs",
      url: "https://sqlite.org/wal.html",
      publisher: "SQLite",
      publishedAt: "2025-01-01",
      sourceType: "web",
      claim: "WAL allows concurrent readers",
      note: "verified locally",
      confidence: 0.9,
      status: "used",
    },
    { id: "s2", title: "Old blog post", sourceType: "web", status: "rejected" },
  ]);
  assert.match(markdown, /2 sources recorded for this mission\./);
  assert.match(markdown, /1\. \*\*SQLite WAL docs\*\* — used · web/);
  assert.match(markdown, /- URL: https:\/\/sqlite\.org\/wal\.html/);
  assert.match(markdown, /- Publisher: SQLite \(2025-01-01\)/);
  assert.match(markdown, /- Claim: WAL allows concurrent readers/);
  assert.match(markdown, /- Note: verified locally/);
  assert.match(markdown, /- Confidence: 0\.9/);
  assert.match(markdown, /2\. \*\*Old blog post\*\* — rejected · web/);
  assert.ok(markdown.endsWith("\n"));
});
```

- [ ] **Step 1.2: Run to verify failure**

Run: `node --experimental-strip-types --import ./scripts/test-alias-register.mjs src/lib/research-artifact-contract.test.ts`
Expected: FAIL — `renderSourceLedgerMarkdown` is not exported.

- [ ] **Step 1.3: Implement** — append to `src/lib/research-artifact-contract.ts` (it already imports the `ResearchSourceRef` type? — it imports from `./research-missions.ts` at line 3; add `type ResearchSourceRef` to that import list):

```ts
/** Render the mission's merged sources as a markdown ledger for Vault
 *  publication — sources.json itself is machine-shaped, not readable. */
export function renderSourceLedgerMarkdown(sources: ResearchSourceRef[]): string {
  const lines = ["# Source ledger", ""];
  if (sources.length === 0) {
    lines.push("No sources were recorded for this mission.");
    return `${lines.join("\n")}\n`;
  }
  lines.push(`${sources.length} source${sources.length === 1 ? "" : "s"} recorded for this mission.`, "");
  sources.forEach((source, index) => {
    lines.push(`${index + 1}. **${source.title}** — ${source.status} · ${source.sourceType}`);
    if (source.url) lines.push(`   - URL: ${source.url}`);
    if (source.localPath) lines.push(`   - Local path: ${source.localPath}`);
    if (source.publisher) {
      lines.push(`   - Publisher: ${source.publisher}${source.publishedAt ? ` (${source.publishedAt})` : ""}`);
    } else if (source.publishedAt) {
      lines.push(`   - Published: ${source.publishedAt}`);
    }
    if (source.claim) lines.push(`   - Claim: ${source.claim}`);
    if (source.note) lines.push(`   - Note: ${source.note}`);
    if (source.confidence !== undefined) lines.push(`   - Confidence: ${source.confidence}`);
  });
  return `${lines.join("\n")}\n`;
}
```

- [ ] **Step 1.4: Run to verify pass**

Run: `node --experimental-strip-types --import ./scripts/test-alias-register.mjs src/lib/research-artifact-contract.test.ts`
Expected: PASS (all tests in the file).

- [ ] **Step 1.5: Commit**

```bash
git add src/lib/research-artifact-contract.ts src/lib/research-artifact-contract.test.ts
git commit -S -m "feat(research): render source ledger markdown for vault publishing

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 2: Standard artifact table + `ensureStandardArtifactRefs`

Client-safe domain additions in `src/lib/research-missions.ts`: the mode→kind mapping (currently duplicated privately in lifecycle and runner), the standard-artifact table, and the additive backfill helper.

**Files:**
- Modify: `src/lib/research-missions.ts` (after the `ResearchArtifactRef` type, ~line 92)
- Test: `src/lib/research-missions.test.ts` (exists; already in the app manifest)

- [ ] **Step 2.1: Write the failing tests** — append to `src/lib/research-missions.test.ts` (extend its existing import from `./research-missions.ts` with `ensureStandardArtifactRefs`, `researchArtifactKindForMode`, `STANDARD_RESEARCH_ARTIFACTS`, and `type ResearchMission` if not present; reuse the file's existing mission-builder helper if one exists, otherwise this inline builder):

```ts
function missionWithArtifacts(
  artifacts: ResearchMission["artifacts"],
  iterations: ResearchMission["iterations"] = [{ number: 2, status: "checkpoint" }],
): ResearchMission {
  return {
    version: 1,
    id: "mission-refs",
    familiarId: "sage",
    title: "Storage decision",
    intent: "Compare SQLite and Postgres",
    mode: "brief",
    modeSource: "user",
    deliverable: "brief",
    constraints: [],
    bounds: {
      wallClockMinutes: 20,
      maxIterations: 3,
      sourceTarget: 6,
      checkpointEvery: 1,
      stopWhenCostUnavailable: false,
    },
    status: "checkpoint",
    createdAt: "2026-07-24T00:00:00.000Z",
    updatedAt: "2026-07-24T01:00:00.000Z",
    iterations,
    artifacts,
    sources: [],
  };
}

test("researchArtifactKindForMode maps every mode to its deliverable kind", () => {
  assert.equal(researchArtifactKindForMode("sweep"), "report");
  assert.equal(researchArtifactKindForMode("paper"), "paper");
  assert.equal(researchArtifactKindForMode("autoresearch"), "findings");
  assert.equal(researchArtifactKindForMode("brief"), "brief");
});

test("ensureStandardArtifactRefs appends missing standard refs after existing ones", () => {
  const primary = {
    key: "primary",
    kind: "brief" as const,
    title: "Storage decision",
    relativePath: "artifacts/primary.md",
    iteration: 2,
    state: "working" as const,
    updatedAt: "2026-07-24T00:30:00.000Z",
  };
  const result = ensureStandardArtifactRefs(missionWithArtifacts([primary]));
  assert.equal(result.artifacts.length, 4);
  assert.equal(result.artifacts[0], primary, "primary stays first and untouched");
  assert.deepEqual(
    result.artifacts.slice(1).map((artifact) => [artifact.key, artifact.kind, artifact.relativePath]),
    [
      ["findings", "findings", "findings.md"],
      ["source-ledger", "source-ledger", "sources.json"],
      ["research-log", "research-log", "research-log.md"],
    ],
  );
  for (const artifact of result.artifacts.slice(1)) {
    assert.equal(artifact.state, "working");
    assert.equal(artifact.iteration, 2, "backfilled refs adopt the latest iteration number");
    assert.equal(artifact.updatedAt, "2026-07-24T01:00:00.000Z");
  }
});

test("ensureStandardArtifactRefs is identity when nothing is missing and never overwrites", () => {
  const complete = ensureStandardArtifactRefs(missionWithArtifacts([{
    key: "primary",
    kind: "brief",
    title: "Storage decision",
    relativePath: "artifacts/primary.md",
    iteration: 1,
    state: "working",
    updatedAt: "2026-07-24T00:30:00.000Z",
  }]));
  assert.equal(ensureStandardArtifactRefs(complete), complete, "same object when complete");

  const customFindings = {
    key: "findings",
    kind: "findings" as const,
    title: "Custom findings title",
    relativePath: "findings.md",
    knowledgeId: "research-mission-refs-findings",
    iteration: 1,
    state: "published" as const,
    updatedAt: "2026-07-24T00:10:00.000Z",
  };
  const result = ensureStandardArtifactRefs(missionWithArtifacts([customFindings]));
  assert.equal(
    result.artifacts.find((artifact) => artifact.key === "findings"),
    customFindings,
    "existing refs are never overwritten",
  );
  assert.equal(result.artifacts.length, 3);
});
```

- [ ] **Step 2.2: Run to verify failure**

Run: `node --experimental-strip-types --import ./scripts/test-alias-register.mjs src/lib/research-missions.test.ts`
Expected: FAIL — the three names are not exported.

- [ ] **Step 2.3: Implement** — insert into `src/lib/research-missions.ts` directly after the `ResearchArtifactRef` type (~line 92):

```ts
/** Mode → primary-deliverable kind. Single source of truth — the lifecycle
 *  and runner previously duplicated this mapping privately. */
export function researchArtifactKindForMode(mode: ResearchMissionMode): ResearchArtifactKind {
  if (mode === "sweep") return "report";
  if (mode === "paper") return "paper";
  if (mode === "autoresearch") return "findings";
  return "brief";
}

/** The always-produced workspace files every mission must track and save,
 *  beyond the mode-specific primary deliverable. */
export const STANDARD_RESEARCH_ARTIFACTS: ReadonlyArray<
  Pick<ResearchArtifactRef, "key" | "kind" | "title" | "relativePath">
> = [
  { key: "findings", kind: "findings", title: "Findings", relativePath: "findings.md" },
  { key: "source-ledger", kind: "source-ledger", title: "Source ledger", relativePath: "sources.json" },
  { key: "research-log", kind: "research-log", title: "Research log", relativePath: "research-log.md" },
];

/** Additive backfill for missions created before the standard refs existed:
 *  appends any standard ref whose key is absent. Never overwrites, never
 *  reorders (the primary working copy must stay first), identity when
 *  nothing is missing. */
export function ensureStandardArtifactRefs(mission: ResearchMission): ResearchMission {
  const missing = STANDARD_RESEARCH_ARTIFACTS.filter(
    (standard) => !mission.artifacts.some((artifact) => artifact.key === standard.key),
  );
  if (missing.length === 0) return mission;
  const iteration = mission.iterations.at(-1)?.number ?? 1;
  return {
    ...mission,
    artifacts: [
      ...mission.artifacts,
      ...missing.map((standard) => ({
        ...standard,
        iteration,
        state: "working" as const,
        updatedAt: mission.updatedAt,
      })),
    ],
  };
}
```

Check the file's existing type names: `ResearchMissionMode` and `ResearchArtifactKind` are both defined/exported in this same file (kinds at line ~70) — no new imports needed.

- [ ] **Step 2.4: Run to verify pass**

Run: `node --experimental-strip-types --import ./scripts/test-alias-register.mjs src/lib/research-missions.test.ts`
Expected: PASS.

- [ ] **Step 2.5: Commit**

```bash
git add src/lib/research-missions.ts src/lib/research-missions.test.ts
git commit -S -m "feat(research): standard artifact table and additive ref backfill

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

<!-- PLAN-CONTINUES-1 -->

---

### Task 3: Register refs at creation + backfill at store read

**Files:**
- Modify: `src/lib/server/research-mission-lifecycle.ts` (createMissionRecord, lines 18–68)
- Modify: `src/lib/server/research-mission-store.ts` (loadResearchMission, lines 149–162)
- Test (new): `src/lib/server/research-mission-lifecycle.test.ts`
- Test: `src/lib/server/research-mission-store.test.ts` (exists)
- Modify: `scripts/run-tests.mjs` (register the new lifecycle test)

- [ ] **Step 3.1: Write the failing lifecycle test** — create `src/lib/server/research-mission-lifecycle.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { createMissionRecord } from "./research-mission-lifecycle.ts";

const INPUT = {
  familiarId: "sage",
  title: "Storage decision",
  intent: "Compare SQLite and Postgres",
  mode: "sweep" as const,
  modeSource: "user" as const,
  deliverable: "report",
  constraints: [],
  bounds: {
    wallClockMinutes: 20,
    maxIterations: 1,
    sourceTarget: 6,
    checkpointEvery: 1,
    stopWhenCostUnavailable: false,
  },
};

test("createMissionRecord registers the primary and all standard artifact refs", () => {
  const mission = createMissionRecord(INPUT, "mission-1", new Date("2026-07-24T00:00:00.000Z"));
  assert.deepEqual(
    mission.artifacts.map((artifact) => [artifact.key, artifact.kind, artifact.relativePath]),
    [
      ["primary", "report", "artifacts/primary.md"],
      ["findings", "findings", "findings.md"],
      ["source-ledger", "source-ledger", "sources.json"],
      ["research-log", "research-log", "research-log.md"],
    ],
  );
  for (const artifact of mission.artifacts) {
    assert.equal(artifact.state, "working");
    assert.equal(artifact.iteration, 1);
    assert.equal(artifact.updatedAt, "2026-07-24T00:00:00.000Z");
    assert.equal(artifact.knowledgeId, undefined);
  }
});
```

- [ ] **Step 3.2: Register the new test file** — in `scripts/run-tests.mjs`, add to the manifest array that already contains `"src/lib/server/research-mission-store.test.ts"` (~line 226), directly after that entry:

```js
    "src/lib/server/research-mission-lifecycle.test.ts",
```

- [ ] **Step 3.3: Run to verify failure**

Run: `node --experimental-strip-types --import ./scripts/test-alias-register.mjs src/lib/server/research-mission-lifecycle.test.ts`
Expected: FAIL — artifacts array has length 1 (only primary).

- [ ] **Step 3.4: Implement lifecycle** — in `src/lib/server/research-mission-lifecycle.ts`:

Replace the import block's research-missions line and delete the private mapper:

```ts
import {
  researchArtifactKindForMode,
  STANDARD_RESEARCH_ARTIFACTS,
  type CreateResearchMissionInput,
  type ResearchMission,
} from "../research-missions.ts";
```

Delete the whole `function artifactKindForMode(...)` (lines 18–23) and its now-unused `ResearchArtifactKind` import. In `createMissionRecord`, change `const kind = artifactKindForMode(input.mode);` to `const kind = researchArtifactKindForMode(input.mode);` and replace the `artifacts:` property with:

```ts
    artifacts: [
      {
        key: "primary",
        kind,
        title: missionTitle(input),
        relativePath: "artifacts/primary.md",
        iteration: 1,
        state: "working",
        updatedAt: timestamp,
      },
      ...STANDARD_RESEARCH_ARTIFACTS.map((standard) => ({
        ...standard,
        iteration: 1,
        state: "working" as const,
        updatedAt: timestamp,
      })),
    ],
```

- [ ] **Step 3.5: Write the failing store-backfill test** — append to `src/lib/server/research-mission-store.test.ts`. **First view the top of that file** and reuse its existing temp-root setup helper if it has one; otherwise use this self-contained pattern (the store reads `COVEN_RESEARCH_MISSIONS_DIR` at call time, line ~30):

```ts
test("loadResearchMission backfills standard artifact refs on legacy missions", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "research-store-backfill-"));
  const previousRoot = process.env.COVEN_RESEARCH_MISSIONS_DIR;
  process.env.COVEN_RESEARCH_MISSIONS_DIR = root;
  t.after(async () => {
    if (previousRoot === undefined) delete process.env.COVEN_RESEARCH_MISSIONS_DIR;
    else process.env.COVEN_RESEARCH_MISSIONS_DIR = previousRoot;
    await rm(root, { recursive: true, force: true });
  });
  const legacy = {
    version: 1,
    id: "legacy-mission",
    familiarId: "sage",
    title: "Legacy",
    intent: "Legacy mission from before standard refs",
    mode: "brief",
    modeSource: "user",
    deliverable: "brief",
    constraints: [],
    bounds: {
      wallClockMinutes: 20,
      maxIterations: 1,
      sourceTarget: 6,
      checkpointEvery: 1,
      stopWhenCostUnavailable: false,
    },
    status: "completed",
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T01:00:00.000Z",
    iterations: [{ number: 1, status: "completed" }],
    artifacts: [{
      key: "primary",
      kind: "brief",
      title: "Legacy",
      relativePath: "artifacts/primary.md",
      iteration: 1,
      state: "working",
      updatedAt: "2026-07-01T01:00:00.000Z",
    }],
    sources: [],
  };
  await mkdir(path.join(root, "legacy-mission"), { recursive: true });
  await writeFile(path.join(root, "legacy-mission", "mission.json"), JSON.stringify(legacy));
  const loaded = await loadResearchMission("legacy-mission");
  assert.ok(loaded);
  assert.deepEqual(
    loaded.artifacts.map((artifact) => artifact.key),
    ["primary", "findings", "source-ledger", "research-log"],
  );
});
```

Add whichever of `mkdtemp`, `mkdir`, `writeFile`, `rm` (from `node:fs/promises`), `os` (`node:os`), `path` (`node:path`), and `loadResearchMission` the file doesn't already import.

- [ ] **Step 3.6: Run to verify failure**

Run: `node --experimental-strip-types --import ./scripts/test-alias-register.mjs src/lib/server/research-mission-store.test.ts`
Expected: the new test FAILS (only `primary` present); pre-existing tests still pass.

- [ ] **Step 3.7: Implement the store backfill** — in `src/lib/server/research-mission-store.ts`, add `ensureStandardArtifactRefs` to the existing import from `../research-missions.ts`, then in `loadResearchMission` change:

```ts
    if (!isResearchMission(parsed) || parsed.id !== id) return null;
    return parsed;
```

to:

```ts
    if (!isResearchMission(parsed) || parsed.id !== id) return null;
    // Additive read-time backfill: missions created before the standard refs
    // existed gain them on load; the refs persist on the next save.
    return ensureStandardArtifactRefs(parsed);
```

- [ ] **Step 3.8: Run to verify pass**

```bash
node --experimental-strip-types --import ./scripts/test-alias-register.mjs src/lib/server/research-mission-lifecycle.test.ts
node --experimental-strip-types --import ./scripts/test-alias-register.mjs src/lib/server/research-mission-store.test.ts
```
Expected: PASS both. Also run the four runner test files (they consume `createMissionRecord` missions indirectly):

```bash
node --experimental-strip-types --import ./scripts/test-alias-register.mjs src/lib/server/research-mission-runner-lifecycle-actions.test.ts
node --experimental-strip-types --import ./scripts/test-alias-register.mjs src/lib/server/research-mission-runner-reconciliation-evidence.test.ts
node --experimental-strip-types --import ./scripts/test-alias-register.mjs src/lib/server/research-mission-runner-automation-scheduling.test.ts
node --experimental-strip-types --import ./scripts/test-alias-register.mjs src/lib/server/research-mission-runner-concurrency-terminal.test.ts
```
If any assert an exact `artifacts.length` after mission creation, update that expectation to 4 (test fixtures built literally — like `checkpointMission()` — are unaffected).

- [ ] **Step 3.9: Commit**

```bash
git add src/lib/server/research-mission-lifecycle.ts src/lib/server/research-mission-lifecycle.test.ts src/lib/server/research-mission-store.ts src/lib/server/research-mission-store.test.ts scripts/run-tests.mjs
git commit -S -m "feat(research): register standard artifact refs at creation and backfill on load

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 4: Runner — publish every final artifact on complete

`reconcileCompletedRun` (runner lines 281–393) currently bumps/publishes only `artifacts[0]`. Now: every non-rejected ref is bumped each pass; on a `complete` decision every unpublished, non-rejected ref publishes with per-artifact failure isolation.

**Files:**
- Modify: `src/lib/server/research-mission-runner.ts`
- Test: `src/lib/server/research-mission-runner-reconciliation-evidence.test.ts` (exists; builders `deps(overrides)` / `checkpointMission(overrides)` at lines 45–131)

- [ ] **Step 4.1: Write the failing tests** — append to the reconciliation test file. It reconciles via `runner.act` with a succeeded flow run (copy the stub shape from its first test, lines 132–169). Helper + tests to add:

```ts
const FOUR_REFS: ResearchMission["artifacts"] = [
  { key: "primary", kind: "findings", title: "Iterative research", relativePath: "artifacts/primary.md", iteration: 1, state: "working", updatedAt: NOW.toISOString() },
  { key: "findings", kind: "findings", title: "Findings", relativePath: "findings.md", iteration: 1, state: "working", updatedAt: NOW.toISOString() },
  { key: "source-ledger", kind: "source-ledger", title: "Source ledger", relativePath: "sources.json", iteration: 1, state: "working", updatedAt: NOW.toISOString() },
  { key: "research-log", kind: "research-log", title: "Research log", relativePath: "research-log.md", iteration: 1, state: "working", updatedAt: NOW.toISOString() },
];

function completingRunDeps(
  stored: { mission: ResearchMission },
  overrides: Partial<ResearchMissionRunnerDeps> = {},
): ResearchMissionRunnerDeps {
  return deps({
    loadMission: async () => structuredClone(stored.mission),
    saveMission: async (mission) => { stored.mission = structuredClone(mission); },
    loadFlowRun: async () => ({ ...RUN, status: "succeeded", finishedAt: NOW.toISOString() }),
    loadConversation: async () => ({
      sessionId: "session-1",
      familiarId: "sage",
      harness: "codex",
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
      turns: [{
        id: "turn-1",
        role: "assistant",
        text: [
          "@@research-control",
          '{"decision":"complete","reason":"Done","confidence":0.9}',
          "@@research-artifacts-written",
        ].join("\n"),
        createdAt: NOW.toISOString(),
      }],
    }),
    readMissionFile: async (_id, relativePath) => `# Content of ${relativePath}\n`,
    ...overrides,
  });
}

test("complete publishes all four final artifacts to the vault", async () => {
  const stored = {
    mission: checkpointMission({
      status: "running",
      artifacts: structuredClone(FOUR_REFS),
      sources: [{ id: "s1", title: "SQLite docs", url: "https://sqlite.org", sourceType: "web", status: "used" }],
      iterations: [{ ...checkpointMission().iterations[0], status: "running", finishedAt: undefined }],
    }),
  };
  const published: Array<{ id: string; body: string }> = [];
  const runner = makeResearchMissionRunner(completingRunDeps(stored, {
    publishKnowledge: async (entry) => { published.push({ id: entry.id, body: entry.body }); return entry; },
  }));
  const result = await runner.act(stored.mission.id, { action: "resume" });
  assert.equal(result.status, "completed");
  assert.equal(result.lastError, undefined);
  assert.deepEqual(
    published.map((entry) => entry.id).sort(),
    [
      "research-mission-actions-findings",
      "research-mission-actions-primary",
      "research-mission-actions-research-log",
      "research-mission-actions-source-ledger",
    ],
  );
  const ledger = published.find((entry) => entry.id.endsWith("source-ledger"));
  assert.match(ledger?.body ?? "", /SQLite docs/, "ledger publishes rendered markdown, not raw JSON");
  for (const artifact of result.artifacts) {
    assert.equal(artifact.state, "published");
    assert.ok(artifact.knowledgeId);
  }
});

test("checkpoint publishes nothing but bumps every working ref", async () => {
  const stored = {
    mission: checkpointMission({
      status: "running",
      artifacts: structuredClone(FOUR_REFS),
      iterations: [{ ...checkpointMission().iterations[0], number: 2, status: "running", finishedAt: undefined }],
    }),
  };
  let published = 0;
  const runner = makeResearchMissionRunner(completingRunDeps(stored, {
    loadConversation: async () => ({
      sessionId: "session-1",
      familiarId: "sage",
      harness: "codex",
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
      turns: [{
        id: "turn-1",
        role: "assistant",
        text: [
          "@@research-control",
          '{"decision":"checkpoint","reason":"Review","confidence":0.8}',
          "@@research-artifacts-written",
        ].join("\n"),
        createdAt: NOW.toISOString(),
      }],
    }),
    publishKnowledge: async (entry) => { published += 1; return entry; },
  }));
  const result = await runner.act(stored.mission.id, { action: "resume" });
  assert.equal(result.status, "checkpoint");
  assert.equal(published, 0);
  for (const artifact of result.artifacts) {
    assert.equal(artifact.state, "working");
    assert.equal(artifact.iteration, 2, "every ref adopts the finished pass number");
  }
});

test("a single publish failure is isolated: mission completes, ref stays working, lastError names it", async () => {
  const stored = {
    mission: checkpointMission({
      status: "running",
      artifacts: structuredClone(FOUR_REFS),
      iterations: [{ ...checkpointMission().iterations[0], status: "running", finishedAt: undefined }],
    }),
  };
  const runner = makeResearchMissionRunner(completingRunDeps(stored, {
    publishKnowledge: async (entry) => {
      if (entry.id.endsWith("-findings")) throw new Error("vault write failed");
      return entry;
    },
  }));
  const result = await runner.act(stored.mission.id, { action: "resume" });
  assert.equal(result.status, "completed", "publish failure never blocks the terminal state");
  assert.match(result.lastError ?? "", /findings: vault write failed/);
  const findings = result.artifacts.find((artifact) => artifact.key === "findings");
  assert.equal(findings?.state, "working");
  assert.equal(findings?.knowledgeId, undefined);
  assert.equal(
    result.artifacts.filter((artifact) => artifact.state === "published").length,
    3,
    "the other refs still publish",
  );
});

test("a missing standard file fails only that artifact", async () => {
  const stored = {
    mission: checkpointMission({
      status: "running",
      artifacts: structuredClone(FOUR_REFS),
      iterations: [{ ...checkpointMission().iterations[0], status: "running", finishedAt: undefined }],
    }),
  };
  const runner = makeResearchMissionRunner(completingRunDeps(stored, {
    readMissionFile: async (_id, relativePath) => (
      relativePath === "research-log.md" ? null : `# Content of ${relativePath}\n`
    ),
  }));
  const result = await runner.act(stored.mission.id, { action: "resume" });
  assert.equal(result.status, "completed");
  assert.match(result.lastError ?? "", /research-log: file missing/);
  assert.equal(result.artifacts.filter((artifact) => artifact.state === "published").length, 3);
});
```

Note: `{ action: "resume" }` on a mission whose flow run has succeeded triggers `reconcileFlowUnlocked` → `reconcileCompletedRun` before the resume branch, exactly like the existing "actions reconcile a completed Flow" test — after reconciliation to a terminal status, resume is not in `allowedResearchActions`, so the reconciled mission is returned as-is.

- [ ] **Step 4.2: Run to verify failure**

Run: `node --experimental-strip-types --import ./scripts/test-alias-register.mjs src/lib/server/research-mission-runner-reconciliation-evidence.test.ts`
Expected: new tests FAIL (only 1 publish happens; standard refs never bumped).

- [ ] **Step 4.3: Implement** — in `src/lib/server/research-mission-runner.ts`:

**(a)** Extend imports: add `renderSourceLedgerMarkdown` and `type ResearchProvenance` to the existing import from `../research-artifact-contract.ts`; add `researchArtifactKindForMode` to the existing import from `../research-missions.ts`. Delete the private `defaultArtifactKindForMode` (line ~209) and replace its two call sites with `researchArtifactKindForMode`.

**(b)** Add the shared publisher directly above `reconcileCompletedRun`:

```ts
type PublishFinalArtifactsArgs = {
  mission: ResearchMission;
  artifacts: ResearchArtifactRef[];
  sources: ResearchSourceRef[];
  /** Pre-read artifacts/primary.md content; null when unavailable. */
  primaryMarkdown: string | null;
  provenance: ResearchProvenance;
  deps: Pick<ResearchMissionRunnerDeps, "readMissionFile" | "publishKnowledge">;
};

/** Publish every unpublished, non-rejected ref. Per-artifact isolation: one
 *  failed vault write or missing file never blocks the others or the
 *  mission's terminal state — the failed ref stays `working` (retryable via
 *  publish-artifact) and is named in the returned failures. */
async function publishFinalArtifacts(
  args: PublishFinalArtifactsArgs,
): Promise<{ artifacts: ResearchArtifactRef[]; failures: string[] }> {
  const artifacts: ResearchArtifactRef[] = [];
  const failures: string[] = [];
  for (const artifact of args.artifacts) {
    if (artifact.state === "rejected" || artifact.knowledgeId) {
      artifacts.push(artifact);
      continue;
    }
    try {
      const markdown = artifact.relativePath === "artifacts/primary.md"
        ? args.primaryMarkdown
        : artifact.kind === "source-ledger"
          ? renderSourceLedgerMarkdown(args.sources)
          : await args.deps.readMissionFile(args.mission.id, artifact.relativePath);
      if (markdown === null) throw new Error("file missing");
      const content = validateResearchArtifactContent(artifact.kind, markdown);
      if (!content.ok) throw new Error(content.reason);
      const entry = await args.deps.publishKnowledge(researchKnowledgeEntry({
        mission: args.mission,
        artifact,
        provenance: args.provenance,
        markdown: content.value,
      }));
      artifacts.push({ ...artifact, knowledgeId: entry.id, state: "published" });
    } catch (error) {
      failures.push(`${artifact.key}: ${error instanceof Error ? error.message : "publish failed"}`);
      artifacts.push(artifact);
    }
  }
  return { artifacts, failures };
}

function publishFailureError(failures: string[]): string | undefined {
  return failures.length ? `Artifact publish failed — ${failures.join("; ")}` : undefined;
}
```

If `ResearchArtifactRef` / `ResearchSourceRef` aren't already imported as types in the runner, add them to the `../research-missions.ts` type import (ResearchArtifactRef is already used at line ~341).

**(c)** In `reconcileCompletedRun`, replace everything from `const primaryArtifact: ResearchArtifactRef | undefined = mission.artifacts[0];` (line ~341) through the final `return` (line ~392) with:

```ts
  // Primary lookup by path, not index — backfilled legacy arrays and the
  // reject flow's prepended working copies both keep this stable.
  const primaryArtifact = mission.artifacts.find(
    (artifact) => artifact.relativePath === "artifacts/primary.md" && artifact.state !== "rejected",
  );
  const content = validateResearchArtifactContent(
    primaryArtifact?.kind ?? researchArtifactKindForMode(mission.mode),
    markdown,
  );
  if (!content.ok) {
    return {
      ...mission,
      status: "checkpoint",
      updatedAt: timestamp,
      lastError: content.reason,
      sources,
      iterations: mission.iterations.map((item, index) => index === iterationIndex ? nextIteration : item),
    };
  }

  // Every pass through the normal evidence path bumps every live ref — the
  // standard files are rewritten by each run just like the primary.
  let artifacts = mission.artifacts.map((artifact) => (
    artifact.state === "rejected" ? artifact : {
      ...artifact,
      iteration: iteration.number,
      updatedAt: timestamp,
    }
  ));
  let publishFailures: string[] = [];
  if (control.decision === "complete") {
    const outcome = await publishFinalArtifacts({
      mission,
      artifacts,
      sources,
      primaryMarkdown: content.value,
      provenance: {
        missionId: mission.id,
        iteration: iteration.number,
        flowRunId: iteration.flowRunId,
        sessionId: iteration.sessionId,
        automationRunId: iteration.automationRunId,
        generatedAt: timestamp,
      },
      deps,
    });
    artifacts = outcome.artifacts;
    publishFailures = outcome.failures;
  }

  return {
    ...mission,
    status: control.decision === "complete" ? "completed" : "checkpoint",
    updatedAt: timestamp,
    ...(control.decision === "complete" ? { finishedAt: timestamp } : {}),
    lastError: publishFailureError(publishFailures),
    sources,
    artifacts,
    iterations: mission.iterations.map((item, index) => index === iterationIndex ? nextIteration : item),
  };
```

The three early returns above this block (evidence read failure, missing `primary.md`, validation failure) are unchanged — they keep checkpoint + `lastError` and never touch refs.

- [ ] **Step 4.4: Run to verify pass**

```bash
node --experimental-strip-types --import ./scripts/test-alias-register.mjs src/lib/server/research-mission-runner-reconciliation-evidence.test.ts
node --experimental-strip-types --import ./scripts/test-alias-register.mjs src/lib/server/research-mission-runner-lifecycle-actions.test.ts
node --experimental-strip-types --import ./scripts/test-alias-register.mjs src/lib/server/research-mission-runner-automation-scheduling.test.ts
node --experimental-strip-types --import ./scripts/test-alias-register.mjs src/lib/server/research-mission-runner-concurrency-terminal.test.ts
```
Expected: PASS. If a pre-existing test completes a single-ref mission and asserts on `result.artifacts[0]` only, it still passes (single-ref missions behave as before). Fix any test asserting `lastError === undefined` after a complete whose fixture makes standard-file reads fail — give its deps a `readMissionFile` override that returns content for every path (like `completingRunDeps` does).

- [ ] **Step 4.5: Commit**

```bash
git add src/lib/server/research-mission-runner.ts src/lib/server/research-mission-runner-reconciliation-evidence.test.ts
git commit -S -m "feat(research): publish all final artifacts on complete with failure isolation

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 5: `publish-artifact` action + `finish` publishes

Manual per-artifact publish for settled missions, and the user-driven `finish` action now saves artifacts exactly like an agent `complete` decision (spec §2–§3).

**Files:**
- Modify: `src/lib/research-missions.ts` (action input union, lines 170–183)
- Modify: `src/lib/server/research-mission-runner.ts` (`act`, lines 564–667)
- Modify: `src/app/api/research/missions/[id]/actions/route.ts` (ACTIONS ~line 26, VALIDATION_ERRORS ~line 33, `actionErrorStatus` ~line 44)
- Tests: `src/lib/server/research-mission-runner-lifecycle-actions.test.ts`, `src/app/api/research/missions/[id]/actions/route.test.ts` (both exist)

- [ ] **Step 5.1: Extend the action input type** — in `src/lib/research-missions.ts`, add a final variant to `ResearchMissionActionInput`:

```ts
  | { action: "reject-artifact"; artifactKey: string; reason: string }
  | { action: "publish-artifact"; artifactKey: string };
```

- [ ] **Step 5.2: Write the failing runner tests** — append to `src/lib/server/research-mission-runner-lifecycle-actions.test.ts` (reuse its local `deps`/mission builders — it has the same `deps(overrides)` + `checkpointMission(overrides)` pattern as the reconciliation file; if the builder names differ, view the file top first and adapt these tests to its builders, keeping assertions identical):

```ts
test("publish-artifact publishes one working ref on a settled mission", async () => {
  let stored = checkpointMission({
    artifacts: [
      { key: "primary", kind: "findings", title: "Iterative research", relativePath: "artifacts/primary.md", iteration: 1, state: "working", updatedAt: NOW.toISOString() },
      { key: "findings", kind: "findings", title: "Findings", relativePath: "findings.md", iteration: 1, state: "working", updatedAt: NOW.toISOString() },
    ],
    lastError: "Artifact publish failed — findings: vault write failed",
  });
  const published: string[] = [];
  const runner = makeResearchMissionRunner(deps({
    loadMission: async () => structuredClone(stored),
    saveMission: async (mission) => { stored = structuredClone(mission); },
    readMissionFile: async (_id, relativePath) => `# Content of ${relativePath}\n`,
    publishKnowledge: async (entry) => { published.push(entry.id); return entry; },
  }));
  const result = await runner.act(stored.id, { action: "publish-artifact", artifactKey: "findings" });
  assert.deepEqual(published, ["research-mission-actions-findings"]);
  const findings = result.artifacts.find((artifact) => artifact.key === "findings");
  assert.equal(findings?.state, "published");
  assert.equal(findings?.knowledgeId, "research-mission-actions-findings");
  assert.equal(result.status, "checkpoint", "manual publish never changes mission status");
  assert.equal(
    result.lastError,
    "Artifact publish failed — findings: vault write failed",
    "publish-failure lastError stays until no unpublished working refs remain",
  );
});

test("publish-artifact clears the publish-failure lastError once nothing is left unpublished", async () => {
  let stored = checkpointMission({
    artifacts: [
      { key: "primary", kind: "findings", title: "Iterative research", relativePath: "artifacts/primary.md", iteration: 1, state: "working", updatedAt: NOW.toISOString(), knowledgeId: "research-mission-actions-primary" },
      { key: "findings", kind: "findings", title: "Findings", relativePath: "findings.md", iteration: 1, state: "working", updatedAt: NOW.toISOString() },
    ],
    lastError: "Artifact publish failed — findings: vault write failed",
  });
  const runner = makeResearchMissionRunner(deps({
    loadMission: async () => structuredClone(stored),
    saveMission: async (mission) => { stored = structuredClone(mission); },
    readMissionFile: async () => "# Findings\n",
  }));
  const result = await runner.act(stored.id, { action: "publish-artifact", artifactKey: "findings" });
  assert.equal(result.lastError, undefined);
});

test("publish-artifact rejects running missions, published refs, rejected refs, and unknown keys", async () => {
  const base = checkpointMission({
    artifacts: [
      { key: "primary", kind: "findings", title: "Iterative research", relativePath: "artifacts/primary.md", iteration: 1, state: "working", updatedAt: NOW.toISOString() },
      { key: "findings", kind: "findings", title: "Findings", relativePath: "findings.md", iteration: 1, state: "published", knowledgeId: "research-mission-actions-findings", updatedAt: NOW.toISOString() },
      { key: "research-log", kind: "research-log", title: "Research log", relativePath: "research-log.md", iteration: 1, state: "rejected", rejectionReason: "sparse", updatedAt: NOW.toISOString() },
    ],
  });
  const cases: Array<[Partial<ResearchMission>, string, string]> = [
    [{ status: "running" }, "primary", "research mission is still running"],
    [{}, "findings", "research artifact already published"],
    [{}, "research-log", "rejected artifacts need a new working version before publishing"],
    [{}, "nope", "research artifact not found"],
  ];
  for (const [overrides, artifactKey, message] of cases) {
    let stored = { ...structuredClone(base), ...overrides };
    const runner = makeResearchMissionRunner(deps({
      loadMission: async () => structuredClone(stored),
      saveMission: async (mission) => { stored = structuredClone(mission); },
      readMissionFile: async () => "# Content\n",
    }));
    await assert.rejects(
      () => runner.act(stored.id, { action: "publish-artifact", artifactKey }),
      new Error(message),
      message,
    );
  }
});

test("publish-artifact surfaces a missing file as a clear validation error", async () => {
  let stored = checkpointMission({
    artifacts: [{ key: "findings", kind: "findings", title: "Findings", relativePath: "findings.md", iteration: 1, state: "working", updatedAt: NOW.toISOString() }],
  });
  const runner = makeResearchMissionRunner(deps({
    loadMission: async () => structuredClone(stored),
    saveMission: async (mission) => { stored = structuredClone(mission); },
    readMissionFile: async () => null,
  }));
  await assert.rejects(
    () => runner.act(stored.id, { action: "publish-artifact", artifactKey: "findings" }),
    new Error("research artifact file missing"),
  );
});

test("finish publishes the mission's working refs like a complete decision", async () => {
  let stored = checkpointMission({
    artifacts: [
      { key: "primary", kind: "findings", title: "Iterative research", relativePath: "artifacts/primary.md", iteration: 1, state: "working", updatedAt: NOW.toISOString() },
      { key: "source-ledger", kind: "source-ledger", title: "Source ledger", relativePath: "sources.json", iteration: 1, state: "working", updatedAt: NOW.toISOString() },
    ],
    sources: [{ id: "s1", title: "SQLite docs", url: "https://sqlite.org", sourceType: "web", status: "used" }],
  });
  const published: string[] = [];
  const runner = makeResearchMissionRunner(deps({
    loadMission: async () => structuredClone(stored),
    saveMission: async (mission) => { stored = structuredClone(mission); },
    readMissionFile: async (_id, relativePath) => `# Content of ${relativePath}\n`,
    publishKnowledge: async (entry) => { published.push(entry.id); return entry; },
  }));
  const result = await runner.act(stored.id, { action: "finish" });
  assert.equal(result.status, "completed");
  assert.deepEqual(published.sort(), [
    "research-mission-actions-primary",
    "research-mission-actions-source-ledger",
  ]);
  assert.equal(result.lastError, undefined);
  for (const artifact of result.artifacts) assert.equal(artifact.state, "published");
});
```

Add `type ResearchMission` to the test file's imports if missing.

- [ ] **Step 5.3: Run to verify failure**

Run: `node --experimental-strip-types --import ./scripts/test-alias-register.mjs src/lib/server/research-mission-runner-lifecycle-actions.test.ts`
Expected: new tests FAIL (`publish-artifact` falls through to the allowed-actions gate and returns the mission unchanged; `finish` publishes nothing).

- [ ] **Step 5.4: Implement the runner branches** — in `act()`:

**(a)** Insert after the `reject-artifact` branch (ends line ~598) and **before** the `allowedResearchActions` gate (line ~600) — input-specific actions run before that gate by existing convention:

```ts
      if (input.action === "publish-artifact") {
        if (!["checkpoint", "completed", "failed"].includes(mission.status)) {
          throw new Error("research mission is still running");
        }
        const artifact = mission.artifacts.find((item) => item.key === input.artifactKey);
        if (!artifact) throw new Error("research artifact not found");
        if (artifact.knowledgeId || artifact.state === "published") {
          throw new Error("research artifact already published");
        }
        if (artifact.state === "rejected") {
          throw new Error("rejected artifacts need a new working version before publishing");
        }
        const markdown = artifact.kind === "source-ledger"
          ? renderSourceLedgerMarkdown(mission.sources)
          : await deps.readMissionFile(mission.id, artifact.relativePath);
        if (markdown === null) throw new Error("research artifact file missing");
        const content = validateResearchArtifactContent(artifact.kind, markdown);
        if (!content.ok) throw new Error(content.reason);
        const lastIteration = mission.iterations.at(-1);
        const entry = await deps.publishKnowledge(researchKnowledgeEntry({
          mission,
          artifact,
          provenance: {
            missionId: mission.id,
            iteration: lastIteration?.number ?? mission.iterations.length,
            flowRunId: lastIteration?.flowRunId,
            sessionId: lastIteration?.sessionId,
            automationRunId: lastIteration?.automationRunId,
            generatedAt: timestamp,
          },
          markdown: content.value,
        }));
        const artifacts = mission.artifacts.map((item) => (
          item.key === artifact.key
            ? { ...item, knowledgeId: entry.id, state: "published" as const, updatedAt: timestamp }
            : item
        ));
        // The publish-failure lastError clears once nothing publishable is
        // left unpublished; any other lastError is not ours to clear.
        const publishPending = artifacts.some((item) => item.state === "working" && !item.knowledgeId);
        const lastError = mission.lastError?.startsWith("Artifact publish failed") && !publishPending
          ? undefined
          : mission.lastError;
        return saveUpdated({ ...mission, artifacts, lastError });
      }
```

**(b)** Replace the `finish` branch (lines ~649–657) with:

```ts
      if (input.action === "finish") {
        mission = await pauseAutomation(mission, "Mission finished");
        // Finishing by hand saves the same final artifacts a `complete`
        // decision would — the checkpointed files are the deliverables.
        const lastIteration = mission.iterations.at(-1);
        const outcome = await publishFinalArtifacts({
          mission,
          artifacts: mission.artifacts.map((artifact) => (
            artifact.state === "rejected" ? artifact : { ...artifact, updatedAt: timestamp }
          )),
          sources: mission.sources,
          primaryMarkdown: await deps.readMissionFile(mission.id, "artifacts/primary.md"),
          provenance: {
            missionId: mission.id,
            iteration: lastIteration?.number ?? mission.iterations.length,
            flowRunId: lastIteration?.flowRunId,
            sessionId: lastIteration?.sessionId,
            automationRunId: lastIteration?.automationRunId,
            generatedAt: timestamp,
          },
          deps,
        });
        return saveUpdated({
          ...mission,
          status: "completed",
          finishedAt: timestamp,
          artifacts: outcome.artifacts,
          lastError: publishFailureError(outcome.failures),
        });
      }
```

- [ ] **Step 5.5: Run runner suites; reconcile existing `finish` expectations**

```bash
node --experimental-strip-types --import ./scripts/test-alias-register.mjs src/lib/server/research-mission-runner-lifecycle-actions.test.ts
node --experimental-strip-types --import ./scripts/test-alias-register.mjs src/lib/server/research-mission-runner-automation-scheduling.test.ts
node --experimental-strip-types --import ./scripts/test-alias-register.mjs src/lib/server/research-mission-runner-reconciliation-evidence.test.ts
node --experimental-strip-types --import ./scripts/test-alias-register.mjs src/lib/server/research-mission-runner-concurrency-terminal.test.ts
```

Known interaction: `finish` now attempts publishes, and the default `deps()` stub returns `readMissionFile: async () => null` — a fixture mission with a working primary ref finishes with `lastError: "Artifact publish failed — primary: file missing"`. The two automation tests that run `finish` ("terminal mission actions pause a linked active Automation", line ~290; "terminal actions pause Automation truth even when mission metadata is stale", line ~396) only assert automation status and are expected to keep passing. If any test fails on an unexpected `lastError` after `finish`, add `readMissionFile: async () => "# Complete\n",` to that test's `deps({...})` overrides rather than weakening the assertion.

- [ ] **Step 5.6: Write the failing route test** — append to `src/app/api/research/missions/[id]/actions/route.test.ts` (source-scan style; it reads `./route.ts` at the top):

```ts
test("publish-artifact is routable with its validation and conflict mappings", () => {
  assert.match(source, /"attach-source", "update-source", "reject-artifact", "publish-artifact"/);
  assert.match(source, /"research mission is still running"/);
  assert.match(source, /"rejected artifacts need a new working version before publishing"/);
  assert.match(source, /"research artifact file missing"/);
  assert.match(source, /"Research artifact is too large"/);
  assert.match(source, /research artifact already published.*return 409|return 409.*research artifact already published/s);
});
```

- [ ] **Step 5.7: Implement the route additions** — in `src/app/api/research/missions/[id]/actions/route.ts`:

Line ~26, extend the input-specific list:

```ts
  "attach-source", "update-source", "reject-artifact", "publish-artifact",
```

In `VALIDATION_ERRORS` (~line 33), add:

```ts
  "research mission is still running",
  "rejected artifacts need a new working version before publishing",
  "research artifact file missing",
  "Research artifact is too large",
  "Unsupported research artifact kind",
```

In `actionErrorStatus` (~line 44), after the automation-conflict 409 line, add:

```ts
  // Re-publishing an already-vaulted artifact is a state conflict, not a bad
  // request — the UI resolves it by refreshing the mission.
  if (message === "research artifact already published") return 409;
```

- [ ] **Step 5.8: Run to verify pass**

```bash
node --experimental-strip-types --import ./scripts/test-alias-register.mjs "src/app/api/research/missions/[id]/actions/route.test.ts"
```
Expected: PASS.

- [ ] **Step 5.9: Commit**

```bash
git add src/lib/research-missions.ts src/lib/server/research-mission-runner.ts src/lib/server/research-mission-runner-lifecycle-actions.test.ts "src/app/api/research/missions/[id]/actions/route.ts" "src/app/api/research/missions/[id]/actions/route.test.ts"
git commit -S -m "feat(research): manual publish-artifact action and publishing finish

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

<!-- PLAN-CONTINUES-2 -->

---

### Task 6: Files API + client accessor

Read-only endpoint serving ref-backed file content (path-validated, symlink-safe, 2 MiB cap via the existing `readValidatedMissionFile`), plus the typed client accessor the UI uses.

**Files:**
- Create: `src/app/api/research/missions/[id]/files/[key]/route.ts`
- Create: `src/app/api/research/missions/[id]/files/[key]/route.test.ts`
- Modify: `src/lib/research-mission-client.ts` (types near the top, function after `getResearchMission` ~line 61)
- Test: `src/lib/research-mission-client.test.ts` (exists)
- Modify: `scripts/run-tests.mjs` (register the new route test)

- [ ] **Step 6.1: Write the failing route source-scan test** — create `src/app/api/research/missions/[id]/files/[key]/route.test.ts` (mirror the sibling `[id]/route.test.ts` style):

```ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./route.ts", import.meta.url), "utf8");

test("research mission file route is dynamic, node-only, and local-only", () => {
  assert.match(source, /export const dynamic = "force-dynamic"/);
  assert.match(source, /export const runtime = "nodejs"/);
  assert.match(source, /rejectNonLocalRequest/);
});

test("route validates the mission id and resolves the artifact by key", () => {
  assert.match(source, /isValidResearchMissionId/);
  assert.match(source, /"path not allowed"/);
  assert.match(source, /"research mission not found"/);
  assert.match(source, /"research artifact not found"/);
});

test("route reads through the validated store reader and tolerates missing files", () => {
  assert.match(source, /readValidatedMissionFile/);
  assert.match(source, /ENOENT/);
  assert.match(source, /content: string \| null/);
  assert.match(source, /workspacePath/);
});
```

- [ ] **Step 6.2: Register it** — in `scripts/run-tests.mjs`, add to the API route manifest next to the existing `"src/app/api/research/missions/[id]/route.test.ts"` entry (~line 1021):

```js
  "src/app/api/research/missions/[id]/files/[key]/route.test.ts",
```

- [ ] **Step 6.3: Run to verify failure**

Run: `node --experimental-strip-types --import ./scripts/test-alias-register.mjs "src/app/api/research/missions/[id]/files/[key]/route.test.ts"`
Expected: FAIL — `./route.ts` does not exist (ENOENT).

- [ ] **Step 6.4: Implement the route** — create `src/app/api/research/missions/[id]/files/[key]/route.ts`. **First view the sibling** `src/app/api/research/missions/[id]/route.ts` and copy its exact import paths and `rejectNonLocalRequest` usage. Shape:

```ts
import path from "node:path";
import { NextResponse } from "next/server";
import { rejectNonLocalRequest } from "@/lib/server/local-request";
import {
  isValidResearchMissionId,
  loadResearchMission,
  readValidatedMissionFile,
  researchMissionWorkspacePath,
} from "@/lib/server/research-mission-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type MissionFilePayload = {
  key: string;
  kind: string;
  title: string;
  fileName: string;
  relativePath: string;
  /** File body, or null when the run has not written it yet. */
  content: string | null;
  workspacePath: string;
  updatedAt: string;
};

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string; key: string }> },
) {
  const rejected = rejectNonLocalRequest(request);
  if (rejected) return rejected;
  const { id, key } = await context.params;
  if (!isValidResearchMissionId(id)) {
    return NextResponse.json({ ok: false, error: "path not allowed" }, { status: 403 });
  }
  const mission = await loadResearchMission(id);
  if (!mission) {
    return NextResponse.json({ ok: false, error: "research mission not found" }, { status: 404 });
  }
  const artifact = mission.artifacts.find((item) => item.key === key);
  if (!artifact) {
    return NextResponse.json({ ok: false, error: "research artifact not found" }, { status: 404 });
  }
  let content: string | null = null;
  try {
    content = await readValidatedMissionFile(id, artifact.relativePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      const message = error instanceof Error ? error.message : "failed to read research artifact";
      return NextResponse.json({ ok: false, error: message }, { status: 500 });
    }
  }
  const file: MissionFilePayload = {
    key: artifact.key,
    kind: artifact.kind,
    title: artifact.title,
    fileName: path.posix.basename(artifact.relativePath),
    relativePath: artifact.relativePath,
    content,
    workspacePath: researchMissionWorkspacePath(id),
    updatedAt: artifact.updatedAt,
  };
  return NextResponse.json({ ok: true, file });
}
```

Adjust to reality while implementing: check the actual exported names in `research-mission-store.ts` (`readValidatedMissionFile` may return null for missing files instead of throwing ENOENT — view lines 182–200 and keep whichever contract holds, updating the try/catch accordingly) and whether `researchMissionWorkspacePath(id)` is the store's actual workspace-path helper name. Keep the route response shape exactly as typed.

- [ ] **Step 6.5: Run to verify pass**

Run: `node --experimental-strip-types --import ./scripts/test-alias-register.mjs "src/app/api/research/missions/[id]/files/[key]/route.test.ts"`
Expected: PASS.

- [ ] **Step 6.6: Write the failing client test** — append to `src/lib/research-mission-client.test.ts`, following its existing fetch-stub pattern (lines 19–34: stash `globalThis.fetch`, restore in `finally`):

```ts
test("getResearchMissionFile fetches the file payload with encoded segments", async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    calls.push(String(input));
    return new Response(JSON.stringify({
      ok: true,
      file: {
        key: "source-ledger",
        kind: "source-ledger",
        title: "Source ledger",
        fileName: "sources.json",
        relativePath: "sources.json",
        content: "[]",
        workspacePath: "/tmp/research-missions/mission-1",
        updatedAt: "2026-07-24T00:00:00.000Z",
      },
    }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  try {
    const file = await getResearchMissionFile("mission 1", "source-ledger");
    assert.deepEqual(calls, ["/api/research/missions/mission%201/files/source-ledger"]);
    assert.equal(file.content, "[]");
    assert.equal(file.workspacePath, "/tmp/research-missions/mission-1");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("getResearchMissionFile surfaces API errors", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(
    JSON.stringify({ ok: false, error: "research artifact not found" }),
    { status: 404, headers: { "content-type": "application/json" } },
  )) as typeof fetch;
  try {
    await assert.rejects(
      () => getResearchMissionFile("mission-1", "nope"),
      /research artifact not found/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
```

Match the error-message assertion to the client's existing error convention (view how `getResearchMission` throws — reuse the same helper).

- [ ] **Step 6.7: Run to verify failure, implement, verify pass** — add to `src/lib/research-mission-client.ts`, mirroring `getResearchMission` (~lines 52–61) exactly (same fetch options, same response-unwrapping helper):

```ts
export type ResearchMissionFile = {
  key: string;
  kind: string;
  title: string;
  fileName: string;
  relativePath: string;
  content: string | null;
  workspacePath: string;
  updatedAt: string;
};

type ResearchMissionFileResponse = { ok: true; file: ResearchMissionFile };

export async function getResearchMissionFile(
  missionId: string,
  artifactKey: string,
  signal?: AbortSignal,
): Promise<ResearchMissionFile> {
  const response = await fetch(
    `/api/research/missions/${encodeURIComponent(missionId)}/files/${encodeURIComponent(artifactKey)}`,
    { cache: "no-store", signal },
  );
  const payload = await parseResponse<ResearchMissionFileResponse>(response);
  return payload.file;
}
```

(`parseResponse` = whatever unwrap helper the file's other functions use; keep the real name.)

Run: `node --experimental-strip-types --import ./scripts/test-alias-register.mjs src/lib/research-mission-client.test.ts`
Expected: PASS.

- [ ] **Step 6.8: Commit**

```bash
git add "src/app/api/research/missions/[id]/files" src/lib/research-mission-client.ts src/lib/research-mission-client.test.ts scripts/run-tests.mjs
git commit -S -m "feat(research): mission artifact file API and client accessor

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 7: Shared `ResearchArtifactActions` component + styles

One client component rendering the per-artifact action row: **View** (modal), **Download**, **Grimoire** (when published), **Publish** (when offered). Reused by the Desk rail, evidence ledger, and Library.

**Files:**
- Create: `src/components/role-surfaces/research-artifact-actions.tsx`
- Create: `src/components/role-surfaces/research-artifact-actions.test.ts` (source-scan)
- Modify: `src/styles/globals/surface-research-desk.css` (append)
- Modify: `scripts/run-tests.mjs` (app manifest, next to the other role-surface component tests ~line 53)

- [ ] **Step 7.1: Write the failing source-scan test** — create `src/components/role-surfaces/research-artifact-actions.test.ts`:

```ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./research-artifact-actions.tsx", import.meta.url), "utf8");

test("artifact actions is a client component with view, download, grimoire, publish", () => {
  assert.match(source, /^"use client";/);
  assert.match(source, /getResearchMissionFile/);
  assert.match(source, /aria-label=\{`View \$\{artifact\.title\}`\}/);
  assert.match(source, /aria-label=\{`Download \$\{artifact\.title\}`\}/);
  assert.match(source, /openGrimoireDoc\("knowledge", artifact\.knowledgeId\)/);
  assert.match(source, /artifact\.state === "working" && !artifact\.knowledgeId/);
});

test("viewer uses the ui Modal with focus management and honest empty copy", () => {
  assert.match(source, /from "@\/components\/ui\/modal"/);
  assert.match(source, /This file has not been written yet\./);
  assert.match(source, /role="alert"/);
  assert.match(source, /focus-ring/);
});

test("download builds a Blob and revokes the object URL", () => {
  assert.match(source, /URL\.createObjectURL/);
  assert.match(source, /URL\.revokeObjectURL/);
});

test("exports the workspace-path fetcher for the desk summary", () => {
  assert.match(source, /export async function fetchResearchWorkspacePath/);
});
```

Register in `scripts/run-tests.mjs` app manifest next to `"src/components/role-surfaces/research-evidence-ledger.test.ts"`:

```js
    "src/components/role-surfaces/research-artifact-actions.test.ts",
```

Run: `node --experimental-strip-types --import ./scripts/test-alias-register.mjs src/components/role-surfaces/research-artifact-actions.test.ts`
Expected: FAIL (file missing).

- [ ] **Step 7.2: Implement the component** — create `src/components/role-surfaces/research-artifact-actions.tsx`. Before writing, view `research-evidence-ledger.tsx` lines 1–40 for the exact import paths of `Modal`, `Icon`, `useAnnouncer`, `openGrimoireDoc`, and the `ResearchMission` types used in role surfaces, and reuse them:

```tsx
"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/modal";
import { Icon } from "@/lib/icon";
import { useAnnouncer } from "@/lib/announcer";
import { openGrimoireDoc } from "@/lib/grimoire-doc";
import { getResearchMissionFile, type ResearchMissionFile } from "@/lib/research-mission-client";
import type { ResearchArtifactRef, ResearchMission } from "@/lib/research-missions";

type ResearchArtifactActionsProps = {
  mission: ResearchMission;
  artifact: ResearchArtifactRef;
  busy?: boolean;
  /** When provided and the ref is an unpublished working copy, renders the
   *  Publish action. Surfaces that must not offer publishing omit it. */
  onPublish?: (artifactKey: string) => void;
};

function downloadTextFile(fileName: string, content: string) {
  const type = fileName.endsWith(".json") ? "application/json" : "text/markdown";
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

/** Resolve the mission workspace path for "Copy workspace path" affordances. */
export async function fetchResearchWorkspacePath(missionId: string): Promise<string | null> {
  try {
    const file = await getResearchMissionFile(missionId, "primary");
    return file.workspacePath;
  } catch {
    return null;
  }
}

export function ResearchArtifactActions({ mission, artifact, busy, onPublish }: ResearchArtifactActionsProps) {
  const announce = useAnnouncer();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewing, setViewing] = useState<ResearchMissionFile | null>(null);
  const [viewerOpen, setViewerOpen] = useState(false);

  const loadFile = async (): Promise<ResearchMissionFile | null> => {
    setPending(true);
    setError(null);
    try {
      return await getResearchMissionFile(mission.id, artifact.key);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Research file could not be read.";
      setError(message);
      announce(message);
      return null;
    } finally {
      setPending(false);
    }
  };

  const view = async () => {
    const file = await loadFile();
    if (!file) return;
    setViewing(file);
    setViewerOpen(true);
  };

  const download = async () => {
    const file = await loadFile();
    if (!file) return;
    if (file.content === null) {
      const message = `${artifact.title} has not been written yet.`;
      setError(message);
      announce(message);
      return;
    }
    downloadTextFile(file.fileName, file.content);
    announce(`${artifact.title} downloaded.`);
  };

  const disabled = Boolean(busy) || pending;
  const showPublish = Boolean(onPublish) && artifact.state === "working" && !artifact.knowledgeId;

  return (
    <>
      <div className="research-desk-artifact__actions">
        <button
          type="button"
          className="research-desk-artifact__open focus-ring"
          onClick={view}
          disabled={disabled}
          aria-label={`View ${artifact.title}`}
        >
          <Icon name="ph:file-text" size={14} />
          View
        </button>
        <button
          type="button"
          className="research-desk-artifact__open focus-ring"
          onClick={download}
          disabled={disabled}
          aria-label={`Download ${artifact.title}`}
        >
          <Icon name="ph:download-simple" size={14} />
          Download
        </button>
        {artifact.knowledgeId ? (
          <button
            type="button"
            className="research-desk-artifact__open focus-ring"
            onClick={() => openGrimoireDoc("knowledge", artifact.knowledgeId)}
            aria-label={`Open ${artifact.title} in the Grimoire`}
          >
            <Icon name="ph:arrow-square-out" size={14} />
            Grimoire
          </button>
        ) : null}
        {showPublish ? (
          <button
            type="button"
            className="research-desk-artifact__open focus-ring"
            onClick={() => onPublish?.(artifact.key)}
            disabled={disabled}
            aria-label={`Publish ${artifact.title} to the Grimoire`}
          >
            <Icon name="ph:book-bookmark" size={14} />
            Publish
          </button>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="research-desk-artifact__error">{error}</p>
      ) : null}
      <Modal
        open={viewerOpen}
        onClose={() => setViewerOpen(false)}
        breadcrumb={["Research", viewing?.fileName ?? artifact.title]}
        ariaLabel={`${artifact.title} file contents`}
        wide
      >
        {viewing?.content === null || viewing?.content === undefined ? (
          <p className="research-artifact-viewer__empty">This file has not been written yet.</p>
        ) : (
          <pre className="research-artifact-viewer__content">{viewing.content}</pre>
        )}
      </Modal>
    </>
  );
}
```

While implementing, verify against the real `Modal` props (`src/components/ui/modal.tsx`: `open`, `onClose`, `breadcrumb?: ReactNode[]`, `wide?`, `ariaLabel?` — it owns focus trapping and portalling internally) and the real announcer/grimoire import paths; adjust imports, not behavior. All four icons (`ph:file-text`, `ph:download-simple`, `ph:arrow-square-out`, `ph:book-bookmark`) are already in `ICON_NAMES` — no subset regeneration.

- [ ] **Step 7.3: Append styles** — to `src/styles/globals/surface-research-desk.css` (tokens only; `.research-desk-artifact__open` already carries the shared chip look at lines 600–612):

```css
.research-desk-artifact__actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1);
  align-items: center;
}

.research-desk-artifact__error {
  margin: 0;
  font-size: var(--text-2xs);
  color: var(--danger-text);
}

.research-artifact-viewer__content {
  margin: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  max-height: 60vh;
  overflow: auto;
  font-size: var(--text-2xs);
}

.research-artifact-viewer__empty {
  margin: 0;
  font-size: var(--text-2xs);
  color: var(--text-tertiary);
}
```

- [ ] **Step 7.4: Run to verify pass + gates**

```bash
node --experimental-strip-types --import ./scripts/test-alias-register.mjs src/components/role-surfaces/research-artifact-actions.test.ts
pnpm typecheck
pnpm lint
```
Expected: PASS / clean. (Typecheck is the real safety net for a source-scanned component.)

- [ ] **Step 7.5: Commit**

```bash
git add src/components/role-surfaces/research-artifact-actions.tsx src/components/role-surfaces/research-artifact-actions.test.ts src/styles/globals/surface-research-desk.css scripts/run-tests.mjs
git commit -S -m "feat(research): shared artifact view/download/publish actions component

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 8: Desk integration — rail actions, saved summary, ledger actions

**Files:**
- Modify: `src/components/role-surfaces/research-mission-detail.tsx` (rail cards ~667–703, completed block ends ~464, `runMissionAction` 177–204)
- Modify: `src/components/role-surfaces/research-evidence-ledger.tsx` (artifact cards ~144–189, `act()` 67–90)
- Tests: `src/components/role-surfaces/research-tab-desk.test.ts` (source-scans the detail file via `new URL("./research-mission-detail.tsx", import.meta.url)`), `src/components/role-surfaces/research-evidence-ledger.test.ts` (both exist)

- [ ] **Step 8.1: Write the failing source-scan assertions**

Append to `research-tab-desk.test.ts` (reuse its existing detail-source variable name):

```ts
test("desk rail renders shared artifact actions with publish on settled missions", () => {
  assert.match(detailSource, /ResearchArtifactActions/);
  assert.match(detailSource, /onPublish=\{settled \? publishArtifact : undefined\}/);
  assert.match(detailSource, /action: "publish-artifact"/);
  assert.match(detailSource, /Artifact published to the Grimoire\./);
});

test("desk shows a saved-artifacts summary with a copy-workspace-path affordance", () => {
  assert.match(detailSource, /fetchResearchWorkspacePath/);
  assert.match(detailSource, /artifacts published to the Grimoire\./);
  assert.match(detailSource, /working files saved in the mission workspace\./);
  assert.match(detailSource, /Copy workspace path/);
  assert.match(detailSource, /Workspace path copied/);
});
```

Append to `research-evidence-ledger.test.ts` (it scans its own component source):

```ts
test("ledger artifact cards mount the shared actions with publish wiring", () => {
  assert.match(source, /ResearchArtifactActions/);
  assert.match(source, /action: "publish-artifact"/);
  assert.match(source, /Artifact published to the Grimoire\./);
});
```

Run both; expected: FAIL.

```bash
node --experimental-strip-types --import ./scripts/test-alias-register.mjs src/components/role-surfaces/research-tab-desk.test.ts
node --experimental-strip-types --import ./scripts/test-alias-register.mjs src/components/role-surfaces/research-evidence-ledger.test.ts
```

- [ ] **Step 8.2: Implement in `research-mission-detail.tsx`**

> **Review carry-over (Tasks 2–3):** the desk tile's `draftArtifact = artifacts.filter(state === "working").at(-1)` (~line 147) resolves to the appended `research-log` ref now that every mission carries 4 working refs. While in this file, change the selection to the working primary only — `mission.artifacts.find((a) => a.relativePath === "artifacts/primary.md" && a.state === "working")` — with NO fallback to standard refs: when the primary is rejected the tile must disappear, as it did before the standard refs existed.

**(a)** Import the component: `import { ResearchArtifactActions, fetchResearchWorkspacePath } from "./research-artifact-actions";`

**(b)** Near the existing action callbacks (after `runMissionAction`, ~line 204), add:

```tsx
  const settled = ["checkpoint", "completed", "failed"].includes(mission.status);
  const publishArtifact = (artifactKey: string) => {
    void runMissionAction(
      "Artifact could not be published",
      () => onAction({ action: "publish-artifact", artifactKey }),
      () => announce("Artifact published to the Grimoire."),
    );
  };
```

(Match `runMissionAction`'s real signature — view lines 177–204 first; if it takes `(errorLabel, action, onSuccess)` in a different order or shape, adapt the call, not the helper.)

**(c)** In the artifact rail cards (~667–703), replace the lone Grimoire-open button block with:

```tsx
              <ResearchArtifactActions
                mission={mission}
                artifact={artifact}
                busy={busy}
                onPublish={settled ? publishArtifact : undefined}
              />
```

Keep the surrounding card markup (title, state chip, iteration) untouched.

**(d)** Saved summary — insert a section directly after the completed Findings block (ends ~line 464), rendered when `mission.status === "completed" || mission.status === "checkpoint"`:

```tsx
        {mission.status === "completed" || mission.status === "checkpoint" ? (
          <section className="research-desk-section">
            <p className="research-desk-section__kicker">Saved</p>
            <p className="research-desk-section__line">
              {mission.status === "completed"
                ? `${mission.artifacts.filter((artifact) => artifact.knowledgeId).length} of ${mission.artifacts.filter((artifact) => artifact.state !== "rejected").length} artifacts published to the Grimoire.`
                : `${mission.artifacts.filter((artifact) => artifact.state === "working").length} working files saved in the mission workspace.`}
            </p>
            <button
              type="button"
              className="research-desk-artifact__open focus-ring"
              onClick={copyWorkspacePath}
              aria-label="Copy the mission workspace path"
            >
              <Icon name="ph:copy" size={14} />
              {workspaceCopied ? "Workspace path copied" : "Copy workspace path"}
            </button>
          </section>
        ) : null}
```

with state + handler near the other component state:

```tsx
  const [workspaceCopied, setWorkspaceCopied] = useState(false);
  const copyWorkspacePath = async () => {
    const workspacePath = await fetchResearchWorkspacePath(mission.id);
    if (!workspacePath) {
      announce("Workspace path could not be resolved.");
      return;
    }
    await navigator.clipboard.writeText(workspacePath);
    setWorkspaceCopied(true);
    announce("Workspace path copied.");
    setTimeout(() => setWorkspaceCopied(false), 2000);
  };
```

Reuse the section/kicker class names actually present in the completed Findings block you're inserting after (view ~430–464 and copy its exact classes; the names above are indicative). `ph:copy` is already in `ICON_NAMES`.

- [ ] **Step 8.3: Implement in `research-evidence-ledger.tsx`** — import `ResearchArtifactActions`, then inside the artifact card (~153–161, after the state/meta line) add:

```tsx
            <ResearchArtifactActions
              mission={mission}
              artifact={artifact}
              busy={busy}
              onPublish={async (artifactKey) => {
                const ok = await act({ action: "publish-artifact", artifactKey });
                if (ok) announce("Artifact published to the Grimoire.");
              }}
            />
```

The ledger's local `act()` (lines 67–90) already returns `Promise<boolean>` and handles error surfacing. Match the card's real local variable names (`mission`, `artifact`, `busy`) while editing. This is the checkpoint surface — the desk rail is hidden at checkpoint (`showArtifactRail = !isCheckpointLike && !isLive`), so the ledger must offer the full action set.

- [ ] **Step 8.4: Run to verify pass + gates**

```bash
node --experimental-strip-types --import ./scripts/test-alias-register.mjs src/components/role-surfaces/research-tab-desk.test.ts
node --experimental-strip-types --import ./scripts/test-alias-register.mjs src/components/role-surfaces/research-evidence-ledger.test.ts
pnpm typecheck
```
Expected: PASS / clean.

- [ ] **Step 8.5: Commit**

```bash
git add src/components/role-surfaces/research-mission-detail.tsx src/components/role-surfaces/research-evidence-ledger.tsx src/components/role-surfaces/research-tab-desk.test.ts src/components/role-surfaces/research-evidence-ledger.test.ts
git commit -S -m "feat(research): desk and ledger artifact actions with saved summary

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 9: Library integration

Unpublished artifacts on Library mission cards get View/Download (no Publish — the Library stays a browsing surface); published ones keep their existing Grimoire open button. Also fix the stale header comment claiming artifacts have no real file bytes.

**Files:**
- Modify: `src/components/role-surfaces/research-tab-library.tsx` (card actions ~416–434, header comment ~line 16)
- Test: `src/components/role-surfaces/research-tab-library.test.ts` (exists)

- [ ] **Step 9.1: Write the failing source-scan assertions** — append to `research-tab-library.test.ts`:

```ts
test("library offers view/download for unpublished artifacts without publish", () => {
  assert.match(source, /ResearchArtifactActions/);
  assert.doesNotMatch(source, /onPublish=/, "library never offers publishing");
});
```

Run: `node --experimental-strip-types --import ./scripts/test-alias-register.mjs src/components/role-surfaces/research-tab-library.test.ts`
Expected: FAIL.

- [ ] **Step 9.2: Implement** — in `research-tab-library.tsx`:

**(a)** Import: `import { ResearchArtifactActions } from "./research-artifact-actions";`

**(b)** In the card actions block (~416–434), where unpublished artifacts currently render nothing (or a disabled hint), render for each artifact without `knowledgeId`:

```tsx
                <ResearchArtifactActions mission={mission} artifact={artifact} />
```

keeping the existing published-artifact Open `Button` untouched. Match the real loop variable names at the site.

**(c)** Update the stale header comment (~line 16) that says artifacts expose no real file bytes — replace that sentence with: `Artifacts are backed by real mission workspace files served via /api/research/missions/[id]/files/[key].`

- [ ] **Step 9.3: Run to verify pass**

```bash
node --experimental-strip-types --import ./scripts/test-alias-register.mjs src/components/role-surfaces/research-tab-library.test.ts
pnpm typecheck
```
Expected: PASS / clean.

- [ ] **Step 9.4: Commit**

```bash
git add src/components/role-surfaces/research-tab-library.tsx src/components/role-surfaces/research-tab-library.test.ts
git commit -S -m "feat(research): library view/download for unpublished artifacts

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 10: Full gates + PR

- [ ] **Step 10.1: Run every gate**

```bash
pnpm typecheck
pnpm lint
node scripts/run-tests.mjs app
node scripts/run-tests.mjs api
node scripts/run-tests.mjs server 2>/dev/null || true
```

(Check `scripts/run-tests.mjs` for the actual suite name covering `src/lib/server/**` — it may be part of `app` or its own suite; run whichever suite contains the runner/store/lifecycle test files.)

Expected: all green. Fix regressions before proceeding — common suspects are listed in Steps 3.8, 4.4, and 5.5.

- [ ] **Step 10.2: Push and open the PR**

```bash
git push origin research-final-artifacts
gh pr create --base main --head research-final-artifacts \
  --title "Research Desk: produce and save final research artifacts" \
  --body "$(cat <<'BODY'
## Summary
- Every research mission now tracks all four final artifacts (primary deliverable, findings, source ledger, research log) as first-class refs, backfilled for legacy missions at load time.
- Agent `complete` decisions and the user `finish` action publish every non-rejected artifact to the Grimoire Vault with per-artifact failure isolation; failures land in `lastError` and are retryable via the new `publish-artifact` action.
- `sources.json` publishes as a rendered markdown source ledger.
- New read-only files API + shared `ResearchArtifactActions` component give View / Download / Grimoire / Publish across the Desk rail, evidence ledger, and Library, plus a saved-artifacts summary with copy-workspace-path.

Spec: `docs/specs/2026-07-24-research-final-artifacts-design.md`
Plan: `docs/superpowers/plans/2026-07-24-research-final-artifacts.md`

## Testing
- `pnpm typecheck`, `pnpm lint`
- `node scripts/run-tests.mjs app`, `node scripts/run-tests.mjs api` (new: contract ledger rendering, ref backfill, multi-publish reconciliation, publish-artifact/finish lifecycle, files route, component/desk/ledger/library source scans)
BODY
)"
```

Wait for the required checks (`Frontend build`, `Rust check`, `CodeQL`, `E2E (Playwright)`), then squash-merge and clean up the worktree per repo convention.


