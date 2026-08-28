# Signed Release-Candidate CI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. **Checkbox state in this document is not evidence of completion. Verify what has shipped against code and merged PRs.**

**Goal:** Make pull-request CI one non-skippable Linux gate and require a successful, signed, exact-commit release candidate before any final release publication begins.

**Architecture:** Land this in two implementation PRs separated by a branch-protection change. Phase 1 adds testable tag-provenance code, reusable full validation, release-candidate validation, final-release authorization, and a parallel `PR checks` context while preserving the currently required `Frontend build`; Phase 2 removes the old path-aware fanout and `main` push trigger only after protection requires `PR checks`. GitHub API and git provenance logic lives in a Node module with fixture-driven tests rather than opaque workflow shell.

**Tech Stack:** GitHub Actions YAML, Node.js 24 ESM, Node test runner, `yaml`, GitHub REST API, git, pnpm.

---

## Current-state reconciliation

The approved specification is `docs/superpowers/specs/2026-08-05-release-candidate-ci-design.md`.
The repository has changed since that document was written:

- Classic branch protection now requires one context, `Frontend build`, rather than nine.
- `.github/workflows/ci.yml` is path-aware and fans frontend checks into parallel jobs, but still runs on pushes to `main`.
- `.github/workflows/release.yml` already runs the deferred web, E2E, cross-platform, sidecar, Windows-native, and iOS checks, but it runs them on the final `vX.Y.Z` release tag.
- There is no `.github/workflows/release-candidate.yml`, no reusable full-validation workflow, and no final-release proof of a successful same-version RC at the exact commit.
- The specification's `v0.2.4` legacy boundary is no longer executable:
  `v0.2.4` through `v0.3.6` were published before this implementation. The
  safe replacement is a fixed publication-time boundary. Manual recovery may
  bypass RC evidence only for a non-draft GitHub Release whose
  `published_at` is before `2026-08-17T08:21:59Z`, one second after the latest
  pre-migration publication (`v0.3.6`). A tag or release created after that
  instant cannot enter the legacy path.
- A final tag executes workflow YAML from the tagged commit. Editing the
  existing `.github/workflows/release.yml` cannot secure an old main commit,
  because that commit still contains the ungated publisher. Phase 1 therefore
  creates a new `.github/workflows/publish-release.yml` identity and disables
  legacy workflow ID `286550155` immediately before merge. The old identity
  stays disabled permanently; the new file does not exist on old commits, so a
  stable tag targeting them cannot publish.

Therefore Phase 1 must migrate one required context (`Frontend build` -> `PR checks`), not recreate the specification's obsolete nine-context intermediate state. The signed-RC safety boundary remains unimplemented and is the primary work.

## File structure

### Phase 1 PR: establish promotion and the new context

- Create `.github/workflows/full-validation.yml` — reusable, read-only deferred validation with a fail-closed rollup.
- Create `.github/workflows/release-candidate.yml` — signed RC trigger, provenance gate, and reusable-validation caller.
- Create `scripts/release-promotion.mjs` — tag parsing, GitHub tag verification, main ancestry, RC-run discovery, rollup verification, legacy recovery boundary, and CLI output.
- Create `scripts/release-promotion.test.mjs` — hermetic REST/git fixtures for candidate and final authorization.
- Create `scripts/release-promotion-workflow.test.mjs` — YAML behavior contract for candidate, reusable validation, and final release DAG.
- Create `.github/workflows/publish-release.yml` — new stable-tag publisher identity with authorization and no duplicated validation.
- Delete `.github/workflows/release.yml` — retire the historical publisher path after its workflow ID is disabled.
- Modify `.github/workflows/ci.yml` — add always-reporting `PR checks` while retaining current `Frontend build` and its prerequisite jobs during migration.
- Modify `scripts/ci-recovery.mjs` — dispatch and validate both the expected SHA and PR number used by concurrency.
- Modify `scripts/ci-recovery.test.mjs` — pin the new dispatch contract.
- Modify `scripts/ci-recovery-workflow.test.mjs` — pin both migration contexts and remove release assertions that move to the dedicated contract test.
- Modify `scripts/run-tests.mjs` — wire both new tests into `SUITES.app`.
- Modify `src-tauri/release-runtime.test.mjs` — read moved runtime jobs from `full-validation.yml`.
- Modify `scripts/ios-build-ci.test.mjs` — assert TestFlight is authorization-gated rather than coupled to duplicated final-tag validation.
- Modify `scripts/stamp-release.test.mjs` — move source-provenance pins from `source-version` to the new authorization job.
- Modify `scripts/release-macos-signing.test.mjs` — pin the authorized source output used by release packaging.
- Modify `scripts/check-grok-registry-release.test.mjs`, `scripts/check-opencode-registry-release.test.mjs`, and `scripts/check-x-app-release.test.mjs` — inspect the new publisher path.
- Modify `src/lib/app-version.test.ts` — inspect the new publisher path.
- Modify `docs/discord-rich-presence.md` — link to the new publisher path.
- Modify `README.md`, `docs/workflows/branching.md`, and `docs/cross-environment.md` — document RC-first release operation and deferred validation.

### Phase 2 PR: retire queue-heavy routine CI

- Modify `.github/workflows/ci.yml` — retain only `PR checks`, remove `push: main`, and preserve exact-head recovery dispatch.
- Modify `scripts/ci-recovery.mjs`, `scripts/ci-recovery.test.mjs`, and `scripts/ci-recovery-workflow.test.mjs` — narrow the inspected job contract to the final one-job workflow.
- Modify `CLAUDE.md` and `.agents/skills/branch-to-merge/SKILL.md` — replace `Frontend build` with `PR checks` and describe the lean gate accurately.
- Modify `docs/cross-environment.md` — make `PR checks` the PR baseline and the RC workflow the cross-platform authority.

## Phase 1 — signed promotion and parallel context

### Task 1: Build the release-promotion verifier

**Files:**
- Create: `scripts/release-promotion.mjs`
- Create: `scripts/release-promotion.test.mjs`
- Modify: `scripts/run-tests.mjs`

- [ ] **Step 1: Write failing parser and candidate-provenance tests**

Create `scripts/release-promotion.test.mjs` with fixture builders for JSON responses, command results, signed tag objects, workflow runs, and run jobs. Start with these public contracts:

```js
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  FINAL_TAG_PATTERN,
  RC_TAG_PATTERN,
  authorizeCandidate,
  parseCandidateTag,
  parseFinalTag,
} from "./release-promotion.mjs";

test("candidate tags require a positive rc number", () => {
  assert.deepEqual(parseCandidateTag("v1.2.3-rc.1"), {
    tag: "v1.2.3-rc.1",
    baseTag: "v1.2.3",
    version: "1.2.3",
    rc: 1,
  });
  for (const tag of ["v1.2.3", "v1.2.3-rc.0", "v1.2.3-rc.01", "v1.2-rc.1", "v1.2.3-beta.1"]) {
    assert.throws(() => parseCandidateTag(tag), /valid release-candidate tag/);
  }
  assert.equal(RC_TAG_PATTERN.test("v1.2.3-rc.1"), true);
});

test("final tags exclude candidates and other prereleases", () => {
  assert.deepEqual(parseFinalTag("v1.2.3"), {
    tag: "v1.2.3",
    version: "1.2.3",
  });
  for (const tag of ["v1.2.3-rc.1", "v1.2.3-beta.1", "1.2.3", "v01.2.3"]) {
    assert.throws(() => parseFinalTag(tag), /valid final release tag/);
  }
  assert.equal(FINAL_TAG_PATTERN.test("v1.2.3"), true);
});

test("candidate authorization accepts only a verified annotated tag at the expected main commit", async () => {
  const fixture = candidateFixture({
    tag: "v1.2.3-rc.1",
    expectedCommit: "a".repeat(40),
    verified: true,
    objectType: "tag",
    onMain: true,
  });
  const result = await authorizeCandidate(fixture.options);
  assert.deepEqual(result, {
    tag: "v1.2.3-rc.1",
    baseTag: "v1.2.3",
    version: "1.2.3",
    commit: "a".repeat(40),
    verificationReason: "valid",
  });
});

test("manual candidate diagnostics use the tag's peeled commit", async () => {
  const fixture = candidateFixture({
    tag: "v1.2.3-rc.1",
    eventName: "workflow_dispatch",
    expectedCommit: undefined,
    taggedCommit: "a".repeat(40),
  });
  assert.equal((await authorizeCandidate(fixture.options)).commit, "a".repeat(40));
});

test("candidate authorization rejects lightweight, unsigned, off-main, and mismatched tags", async () => {
  for (const override of [
    { objectType: "commit", message: /annotated tag/ },
    { verified: false, message: /GitHub-verified/ },
    { onMain: false, message: /contained in origin\/main/ },
    { taggedCommit: "b".repeat(40), message: /expected commit/ },
  ]) {
    const fixture = candidateFixture(override);
    await assert.rejects(authorizeCandidate(fixture.options), override.message);
  }
});
```

