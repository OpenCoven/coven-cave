# Session-Exit Worktree Retirement Design

## Goal

Retire clean local worktrees that have already landed on `main` when a Claude
session ends, without invoking the network-bound lifecycle patrol.

## Policy

The exit command uses the local `wt:status --json` classification and may
remove only `SAFE-RETIRE` worktrees. Those are non-primary, named-branch,
clean worktrees with no commits ahead of `main`. Dirty, unmerged, detached,
protected, and unreadable worktrees remain untouched.

If a safe worktree is locked, the command unlocks it immediately before local
removal. It deletes the local branch only after its worktree is removed. It
never contacts GitHub, Beads, or a remote, and it never deletes a remote
branch. Individual failures are reported but do not block session shutdown.

## Validation

Fixture coverage verifies clean merged removal, dirty/unmerged/primary
retention, safe lock removal, and continuation after an individual failure.
The hook configuration is also tested directly.
