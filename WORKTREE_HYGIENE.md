# Coven Cave Local Worktree Hygiene

This is the operator guide for keeping `coven-cave` branches and worktrees small without weakening the repository's existing retention, Beads, PR, or maintenance-plane protections.

The central rule is **reduce checkout state before deleting identity**. A worktree can consume gigabytes while its local branch costs almost nothing. Use thinning first, parking second, and retirement only after the existing lifecycle patrol proves the work has landed and is retained.

## Steady-state targets

These are soft operational targets, not replacements for the repository's existing hard admission budgets.

| Resource | Normal target |
| --- | ---: |
| Branch-attached non-primary worktrees | 10 or fewer |
| Detached scratch worktrees | 2 or fewer |
| Local non-protected branches | 15 or fewer |
| Branch review age | 7 days |
| Detached scratch review age | 24 hours |

The existing lifecycle budgets remain authoritative when creating managed worktrees.

## Daily report

From the primary `coven-cave` checkout:

```bash
node scripts/worktree-hygiene.mjs daily --fetch
```

Machine-readable:

```bash
node scripts/worktree-hygiene.mjs daily --fetch --json
```

`--fetch` performs `git fetch origin --prune`. It does not delete local branches, local tags, or worktrees.

The report combines the network-free `wt:status` verdicts with branch age and approximate per-worktree disk use. `WEDGED` and `SALVAGE` are urgent because they represent paused Git machinery or merged trees that still contain uncommitted data.

## Weekly report

```bash
node scripts/worktree-hygiene.mjs weekly --fetch
```

Weekly mode additionally runs the authoritative worktree lifecycle patrol and the local remote-hygiene audit. Those subreports remain read-only. A GitHub/Beads probe failure is reported as degraded evidence; it never becomes permission to clean up.

## Thin a worktree

Thinning removes only ignored output whose path is also in Cave's canonical disposable-output policy. It refuses a worktree with tracked or untracked changes, or an unfinished merge/rebase/cherry-pick/revert/bisect.

Dry-run:

```bash
node scripts/worktree-hygiene.mjs thin --branch feat/cave-example
```

Apply:

```bash
node scripts/worktree-hygiene.mjs thin --branch feat/cave-example --apply
```

Bounded bulk dry-run:

```bash
node scripts/worktree-hygiene.mjs thin --all-eligible --max 3
```

Bulk apply always requires the explicit `--apply` flag. The maximum is capped at 10.

The disposable set currently mirrors the lifecycle policy for `.next`, `.turbo`, `artifacts`, `coverage`, `dist`, `node_modules`, selected sandbox/generated roots, Rust/Tauri targets, test results, the generated pdf.js worker, and machine-local worktree-hook logs. The safety contract fails if hygiene claims a disposable path that the canonical lifecycle policy no longer recognizes.

## Park a worktree

Parking removes a **clean checkout** but keeps the local branch and its exact remote retention. It is intended for work waiting on CI/review or otherwise inactive but not retired.

Dry-run:

```bash
node scripts/worktree-hygiene.mjs park --branch feat/cave-example
```

Apply:

```bash
node scripts/worktree-hygiene.mjs park --branch feat/cave-example --apply
```

Parking refuses when any of these are true:

- primary, protected, detached, or tool-owned branch;
- unfinished Git operation;
- tracked or untracked change;
- locked worktree;
- exact head is not present on the corresponding remote branch or a pushed remote tag;
- ignored state exists outside the canonical disposable set;
- the network retention probe cannot be completed.

Apply removes disposable ignored output first, runs ordinary `git worktree remove` **without `--force`**, and then verifies that the worktree registration is gone while the local branch still resolves to exactly the original head. It then runs the authoritative lifecycle patrol and requires the parked unit to reappear as a healthy `branch-only` lifecycle unit. If either postcondition fails, the operation attempts to recreate the original worktree.

Parking is deliberately different from retirement: the branch remains. Remote deletion is never part of this command.

## Unpark

Dry-run:

```bash
node scripts/worktree-hygiene.mjs unpark --branch feat/cave-example
```

Apply:

```bash
node scripts/worktree-hygiene.mjs unpark --branch feat/cave-example --apply
```

Unpark requires the local branch to exist, not already be checked out, and still be retained at the exact head by the remote branch or a pushed tag. It restores the checkout under `.worktrees/<branch-slug>` with `--no-track`.

## Automated local reporting on macOS

Install the report-only LaunchAgent from the primary checkout:

```bash
node scripts/worktree-hygiene-schedule.mjs install
```

Status:

```bash
node scripts/worktree-hygiene-schedule.mjs status
```

Remove:

```bash
node scripts/worktree-hygiene-schedule.mjs uninstall
```

The agent runs every day at **19:15 local time**. Sunday runs emit the richer weekly report. Logs are appended to:

```text
~/.coven/logs/cave-worktree-hygiene.log
```

The LaunchAgent intentionally has **no `--apply` path** and no worktree-guard bypass. It may fetch/prune remote-tracking refs for freshness; it never removes a worktree, branch, tag, or ignored output.

## CI automation

`.github/workflows/worktree-hygiene-contract.yml` runs the safety contract on relevant PRs, on pushes to `main`, on manual dispatch, and once weekly. The schedule validates the tooling; GitHub Actions cannot and must not pretend to clean a developer's local worktrees.

The workflow explicitly fails if scheduled-local tooling ever acquires `--apply` or `WT_GUARD_BYPASS`.

## Retirement remains separate

These hygiene tools do **not** replace:

```bash
pnpm beads:worktrees
pnpm beads:worktrees:apply
```

or the archive-tag retention path in `CLAUDE.md`.

A squash-merged PR is not proof that the feature branch's exact commits are retained. Retirement remains exact-OID guarded, remote deletion remains separately authorized, and unattended retirement remains blocked until the repository's maintenance planes are fully enforced.

## Recommended cadence

At the start of a work session:

```bash
node scripts/worktree-hygiene.mjs daily --fetch
```

After a PR merges or closes:

```bash
pnpm beads:worktrees
node scripts/worktree-hygiene.mjs daily --fetch
```

At least weekly:

```bash
node scripts/worktree-hygiene.mjs weekly --fetch
```

Use the sequence:

1. resolve `WEDGED`;
2. inspect every dirty/salvage path;
3. thin large inactive trees;
4. park clean retained checkouts that are waiting;
5. retire only through the existing lifecycle/retention contract;
6. review stale no-PR branches separately from local worktree cleanup.