The fixture must inject both `fetchImpl` and `execFileImpl`; it must not invoke the network, the real git checkout, or local signature configuration.
Its successful run fixture must expose the API job name
`full-validation / Release candidate validated`, matching GitHub's reusable
workflow prefix behavior.

- [ ] **Step 2: Run the focused test and confirm the missing module failure**

Run:

```bash
node --test scripts/release-promotion.test.mjs
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `scripts/release-promotion.mjs`.

- [ ] **Step 3: Implement strict parsing and candidate authorization**

Create `scripts/release-promotion.mjs` with these exports and dependency-injected entry points:

```js
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";

const execFile = promisify(execFileCallback);

export const RC_TAG_PATTERN =
  /^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)-rc\.([1-9][0-9]*)$/;
export const FINAL_TAG_PATTERN =
  /^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;

export function parseCandidateTag(tag) {
  const match = RC_TAG_PATTERN.exec(tag);
  if (!match) throw new Error(`${tag} is not a valid release-candidate tag`);
  const version = `${match[1]}.${match[2]}.${match[3]}`;
  return { tag, baseTag: `v${version}`, version, rc: Number(match[4]) };
}

export function parseFinalTag(tag) {
  const match = FINAL_TAG_PATTERN.exec(tag);
  if (!match) throw new Error(`${tag} is not a valid final release tag`);
  return { tag, version: `${match[1]}.${match[2]}.${match[3]}` };
}

export async function authorizeCandidate(options) {
  const parsed = parseCandidateTag(options.tag);
  const signedTag = await verifySignedAnnotatedTag(options);
  if (options.eventName === "push" && signedTag.commit !== options.expectedCommit) {
    throw new Error(`${options.tag} does not peel to the expected commit`);
  }
  await requireMainAncestor(options.tag, signedTag.commit, options.execFileImpl ?? execFile);
  return {
    ...parsed,
    commit: signedTag.commit,
    verificationReason: signedTag.verificationReason,
  };
}
```

Implement `verifySignedAnnotatedTag` with:

1. `GET /repos/{owner}/{repo}/git/ref/tags/{encoded-tag}`.
2. Require `object.type === "tag"`; a `commit` object is lightweight and fails.
3. `GET /repos/{owner}/{repo}/git/tags/{object.sha}`.
4. Require `verification.verified === true`, `object.type === "commit"`, and a 40-hex commit SHA.
5. Return the peeled commit and `verification.reason`.

Implement `requireMainAncestor(tag, commit, execFileImpl)` by fetching both
objects into local refs before testing ancestry. This is required for manual
diagnostics and historical recovery, whose default-branch checkout may not
contain the older tagged commit:

```js
await execFileImpl("git", [
  "fetch",
  "--no-tags",
  "origin",
  `refs/tags/${tag}:refs/coven-release-tags/${tag}`,
]);
await execFileImpl("git", ["fetch", "--no-tags", "origin", "main:refs/remotes/origin/main"]);
const { stdout } = await execFileImpl("git", ["rev-parse", `refs/coven-release-tags/${tag}^{commit}`]);
if (stdout.trim() !== commit) throw new Error(`${tag} does not match GitHub's peeled commit`);
await execFileImpl("git", ["merge-base", "--is-ancestor", commit, "origin/main"]);
```

Convert a nonzero ancestry result into a specific `not contained in origin/main`
error. Propagate fetch and API errors; do not convert missing evidence into
success.

- [ ] **Step 4: Write failing final-promotion and legacy-boundary tests**

Add tests that prove:

```js
test("final promotion paginates and accepts an exact successful push candidate", async () => {
  const fixture = promotionFixture({
    finalTag: "v1.2.3",
    finalCommit: "a".repeat(40),
    matchingRunPage: 2,
    candidateTag: "v1.2.3-rc.4",
    candidateEvent: "push",
    candidateConclusion: "success",
    rollupConclusion: "success",
    candidateStillSigned: true,
  });
  const result = await authorizeRelease(fixture.options);
  assert.deepEqual(result, {
    finalTag: "v1.2.3",
    version: "1.2.3",
    commit: "a".repeat(40),
    candidateTag: "v1.2.3-rc.4",
    candidateRunId: 4004,
    candidateRunUrl: "https://github.test/OpenCoven/coven-cave/actions/runs/4004",
    legacyRecovery: false,
    legacyRunId: null,
    legacyRunUrl: null,
  });
});

test("final promotion rejects wrong event, SHA, version, rollup, or current RC ref", async () => {
  for (const override of [
    { candidateEvent: "workflow_dispatch", message: /push candidate/ },
    { candidateHeadSha: "b".repeat(40), message: /exact commit/ },
    { candidateTag: "v1.2.4-rc.1", message: /same base version/ },
    { rollupConclusion: "failure", message: /validated rollup/ },
    { candidateStillSigned: false, message: /current signed candidate/ },
  ]) {
    const fixture = promotionFixture(override);
    await assert.rejects(authorizeRelease(fixture.options), override.message);
  }
});

