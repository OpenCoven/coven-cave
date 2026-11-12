# Release train

**Status: Living operational procedure.** The one ordered path for shipping an
update: cut it, validate it, publish it, roll it out, then bring the README and
docs back in line with what shipped.

```bash
pnpm release:train          # where the release stands and what is next
pnpm release:train list     # every phase and the step it covers
pnpm release:train <phase>  # run that phase's check and print the next command
```

The runner keeps no state. It works out the current phase from the stamped
version, the tags, the release-candidate run and the published release, so two
sessions always see the same answer.

It reads Git and GitHub and runs this repository's own verification scripts.
It never tags, pushes, commits or merges. It prints those commands, and the
maintainer runs them. A printed command is not authority to run it: release
tags, merges and each widening of the audience still need the maintainer's
decision at that step.

## The steps

Steps 1 to 10 are the release and candidate sequence in
[Branching](branching.md#release-and-testflight), which holds their full rules.
Steps 11 to 13 are what follows a release.

1. Confirm no open PR is meant for this release.
   `pnpm release:train preflight`
2. Confirm `origin/main` is current, holds every intended commit and is green.
   Same phase; it reports the latest main CI run and any open stamp PR.
3. Create the `release/stamp-vX.Y.Z` worktree from current `origin/main` with
   `git worktree add --no-track`.
   `pnpm release:train stamp --version X.Y.Z` prints the exact command.
4. Preview the stamp, then prepare it from that clean worktree.
   `pnpm release:train stamp --version X.Y.Z`, then again with `--prepare`.
5. Edit the generated changelog, verify, make the signed stamp commit and merge
   it through the protected PR path.
   `pnpm release:train verify --version X.Y.Z`
6. From clean `main` at the stamp merge commit, push a signed, annotated
   `vX.Y.Z-rc.N` tag.
   `pnpm release:train rc` prints the two commands, pinned to the commit.
7. Wait for the `Release candidate` workflow and its `Release candidate
   validated` rollup. A failed candidate is replaced by a higher `rc.N` after
   its fix lands through a PR.
   `pnpm release:train rc` again reports the run.
8. Push the signed, annotated final `vX.Y.Z` tag at the same commit.
   `pnpm release:train final` refuses until the newest candidate is validated.
9. Confirm the published release and its updater manifest, and record the
   build, tags, promoted commit and runs.
   `pnpm release:train publish-check`
10. Before widening the audience, run the three-OS acceptance journey and prove
    a rollback target exists. See [Release Acceptance](release-acceptance.md)
    and [Production Rollout](production-rollout.md).
    `pnpm release:train acceptance`, then
    `pnpm release:train rollout --state <state.json>` for each stage.
11. Recapture the README screenshots from the shipped build.
    `pnpm release:train screenshots`
12. Review the README and the living docs against the shipped product.
    `pnpm release:train docs`
13. Post the handoff record on the release issue.
    `pnpm release:train record`

A release that has shipped a tag has not been rolled out, and a release that
has been rolled out is not finished until steps 11 to 13 are done.

## Step 11: README screenshots

`screenshots/manifest.json` lists every image the README shows: the file, its
alt text, the surface to open and the selector that proves the surface
rendered. `scripts/readme-screenshots.test.mjs` fails when the README and the
manifest disagree, so an image cannot be added to one without the other.

```bash
pnpm build
pnpm screenshots:readme                      # every capture
pnpm screenshots:readme --only home.png      # one capture
pnpm screenshots:readme --origin http://127.0.0.1:3412   # a server you started
```

Without `--origin`, the command starts its own production server on a free
port with an empty temporary home and demo data, captures, and stops that
server. Nothing from the real `~/.coven` can appear in an image. With
`--origin`, the server and its data are yours to vouch for.

Look at every image before committing it. A capture that rendered a loading
state or an empty panel is a failed capture, even when the command exits 0.
To add a README image, add its manifest entry first, then the capture, then the
README line.

## Step 12: docs

`pnpm docs:check` reads `README.md` and every document under the Living heading
of the [documentation index](../README.md). It reports relative links whose
target is gone, backticked source paths that no longer exist, and mentions of
surfaces the product has retired. It always exits 0; pass `--strict` to fail
on any hit.

It is a reading list, not a gate. Fix what is wrong, and leave a deliberate
historical reference alone. When a release retires a surface, add it to
`RETIRED_SURFACES` in `scripts/docs-check.mjs` so later reviews catch stray
mentions, and move the surface's own document to Historical in the index.

The changelog is not part of this step: the stamp in step 4 drafts it and step
5 finalizes it.

## Step 13: the handoff record

`pnpm release:train record` prints a table with what it can observe (version,
promoted commit, candidate tag and run, release URL, acceptance record count)
and marks the rest `not recorded`. Fill those from the evidence, then post the
table on the release issue. Do not write "done" for a row that was not
observed.

## When a phase fails

A phase exits 1 when its check does not pass and says what is missing. Fix the
cause and run the phase again; nothing needs resetting. `pnpm release:train`
shows the phase the release is really in at any time.
