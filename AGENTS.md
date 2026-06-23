# Coven Cave Agent Notes

## Workflow-First Branch Hygiene

- Treat `main` as the canonical project state. Before starting work, fetch and branch from current `origin/main`.
- Use branches and worktrees only as short-lived PR transport for active implementation. Do not use branches as durable storage, coordination logs, or half-finished agent memory.
- Keep durable coordination in tracked workflow artifacts: plans, specs, issues, PR descriptions/checklists, release notes, and handoff docs.
- Before opening a PR, make the branch PR-shaped: scoped diff, relevant local verification, and a summary of what changed.
- After a PR merges, delete the remote branch and remove the local worktree/branch. Preserve any intentionally unmerged work as an archive patch or named stash before cleanup.
- Do not push directly to `main`; use the protected PR path for repository changes.
- Before release or TestFlight work, reconcile through clean `main`, then verify from that state.