test("legacy manual recovery is limited to pre-migration publications", async () => {
  const allowed = promotionFixture({
    finalTag: "v0.3.6",
    eventName: "workflow_dispatch",
    releaseExists: true,
    releasePublishedAt: "2026-08-17T08:21:58Z",
    legacyRunId: 7001,
    legacyRunHeadSha: "a".repeat(40),
    legacyRunCreatedAt: "2026-08-17T06:39:15Z",
    legacyRunUpdatedAt: "2026-08-17T06:51:42Z",
    workflowRuns: [],
  });
  assert.deepEqual(await authorizeRelease(allowed.options), {
    finalTag: "v0.3.6",
    version: "0.3.6",
    commit: "a".repeat(40),
    legacyRecovery: true,
    candidateTag: null,
    candidateRunId: null,
    candidateRunUrl: null,
    legacyRunId: 7001,
    legacyRunUrl: "https://github.test/OpenCoven/coven-cave/actions/runs/7001",
  });

  for (const override of [
    { finalTag: "v0.3.6", eventName: "workflow_dispatch", releaseExists: false },
    { finalTag: "v0.3.6", eventName: "push", releaseExists: true, releasePublishedAt: "2026-08-17T08:21:58Z" },
    { finalTag: "v0.3.7", eventName: "workflow_dispatch", releaseExists: true, releasePublishedAt: "2026-08-17T08:22:00Z" },
    { finalTag: "v9.9.9", eventName: "workflow_dispatch", releaseExists: true, releasePublishedAt: null },
    { finalTag: "v0.3.6", eventName: "workflow_dispatch", releaseExists: true, releasePublishedAt: "2026-08-17T08:21:58Z", legacyRunHeadSha: "b".repeat(40) },
    { finalTag: "v0.3.6", eventName: "workflow_dispatch", releaseExists: true, releasePublishedAt: "2026-08-17T08:21:58Z", legacyRunCreatedAt: "2026-08-17T06:39:15Z", legacyRunUpdatedAt: "2026-08-17T08:22:00Z" },
  ]) {
    const fixture = promotionFixture({ ...override, workflowRuns: [] });
    await assert.rejects(authorizeRelease(fixture.options), /successful signed release candidate/);
  }
});
```

- [ ] **Step 5: Implement fail-closed final promotion**

Export `authorizeRelease(options)` and implement this exact decision order:

1. Parse the final `vMAJOR.MINOR.PATCH` tag.
2. Verify the final ref as a GitHub-verified annotated tag, require the expected commit, and require main ancestry.
3. For `eventName === "workflow_dispatch"`, query `/releases/tags/{tag}`.
   Return the verified `finalTag`, `version`, and `commit`, plus
   `legacyRecovery: true`, null candidate fields, and the historical run ID/URL
   only when both of these hold:
   - the response is a non-draft release with a valid `published_at` strictly
     before the exported `LEGACY_RELEASE_PUBLISHED_BEFORE` instant
     (`2026-08-17T08:21:59Z`);
   - legacy workflow ID `286550155` has a successful push run whose
     `head_branch` is the same tag, `head_sha` is the currently verified tag
     commit, and both `created_at` and `updated_at` are valid timestamps strictly
     before the cutoff. Bounding `updated_at` is mandatory: GitHub preserves
     `created_at` when a run is rerun, so `created_at` alone would let a failed
     historical run acquire a successful post-cutoff conclusion.

   Query the legacy runs through
   `/actions/workflows/286550155/runs?branch={tag}&event=push&status=success&per_page=100`
   with the same bounded, same-origin pagination rules as candidate discovery.
   This binds recovery to the commit that historically published the release;
   retargeting an old tag cannot create new RC-free authority. The verified
   commit output remains mandatory because every downstream checkout uses it.
   A 404, draft, missing/malformed timestamp, later publication, missing run,
   wrong event, mismatched historical SHA, or a run created or updated at/after
   the cutoff does not bypass RC proof.
4. Query `/actions/workflows/release-candidate.yml/runs?event=push&status=success&per_page=100`.
5. Follow only same-origin, same-repository `Link: rel="next"` URLs and cap pagination at 20 pages.
6. Filter runs by `event === "push"`, `conclusion === "success"`, exact `head_sha`, and `head_branch` matching an RC tag for the final version.
7. For each candidate, query `/actions/runs/{id}/jobs?filter=latest&per_page=100` and require exactly one completed successful rollup. GitHub prefixes a reusable-workflow job with its caller, so accept only `Release candidate validated` or a name ending in ` / Release candidate validated`; reject substring matches and duplicate rollups.
8. Re-read the current candidate tag ref and tag object; require it to remain GitHub-verified and peel to the final commit.
9. Select the highest valid `rc.N`, not the most recently returned run.
10. Throw a deterministic error when no candidate survives. Network, pagination, malformed payload, missing job, cancelled job, skipped job, and API errors all fail closed.

Add a CLI with only two modes:

```bash
node scripts/release-promotion.mjs candidate
node scripts/release-promotion.mjs release
```

Export:

```js
export const LEGACY_RELEASE_PUBLISHED_BEFORE = Date.parse("2026-08-17T08:21:59Z");
export const LEGACY_RELEASE_WORKFLOW_ID = 286550155;
```

Read `GITHUB_REPOSITORY`, `GITHUB_TOKEN`, `RELEASE_TAG`, optional
`EXPECTED_COMMIT`, and `GITHUB_EVENT_NAME` from the environment. Require
`EXPECTED_COMMIT` for push events; manual diagnostics and legacy recovery
derive the immutable source commit by peeling the verified tag. Write machine
outputs to the path in `GITHUB_OUTPUT` and a human summary to
`GITHUB_STEP_SUMMARY`. Never print the token.

- [ ] **Step 6: Run the verifier tests**

Run:

```bash
node --test scripts/release-promotion.test.mjs
```

Expected: all parser, provenance, pagination, exact-SHA, rollup, current-ref, and legacy-boundary tests PASS.

- [ ] **Step 7: Wire the new test into the app suite**

Add this entry beside the existing CI/release script tests in `scripts/run-tests.mjs`:

```js
"scripts/release-promotion.test.mjs",
```

Run:

```bash
pnpm check:tests-wired
```

Expected: PASS with no unwired test files.

- [ ] **Step 8: Commit the verifier**

```bash
git add scripts/release-promotion.mjs scripts/release-promotion.test.mjs scripts/run-tests.mjs
git commit -m "ci: verify signed release promotion"
```

### Task 2: Extract deferred validation into a reusable workflow

**Files:**
- Create: `.github/workflows/full-validation.yml`
- Create: `scripts/release-promotion-workflow.test.mjs`
- Modify: `scripts/run-tests.mjs`
- Modify: `src-tauri/release-runtime.test.mjs`

- [ ] **Step 1: Write the failing reusable-workflow contract**

Create `scripts/release-promotion-workflow.test.mjs`, parse YAML with `yaml`, and assert:

```js
const fullValidation = parse(await readFile(
  new URL("../.github/workflows/full-validation.yml", import.meta.url),
  "utf8",
));

assert.deepEqual(fullValidation.on.workflow_call.inputs.ref, {
  description: "Exact commit to validate",
  required: true,
  type: "string",
});
assert.deepEqual(Object.keys(fullValidation.jobs).sort(), [
  "e2e",
  "frontend",
  "release-candidate-validated",
  "runtime",
  "rust",
  "windows-native",
]);
assert.equal(fullValidation.jobs["release-candidate-validated"].name, "Release candidate validated");
assert.equal(fullValidation.jobs["release-candidate-validated"].if, "always()");
assert.deepEqual(fullValidation.jobs["release-candidate-validated"].needs, [
  "frontend",
  "rust",
  "e2e",
  "runtime",
  "windows-native",
]);
assert.deepEqual(fullValidation.jobs.runtime.strategy.matrix.os, [
  "ubuntu-24.04",
  "windows-latest",
  "macos-15",
]);
assert.ok(
  fullValidation.jobs.runtime.steps.some(
    (step) => step.name === "Summarize runtime platform" && step.if === "always()",
  ),
  "each matrix leg records its platform result",
);
```

Also inspect every checkout step and require `with.ref === "${{ inputs.ref }}"` and `persist-credentials === false`.

- [ ] **Step 2: Run the workflow test and confirm the missing file failure**

Run:

```bash
node --test scripts/release-promotion-workflow.test.mjs
```

Expected: FAIL with `ENOENT` for `.github/workflows/full-validation.yml`.

- [ ] **Step 3: Create the reusable validation workflow**

Create `.github/workflows/full-validation.yml` with:

```yaml
name: Full validation

on:
  workflow_call:
    inputs:
      ref:
        description: Exact commit to validate
        required: true
        type: string

permissions:
  contents: read

jobs:
  frontend:
    name: Validate candidate frontend
    runs-on: ubuntu-24.04
    timeout-minutes: 75

  rust:
    name: Validate candidate Rust
    runs-on: ubuntu-24.04
    timeout-minutes: 45

  e2e:
    name: Validate candidate E2E
    runs-on: ubuntu-24.04
    timeout-minutes: 45

  runtime:
    name: Validate candidate runtime (${{ matrix.os }})
    runs-on: ${{ matrix.os }}
    timeout-minutes: 60
    strategy:
      fail-fast: false
      matrix:
        os: [ubuntu-24.04, windows-latest, macos-15]

  windows-native:
    name: Validate candidate Windows native behavior
    runs-on: windows-latest
    timeout-minutes: 20

  release-candidate-validated:
    name: Release candidate validated
    if: always()
    needs: [frontend, rust, e2e, runtime, windows-native]
    runs-on: ubuntu-24.04
    steps:
      - name: Require every deferred validation job
        env:
          FRONTEND_RESULT: ${{ needs.frontend.result }}
          RUST_RESULT: ${{ needs.rust.result }}
          E2E_RESULT: ${{ needs.e2e.result }}
          RUNTIME_RESULT: ${{ needs.runtime.result }}
          WINDOWS_NATIVE_RESULT: ${{ needs.windows-native.result }}
        run: |
          set -euo pipefail
          test "$FRONTEND_RESULT" = "success"
          test "$RUST_RESULT" = "success"
          test "$E2E_RESULT" = "success"
          test "$RUNTIME_RESULT" = "success"
          test "$WINDOWS_NATIVE_RESULT" = "success"
      - name: Summarize candidate validation
        if: always()
        env:
          FRONTEND_RESULT: ${{ needs.frontend.result }}
          RUST_RESULT: ${{ needs.rust.result }}
          E2E_RESULT: ${{ needs.e2e.result }}
          RUNTIME_RESULT: ${{ needs.runtime.result }}
          WINDOWS_NATIVE_RESULT: ${{ needs.windows-native.result }}
        run: |
          {
            echo "## Release candidate validation"
            echo
            echo "| Suite | Result |"
            echo "| --- | --- |"
            echo "| Frontend | $FRONTEND_RESULT |"
            echo "| Rust | $RUST_RESULT |"
            echo "| Playwright | $E2E_RESULT |"
            echo "| Ubuntu / Windows / macOS runtime | $RUNTIME_RESULT |"
            echo "| Windows native | $WINDOWS_NATIVE_RESULT |"
          } >> "$GITHUB_STEP_SUMMARY"
