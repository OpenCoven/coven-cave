Scheduled worktree sweep for the coven-cave repository. You are running
unattended from a scheduler, with the primary checkout as your working
directory. Other interactive sessions may be live on this same checkout right
now. Assume nothing; verify everything.

The wiring that launches you is machine-specific and lives outside the repo: a
scheduler entry (launchd on macOS) invoking scripts/worktree-sweep.sh, and on
macOS an app bundle holding the Full Disk Access grant that a scheduled job
needs to read a protected folder. If that grant is missing the sweep aborts
loudly rather than reporting an empty repository as "nothing to retire".

Your job: run the lifecycle patrol and retire ONLY what has genuinely become
cleanup-ready. Preserving a unit that should have been retired costs nothing.
Destroying a unit that was still live is unrecoverable. When those two trade off,
always preserve.

## 1. Assess

- Check GraphQL quota first: `gh api rate_limit --jq .resources.graphql`. If it is
  nearly exhausted, STOP and report — the patrol will exit 1 with an incomplete
  inventory, and an incomplete inventory must never be treated as "nothing to do".
- Run `pnpm beads:worktrees:json` (takes several minutes). Skip the pnpm banner
  before the first `{` when parsing. Each item's `lane` field is the
  classification; `counts` is the tally.

## 2. Decide

- Retire ONLY units in lane `cleanup-ready`.
- Preserve every unit in lane `active`, `cooldown`, `recovery`, `uncertain`, or
  `retire-after-gate`, and state the reason for each in your report.
- Preserve any unit with uncommitted changes or a live process cwd, regardless of
  lane.
- If the patrol reports `ok: false` or any probe warnings, preserve everything and
  report. A degraded inventory is not evidence of retirability.

## 3. Retire via the tool, not by hand

If step 2 found at least one `cleanup-ready` unit, run:

```
pnpm beads:worktrees:apply --allow-unenforced-planes --max-retire 3
```

**Use this path rather than removing worktrees yourself.** Hand-retirement is a
multi-step ritual performed from memory — prove retention, push an archive tag,
unlock, remove, delete the branch, clear the bead's metadata record — and steps
get skipped silently. Measured on 2026-08-10: of five hand-retired units, two
were removed with no archive tag, so their squash-merged commits sat on no ref
at all; and every hand-retirement left the bead's `metadata.coven.worktree`
record behind, which then blocks that bead from ever holding another worktree.
The apply path does retention proof, removal, metadata repair and audit as one
fenced operation, so none of those steps can be forgotten.

`--allow-unenforced-planes` is what makes this reachable while the beads and
github maintenance planes stay unenforced (cave-wqa0b.3/.4, cave-3aqvr). It is
explicit and audited: the run prints `DEGRADED APPLY` on stderr naming each
waived plane before touching anything. Capture that banner in your report.

**The local plane is still enforced and is never waived.** If apply refuses with
`local-acquire-failed: gate-held`, another actor holds the maintenance gate —
that is correct behaviour, not a failure. Report it and stop; do NOT fall back
to hand-retirement to get around it, because the gate is what stops two actors
retiring the same unit.

`--max-retire 3` bounds the blast radius of an unattended run. Do not raise it.

Other refusals to report rather than work around: `gate-incomplete` means the
flag did not reach the command; anything naming the local plane means the
exclusion is unavailable.

- NEVER use WT_GUARD_BYPASS.
- Do NOT delete remote branches. Remote deletion is proposal-only in this repo.
- If something blocks on live processes, identify them
  (`ps -o pid,ppid,etime,command -p <pid>`) and report by pid and command.
  Leftover watcher loops from a dead session are safe to stop; another session's
  live work is NOT.

## 4. Close out

For any retired unit whose work has merged, close its bead with the merge commit
as evidence: `bd close <id> --reason "..."`. Do not close a bead on partial
evidence — if only some of its acceptance criteria landed, leave it open and note
what remains.

## 5. Report

Print: what apply retired (quote its own report rather than paraphrasing), the
DEGRADED APPLY banner naming the waived planes, what was preserved and why,
anything that blocked, and the final worktree count
against the budget — currently 28 worktrees / 38 local branches, raised in PR
#4472. If you retired nothing, say so plainly; with concurrent sessions active,
"nothing was retirable" is the normal and correct outcome, not a failure.
