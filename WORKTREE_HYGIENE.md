# Coven Cave Local Worktree Hygiene

Keep local checkout state small without weakening ownership, retention, PR,
or maintenance-plane protections. Follow
[GitHub work tracking](docs/workflows/github-work-tracking.md) for issue
ownership, Cave Project 9, worktree creation, and completion.

The central rule is **reduce checkout state before deleting identity**.
A checkout can consume gigabytes while its branch costs little. Thin only
authorized disposable output; retirement needs separate Branch Curator proof.
Parking and unparking are preview-only: no lifecycle proof exists to verify
an apply.

## Steady-state targets

These are soft operational targets, not replacements for the repository's existing hard admission budgets.

| Resource | Normal target |
| --- | ---: |
| Branch-attached non-primary worktrees | 10 or fewer |
| Detached scratch worktrees | 2 or fewer |
| Local non-protected branches | 15 or fewer |
| Branch review age | 7 days |
| Detached scratch review age | 24 hours |

The canonical guide's 28-worktree budget counts the whole checkout, including
the primary worktree. Raw Git does not enforce it. Review ownership and budget
before creation; exceeding a target never authorizes deletion.

## Daily report

From a `coven-cave` checkout you are authorized to inspect:

```bash
node scripts/worktree-hygiene.mjs daily --fetch
```

Machine-readable:

```bash
node scripts/worktree-hygiene.mjs daily --fetch --json
```

`--fetch` performs `git fetch origin --prune`. It does not delete local branches, local tags, or worktrees.

The report combines network-free `wt:status` verdicts, branch age, and
approximate disk use. `WEDGED` and `SALVAGE` need inspection: paused Git
operations and uncommitted data are not permission to abort or remove a unit.
Record dirty paths, not only counts. A local verdict is not an owner or
remote-retention receipt.

## Weekly report

```bash
node scripts/worktree-hygiene.mjs weekly --fetch
```

Current weekly mode adds the read-only remote-hygiene audit, not a lifecycle
patrol. Its report has no retirement authority.

The lifecycle creator, inventory, and patrol were removed with Beads (#5566).
Use `pnpm wt:status` for local evidence and preserve uncertain units.

## Thin a worktree

Thinning removes only ignored output whose path is also in Cave's canonical disposable-output policy. It refuses a worktree with tracked or untracked changes, or an unfinished merge/rebase/cherry-pick/revert/bisect.

Dry-run:

```bash
node scripts/worktree-hygiene.mjs thin --branch feat/issue-123-example
```

Apply:

```bash
node scripts/worktree-hygiene.mjs thin --branch feat/issue-123-example --apply
```

Bounded bulk dry-run:

```bash
node scripts/worktree-hygiene.mjs thin --all-eligible --max 3
```

Bulk apply always requires the explicit `--apply` flag. The maximum is capped at 10.

The disposable set covers `.next`, `.turbo`, `artifacts`, `coverage`, `dist`, `node_modules`, selected sandbox/generated roots, Rust/Tauri targets, test results, the generated pdf.js worker, and machine-local worktree-hook logs.

## Parking and unparking are report-only

Parking's intended distinction is to remove a clean checkout while retaining
the branch. It is not retirement. The current CLI refuses both `park --apply`
and `unpark --apply` before any Git query or tracker operation because no
lifecycle proof exists to verify their postcondition. Do not bypass
that refusal or manufacture metadata to make it pass.

Dry-run proposals remain available:

```bash
node scripts/worktree-hygiene.mjs park --branch feat/issue-123-example
node scripts/worktree-hygiene.mjs unpark --branch feat/issue-123-example
```

Parking proposals still refuse:

- primary, protected, detached, or tool-owned branch;
- unfinished Git operation;
- tracked or untracked change;
- locked worktree;
- exact head is not present on the corresponding remote branch or a pushed remote tag;
- ignored state exists outside the canonical disposable set;
- the network retention probe cannot be completed.

An unpark proposal requires an existing unchecked-out branch, its exact
recorded path, and exact remote retention. A missing path record is a refusal,
not permission to invent one. Neither dry-run proves current ownership or
authorizes mutation. Remote deletion is never part of these commands.

## Automated local reporting on macOS

Install the report-only LaunchAgent only from an authorized checkout with the
current GitHub-only reporter:

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
Repository changes do not update or remove existing machine-specific schedules.
`scripts/worktree-sweep.sh` is a no-side-effect exit-2 tombstone for old external
schedules, not a reporter or retirement entrypoint. Do not reinstall it.

## CI automation

`.github/workflows/worktree-hygiene-contract.yml` runs the safety contract on relevant PRs, on pushes to `main`, on manual dispatch, and once weekly. The schedule validates the tooling; GitHub Actions cannot and must not pretend to clean a developer's local worktrees.

The workflow explicitly fails if scheduled-local tooling ever acquires `--apply` or `WT_GUARD_BYPASS`.

## Retirement remains separate

The old automatic `SessionEnd` retirement hook and `wt:retire-on-exit` shortcut
are removed. `scripts/worktree-session-exit-retirement.mjs` is an exit-2
tombstone for stale registrations: it does not probe status, unlock worktrees,
or remove any checkout or branch, including clean locally merged candidates.

Use [Branch Curator](.agents/skills/branch-curator/SKILL.md) and its complete
[deletion proof](.agents/skills/branch-curator/references/deletion-proof.md).
Require current bounded authorization, the local maintenance lease, clean
state, exact OIDs, retained recovery roots, and fresh owner/runtime evidence.
GitHub assignment and comments are not atomic execution leases.

A squash-merged PR is not retention of the branch's own commits. Verify a
current remote ref, using a pushed archive or retention tag when authorized;
a local-only tag or stale tracking ref does not count. Never force-remove
a worktree, bypass its guard, or override another owner's lock.

Record each unit as removed and verified or intentionally preserved with an
owner and reason on the GitHub issue before completion. Remote deletion
remains proposal-only during routine hygiene. The missing legacy maintenance
planes are not implemented by tracker migration; unattended retirement still
requires the full maintenance gate. Unknown ownership or access means preserve,
not permission to take over.

## Recommended cadence

At the start of a work session:

```bash
node scripts/worktree-hygiene.mjs daily --fetch
```

After a PR merges or closes:

```bash
node scripts/worktree-hygiene.mjs daily --fetch
```

At least weekly:

```bash
node scripts/worktree-hygiene.mjs weekly --fetch
```

Use the sequence:

1. Inspect `WEDGED` state and ownership before any authorized resolution.
2. Record every dirty/salvage path and preserve uncertain units.
3. Thin only authorized disposable output in inactive trees.
4. Keep parking proposals read-only while apply is unavailable.
5. Retire only through Branch Curator's complete proof.
6. Review old no-PR branches separately; age is not deletion evidence.