```

Fill the job bodies as follows:

- `frontend`: use the checkout/pnpm/Node setup and commands currently in `release-web-validation`, through the retrying `pnpm build`, but stop before Playwright installation. It must run, in order, `check-conflict-markers`, `lint`, `typecheck`, `check:tests-wired`, `test:app`, `test:api`, `test:mobile`, and `build`.
- `rust`: use checkout, stable Rust, Rust cache, Linux Tauri dependencies, create both resource placeholders, then run `cargo check --locked` and `cargo test --locked --lib` from `src-tauri`.
- `e2e`: use checkout/pnpm/Node, frozen install, `pnpm exec playwright install --with-deps chromium webkit`, then `pnpm exec playwright test`.
- `runtime`: move the current `release-platform-validation` body verbatim, remove `daemon-package`/`source-version` dependencies and recovery-tooling overlays, and make checkout use `${{ inputs.ref }}`.
- `windows-native`: move the current `release-windows-native` body verbatim, remove its dependencies, and make checkout use `${{ inputs.ref }}`.

Do not add artifact uploads, release writes, TestFlight actions, secrets, or write permissions to this workflow.

Append this final step to the `runtime` matrix job so each platform records its
own result instead of exposing only the aggregate matrix result:

```yaml
- name: Summarize runtime platform
  if: always()
  run: |
    {
      echo "## Runtime validation"
      echo
      echo "- Platform: $RUNNER_OS"
      echo "- Commit: ${{ inputs.ref }}"
      echo "- Job status: ${{ job.status }}"
    } >> "$GITHUB_STEP_SUMMARY"
```

- [ ] **Step 4: Move native contract tests to the reusable workflow**

In `src-tauri/release-runtime.test.mjs`, change the workflow path for tests that
inspect `release-platform-validation`, `release-windows-native`, or CI's Rust
`build` job:

```js
new URL("../.github/workflows/full-validation.yml", import.meta.url)
```

Rename the extracted job references:

```js
getWorkflowJob(workflow, "windows-native");
getWorkflowJob(workflow, "runtime");
getWorkflowJob(workflow, "rust");
```

Keep the Windows nonzero-test guards, full-library mobile-token assertion, and
the three-OS assertion unchanged.

- [ ] **Step 5: Wire and run the workflow contracts**

Add to `SUITES.app`:

```js
"scripts/release-promotion-workflow.test.mjs",
```

Run:

```bash
node --test scripts/release-promotion-workflow.test.mjs
node --test src-tauri/release-runtime.test.mjs
pnpm check:tests-wired
```

Expected: all three commands PASS.

- [ ] **Step 6: Commit reusable validation**

```bash
git add .github/workflows/full-validation.yml scripts/release-promotion-workflow.test.mjs scripts/run-tests.mjs src-tauri/release-runtime.test.mjs
git commit -m "ci: extract release candidate validation"
```

### Task 3: Add the signed release-candidate workflow

**Files:**
- Create: `.github/workflows/release-candidate.yml`
- Modify: `scripts/release-promotion-workflow.test.mjs`

- [ ] **Step 1: Add failing candidate-workflow assertions**

Extend the workflow contract with:

```js
assert.equal(candidate.name, "Release candidate");
assert.deepEqual(candidate.on.push.tags, ["v*-rc.*"]);
assert.deepEqual(candidate.on.workflow_dispatch.inputs.tag, {
  description: "Existing signed candidate tag to validate",
  required: true,
  type: "string",
});
assert.equal(candidate.concurrency.group, "release-candidate-${{ github.event.inputs.tag || github.ref_name }}");
assert.equal(candidate.concurrency["cancel-in-progress"], false);
assert.deepEqual(Object.keys(candidate.jobs), ["provenance", "full-validation"]);
assert.equal(candidate.jobs["full-validation"].needs, "provenance");
assert.equal(candidate.jobs["full-validation"].uses, "./.github/workflows/full-validation.yml");
assert.equal(candidate.jobs["full-validation"].with.ref, "${{ needs.provenance.outputs.commit }}");
```

Assert the provenance job has `contents: read`, invokes `node scripts/release-promotion.mjs candidate`, writes its summary, and checks out the workflow revision with no persisted credentials. On a tag push that revision is the candidate commit; on manual dispatch it is the current default-branch verifier, which inspects the requested immutable tag through the API.

- [ ] **Step 2: Run the contract and confirm it fails**

Run:

```bash
node --test scripts/release-promotion-workflow.test.mjs
```

Expected: FAIL because `.github/workflows/release-candidate.yml` does not exist.

- [ ] **Step 3: Create the candidate workflow**

Create `.github/workflows/release-candidate.yml`:

```yaml
name: Release candidate

on:
  push:
    tags: ["v*-rc.*"]
  workflow_dispatch:
    inputs:
      tag:
        description: Existing signed candidate tag to validate
        required: true
        type: string

concurrency:
  group: release-candidate-${{ github.event.inputs.tag || github.ref_name }}
  cancel-in-progress: false

permissions:
  contents: read

jobs:
  provenance:
    name: Verify release candidate provenance
    runs-on: ubuntu-24.04
    outputs:
      commit: ${{ steps.provenance.outputs.commit }}
    steps:
      - uses: actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5
        with:
          persist-credentials: false
      - uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020
        with:
          node-version: 24
      - id: provenance
        name: Require a signed candidate on main
        env:
          GITHUB_TOKEN: ${{ github.token }}
          RELEASE_TAG: ${{ github.event.inputs.tag || github.ref_name }}
          EXPECTED_COMMIT: ${{ github.event_name == 'push' && github.sha || '' }}
          GITHUB_EVENT_NAME: ${{ github.event_name }}
        run: node scripts/release-promotion.mjs candidate

  full-validation:
    needs: provenance
    uses: ./.github/workflows/full-validation.yml
    with:
      ref: ${{ needs.provenance.outputs.commit }}
```

The helper's strict regex is the authority after the intentionally broad tag glob. A manual run is diagnostic only because final authorization filters candidate runs to `event === "push"`.

- [ ] **Step 4: Run candidate workflow contracts**

Run:

```bash
node --test scripts/release-promotion-workflow.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit the candidate workflow**

```bash
git add .github/workflows/release-candidate.yml scripts/release-promotion-workflow.test.mjs
git commit -m "ci: validate signed release candidates"
```

### Task 4: Create a new gated final-release workflow identity

**Files:**
- Create: `.github/workflows/publish-release.yml`
- Delete: `.github/workflows/release.yml`
- Modify: `scripts/release-promotion-workflow.test.mjs`
- Modify: `scripts/ci-recovery-workflow.test.mjs`
- Modify: `scripts/ios-build-ci.test.mjs`
- Modify: `scripts/stamp-release.test.mjs`
- Modify: `scripts/release-macos-signing.test.mjs`
- Modify: `scripts/check-grok-registry-release.test.mjs`
- Modify: `scripts/check-opencode-registry-release.test.mjs`
- Modify: `scripts/check-x-app-release.test.mjs`
- Modify: `src/lib/app-version.test.ts`
- Modify: `docs/discord-rich-presence.md`

- [ ] **Step 1: Write failing final-release DAG assertions**

Add assertions that:

```js
assert.deepEqual(release.on.push.tags, ["v*.*.*", "!v*.*.*-*"]);
assert.equal(release.jobs["authorize-release-promotion"].name, "Authorize release promotion");
assert.deepEqual(release.jobs["authorize-release-promotion"].permissions, {
  actions: "read",
  contents: "read",
});
assert.equal(release.jobs["daemon-package"].needs, "authorize-release-promotion");
assert.equal(release.jobs["source-version"].needs, "authorize-release-promotion");
assert.equal(release.jobs["source-version"].outputs["release-commit"],
  "${{ steps.release.outputs.commit }}");
for (const removed of ["release-web-validation", "release-platform-validation", "release-windows-native"]) {
  assert.equal(release.jobs[removed], undefined);
}
assert.deepEqual(release.jobs.build.needs, ["daemon-package", "source-version"]);
```

Build a graph walk over every job's `needs` and assert all publication-capable jobs are transitively downstream of `authorize-release-promotion`:

```js
for (const job of ["release-ios-build", "build", "checksums", "updater-manifest", "homebrew"]) {
  assert.equal(dependsOn(release.jobs, job, "authorize-release-promotion"), true, `${job} is promotion-gated`);
}
```

Also assert the authorization step invokes `node scripts/release-promotion.mjs release` with `GITHUB_TOKEN`, `RELEASE_TAG`, `EXPECTED_COMMIT`, and `GITHUB_EVENT_NAME`.

- [ ] **Step 2: Run the contract and confirm current final-tag validation fails it**

Run:

```bash
node --test scripts/release-promotion-workflow.test.mjs
```

Expected: FAIL because `.github/workflows/publish-release.yml` does not exist.

- [ ] **Step 3: Add final promotion authorization**

Copy `.github/workflows/release.yml` to
`.github/workflows/publish-release.yml`, then apply these changes to the new
file:

1. Change the tag trigger to:

