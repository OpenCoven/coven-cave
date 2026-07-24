# Coven Cave — Claude Code project notes

> **Primary agent guide: [`AGENTS.md`](AGENTS.md).** Start there for the branch/PR
> workflow, worktree conventions, Beads protocol, contributor attribution, and
> the design-system contract for UI work (tokens, primitives, and the lint /
> codemod / drift-ratchet gates that enforce it).
> This file adds Claude-specific depth on branch protection and CI gotchas.

## Branch protection on `main` — all changes go through a PR

**Rule:** `main` is a protected branch. There are **no direct pushes** — not for collaborators, not for admins, not for Claude sessions (which push as the `BunsDev` admin). Every change lands via a pull request whose required checks are green. `git push origin main` (or `HEAD:main`) will be **rejected** with `GH006: Protected branch update failed`.

**Why:** Direct-to-main pushes were bypassing PR review and CI, and a shared-checkout `git add -A` from one of several concurrent sessions swallowed other sessions' uncommitted work into a single unrelated direct push (commit `258af8d`). See issue #585 for the full write-up. Protection was enabled with `enforce_admins=true` to make the hard stop apply to everyone.

**Current settings** (verified live; `gh api repos/OpenCoven/coven-cave/branches/main/protection`):

- PR required before merging — **0 approvals** (you can self-merge once checks pass; no second human needed for solo work).
- Required status checks (all must pass): `Frontend build`, `Rust check`, `E2E (Playwright)`, `Cross-environment required`, `Sidecar runtime required`, `CodeQL`. (Require the **aggregate** `CodeQL` check, not the individual `Analyze (<lang>)` jobs — those are matched ambiguously by branch protection and get stuck as "expected", which blocks every PR. The aggregate `CodeQL` context resolves fast on every PR — `pass` in ~2s even when the per-language analyses skip — so it never hangs a PR.) `CodeQL` is enforced in **both** layers: ruleset `19123333` ("main protection (checks + CodeQL)") and classic branch protection (re-added 2026-07-24, cave-1vyi). The `E2E (Playwright)` job runs daemon-less (`COVEN_CAVE_E2E=1`), so e2e specs must be self-contained — dismiss onboarding (`cave:onboarding:dismissed=1`) and drive surfaces via `page.route(...)` API mocks rather than a live daemon.
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

## Starting the Tauri desktop app

Use the desktop shell when validating native-only surfaces such as the terminal,
browser pane, window chrome, sidecar behavior, updater wiring, or Tauri
permissions. Do not open Codex browser previews for this repo; use the native
Tauri window, or the user's default browser for web-only checks.

Preferred dev command:

```bash
bash scripts/dev-app.sh
```

Run it in the foreground from your repo checkout or worktree and leave that
terminal attached. Stop it with `Ctrl-C`. The wrapper:

- picks the first free loopback port in `3000..3010`, or honors `PORT=3001`
- starts the Next custom dev server on that port when needed
- writes a temporary Tauri config so `devUrl` points at the actual port
- runs `pnpm exec tauri dev` against the desktop shell

Expected early output looks like:

```text
[dev:app] port 3001 is free
[dev:app] starting dev server on 3001
Running BeforeDevCommand (`PORT=3001 pnpm dev`)
> Ready on http://127.0.0.1:3001
Running DevCommand (`cargo run --no-default-features --color always --`)
```

First launch may spend several minutes downloading and compiling Rust crates
before the window appears. Treat Cargo `Compiling ...` lines as progress, not a
hang. If port `3000` is occupied, for example by Docker, the wrapper should move
to `3001`; if all ports in the range are occupied, free one or run with an
explicit port:

```bash
PORT=3007 bash scripts/dev-app.sh
```

`pnpm dev:app` calls the same wrapper. Prefer the direct `bash` form in agent
handoffs because its logs make the startup sequence and selected port obvious.
Do not background the command when the goal is to verify the app started; a
detached wrapper can exit without leaving useful Tauri logs.

## Diagnosing concurrent sessions

If git operations keep colliding with surprise pulls/merges, multiple Claude sessions are likely on the same checkout. Diagnose:

```bash
ps -ef | grep ' claude --' | grep -v grep    # one PID per live session
```

Map PIDs to session JSONLs in `~/.claude/projects/-Users-buns-Documents-GitHub-OpenCoven-coven-cave/` by matching session-JSONL first-entry timestamp to PID elapsed time (`ps -o etime`). All sessions in the same cwd → they're racing on the primary checkout; move them into worktrees.

