# Release-Candidate CI Design

**Date:** 2026-08-05 · **Bead:** `cave-7kix8` · **Status:** approved design, not yet implemented

Coven Cave currently runs the full validation suite for every pull request and
again after every merge to `main`. A successful pull request occupies Linux and
Windows runners for roughly 9-19 minutes, then its merge starts another
12-14-minute copy. This design optimizes for the shortest pull-request queue:
one Linux gate on pull requests, no automatic `main` run, and the complete
platform/runtime suite at a signed release-candidate boundary.

## Decision

Use signed release-candidate tags as the promotion boundary. Do not add a
long-lived `staging` branch.

The delivery path becomes:

```text
feature branch
  -> pull request
  -> PR checks
  -> main
  -> signed vX.Y.Z-rc.N tag
  -> full release-candidate validation
  -> signed vX.Y.Z tag on the exact same commit
  -> package and publish
```

This accepts the Option C safety trade-off: Rust, browser, packaged-sidecar, and
platform-specific regressions may reach `main`. They may not reach a published
release.

## Goals

1. Reduce pull-request runner demand from nine required contexts to one Linux
   job.
2. Stop rerunning the full suite after every merge to `main`.
3. Preserve lint, type, test-wiring, and unit/API/mobile feedback before merge.
4. Run the full suite once for each release candidate, including macOS coverage
   that is too expensive for pull-request CI.
5. Prove that published artifacts come from the exact commit that passed
   candidate validation.
6. Change branch protection without an unprotected or permanently blocked
   interval.

## Non-goals

- A permanent staging, develop, or release branch.
- A merge queue or batched merge train.
- Automatic release creation from `main`.
- Path-based skipping of the pull-request gate.
- Replacing release packaging, signing, notarization, updater, checksum, or
  Homebrew behavior.
- Making a release from a candidate commit that differs from the final tag.

## Workflow architecture

### Pull-request CI

`.github/workflows/ci.yml` runs only for pull requests targeting `main` and for
explicit diagnostic dispatches. It does not run on pushes to `main`.

It exposes one stable required context named **`PR checks`** on
`ubuntu-latest`:

1. Check out the pull-request merge ref.
2. Install pnpm and Node 24.
3. Run `pnpm install --frozen-lockfile`.
4. Run `pnpm lint`.
5. Run `pnpm typecheck`.
6. Run `pnpm check:tests-wired`.
7. Run `pnpm test:app`.
8. Run `pnpm test:api`.
9. Run `pnpm test:mobile`.

The job does not run `pnpm build`, Cargo, Playwright, cross-environment
conformance, or packaged-sidecar runtime tests. Those move to candidate
validation.

Pull-request concurrency is keyed by pull-request number, not `github.ref`, and
uses `cancel-in-progress: true`. A newer commit cancels obsolete work for the
same pull request without cancelling another pull request.

The job is never conditionally skipped. Branch protection requires its exact
name, so every pull request targeting `main` must report it.

### Full validation

`.github/workflows/full-validation.yml` is a reusable workflow invoked by the
release-candidate workflow. It owns the deferred checks:

| Job | Coverage |
| --- | --- |
| Frontend validation | Every `PR checks` command plus `pnpm build`, including existing Turbopack retry behavior |
| Rust check | `cargo check --locked` and the persisted mobile-token test |
| E2E (Playwright) | Chromium and WebKit viewport projects |
| Cross-environment | The conformance suite on Ubuntu, Windows, and macOS |
| Sidecar runtime | Packaged sidecar/runtime proof on Ubuntu, Windows, and macOS |
| Release candidate validated | Fail-closed rollup requiring every job and matrix leg |

The Windows-only Cargo lifecycle checks stay attached to the Windows sidecar
leg. The macOS conformance and sidecar legs return here because candidate runs
are infrequent; removing macOS from pull-request CI was a queue/cost decision,
not a declaration that the platform needs no validation.

The rollup job uses `if: always()` and succeeds only when every direct
dependency reports `success`. A cancelled, failed, or skipped dependency makes
the candidate fail. Future optional diagnostics must not be added as a
dependency of this rollup.

### Release-candidate workflow

