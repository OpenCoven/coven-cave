# Coven Cave Agent Notes

## Workflow-First Branch Hygiene

- Treat `main` as the canonical project state. Before starting work, fetch and branch from current `origin/main`.
- Use branches and worktrees only as short-lived PR transport for active implementation. Do not use branches as durable storage, coordination logs, or half-finished agent memory.
- Keep durable coordination in tracked workflow artifacts: plans, specs, issues, PR descriptions/checklists, release notes, and handoff docs.
- Before opening a PR, make the branch PR-shaped: scoped diff, relevant local verification, and a summary of what changed.
- After a PR merges, delete the remote branch and remove the local worktree/branch. Preserve any intentionally unmerged work as an archive patch or named stash before cleanup.
- Do not push directly to `main`; use the protected PR path for repository changes.
- Before release or TestFlight work, reconcile through clean `main`, then verify from that state.

## Design System (any UI work)

[`docs/coven-design-language.md`](docs/coven-design-language.md) is the
binding contract for tokens, density, elevation, motion, voice, and interface
copy — read it before editing any surface, and walk its §9 shipping checklist
before opening a UI PR. The live token reference renders at `/aesthetic`.

Where the truth lives:

- `src/styles/globals/foundations.css` — the annotated token contract
  (surfaces, text tiers, borders, radii, 4px spacing grid, type scale, motion,
  focus rings, icon sizes). `src/app/globals.css` is only an import facade.
- `src/styles/globals/themes.css` — 21 palettes × 2 modes (`data-theme` ×
  `data-mode` on `:root`). Every surface must survive all 42 combinations.
- `src/styles/globals/primitives.css` — shared `.ui-*` classes; grep before
  inventing a class.
- `src/components/ui/` — React primitives (Button, EmptyState, ErrorState,
  Skeleton, Modal, Popover, OverflowMenu, ViewHeader, SearchInput, …). Reuse
  before writing new ones.
- `src/lib/icon.tsx` — the `ph:`-prefixed Phosphor `ICON_NAMES` union. New
  icon: add the name there, run `node scripts/generate-icon-subset.mjs`,
  commit the regenerated subset (`icon-subset.test.ts` fails CI otherwise).

Hard rules, enforced by gates (not advisory):

- **Tokens only** — no hardcoded colors, on-scale px font sizes, off-grid
  spacing, or off-step radii in render code. `pnpm lint` runs the design
  ESLint gate (`coven-design/no-raw-px-text`, `no-static-inline-style`,
  `no-render-hex-color`) plus `pnpm codemod:design:check`;
  `src/lib/design-token-drift.test.ts` (app test suite) keeps the CSS codemod
  a no-op and ratchets judgment categories down-only — if you must add one,
  raise the baseline in the same PR and justify it.
- **Auto-fixers before hand-editing**: `node scripts/codemods/tokenize-css.mjs`
  rewrites on-scale CSS literals to tokens; `pnpm codemod:design` does the
  same for component TSX.
- **State tints derive from one solid token** via the `color-mix` recipe
  (solid text, ~14% fill, 30–45% border) — never a second hue. Danger alerts
  ship pre-mixed as `--danger-bg` / `--danger-border` / `--danger-text`.
- **A11y non-negotiables**: `.focus-ring` on interactive elements,
  `useFocusTrap` + focus return for anything modal, `useAnnouncer()` on
  mutations, a `prefers-reduced-motion` story for anything that moves, and
  color never the only channel.
- **Copy follows the doc's §10 contract** (vocabulary, action copy, field
  semantics, placeholder grammar `Search <items>…` with the `…` character,
  state copy). `scripts/ui-consistency.test.mjs` pins the §10 headings and
  the doc's factual claims (palette counts, token values, cited paths).

## Starting The Tauri Desktop App

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


<!-- BEGIN BEADS INTEGRATION v:1 profile:minimal hash:970c3bf2 -->
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

<!-- BEGIN BEADS CODEX SETUP: generated by bd setup codex -->
## Beads Issue Tracker

Use Beads (`bd`) for durable task tracking in repositories that include it. Use the `beads` skill at `.agents/skills/beads/SKILL.md` (project install) or `~/.agents/skills/beads/SKILL.md` (global install) for Beads workflow guidance, then use the `bd` CLI for issue operations.

### Quick Reference

```bash
bd ready                # Find available work
bd show <id>            # View issue details
bd update <id> --claim  # Claim work
bd close <id>           # Complete work
bd prime                # Refresh Beads context
```

### Rules

- Use `bd` for all task tracking; do not create markdown TODO lists.
- Run `bd prime` when Beads context is missing or stale. Codex 0.129.0+ can load Beads context automatically through native hooks; use `/hooks` to inspect or toggle them.
- Keep persistent project memory in Beads via `bd remember`; do not create ad hoc memory files.

**Architecture in one line:** issues live in a local Dolt DB; sync uses `refs/dolt/data` on your git remote; `.beads/issues.jsonl` is a passive export. See https://github.com/gastownhall/beads/blob/main/docs/SYNC_CONCEPTS.md for details and anti-patterns.
<!-- END BEADS CODEX SETUP -->

## Coven Familiar Beads Protocol

- Run `bd prime` and `bd ready --json` before choosing familiar work in this repo.
- Claim exactly one ready bead with `bd update <id> --claim` before editing code.
- Keep GitHub and Linear as visibility layers: link PRs, checks, and Linear tickets through `external-ref`, labels, notes, or comments instead of duplicating the queue.
- Record branch/worktree, session, familiar owner, and verification evidence in the bead before handoff.
- Close with `bd close <id>` only after merge or explicit completion criteria are satisfied.
- Never put secrets in bead text, and never treat `.beads/issues.jsonl` as the sync source of truth.

## Crediting Contributors

When you re-land or build on someone else's work — a fork PR, an issue author's proposal, a co-author — **credit the human contributor with a working GitHub-linked trailer** so they show up in the contributors graph and on their profile:

```
Co-authored-by: Full Name <ID+username@users.noreply.github.com>
```

- Use the **numeric-id no-reply form**. Get the id with `gh api users/<login> --jq .id`.
- **Never** use a machine or `.local` email (e.g. `name@Someones-Mac.local`) in a co-author trailer — it links to no account and gives **zero** credit.
- When a squash-merge folds a contributor's PR into an internal branch, **preserve their `Co-authored-by:` line in the squash commit message** (pass an explicit commit message to the merge). A trailer that only lands as free text in the PR body does not count.
- For substantial external contributions, also add the person to [`CONTRIBUTORS.md`](CONTRIBUTORS.md).

This is about crediting **people**. Don't add trailers or footers that credit an AI model, assistant, vendor, or coding harness.