```yaml
push:
  tags: ["v*.*.*", "!v*.*.*-*"]
```

2. Add `authorize-release-promotion` as the first job. It checks out the workflow revision without persisted credentials, sets up Node 24, runs `release-promotion.mjs release`, exposes `commit`, `candidate-tag`, `candidate-run-id`, and `candidate-run-url`, and writes those values to the workflow summary. Pass `EXPECTED_COMMIT: ${{ github.event_name == 'push' && github.sha || '' }}` so a tag-push must peel to GitHub's event SHA while manual recovery derives the commit from the immutable verified tag.
3. Give that job only `contents: read` and `actions: read`.
4. Make `daemon-package` and `source-version` depend directly on authorization.
5. Remove tag signature/main-ancestry logic from `source-version`; check out `${{ needs.authorize-release-promotion.outputs.commit }}`, add that commit to the existing `release` step's outputs, expose `release-commit: ${{ steps.release.outputs.commit }}`, and retain the audited source-version checker and stamped-source agreement.
6. Delete `release-web-validation`, `release-platform-validation`, and `release-windows-native`; their checks now run only in the RC workflow.
7. Change desktop `build.needs` to `daemon-package` and `source-version`.
8. Change `release-ios-build.needs` to `daemon-package` and `source-version`.
9. Preserve all existing packaging, signing, notarization, diagnostics, updater, checksum, TestFlight, registry, X-app, and Homebrew behavior.
10. Delete `.github/workflows/release.yml`. Its remote workflow identity is
    disabled in Task 7 immediately before this PR merges; deletion alone is not
    the security boundary.

For manual recovery, pass the requested `inputs.tag` to the verifier. The
helper alone owns the fixed pre-migration publication-time exception; no
workflow boolean or version-based bypass is allowed.

- [ ] **Step 4: Update release-adjacent tests**

In `scripts/release-promotion-workflow.test.mjs`, read the final publisher from:

```js
new URL("../.github/workflows/publish-release.yml", import.meta.url)
```

Assert that `.github/workflows/release.yml` is absent, so a future edit cannot
silently revive the disabled identity.

In `scripts/ci-recovery-workflow.test.mjs`, remove the release workflow block at the end; promotion behavior now belongs to `release-promotion-workflow.test.mjs`.

In `scripts/ios-build-ci.test.mjs`, replace the old validation dependency assertion with:

```js
assert.match(
  iosJob,
  /needs:[\s\S]{0,120}- daemon-package[\s\S]{0,120}- source-version/,
  "TestFlight publication is downstream of signed release promotion",
);
assert.doesNotMatch(
  workflow,
  /^ {2}release-(web-validation|platform-validation|windows-native):$/m,
  "final tags package the exact commit already validated as a release candidate",
);
```

In `scripts/stamp-release.test.mjs`, keep the stable-tag regex, read-only
workflow default, audited checker, stamped-source, immutable checkout,
checksums, and updater assertions. Delete the old assertions for checkout via
`steps.release.outputs.ref`, output via `steps.tag.outputs.commit`,
`git cat-file`, `.verification.verified`, main ancestry, and the
`tagVerificationIndex` ordering check. Replace them with:

```js
const authorizationJob = workflowJob(yml, "authorize-release-promotion");
assert.match(
  authorizationJob,
  /node scripts\/release-promotion\.mjs release/,
  "release authorization verifies signed exact-candidate promotion",
);
assert.match(
  sourceVersionJob,
  /needs: authorize-release-promotion[\s\S]*ref: \$\{\{ needs\.authorize-release-promotion\.outputs\.commit \}\}[\s\S]*fetch-depth: 0[\s\S]*persist-credentials: false/,
  "source-version checks the immutable commit emitted by promotion authorization",
);
assert.match(
  sourceVersionJob,
  /outputs:\s*\n\s+release-commit: \$\{\{ steps\.release\.outputs\.commit \}\}/,
  "the source gate preserves the authorized commit for every publishing checkout",
);
assert.doesNotMatch(
  sourceVersionJob,
  /git cat-file -t|verification\.verified|git merge-base --is-ancestor "\$TAGGED_COMMIT"/,
  "tag provenance has one owner: authorize-release-promotion",
);
```

Keep the `dependencyInstallIndex` existence assertion, because the audited
source checker must still install with scripts and the pnpmfile disabled.

In `scripts/release-macos-signing.test.mjs`, replace:

```js
/release-commit: \$\{\{ steps\.tag\.outputs\.commit \}\}/
```

with:

```js
/release-commit: \$\{\{ steps\.release\.outputs\.commit \}\}/
```

Keep its downstream `needs.source-version.outputs.release-commit` checks
unchanged.

Change every live source/test reference that inspects the publisher from
`.github/workflows/release.yml` to
`.github/workflows/publish-release.yml` in:

```text
scripts/check-grok-registry-release.test.mjs
scripts/check-opencode-registry-release.test.mjs
scripts/check-x-app-release.test.mjs
scripts/ios-build-ci.test.mjs
scripts/release-macos-signing.test.mjs
scripts/stamp-release.test.mjs
src/lib/app-version.test.ts
src-tauri/release-runtime.test.mjs
docs/discord-rich-presence.md
```

Do not rewrite historical changelog entries, completed plans, or the approved
specification; this implementation plan records why the new workflow identity
is required.

- [ ] **Step 5: Run release workflow contracts**

Run:

```bash
node --test scripts/release-promotion-workflow.test.mjs
node --test scripts/ci-recovery-workflow.test.mjs
node --test scripts/ios-build-ci.test.mjs
node --test scripts/stamp-release.test.mjs
node --test scripts/release-macos-signing.test.mjs
node --test scripts/check-grok-registry-release.test.mjs
node --test scripts/check-opencode-registry-release.test.mjs
node --test scripts/check-x-app-release.test.mjs
node --test src-tauri/release-runtime.test.mjs
```

Expected: all commands PASS.

- [ ] **Step 6: Commit final promotion gating**

```bash
git add .github/workflows/publish-release.yml .github/workflows/release.yml scripts/release-promotion-workflow.test.mjs scripts/ci-recovery-workflow.test.mjs scripts/ios-build-ci.test.mjs scripts/stamp-release.test.mjs scripts/release-macos-signing.test.mjs scripts/check-grok-registry-release.test.mjs scripts/check-opencode-registry-release.test.mjs scripts/check-x-app-release.test.mjs src/lib/app-version.test.ts src-tauri/release-runtime.test.mjs docs/discord-rich-presence.md
git commit -m "ci: require exact candidate promotion"
```

### Task 5: Establish `PR checks` without dropping `Frontend build`

**Files:**
- Modify: `.github/workflows/ci.yml`
- Modify: `scripts/ci-recovery.mjs`
- Modify: `scripts/ci-recovery.test.mjs`
- Modify: `scripts/ci-recovery-workflow.test.mjs`

- [ ] **Step 1: Write failing migration-context assertions**

Update `scripts/ci-recovery-workflow.test.mjs` to require a new `pr-checks` job while retaining the current five jobs:

```js
assert.deepEqual(Object.keys(ciWorkflow.jobs).sort(), [
  "build",
  "frontend-bundle",
  "frontend-validation",
  "ios",
  "paths",
  "pr-checks",
]);
assert.equal(ciWorkflow.jobs["pr-checks"].name, "PR checks");
assert.equal(ciWorkflow.jobs.build.name, "Frontend build");
assert.deepEqual(
  ciWorkflow.jobs["pr-checks"].steps.filter((step) => step.run?.startsWith("pnpm ")).map((step) => step.run),
  [
    "pnpm install --frozen-lockfile",
    "pnpm lint",
    "pnpm typecheck",
    "pnpm check:tests-wired",
    "pnpm test:app",
    "pnpm test:api",
    "pnpm test:mobile",
  ],
);
assert.ok(
  ciWorkflow.jobs["pr-checks"].steps.some((step) => step.name === "Summarize PR check duration" && step.if === "always()"),
  "PR checks records queue-speed evidence even on failure",
);
```

Assert that `pr-checks` contains no build, Cargo, Playwright, conformance, sidecar, or Xcode command.

- [ ] **Step 2: Change the recovery concurrency tests first**

In `scripts/ci-recovery.test.mjs`, update the guarded fixture to include:

```yaml
workflow_dispatch:
  inputs:
    expected_sha:
      required: true
      type: string
    expected_pr_number:
      required: true
      type: string
concurrency:
  group: ci-pr-${{ github.event.pull_request.number || inputs.expected_pr_number || github.run_id }}
  cancel-in-progress: ${{ github.event_name != 'workflow_dispatch' }}
```

