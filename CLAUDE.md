# Coven Cave — Claude Code project notes

## Worktree convention

Use `.worktrees/<branch-name>/` subdirectories inside the repo. Confirmed in use; an empty `.wt/` stub also exists — ignore it, not the active convention. (Apparently a `cv-wt` claim+canary CLI exists too; if the canonical incantation matters, ask the user rather than guessing.)

**Create:**

```bash
git worktree add -b <branch> .worktrees/<branch> origin/main
cd .worktrees/<branch> && pnpm install   # ~10s with pnpm's CAS store
```

**When to use a worktree:**

- Multiple concurrent Claude sessions on this repo — each session in its own `.worktrees/<branch>` so their git operations don't race.
- Multi-task subagent dispatches that share a feature branch — one shared worktree at `.worktrees/<branch>`, all subagents dispatched there. **Do not** pass `isolation: "worktree"` to the `Agent` tool for this pattern — it creates a fresh worktree per agent and breaks branch continuity.

**Don't:**

- Symlink `node_modules` from the main checkout — Next.js + pnpm workspaces are fragile around this.
- `git worktree remove --force` when status is dirty — investigate first; uncommitted edits may belong to another live session.

**After `gh pr merge --squash --delete-branch`:** remote-side cleanup is automatic; local-side is NOT. Manually `git worktree remove <path>` then `git branch -D <branch>`, then `git worktree list` to verify.

## Diagnosing concurrent sessions

If git operations keep colliding with surprise pulls/merges, multiple Claude sessions are likely on the same checkout. Diagnose:

```bash
ps -ef | grep ' claude --' | grep -v grep    # one PID per live session
```

Map PIDs to session JSONLs in `~/.claude/projects/-Users-buns-Documents-GitHub-OpenCoven-coven-cave/` by matching session-JSONL first-entry timestamp to PID elapsed time (`ps -o etime`). All sessions in the same cwd → they're racing on the primary checkout; move them into worktrees.

**Beyond git collisions — see [`docs/multi-session-coordination.md`](docs/multi-session-coordination.md).** Git only catches *duplicate* work between sessions. The costlier failure mode — *orphaned* work, where Session A polishes a surface that Session B is about to remove — slips through every check because it builds clean and passes tests. The doc covers the patterns, why git doesn't catch them, and which cross-session signals would. Read it before structural work (removals, IA changes, large refactors) on a surface that's plausibly being touched elsewhere.
