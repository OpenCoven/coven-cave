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
6. Reconcile clean `main` at the stamp merge commit before creating the signed
   `vX.Y.Z` tag. The release workflow requires an annotated GitHub-verified
   tag contained in `main`, then rejects any disagreement across the five
   stamped sources before platform builds begin.
7. Record the build/version, exact tagged SHA, verification, upload artifact,
   and any App Store Connect status in the release handoff.