Update the dispatch assertion to require:

```js
assert.deepEqual(request.body, {
  ref: pull.head.ref,
  inputs: {
    expected_sha: pull.head.sha,
    expected_pr_number: String(pull.number),
  },
});
```

- [ ] **Step 3: Run CI recovery tests and confirm they fail**

Run:

```bash
node --test scripts/ci-recovery.test.mjs
node --test scripts/ci-recovery-workflow.test.mjs
```

Expected: FAIL on the old workflow inputs/concurrency and missing `PR checks`.

- [ ] **Step 4: Implement PR-number concurrency and dispatch**

In `.github/workflows/ci.yml`:

```yaml
workflow_dispatch:
  inputs:
    expected_sha:
      description: Expected pull request head SHA
      required: true
      type: string
    expected_pr_number:
      description: Pull request number used for concurrency
      required: true
      type: string

concurrency:
  group: ci-pr-${{ github.event.pull_request.number || inputs.expected_pr_number || github.run_id }}
  cancel-in-progress: ${{ github.event_name != 'workflow_dispatch' }}
```

In `scripts/ci-recovery.mjs`, update the expected workflow constants and send:

```js
body: JSON.stringify({
  ref,
  inputs: {
    expected_sha: sha,
    expected_pr_number: String(number),
  },
}),
```

Thread `pull.number` into `dispatchWorkflow`. Keep exact-SHA revalidation and same-repository protections unchanged.

- [ ] **Step 5: Add the migration `PR checks` job**

Add this job before the existing path-aware jobs:

```yaml
pr-checks:
  name: PR checks
  if: github.event_name != 'workflow_dispatch' || github.sha == inputs.expected_sha
  runs-on: ubuntu-latest
  timeout-minutes: 60
  steps:
    - id: clock
      name: Start duration clock
      run: echo "epoch=$(date +%s)" >> "$GITHUB_OUTPUT"
    - uses: actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5
      with:
        persist-credentials: false
    - uses: pnpm/action-setup@b906affcce14559ad1aafd4ab0e942779e9f58b1
    - uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020
      with:
        node-version: 24
        cache: pnpm
    - run: pnpm install --frozen-lockfile
    - run: pnpm lint
    - run: pnpm typecheck
    - run: pnpm check:tests-wired
    - run: pnpm test:app
    - run: pnpm test:api
    - run: pnpm test:mobile
    - name: Summarize PR check duration
      if: always()
      env:
        START_EPOCH: ${{ steps.clock.outputs.epoch }}
      run: |
        end_epoch=$(date +%s)
        duration=$((end_epoch - START_EPOCH))
        {
          echo "## PR checks"
          echo
          echo "- Duration: ${duration}s"
          echo "- Commit: $GITHUB_SHA"
        } >> "$GITHUB_STEP_SUMMARY"
```

Retain the `push: main` trigger and all existing path-aware jobs in this PR. Both `PR checks` and `Frontend build` must report during migration.

- [ ] **Step 6: Run CI contracts**

Run:

```bash
node --test scripts/ci-recovery.test.mjs
node --test scripts/ci-recovery-workflow.test.mjs
```

Expected: PASS.

- [ ] **Step 7: Commit the parallel PR context**

```bash
git add .github/workflows/ci.yml scripts/ci-recovery.mjs scripts/ci-recovery.test.mjs scripts/ci-recovery-workflow.test.mjs
git commit -m "ci: establish lean PR checks context"
```

### Task 6: Document signed release-candidate operation

**Files:**
- Modify: `README.md`
- Modify: `docs/workflows/branching.md`
- Modify: `docs/cross-environment.md`

- [ ] **Step 1: Update the release operator sequence**

In `docs/workflows/branching.md`, replace the direct final-tag step with:

```markdown
6. Reconcile clean `main` at the stamp merge commit. Create and push a signed,
   annotated `vX.Y.Z-rc.N` tag at that exact commit. Candidate tags are immutable;
   a failed candidate is replaced by a higher `rc.N` after its fix lands through
   a PR.
7. Wait for the `Release candidate` workflow and its `Release candidate
   validated` rollup to succeed. Record the candidate tag, run URL, and exact
   commit.
8. Create and push the signed, annotated final `vX.Y.Z` tag at the same commit.
   Final release authorization re-verifies both tags through GitHub, requires
   the successful push-triggered candidate run, and rejects a different version
   or commit before packaging, release metadata, or TestFlight work starts.
9. Record the build/version, candidate and final tags, exact promoted SHA,
   validation run, upload artifacts, and App Store Connect status in the release
   handoff.
```

Add the concrete command sequence:

```bash
git fetch origin
version=$(node -p "require('./package.json').version")
main_commit=$(git rev-parse origin/main)
test "$(git rev-parse HEAD)" = "$main_commit"
git tag -s "v${version}-rc.1" "$main_commit" -m "Coven Cave v${version}-rc.1"
git push origin "v${version}-rc.1"
candidate_run=""
for attempt in $(seq 1 20); do
  candidate_run=$(gh run list --workflow release-candidate.yml --branch "v${version}-rc.1" --event push --limit 10 --json databaseId,headSha --jq '.[] | select(.headSha == "'"$main_commit"'") | .databaseId' | head -1)
  [ -n "$candidate_run" ] && break
  sleep 6
done
test -n "$candidate_run"
gh run watch --exit-status "$candidate_run"
git tag -s "v${version}" "$main_commit" -m "Coven Cave v${version}"
git push origin "v${version}"
```

State explicitly that manual candidate dispatch is diagnostic and cannot authorize promotion.

- [ ] **Step 2: Update README and cross-environment authority**

In `README.md`, change the release note to say releases, TestFlight uploads, and updater publication start from a successful signed RC on clean `main`, followed by a final signed tag on the exact commit.

In `docs/cross-environment.md`, replace obsolete branch-protection job names with:

```markdown
- **Pull-request baseline** — `PR checks` runs lint, typecheck, test wiring, and
  app/API/mobile tests on Ubuntu for every pull request.
- **Release-candidate matrix** — the `Release candidate` workflow runs the
  production frontend build, Playwright, Rust, conformance, packaged sidecar,
  and Windows-native checks. Its runtime matrix covers `ubuntu-24.04`,
  `windows-latest`, and `macos-15`.
- **Fail-closed rollup** — `Release candidate validated` succeeds only when
  every deferred job and matrix leg succeeds. It is a release-promotion
  authority, not a branch-protection context.
```

Also change the CI Node version table from `22` to `24`, matching current workflows.

- [ ] **Step 3: Check documentation references**

Run:

```bash
node scripts/docs-index.test.mjs
rg -n "Cross-environment required|Sidecar runtime required" docs/cross-environment.md
```

Expected: docs index PASS; `rg` returns no obsolete required-context references.

- [ ] **Step 4: Commit documentation**

```bash
git add README.md docs/workflows/branching.md docs/cross-environment.md
git commit -m "docs: require signed candidate promotion"
```

### Task 7: Verify and land Phase 1

**Files:**
- Verify all Phase 1 paths above.
- No new source files.

- [ ] **Step 1: Run focused workflow tests**

```bash
node --test scripts/release-promotion.test.mjs
node --test scripts/release-promotion-workflow.test.mjs
node --test scripts/ci-recovery.test.mjs
node --test scripts/ci-recovery-workflow.test.mjs
node --test scripts/ios-build-ci.test.mjs
node --test scripts/stamp-release.test.mjs
node --test scripts/release-macos-signing.test.mjs
node --test scripts/check-grok-registry-release.test.mjs
node --test scripts/check-opencode-registry-release.test.mjs
node --test scripts/check-x-app-release.test.mjs
node --test src-tauri/release-runtime.test.mjs
```

Expected: all PASS.

- [ ] **Step 2: Run the complete lean PR gate locally**

```bash
pnpm lint
pnpm typecheck
pnpm check:tests-wired
pnpm test:app
pnpm test:api
pnpm test:mobile
```

Expected: all PASS.

- [ ] **Step 3: Validate YAML parsing and scoped diff**

```bash
node -e 'import("node:fs/promises").then(async ({readFile}) => { const {parse}=await import("yaml"); for (const file of [".github/workflows/ci.yml",".github/workflows/full-validation.yml",".github/workflows/release-candidate.yml",".github/workflows/publish-release.yml"]) parse(await readFile(file,"utf8")); console.log("workflow yaml: ok"); })'
test ! -e .github/workflows/release.yml
git diff --check
git status --short
git diff origin/main...HEAD --stat
```

Expected: YAML parses, `git diff --check` is silent, and every changed path belongs to this plan.

