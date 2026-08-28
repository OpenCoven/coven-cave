# CI Implementation Plan — fastest Coven Cave CI workflow

**Bead:** `cave-7kix8.8` (Plan CI implementation, checklist child of `cave-7kix8`)
**Parent design:** [`docs/superpowers/specs/2026-08-05-release-candidate-ci-design.md`](superpowers/specs/2026-08-05-release-candidate-ci-design.md) (approved; spec commit `11ee417d9`)
**Task-level breakdown:** [`docs/superpowers/plans/2026-08-17-release-candidate-ci.md`](superpowers/plans/2026-08-17-release-candidate-ci.md)
**Status:** Program — Phase 1 (signed promotion, full validation, parallel `PR checks` context) is shipped on `main`; Phase 2 (retire routine fanout) plus the branch-protection switch remain.

This is the rollout plan for the approved Option C model: one non-skippable
Linux `PR checks` gate on pull requests, no automatic `main` CI, and the full
cross-platform/Rust/Playwright/sidecar suite at the signed release-candidate
boundary, with exact-SHA signed final-tag authorization before any release
artifact is created.

---

## 1. Current state (reconciled against `origin/main`)

The repository has moved past the written spec. What is already true on
`origin/main` (f0905ce15):

| Piece | State |
| --- | --- |
| `PR checks` job in `.github/workflows/ci.yml` | **Shipped** (#4753, refined #5088) — always-reporting Ubuntu job: install, lint, typecheck, test wiring, app/API/mobile tests |
| Classic branch protection | **Still requires `Frontend build`** — `PR checks` reports in parallel but is not yet the required context |
| `.github/workflows/full-validation.yml` (reusable) | **Shipped** — frontend, rust, e2e (8 shards), e2e-agentic, runtime (Ubuntu/Windows/macOS), windows-native, fail-closed `Release candidate validated` rollup |
| `.github/workflows/release-candidate.yml` | **Shipped** — signed RC-tag trigger + provenance gate calling `full-validation` |
| `.github/workflows/release.yml` authorization | **Shipped** — `Authorize release promotion` job gates all publishing paths |
| `scripts/release-promotion.mjs` + tests | **Shipped and wired** — tag parsing, tag verification, main ancestry, RC-run discovery, legacy recovery boundary |
| `scripts/ci-recovery.mjs` + tests | **Shipped and wired** — exact-head dispatch, PR-number concurrency, non-cancelling recovery |
| `ci.yml` `push: branches: [main]` trigger | **Still present** — post-merge full reruns still happen |
| `ci.yml` legacy path-aware fanout | **Still present** — `paths`, `ios`, `frontend-validation`, `frontend-bundle`, `frontend-e2e`, `frontend-e2e-agentic`, `build` |
| Required-check documentation | **Still names `Frontend build`** — `CLAUDE.md`, `.agents/skills/branch-to-merge/SKILL.md`, `docs/cross-environment.md` |

So the remaining work is: switch branch protection to `PR checks`, then remove
the queue-heavy routine CI and update the required-check documentation.

---

## 2. Target job graph

### 2.1 Pull request (per PR, required)

```text
pull_request: branches [main]   (workflow_dispatch: exact-SHA diagnostic recovery)
        │
        ▼
   ┌─────────────────────┐
   │  PR checks          │  ubuntu-latest · never skipped · one job
   │  install --frozen   │  concurrency: ci-pr-<PR#>, cancel-in-progress
   │  lint               │  (dispatch queued, never cancels the run it rescues)
   │  typecheck          │
   │  check:tests-wired  │
   │  test:app           │
   │  test:api           │
   │  test:mobile        │
   └─────────────────────┘
```

Deliberately **absent** from the PR gate: `pnpm build`, Cargo, Playwright,
cross-environment conformance, packaged-sidecar runtime, and macOS. Those
move to candidate validation.

### 2.2 Release candidate (per signed RC tag)

```text
push: tags vMAJOR.MINOR.PATCH-rc.N   (workflow_dispatch: diagnostics only)
        │
        ▼
  provenance  — tag pattern ^v[0-9]+\.[0-9]+\.[0-9]+-rc\.[1-9][0-9]*$
              — annotated tag object, verification.verified == true
              — peeled commit == github.sha
              — commit reachable from origin/main
        │  commit (exact SHA)
        ▼
  full-validation (reusable) ─────────────────────────────────────────┐
   ├─ frontend        ubuntu · every PR-checks command + build (retry) │
   ├─ rust            ubuntu · cargo check --locked + mobile-token test│
   ├─ e2e             8 shards · Playwright Chromium + WebKit          │
   ├─ e2e-agentic     flag-enabled Playwright journeys                 │
   ├─ runtime         ubuntu / windows / macOS · conformance + sidecar │
   ├─ windows-native  windows · Cargo lifecycle regression tests       │
   └───────────────────────────────────────────────────────────────────┘
        ▼
  release-candidate-validated   if: always() · every leg must be success
```

### 2.3 Final release (per signed final tag, excluding prereleases)

```text
push: tags vMAJOR.MINOR.PATCH   (prerelease tags explicitly excluded)
        │
        ▼
  authorize-release-promotion  — verified signed annotated final tag
        │                        — peels to github.sha, reachable from main
        │                        — one successful push-event RC run with:
        │                          head_sha == final peeled commit
        │                          tag vMAJOR.MINOR.PATCH-rc.N (same base)
        │                          successful Release candidate validated
        │                        — current RC ref still verified signed
        ▼
  rollback-readiness → daemon-package → build/checksums/updater-manifest/homebrew
```

No job that creates a release, uploads an asset, signs an updater artifact, or
changes release metadata may run when authorization fails.

---

## 3. Phases

### Phase 1 — signed promotion and parallel context (SHIPPED)

Already merged on `main`:

- #4753 established `PR checks`, `full-validation.yml`,
  `release-candidate.yml`, release authorization, and
  `scripts/release-promotion.mjs` + tests.
- #5000 sharded candidate E2E; #5006 isolated release E2E server workers.
- #5088 made `PR checks` suites report independently instead of
  short-circuiting (cave-t8p1a).

No further work in this phase unless a corrective PR is required.

### Phase 2 — migrate branch protection to `PR checks`

Operator step, done through the GitHub UI / API against classic branch
protection. Preserve every unrelated setting — `strict: false`,
`enforce_admins: false`, current conversation/signature policies. The
disabled ruleset (`19123333`) is not enabled or edited.

1. Confirm `PR checks` reports successfully on a PR created after the
   `PR checks` context landed.
2. Change the required status check from `Frontend build` to `PR checks`.
3. Confirm `Frontend build` is no longer required and a new PR shows only
   `PR checks`.

At no point is `main` left without a required pull-request check. The old
jobs may keep consuming runners between phases, but they stop being merge
gates after this step.

### Phase 3 — retire queue-heavy routine CI (ONE PR, docs + workflow)

Branch: `ci/cave-7kix8-8-lean-pr-gate`. One focused PR, merged through the
new single required context.

**Workflow change** (`.github/workflows/ci.yml`):

1. Delete `push: branches: [main]`.
2. Delete the `paths`, `ios`, `frontend-validation`,
   `frontend-bundle`, `frontend-e2e`, `frontend-e2e-agentic`, and
   `build` jobs.
3. Retain `pr-checks` unchanged.
4. Retain `workflow_dispatch` with the exact-SHA guard, PR-number
   concurrency, and read-only permissions.
5. Update comments so none describe removed path selection, fanout, or
   `main` cancellation.

Resulting job map must be exactly one job: `pr-checks` named `PR checks`.

**Recovery contract** (`scripts/ci-recovery.mjs`,
`scripts/ci-recovery.test.mjs`, `scripts/ci-recovery-workflow.test.mjs`):

- Narrow the guarded-job contract to `pr-checks` only.
- Keep `expected_sha`, `expected_pr_number`, run-name stamping,
  branch-head revalidation, cooldown, and non-cancelling dispatch behavior.

**Documentation and contract pins**:

- `CLAUDE.md` and `.agents/skills/branch-to-merge/SKILL.md`: required
  check becomes `PR checks`; describe it as one Ubuntu job running
  install/lint/typecheck/test-wiring/app/API/mobile; state that build, Rust,
  Playwright, conformance, sidecar, Windows-native, and macOS run at the
  signed RC boundary.
- `docs/cross-environment.md`: `PR checks` becomes the PR baseline and the
  RC workflow the cross-platform authority; no text describes candidate
  validation as a branch-protection check.
- Extend `scripts/ci-recovery-workflow.test.mjs` to pin both docs naming
  `PR checks` and not naming the retired `Frontend build` context.

**New tests**: none beyond the narrowed contract tests already wired into
`scripts/run-tests.mjs` (no new files, so no registration needed).

### Phase 4 — verify the lean gate end to end

After Phase 3 merges:

1. Open a PR; confirm `PR checks` is the only required context and a new
   commit cancels its prior run.
2. Merge; confirm no automatic `ci.yml` run starts on `main`
   (`gh run list --workflow ci.yml --commit <merge-sha> --event push` → empty).
3. Run the focused contract suites locally:
   `release-promotion`, `release-promotion-workflow`, `ci-recovery`,
   `ci-recovery-workflow`, `ios-build-ci`, `stamp-release`,
   `release-macos-signing`, `src-tauri/release-runtime`.

### Phase 5 — exercise promotion at the next release cut

1. Stamp a release commit; create `git tag -s vX.Y.Z-rc.N <commit>`.
2. Confirm the `Release candidate` workflow runs and the
   `Release candidate validated` rollup succeeds at that exact commit; the
   `Release` workflow must NOT start for the RC tag.
3. Negative-check final authorization with the fixture tests (unsigned,
   lightweight, off-main, failed, skipped, manual, wrong-version, wrong-SHA).
   Never push deliberately invalid final tags — final tags are immutable and
   publication-capable.
4. Create `git tag -s vX.Y.Z <same-commit>`; confirm authorization succeeds
   before packaging/TestFlight jobs start and the summary names the candidate
   tag, candidate run URL, and exact promoted SHA.
5. Confirm RC tags never start the release publisher and prerelease tags are
   excluded by the final tag matcher.

---

## 4. Caching strategy

| Cache | Mechanism | Scope |
| --- | --- | --- |
| pnpm store | `actions/setup-node` with `cache: pnpm` (keyed by `pnpm-lock.yaml`) | shared across `PR checks` and every `full-validation` leg |
| Rust target | `Swatinem/rust-cache` with `workspaces: src-tauri -> target` | `rust` leg, `runtime` legs, `windows-native` leg |
| Playwright browsers | installed per job with `--with-deps chromium webkit` (version pinned by lockfile; not cached) | `e2e`, `e2e-agentic` |
| `.next` build | not cached; Turbopack flake retry (3 attempts, clean `.next` between) | frontend leg only |

Caching exists to cut wall-clock, never to relax correctness: every leg runs
`pnpm install --frozen-lockfile` against the exact lockfile and `--locked`
Cargo invocations, so a warm cache cannot hide dependency drift.

## 5. Evidence and provenance strategy

- **Signature authority** is GitHub's tag-object `verification` result
  (`verification.verified == true`), read through the REST API. Local
  `%G?` output is never used (no reliable allowed-signers config in this
  checkout).
- **Exact-SHA pinning**: the candidate workflow peels the annotated tag to a
  commit and validates only that commit; the release gate requires a
  successful push-event candidate run whose `head_sha` equals the final
  tag's peeled commit, for the same base version, with a successful
  `Release candidate validated` rollup.
- **Fail-closed**: missing, cancelled, failed, or skipped evidence always
  denies. No fallback to the latest candidate, no silent acceptance of a
  branch run or manual dispatch.
- **Observability**: each workflow summary records the PR-check duration, the
  candidate tag/peeled commit/verification reason and per-platform results,
  or the final tag/chosen candidate/candidate run URL/exact promoted SHA.
- **Contract tests** pin behavior, not text: `release-promotion` (tag
  parsing + provenance negatives), `release-promotion-workflow` (YAML DAG:
  PR gate exclusions, rollup fail-closed, release jobs downstream of
  authorization), `ci-recovery-workflow` (one required context, no
  `main` push trigger), plus `docs-index` keeping this document indexed.

## 6. Rollout steps (ordered)

1. [done] Phase 1 shipped on `main` (#4753, #5000, #5006, #5088).
2. [operator] Switch classic branch protection from `Frontend build` to
   `PR checks` (Phase 2).
3. [PR] Phase 3: remove `push: main` + legacy fanout, narrow recovery
   contract, update required-check docs and pins. Merge through `PR checks`.
4. [verify] Phase 4: new PR shows only `PR checks`; merge starts no `main`
   CI; contract suites pass.
5. [release cut] Phase 5: signed RC → full validation → signed final tag →
   authorized publication.

## 7. Acceptance criteria (from the parent design)

1. A PR reports only `PR checks` as required, and a new commit cancels its
   prior run.
2. Merging starts no automatic `ci.yml` run on `main`.
3. An unsigned, lightweight, off-main, failed, skipped, or manually
   dispatched candidate cannot authorize a final release.
4. A signed successful candidate authorizes only a signed final tag for the
   same base version and exact commit.
5. No release artifact or release metadata is created before promotion
   authorization succeeds.
6. Candidate validation covers Ubuntu, Windows, macOS, Rust, Playwright,
   conformance, sidecar runtime, all PR-check commands, and the production
   frontend build.