`.github/workflows/release-candidate.yml` runs on:

- pushes of tags matching `vMAJOR.MINOR.PATCH-rc.N`; and
- manual dispatch for diagnostics.

Only a tag-push run can authorize promotion. Manual runs exercise the suite but
are excluded by the final release gate.

Before invoking full validation, a provenance job verifies:

1. The tag name matches `^v[0-9]+\.[0-9]+\.[0-9]+-rc\.[1-9][0-9]*$`.
2. The ref resolves to an annotated tag object, not a lightweight tag.
3. GitHub's tag-object response reports `verification.verified == true`.
4. Peeling the tag reaches `github.sha`.
5. The peeled commit is reachable from `origin/main`.

Candidate concurrency is keyed by the complete tag and never cancels in
progress. A failed candidate is immutable: fix the defect through a pull
request, merge it, and create the next signed `rc.N` tag. Never move or reuse a
candidate tag.

### Final release workflow

`.github/workflows/release.yml` responds to final tags matching
`vMAJOR.MINOR.PATCH`. Prerelease tags are explicitly excluded so an RC can
never create release assets.

A new **`Authorize release promotion`** job runs before every existing release
job. It has `contents: read` and `actions: read` permissions and verifies:

1. The final ref is a GitHub-verified signed annotated tag.
2. The final tag peels to the workflow's `github.sha`.
3. That commit is reachable from `origin/main`.
4. At least one successful `Release candidate` workflow run exists with:
   - event `push`;
   - `head_sha` equal to the final tag's peeled commit;
   - a tag matching `vMAJOR.MINOR.PATCH-rc.N` for the same base version; and
   - a successful `Release candidate validated` rollup.
5. The current RC ref still resolves to a GitHub-verified signed tag that peels
   to the same commit.

The job queries workflow runs through the GitHub API and paginates until it
finds a match or exhausts the result set. It does not accept a branch run,
manual dispatch, commit status with a similar name, or successful run from a
different workflow file.

`daemon-package` depends on `Authorize release promotion`; the existing build,
checksums, updater manifest, and Homebrew dependency chain remains downstream.
No job that can create a release, upload an asset, sign an updater artifact, or
change release metadata may run when promotion authorization fails.

The final tag is also immutable. A deterministic provenance failure does not
permit retargeting it. Correct the issue and release the next version. A
transient GitHub API failure may be rerun because the inputs and tag objects have
not changed.

The promotion contract starts at `v0.2.4`. Manual recovery runs for final tags
older than `v0.2.4` remain possible only when a GitHub Release for that tag
already exists; they cannot create a missing historical release. New tag-push
releases and every final version at or above `v0.2.4` require signed candidate
promotion. This preserves recovery for artifacts shipped before candidate runs
existed without creating a general bypass.

## Tagging contract

Release operators use signed annotated tags:

```bash
git tag -s v0.2.4-rc.1 <main-commit> -m "Coven Cave v0.2.4-rc.1"
git push origin v0.2.4-rc.1

# After the candidate workflow succeeds:
git tag -s v0.2.4 <same-main-commit> -m "Coven Cave v0.2.4"
git push origin v0.2.4
```

The operator must confirm the candidate run and exact commit before creating the
final tag. The server-side promotion job repeats that proof; local inspection
is not an authority boundary.

GitHub's tag-object `verification` result is authoritative for this contract.
Local `%G?` output is not used because this checkout does not have a reliable
allowed-signers configuration.

## Failure behavior

| Failure | Result | Recovery |
| --- | --- | --- |
| Pull-request check fails | Merge remains blocked | Fix and push; obsolete run cancels |
| Candidate tag is malformed, lightweight, unsigned, or off `main` | Full validation does not start | Create a new valid signed candidate tag |
| Deferred validation fails | Candidate is not promotable | Fix through a PR and increment `rc.N` |
| Candidate run is cancelled or skips a required leg | Candidate is not promotable | Rerun the unchanged tag or create the next candidate |
| Final tag has no exact successful candidate | Packaging cannot start | Treat as deterministic provenance failure; do not move the tag |
| GitHub API is unavailable | Promotion fails closed | Rerun the unchanged release workflow |
| Packaging fails after promotion | Existing release recovery applies | Rerun the failed release jobs against the unchanged final tag |

