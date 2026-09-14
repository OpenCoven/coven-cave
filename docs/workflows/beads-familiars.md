# Beads development workflow: retired

**Status: Tombstone, 2026-09-14.** Issue #5399 replaces Beads development
tracking with [GitHub Issues and the Cave Project](github-work-tracking.md).
That guide owns discovery, ownership, worktrees, PRs, and handoff.

Do not run `bd`, prime a session, claim or close a Bead, or sync Dolt to work
on this repository. The old `beads:*` package shortcuts and automatic context
hooks are retired. Preserve legacy data and links rather than maintaining a
second queue or bulk-importing old records.

## Historical records

See the [frozen remaining-record inventory](../legacy/beads-remaining-2026-09-14.md)
for the one-time notation of the embedded store, with capture limitations.

`.beads/issues.jsonl` is an export, not the sync protocol or the current queue.
The retirement inventory must name its source, observation time, and coverage.
Historical owners and statuses are not evidence of live execution.

Preserve `.beads/`, sync refs, IDs, dependencies, and external references.
When intentionally resuming one old outcome, reuse its GitHub issue or create
one scoped authorized issue with the legacy ID. Do not mutate the old graph.
Keep preserved exports public-scrubbed before committing: no private
transcripts, personal machine paths, local actor emails, or secrets.

## Optional application compatibility

The existing `/api/beads` and `/api/beads/prs` adapters and
`src/lib/beads-work-queue.ts` remain compatibility code in this slice.
The optional Familiar Work Queue is not the new development queue.
Using its Beads actions can still invoke the installed Beads CLI; the workflow
retirement is not a claim that the application adapter was removed.

Keep the local-origin/path guards, bounded mutation bodies, argv-safe command
adapter, and independent API contracts. An application integration must not
reinterpret the passive export as live state.

Old migration/recovery utilities and plans remain historical evidence, not
instructions to run a parallel tracker. No secrets belong in legacy record
text, new GitHub issues, or handoff comments.