- [ ] **Step 4: Push and open the Phase 1 PR**

```bash
git push -u origin "$(git branch --show-current)"
gh pr create --base main --head "$(git branch --show-current)" \
  --title "Require signed release-candidate promotion" \
  --body "Implements cave-7kix8.8 Phase 1: signed exact-SHA RC promotion, reusable deferred validation, and the parallel PR checks migration context. Preserves Frontend build until branch protection changes."
```

Expected: PR URL returned.

- [ ] **Step 5: Require both migration contexts on the exact head**

```bash
head=$(git rev-parse HEAD)
gh pr view --json headRefOid --jq .headRefOid | grep -Fx "$head"
gh pr checks --watch
gh pr view --json statusCheckRollup --jq '.statusCheckRollup[] | select(.name == "PR checks" or .name == "Frontend build") | [.name,.status,.conclusion] | @tsv'
```

Expected: both `PR checks` and `Frontend build` are completed successfully on `$head`.

- [ ] **Step 6: Freeze the legacy publisher and merge Phase 1**

After reading all review threads and fixing any valid findings:

```bash
legacy_workflow_id=$(gh api repos/OpenCoven/coven-cave/actions/workflows/release.yml --jq .id)
test "$legacy_workflow_id" = "286550155"
gh api --method PUT "repos/OpenCoven/coven-cave/actions/workflows/$legacy_workflow_id/disable"
test "$(gh api "repos/OpenCoven/coven-cave/actions/workflows/$legacy_workflow_id" --jq .state)" = "disabled_manually"

active_runs=-1
for attempt in $(seq 1 60); do
  active_runs=0
  for status in queued in_progress waiting requested pending; do
    count=$(gh api "repos/OpenCoven/coven-cave/actions/workflows/$legacy_workflow_id/runs?status=$status&per_page=1" --jq .total_count)
    active_runs=$((active_runs + count))
  done
  [ "$active_runs" -eq 0 ] && break
  sleep 10
done
test "$active_runs" -eq 0

gh pr merge --squash --match-head-commit "$head"

publisher_state=""
for attempt in $(seq 1 20); do
  publisher_state=$(gh api repos/OpenCoven/coven-cave/actions/workflows/publish-release.yml --jq .state 2>/dev/null || true)
  [ "$publisher_state" = "active" ] && break
  sleep 6
done
test "$publisher_state" = "active"
test "$(gh api "repos/OpenCoven/coven-cave/actions/workflows/$legacy_workflow_id" --jq .state)" = "disabled_manually"
```

Expected: no release run is interrupted; legacy workflow ID `286550155` is
disabled before the active-run check, pre-disable runs reach a terminal state,
and only then does the merge run without `--admin`; the new
`publish-release.yml` identity becomes active; the legacy identity remains
disabled. If the merge command fails or its result is uncertain, stop with the
legacy workflow still disabled. Never automatically re-enable the legacy
publisher: a transient PR-state API failure after a successful merge must not
reactivate the unsafe identity. Diagnose the merge result, then either retry
the exact-head merge or complete deployment of the new publisher.

### Task 8: Change branch protection to `PR checks`

**Files:**
- Remote setting only: classic protection for `OpenCoven/coven-cave` branch `main`.

- [ ] **Step 1: Prove the new context exists after Phase 1**

```bash
phase1_sha=$(gh pr view --json mergeCommit --jq .mergeCommit.oid)
gh api "repos/OpenCoven/coven-cave/commits/$phase1_sha/check-runs" \
  --jq '.check_runs[] | select(.name == "PR checks") | [.name,.status,.conclusion,.head_sha] | @tsv'
```

Expected: `PR checks`, `completed`, `success`, and the exact Phase 1 merge SHA.

- [ ] **Step 2: Snapshot the current protection fields**

```bash
protection=$(gh api repos/OpenCoven/coven-cave/branches/main/protection)
jq '{
  required_status_checks,
  enforce_admins,
  required_pull_request_reviews,
  required_conversation_resolution,
  required_signatures,
  allow_force_pushes,
  allow_deletions
}' <<<"$protection"
```

Expected before mutation: required context `Frontend build`, `strict: false`, and the repository's existing unrelated policies.

- [ ] **Step 3: Patch only the required-status-checks subresource**

```bash
strict=$(jq -r '.required_status_checks.strict' <<<"$protection")
jq -n --argjson strict "$strict" '{strict:$strict,contexts:["PR checks"]}' |
  gh api --method PATCH \
    repos/OpenCoven/coven-cave/branches/main/protection/required_status_checks \
    --input -
```

Expected: response contains only `PR checks` and preserves `strict: false`.

- [ ] **Step 4: Verify unrelated protection did not drift**

```bash
after=$(gh api repos/OpenCoven/coven-cave/branches/main/protection)
jq '.required_status_checks' <<<"$after"
diff -u \
  <(jq -S 'del(.required_status_checks)' <<<"$protection") \
  <(jq -S 'del(.required_status_checks)' <<<"$after")
```

Expected: required context is exactly `PR checks`; `diff` is silent.

## Phase 2 — remove routine fanout and `main` reruns

### Task 9: Collapse CI to one lean job

**Files:**
- Modify: `.github/workflows/ci.yml`
- Modify: `scripts/ci-recovery.mjs`
- Modify: `scripts/ci-recovery.test.mjs`
- Modify: `scripts/ci-recovery-workflow.test.mjs`

- [ ] **Step 1: Create a new managed Phase 2 branch from current `origin/main`**

After Phase 1 merges and protection is verified:

```bash
git fetch origin
pnpm beads:worktrees:create \
  --bead cave-7kix8.8 \
  --branch ci/cave-7kix8-8-lean-pr-gate \
  --owner cody \
  --purpose "Remove legacy PR fanout after PR checks protection migration"
```

Expected: a new managed worktree rooted at the Phase 1 merge. If admission exits 2, use the exact attributed exception command it prints; do not use bare `git worktree add`.

- [ ] **Step 2: Write the final one-job contract**

In `scripts/ci-recovery-workflow.test.mjs`, replace migration assertions with:

```js
assert.deepEqual(Object.keys(ciWorkflow.jobs), ["pr-checks"]);
assert.equal(ciWorkflow.jobs["pr-checks"].name, "PR checks");
assert.deepEqual(ciWorkflow.on.pull_request, { branches: ["main"] });
assert.equal(ciWorkflow.on.push, undefined);
assert.equal(
  ciWorkflow.concurrency.group,
  "ci-pr-${{ github.event.pull_request.number || inputs.expected_pr_number || github.run_id }}",
);
assert.equal(
  ciWorkflow.concurrency["cancel-in-progress"],
  "${{ github.event_name != 'workflow_dispatch' }}",
);
```

Retain the exact ordered command assertion from Phase 1 and the exclusions for build, Cargo, Playwright, conformance, sidecar, and Xcode.

- [ ] **Step 3: Narrow recovery's guarded-job contract**

In `scripts/ci-recovery.mjs` and its test fixture, make the only required job guard:

```js
const EXPECTED_JOB_GUARDS = {
  "pr-checks": EXPECTED_JOB_GUARD,
};
```

Keep `expected_sha`, `expected_pr_number`, run-name stamping, branch-head revalidation, cooldown, and non-cancelling dispatch behavior.

- [ ] **Step 4: Run the tests and confirm old CI fails**

```bash
node --test scripts/ci-recovery.test.mjs
node --test scripts/ci-recovery-workflow.test.mjs
```

Expected: FAIL because old jobs and the `push` trigger still exist.

- [ ] **Step 5: Remove legacy routine CI**

In `.github/workflows/ci.yml`:

1. Delete `push: branches: [main]`.
2. Delete `paths`, `ios`, `frontend-validation`, `frontend-bundle`, and `build`.
3. Retain `pr-checks` unchanged.
4. Retain diagnostic `workflow_dispatch`, exact-SHA guard, PR-number concurrency, and read-only permissions.
5. Update comments so none describe removed path selection, fanout, or `main` cancellation.

The resulting job map must contain exactly:

```yaml
jobs:
  pr-checks:
    name: PR checks
```

- [ ] **Step 6: Run final CI contracts**

```bash
node --test scripts/ci-recovery.test.mjs
node --test scripts/ci-recovery-workflow.test.mjs
```

Expected: PASS.

- [ ] **Step 7: Commit the final lean workflow**

```bash
git add .github/workflows/ci.yml scripts/ci-recovery.mjs scripts/ci-recovery.test.mjs scripts/ci-recovery-workflow.test.mjs
git commit -m "ci: retire routine validation fanout"
```

