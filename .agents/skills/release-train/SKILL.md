---
name: release-train
description: Use when asked to ship, cut, release, roll out or "roll" a Coven Cave update, to check where a release stands, or to refresh the README screenshots or docs after a release. Walks the ordered release runbook through `pnpm release:train`. It reports and verifies; tags, merges and audience widening stay the maintainer's.
---

# Release Train

One ordered path for shipping an update. The runbook is
`docs/workflows/release-train.md`; steps 1 to 10 keep their full rules in
`docs/workflows/branching.md`. This is an operational procedure, not release
authority.

## Start from the facts

```bash
pnpm release:train        # where the release stands, and the next phase
pnpm release:train list   # every phase and its runbook step
```

Never keep your own cursor. The runner derives the phase from the stamped
version, the tags, the release-candidate run and the published release. If
your memory and its answer differ, its answer is current.

Load [work-continuity](../work-continuity/SKILL.md) first: another session may
already hold the stamp worktree or an open stamp PR. `preflight` reports an
open stamp PR; do not start a second one.

## Walk the phases

Run each phase, read its output, and do only what it and the current request
authorize.

| Phase | Step | You may do | Needs the maintainer's go-ahead |
| --- | --- | --- | --- |
| `preflight` | 1, 2 | Read open PRs, main's head and CI | Deciding which PRs ship |
| `stamp` | 3, 4 | Preview; prepare in the stamp worktree | Creating the worktree over budget |
| `verify` | 5 | Run both verifiers, edit the changelog | Commit, push, stamp PR, merge |
| `rc` | 6, 7 | Read the candidate run | Pushing the `rc.N` tag |
| `final` | 8 | Confirm the candidate is validated | Pushing the final tag |
| `publish-check` | 9 | Verify the updater manifest | Re-running release jobs |
| `acceptance` | 10 | Validate acceptance records | The journey itself, on three OSes |
| `rollout` | 10 | Run the gate on a state file | Widening or rolling back |
| `screenshots` | 11 | Capture, inspect, open a PR | Merging it |
| `docs` | 12 | Fix stale docs, open a PR | Merging it |
| `record` | 13 | Print and fill the record | Posting it, if not yet authorized |

The runner prints `git tag` and `git push` commands. It never runs them, and
neither do you without an explicit request for that exact tag. A printed
command, an earlier approval or a green check is not that request.

A failing phase exits 1 and names what is missing. Fix the cause and rerun the
phase. Do not skip ahead, and do not replace a failed candidate tag: land the
fix through a PR and tag the next `rc.N`.

## After the release

Steps 11 to 13 are part of the release, not optional cleanup.

- **Screenshots:** `pnpm build`, then `pnpm screenshots:readme`. It starts its
  own server on an empty home and serves synthetic fixtures. Open every image.
  A loading state, an empty panel or a toast over the content is a failed
  capture even when the command exits 0. Never capture against a real
  `~/.coven`.
- **Docs:** `pnpm docs:check` is a reading list, not a gate. Fix what is
  wrong; leave deliberate history. When the release retired a surface, add it
  to `RETIRED_SURFACES` in `scripts/docs-check.mjs`.
- **Record:** fill only rows you observed. `not recorded` is an honest value.

Screenshot and docs changes land through one PR on an issue-owned branch, like
any other change.

## Report

State the version, the phase reached, what you ran and its result, what you
did not run, and the one next step with who must take it. Keep delivered,
locally verified and device-verified evidence separate.
