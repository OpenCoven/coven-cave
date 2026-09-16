# Coven Cave Agent Notes

## Work continuity before starting

Before creating, claiming, planning, resuming, or delegating multi-step work,
load [work-continuity](.agents/skills/work-continuity/SKILL.md). If the skill
dispatcher does not index it, read that exact file directly.

Follow [the living procedure](docs/workflows/work-continuity.md): inspect
authorized GitHub issues, Project items, PRs, and explicit execution references.
Match outcome and target, preserve existing owners and original messages, and
propose a continuation rather than starting competing work. Unknown coverage
is not "no match"; a saved issue comment is not a delivered handoff.
Skip broad discovery for ordinary independent one-turn answers.

## GitHub Issues and Projects

Use **GitHub Issues** as the development queue and the existing
[Cave Project](https://github.com/orgs/OpenCoven/projects/9) for planning.
[GitHub work tracking](docs/workflows/github-work-tracking.md) is the canonical
guide for ownership, status, worktrees, handoff, and completion.

Beads is retired from this workflow by issue #5399. Do not run `bd`, create
or claim Beads, or sync Dolt to work on this repository. Preserve legacy data,
IDs, owners, and citations as historical notes. Do not bulk-import old rows
into GitHub or treat the passive `.beads/issues.jsonl` export as current work.

Keep one issue per outcome. Record the acting familiar, scope, branch/worktree,
evidence, blocker, and imperative next step on that issue. GitHub assignment
and comments are not execution leases. Preserve human-authored dependencies
and approval requirements.

Use Project `Started` only while actively working. Waiting or blocked work is
`Todo`, with the named blocker and next step on the issue. Use `Done` only
after merge or explicit completion criteria. Do not leave an idle session
marked active.

## Workflow-First Branch Hygiene

- Treat `main` as canonical. Fetch current `origin/main` before branching.
- Use a short-lived, issue-owned worktree under `.worktrees/`. Follow the
  [creation and budget contract](docs/workflows/github-work-tracking.md#worktrees).
  Use `git worktree add --no-track`; do not create a Bead or forge legacy
  lifecycle metadata to obtain a worktree.
- Keep durable decisions in issues, approved specs/plans, and PRs, not branches
  or session memory. Approved documents must resolve on `main` through a PR.
- Keep the shared checkout and other sessions' edits untouched. Run
  `pnpm wt:status` before interpreting dirtiness; a paused Git operation is
  not proof of live editing or permission to abort it.
- Make each PR scoped and locally verified. Do not commit, push, or merge
  without clear authority from the current request.
- Never push directly to `main`, use `gh pr merge --admin`, or change branch
  protection. The maintainer's admin exemption is not an agent exemption.
- Before closing PR-backed work, record the worktree as removed and verified,
  or intentionally preserved with an owner and reason.
- Use [branch-curator](.agents/skills/branch-curator/SKILL.md) for deletion.
  Require exact OIDs, retained heads, clean state, no live owner, and explicit
  scope. A merged squash PR is not retention; a pushed archive tag can be.
  A local status label is not deletion authority; remote deletion remains proposal-only.
- Preserve uncertain or dirty units, foreign locks, and inaccessible paths.
  A chat approval does not expand filesystem access. De-registration is not
  directory deletion, and neither is justified by missing ownership evidence.
- Before release or TestFlight work, reconcile and verify from clean `main`.

Use the existing Git-only secret and attribution hooks. The guarded migration
command is `bash scripts/install-git-hooks.sh --retire-beads`; never replace
safety hooks with an empty path.

## Pull-request Review Standard

A review request is **read-only** unless repairs are separately authorized.
Review the exact `headRefOid`, scoped diff, relevant code paths, mergeability,
all review threads and paginated comments, and current check runs.
Pending, missing, stale, cancelled, or failed checks are incomplete.
Do not edit, push, merge, resolve threads, or change PR state during review.

Use [branch-to-merge](.agents/skills/branch-to-merge/SKILL.md) when authorized
to land work. Preserve exact-head merge guards and human contributor trailers.

## Design System (any UI work)

Read [the design language](docs/coven-design-language.md) before editing a
surface, and walk its section 9 shipping checklist before a UI PR.
The live reference is `/aesthetic`.

For a Claude Design handoff, first read
[implementation status](docs/design-handoff/IMPLEMENTATION-STATUS.md).
Downloaded snapshots can miss live frames. The prototype palette is the
existing token set, not a reason to copy hex values.

| Contract | Canonical source |
| --- | --- |
| Surfaces, spacing, type, radii, motion, and focus | `src/styles/globals/foundations.css` |
| Theme/mode values and palette roster | `src/styles/globals/themes.css`, `src/lib/theme-palettes.ts` |
| Shared CSS and React primitives | `src/styles/globals/primitives.css`, `src/components/ui/` |
| Phosphor icon names and generated subset | `src/lib/icon.tsx`, `scripts/generate-icon-subset.mjs` |

`src/app/globals.css` is an import facade. New gated-surface CSS belongs in a
component-imported sheet, not the global bundle. Reuse existing primitives.

Use defined tokens, on-grid spacing, on-step radii, and semantic state tints.
Run existing codemods before hand-fixing token literals. Keep the design ESLint
gates, `src/lib/design-token-drift.test.ts`, and the undefined-token scan intact.
Baselines ratchet down; a necessary exception needs an explicit justification.
State tints derive from one solid token; use existing danger tokens.

Interactive elements need focus rings. Modals need trapping and focus return.
Mutations need `useAnnouncer()`, motion needs a reduced-motion alternative,
and color cannot be the only signal. Copy follows the design document's
section 10 vocabulary, action, placeholder, and state rules.

## Orchestration-Ready Tasks (any Board or Chart Room work)

Read [the shared task contract](docs/orchestration-ready-tasks.md).
A blocked task carries unresolved dependencies, one named primary blocker,
and one imperative next step. Failed execution synthesizes an execution
dependency rather than taking a weaker path into Blocked.

Enforce this in `cave-board.ts` mutators, not only routes.
`nextStep.requiresApproval` blocks dispatch. Propose changes to human-authored
dependencies and next steps; do not overwrite them. A model's self-reported
confidence is not an application-verifiable admission condition.

## Starting The Tauri Desktop App

Use the native shell for native-only surfaces, permissions, sidecars, terminal,
browser panes, and window behavior:

```bash
bash scripts/dev-app.sh
```

Keep the terminal attached. The wrapper selects `COVEN_CAVE_PORT`, then `PORT`,
then port `3000`; it does not scan for a free port. It attaches only to an
identified Cave server and refuses an unrelated holder. Choose an explicit
different port when necessary.

Cargo compilation is progress, not a hang. The wrapper owns its child tree
and stops it on exit; do not detach it while proving startup. Its origin
watchdog and the in-app recovery overlay handle outages differently.
Use the user's default browser for web-only work, not a Codex browser preview.

Read `CLAUDE.md` for long-running dev-server heap behavior. Prefer production
builds for sustained verification. Do not symlink another worktree's
`node_modules`; restore dependencies only when needed.

## Crediting Contributors

Credit human contributions with the GitHub-linked numeric no-reply form:

```text
Co-authored-by: Full Name <ID+username@users.noreply.github.com>
```

Resolve the ID with `gh api users/<login> --jq .id`. Never use machine or
`.local` emails. Preserve human trailers in the final squash message; a PR-body
mention does not credit the commit. Add substantial external contributors to
`CONTRIBUTORS.md`.

Don't add trailers or footers that credit an AI model, assistant, vendor,
or coding harness.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