**Beyond git collisions — see [`docs/multi-session-coordination.md`](docs/multi-session-coordination.md).** Git only catches *duplicate* work between sessions. The costlier failure mode — *orphaned* work, where Session A polishes a surface that Session B is about to remove — slips through every check because it builds clean and passes tests. The doc covers the patterns, why git doesn't catch them, and which cross-session signals would. Read it before structural work (removals, IA changes, large refactors) on a surface that's plausibly being touched elsewhere.

**Surface-claim guard (automatic).** A PreToolUse hook — `scripts/surface-claim-guard.mjs`, wired in `.claude/settings.json` — records each session's claim on the files it edits in the primary checkout (`.claude/claims.json`, gitignored, ~2h TTL) and warns when another live session has already claimed the same file. It's advisory-only (never blocks an edit) and skips `.worktrees/` paths. So if you get a "⚠️ Multi-session collision on `<file>`" message, another session may be editing that file — coordinate or move to a worktree before clobbering it. This operationalizes §1 of the coordination doc; you no longer have to grep claims.json by hand.

**Worktree guard (automatic, BLOCKING).** A second PreToolUse hook — `scripts/worktree-guard.mjs`, matcher Bash — blocks (exit 2) destruction of live work: `git worktree remove`/`rm -rf` of a worktree root that is dirty or whose HEAD is on no remote ref, `git branch -D` of an unpushed tip, and `git push --delete` of a branch that still heads an OPEN PR. Clean+pushed cleanup and husk GC pass silently. If destruction is deliberate, re-run prefixed with `WT_GUARD_BYPASS=1 `. Exists because on 2026-07-03 an actor merged another session's in-progress branch (PR #2290) and its post-merge cleanup destroyed that session's worktree mid-edit (coordination doc §5). Corollary discipline: **push your branch to origin after every commit** — the remote is the only store a local actor can't destroy.


<!-- BEGIN BEADS INTEGRATION v:1 profile:minimal hash:6cd5cc61 -->
## Beads Issue Tracker

This project uses **bd (beads)** for issue tracking. Run `bd prime` to see full workflow context and commands.

### Quick Reference

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --claim  # Claim work
bd close <id>         # Complete work
```

### Rules

- Use `bd` for ALL task tracking — do NOT use TodoWrite, TaskCreate, or markdown TODO lists
- Run `bd prime` for detailed command reference and session close protocol
- Use `bd remember` for persistent knowledge — do NOT use MEMORY.md files

**Architecture in one line:** issues live in a local Dolt DB; sync uses `refs/dolt/data` on your git remote; `.beads/issues.jsonl` is a passive export. See https://github.com/gastownhall/beads/blob/main/docs/SYNC_CONCEPTS.md for details and anti-patterns.

## Agent Context Profiles

The managed Beads block is task-tracking guidance, not permission to override repository, user, or orchestrator instructions.

- **Conservative (default)**: Use `bd` for task tracking. Do not run git commits, git pushes, or Dolt remote sync unless explicitly asked. At handoff, report changed files, validation, and suggested next commands.
- **Minimal**: Keep tool instruction files as pointers to `bd prime`; use the same conservative git policy unless active instructions say otherwise.
- **Team-maintainer**: Only when the repository explicitly opts in, agents may close beads, run quality gates, commit, and push as part of session close. A current "do not commit" or "do not push" instruction still wins.

## Session Completion

This protocol applies when ending a Beads implementation workflow. It is subordinate to explicit user, repository, and orchestrator instructions.

1. **File issues for remaining work** - Create beads for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **Handle git/sync by active profile**:
   ```bash
   # Conservative/minimal/default: report status and proposed commands; wait for approval.
   git status

   # Team-maintainer opt-in only, unless current instructions forbid it:
   git pull --rebase
   bd dolt push
   git push
   git status
   ```
5. **Hand off** - Summarize changes, validation, issue status, and any blocked sync/commit/push step

**Critical rules:**
- Explicit user or orchestrator instructions override this Beads block.
- Do not commit or push without clear authority from the active profile or the current user request.
- If a required sync or push is blocked, stop and report the exact command and error.
<!-- END BEADS INTEGRATION -->

## Coven Familiar Beads Protocol

- Run `bd prime` and `bd ready --json` before choosing familiar work in this repo.
- Claim exactly one ready bead with `bd update <id> --claim` before editing code.
- Keep GitHub and Linear as visibility layers: link PRs, checks, and Linear tickets through `external-ref`, labels, notes, or comments instead of duplicating the queue.
- Record branch/worktree, session, familiar owner, and verification evidence in the bead before handoff.
- Close with `bd close <id>` only after merge or explicit completion criteria are satisfied.
- Never put secrets in bead text, and never treat `.beads/issues.jsonl` as the sync source of truth.
