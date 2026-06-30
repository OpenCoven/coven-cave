# Coven Cave — Claude Code project notes

## Branch protection on `main` — all changes go through a PR

**Rule:** `main` is a protected branch. There are **no direct pushes** — not for collaborators, not for admins, not for Claude sessions (which push as the `BunsDev` admin). Every change lands via a pull request whose required checks are green. `git push origin main` (or `HEAD:main`) will be **rejected** with `GH006: Protected branch update failed`.

**Why:** Direct-to-main pushes were bypassing PR review and CI, and a shared-checkout `git add -A` from one of several concurrent sessions swallowed other sessions' uncommitted work into a single unrelated direct push (commit `258af8d`). See issue #585 for the full write-up. Protection was enabled with `enforce_admins=true` to make the hard stop apply to everyone.

**Current settings** (verified live; `gh api repos/OpenCoven/coven-cave/branches/main/protection`):

- PR required before merging — **0 approvals** (you can self-merge once checks pass; no second human needed for solo work).
- Required status checks (all must pass): `Frontend build`, `Rust check`, `CodeQL`, `E2E (Playwright)`. (Require the **aggregate** `CodeQL` check, not the individual `Analyze (<lang>)` jobs — those are matched ambiguously by branch protection and get stuck as "expected", which blocks every PR.) The `E2E (Playwright)` job runs daemon-less (`COVEN_CAVE_E2E=1`), so e2e specs must be self-contained — dismiss onboarding (`cave:onboarding:dismissed=1`) and drive surfaces via `page.route(...)` API mocks rather than a live daemon.
- `enforce_admins = true` — admins are **not** exempt.
- Force-pushes and deletion of `main` are blocked.

**How to apply (the only path to `main`):**

```bash
# work on a branch (in a worktree, per the convention below)
git worktree add -b <branch> .worktrees/<branch> origin/main
# … commit (signed, per the global -S rule) …
git push -u origin <branch>
gh pr create --base main --head <branch> --title "…" --body "…"
# wait for the 3 required checks to go green, then:
gh pr merge <#> --squash --delete-branch
```

Squash-merge through `gh`/the PR UI still works — it's a merge, not a direct push. Only `git push … main` is blocked. Don't try to "work around" protection (e.g. flipping `enforce_admins` off to push) — if a change can't go through a PR, surface it to the user.

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

**Surface-claim guard (automatic).** A PreToolUse hook — `scripts/surface-claim-guard.mjs`, wired in `.claude/settings.json` — records each session's claim on the files it edits in the primary checkout (`.claude/claims.json`, gitignored, ~2h TTL) and warns when another live session has already claimed the same file. It's advisory-only (never blocks an edit) and skips `.worktrees/` paths. So if you get a "⚠️ Multi-session collision on `<file>`" message, another session may be editing that file — coordinate or move to a worktree before clobbering it. This operationalizes §1 of the coordination doc; you no longer have to grep claims.json by hand.