No workflow converts missing evidence into success, silently falls back to the
latest candidate, or selects the most recent run without checking version and
commit.

## Branch-protection migration

Classic branch protection currently requires nine contexts. Changing workflow
names and protection in the wrong order can leave every pull request blocked.
Use two repository PRs:

### Phase 1: establish the new context

1. Add `PR checks` to `ci.yml` while retaining all existing pull-request jobs.
2. Add the candidate/full-validation workflows and final-release promotion
   gate.
3. Update workflow contract tests and release documentation.
4. Merge through the existing nine required contexts.
5. Confirm `PR checks` reports successfully on a pull request created after the
   merge.
6. Change classic branch protection to require only `PR checks`, preserving all
   unrelated settings, including `strict: false`, `enforce_admins: false`, and
   the current conversation/signature policies.

The disabled ruleset is not enabled or edited as part of this work.

### Phase 2: remove queue-heavy triggers

1. Remove the old full-suite jobs from pull-request `ci.yml`.
2. Remove the `push: branches: [main]` trigger.
3. Update `CLAUDE.md`, the branch-to-merge skill, and their contract test from
   nine required checks to `PR checks`.
4. Merge through the new single required context.
5. Confirm a subsequent merge does not start `ci.yml` on `main`.

At no point is `main` left without a required pull-request check. The old jobs
may continue consuming runners briefly between phases, but they are no longer
merge gates after the protection update.

## Contract tests

Add workflow contract tests that parse the YAML as behavior, not just text
snapshots. They must prove:

- `ci.yml` targets pull requests to `main`, has no automatic `main` push
  trigger, and always exposes exactly one job named `PR checks`.
- `PR checks` invokes every command in the stated order and excludes build,
  Cargo, Playwright, conformance, and sidecar commands.
- candidate tag matching accepts `v1.2.3-rc.1` and rejects final, zero-indexed,
  malformed, and unrelated prerelease tags.
- candidate provenance requires a verified annotated tag and a commit reachable
  from `main`.
- full validation includes all deferred jobs, all three operating systems, and
  a fail-closed rollup; its frontend job also repeats every pull-request
  command before building.
- final tag matching excludes candidates and other prereleases.
- every publishing-capable release job is transitively downstream of
  `Authorize release promotion`.
- promotion filters by workflow identity, push event, exact SHA, matching base
  version, successful rollup, and current signed RC ref.
- the documented required check and branch-to-merge skill both name only
  `PR checks`.

Existing tests that pin macOS's absence from pull-request CI must be updated to
pin its presence in candidate validation instead. Release signing, registry,
version-stamping, and packaging tests remain in place.

## Observability and acceptance

Each workflow summary records:

- pull-request check duration;
- candidate tag, peeled commit, signature verification reason, and per-platform
  results; or
- final tag, chosen candidate tag, candidate run URL, and exact promoted SHA.

The implementation is accepted when:

1. A pull request reports only `PR checks` as required and a new commit cancels
   its prior run.
2. Merging that pull request starts no automatic `ci.yml` run on `main`.
3. An unsigned, lightweight, off-main, failed, skipped, or manually dispatched
   candidate cannot authorize a final release.
4. A signed successful candidate authorizes only a signed final tag for the same
   base version and exact commit.
5. No release artifact or release metadata is created before promotion
   authorization succeeds.
6. Candidate validation covers Ubuntu, Windows, macOS, Rust, Playwright,
   conformance, sidecar runtime, all pull-request checks, and the production
   frontend build.

## Trade-offs

The design intentionally favors queue speed over continuous platform confidence.
`main` can be temporarily broken in ways the Linux unit/API gate cannot see, and
several merged changes may need to be investigated together when a candidate
fails. Signed exact-SHA promotion bounds that risk at publication without
pretending to remove it.

A staging branch would move the same delayed feedback into another mutable
branch while adding drift, merge bookkeeping, and ambiguous release provenance.
Release-candidate tags provide an immutable checkpoint without creating a
second source of truth.