### Task 10: Update required-check documentation

**Files:**
- Modify: `CLAUDE.md`
- Modify: `.agents/skills/branch-to-merge/SKILL.md`
- Modify: `docs/cross-environment.md`

- [ ] **Step 1: Replace the required context and behavior description**

In `CLAUDE.md`, replace both required-context references with `PR checks`. Describe it as one Ubuntu job running install, lint, typecheck, test wiring, and app/API/mobile tests on every PR; state that build, Rust, Playwright, conformance, sidecar, Windows-native, and macOS checks run at the signed RC boundary.

In `.agents/skills/branch-to-merge/SKILL.md`, change the required-check list to:

```markdown
- `PR checks`
```

Keep the exact-head, missing/pending/cancelled/stale check rules unchanged.

In `docs/cross-environment.md`, ensure no text describes candidate validation as a branch-protection check.

- [ ] **Step 2: Pin the documentation in the workflow contract**

Extend `scripts/ci-recovery-workflow.test.mjs`:

```js
for (const [path, source] of [
  ["CLAUDE.md", await readFile(new URL("../CLAUDE.md", import.meta.url), "utf8")],
  [".agents/skills/branch-to-merge/SKILL.md", await readFile(new URL("../.agents/skills/branch-to-merge/SKILL.md", import.meta.url), "utf8")],
]) {
  assert.match(source, /`PR checks`/, `${path} names the required context`);
  assert.doesNotMatch(source, /required `Frontend build`|Required status checks[^]*`Frontend build`/, `${path} drops the retired context`);
}
```

- [ ] **Step 3: Run documentation and workflow contracts**

```bash
node --test scripts/ci-recovery-workflow.test.mjs
node scripts/docs-index.test.mjs
```

Expected: PASS.

- [ ] **Step 4: Commit required-check documentation**

```bash
git add CLAUDE.md .agents/skills/branch-to-merge/SKILL.md docs/cross-environment.md scripts/ci-recovery-workflow.test.mjs
git commit -m "docs: make PR checks the merge gate"
```

### Task 11: Verify and land Phase 2

**Files:**
- Verify all Phase 2 paths above.
- No new source files.

- [ ] **Step 1: Run the exact final PR gate locally**

```bash
pnpm lint
pnpm typecheck
pnpm check:tests-wired
pnpm test:app
pnpm test:api
pnpm test:mobile
```

Expected: all PASS.

- [ ] **Step 2: Run focused workflow and promotion tests**

```bash
node --test scripts/release-promotion.test.mjs
node --test scripts/release-promotion-workflow.test.mjs
node --test scripts/ci-recovery.test.mjs
node --test scripts/ci-recovery-workflow.test.mjs
node --test scripts/ios-build-ci.test.mjs
node --test scripts/stamp-release.test.mjs
node --test scripts/release-macos-signing.test.mjs
node --test src-tauri/release-runtime.test.mjs
```

Expected: all PASS.

- [ ] **Step 3: Open the Phase 2 PR and require only `PR checks`**

```bash
git push -u origin "$(git branch --show-current)"
gh pr create --base main --head "$(git branch --show-current)" \
  --title "Retire routine CI fanout" \
  --body "Implements cave-7kix8.8 Phase 2 after branch protection migrated to PR checks: removes main-push CI and legacy path-aware PR fanout."
head=$(git rev-parse HEAD)
gh pr checks --required --watch
gh pr view --json headRefOid --jq .headRefOid | grep -Fx "$head"
```

Expected: `PR checks` is the only required context and succeeds on the exact head.

- [ ] **Step 4: Merge through the protected path**

After reading review threads and fixing valid findings:

```bash
gh pr merge --squash --match-head-commit "$head"
```

Expected: merge succeeds without `--admin`.

- [ ] **Step 5: Prove a merge does not start routine CI**

```bash
merge_sha=$(gh pr view --json mergeCommit --jq .mergeCommit.oid)
sleep 30
gh run list --workflow ci.yml --commit "$merge_sha" --event push --json databaseId,event,headSha,status,conclusion
```

Expected: `[]`.

### Task 12: Exercise promotion at the next release cut

**Files:**
- No repository changes unless the exercise exposes a defect.
- Remote evidence: signed RC tag, successful candidate run, signed final tag, authorized release run.

- [ ] **Step 1: Create a signed candidate from the stamped main commit**

From the clean release-stamp merge:

```bash
version=$(node -p "require('./package.json').version")
main_commit=$(git rev-parse origin/main)
candidate="v${version}-rc.1"
git tag -s "$candidate" "$main_commit" -m "Coven Cave $candidate"
git push origin "$candidate"
```

Expected: the `Release candidate` workflow starts; `Release` does not start for the RC tag.

- [ ] **Step 2: Require complete candidate validation**

```bash
candidate_run=""
for attempt in $(seq 1 20); do
  candidate_run=$(gh run list --workflow release-candidate.yml --branch "$candidate" --event push --limit 10 --json databaseId,headSha --jq '.[] | select(.headSha == "'"$main_commit"'") | .databaseId' | head -1)
  [ -n "$candidate_run" ] && break
  sleep 6
done
test -n "$candidate_run"
gh run watch --exit-status "$candidate_run"
gh run view "$candidate_run" --json conclusion,url,headSha,jobs \
  --jq '{conclusion,url,headSha,rollup:[.jobs[] | select(.name=="Release candidate validated" or (.name | endswith(" / Release candidate validated"))) | {status,conclusion}]}'
```

Expected: run and rollup conclude `success` at `$main_commit`.

- [ ] **Step 3: Negative-check final authorization without publishing**

Use `scripts/release-promotion.test.mjs` fixtures for unsigned, lightweight, off-main, failed, skipped, manual, wrong-version, and wrong-SHA cases. Do not push deliberately invalid final tags because final tags are immutable and publication-capable.

Run:

```bash
node --test scripts/release-promotion.test.mjs
```

Expected: every negative case PASSes by rejecting authorization.

- [ ] **Step 4: Promote the exact candidate commit**

```bash
final_tag="v${version}"
git tag -s "$final_tag" "$main_commit" -m "Coven Cave $final_tag"
git push origin "$final_tag"
release_run=""
for attempt in $(seq 1 20); do
  release_run=$(gh run list --workflow publish-release.yml --branch "$final_tag" --event push --limit 10 --json databaseId,headSha --jq '.[] | select(.headSha == "'"$main_commit"'") | .databaseId' | head -1)
  [ -n "$release_run" ] && break
  sleep 6
done
test -n "$release_run"
authorization=""
for attempt in $(seq 1 60); do
  authorization=$(gh run view "$release_run" --json jobs --jq '[.jobs[] | select(.name=="Authorize release promotion" and .status=="completed")][0].conclusion // empty')
  [ -n "$authorization" ] && break
  sleep 5
done
test "$authorization" = "success"
gh run view "$release_run" --json url,headSha,jobs \
  --jq '{url,headSha,authorization:[.jobs[] | select(.name=="Authorize release promotion") | {status,conclusion,url}]}'
gh run watch --exit-status "$release_run"
```

Expected: authorization succeeds before packaging or TestFlight jobs start, and its summary names `$candidate`, `$candidate_run`, and `$main_commit`.

## Final acceptance checklist

- [ ] `PR checks` is the only classic required status context.
- [ ] `ci.yml` has no `push` trigger and exactly one job.
- [ ] New commits cancel obsolete PR runs; recovery dispatches queue rather than cancel.
- [ ] RC tags are signed annotated tags on `main`; manual RC dispatch cannot authorize promotion.
- [ ] Candidate validation covers all lean PR commands, production build, Rust, Playwright, Ubuntu/Windows/macOS conformance and sidecar runtime, and Windows-native regression tests.
- [ ] Cancelled, failed, or skipped candidate dependencies make `Release candidate validated` fail.
- [ ] Final release authorization matches workflow identity, push event, exact SHA, base version, successful rollup, and current signed RC ref.
- [ ] RC tags do not start `publish-release.yml`.
- [ ] Legacy workflow ID `286550155` is disabled, and `.github/workflows/release.yml` is absent from current `main`.
- [ ] Every release-writing, artifact-uploading, updater, Homebrew, and TestFlight path is downstream of authorization.
- [ ] Manual recovery without RC evidence is limited to non-draft releases published before `2026-08-17T08:21:59Z` whose current tag commit matches a successful push run from legacy workflow ID `286550155` that was both created and last updated before the cutoff; no post-cutoff rerun, new release, or retargeted release has a legacy bypass.
- [ ] Workflow summaries record duration or exact tag/commit/run provenance as required by the approved specification.
