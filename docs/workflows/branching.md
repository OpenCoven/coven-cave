# Workflow-First Branching

Coven Cave uses `main` as the canonical source of truth. Branches are allowed, but only as short-lived transport for active PR work.

## Canonical State

- `main` is the only long-lived branch.
- Releases, TestFlight uploads, and updater validation start from clean `main`.
- Work that needs to survive an agent session belongs in tracked artifacts, not in an abandoned branch.

Durable artifacts include:

- `docs/superpowers/specs/` for product and design intent.
- `docs/superpowers/plans/` for implementation plans and handoffs.
- GitHub issues and PR descriptions for active coordination.
- Release notes, checklists, and verification summaries for ship state.

## Short-Lived Branches

Use a branch when there is active implementation or review work that cannot land directly on protected `main`.

Expected lifecycle:

1. Fetch latest `origin/main`.
2. Create a scoped worktree/branch from `origin/main`.
3. Make the diff PR-shaped: focused scope, relevant tests, and no unrelated churn.
4. Open a PR with the verification performed and any known follow-up work.
5. Merge through the protected PR path after checks pass.
6. Delete the remote branch and remove the local worktree/branch.

Branches should not remain open as:

- agent scratchpads
- long-running state stores
- hidden task queues
- backups for unreviewed changes
- coordination substitutes for docs, issues, or PR text

## WIP Preservation

Before removing a stale branch or worktree, inspect it.

- If the work is merged or patch-equivalent to `main`, delete the branch.
- If it has useful unmerged commits, archive them with `git format-patch` before deleting.
- If it has uncommitted work, preserve it with a named stash or archive patch before cleanup.
- Prefer moving generated leftover directories to Trash over permanent deletion.

## Release And TestFlight

Release work should start only after branch consolidation:

1. Confirm no open PRs are intended for the release.
2. Confirm `origin/main` is current and contains every commit intended for the release.
3. Create the release stamp branch through the managed Beads worktree command,
   using the exact name `release/stamp-vX.Y.Z`.
4. Preview the complete stamp with `pnpm release:preview --version X.Y.Z`,
   then run `pnpm release:prepare --version X.Y.Z` from that clean managed
   worktree. The preparation command updates `package.json`, the Tauri config,
   Cargo manifest and lockfile, both iOS release values, and `CHANGELOG.md`;
   it first requires HEAD to equal live `origin/main`, and it does not commit,
   push, tag, publish, or open a PR.
5. Edit the generated changelog, run
   `pnpm release:verify --version X.Y.Z`, make a signed stamp commit, and merge
   it through the protected PR path.
6. Reconcile clean `main` at the stamp merge commit. Create and push a signed,
   annotated `vX.Y.Z-rc.N` tag at that exact commit. Candidate tags are
   immutable; replace a failed candidate with a higher `rc.N` after its fix
   lands through a PR.
7. Wait for the `Release candidate` workflow and its `Release candidate
   validated` rollup to succeed. Record the candidate tag, run URL, and exact
   commit. A manual candidate dispatch is diagnostic only and cannot authorize
   promotion.
8. Create and push the signed, annotated final `vX.Y.Z` tag at the same commit.
   Final release authorization re-verifies both tags through GitHub and rejects
   a different version or commit before packaging, release metadata, updater
   publication, or TestFlight work starts.
   The only legacy-recovery exception is a manually dispatched final release
   strictly before `v0.2.4` with an existing non-draft GitHub Release published
   before the legacy cutoff and a matching successful legacy push run whose
   creation and update timestamps precede that cutoff. Final versions `v0.2.4`
   and later always require signed release-candidate promotion.
9. Record the build/version, candidate and final tags, exact promoted SHA,
   validation run, upload artifacts, and App Store Connect status in the
   release handoff. The `rollback-readiness` job records the verified rollback
   target alongside it, and blocks updater publication when the previous
   release is not one — see
   [`release-rollback-readiness.md`](release-rollback-readiness.md).
10. Before widening the audience, run the three-OS acceptance journey and prove
    a rollback target exists. See [Release Acceptance](release-acceptance.md)
    for the journey and its evidence format, and
    [Production Rollout](production-rollout.md) for the staged rollout
    thresholds and the bounded rollback drill. A release that has shipped a tag
    has not yet been rolled out.

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
