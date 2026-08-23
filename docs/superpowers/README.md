# Approved specs and plans

Beads cite files here as the authoritative approved design for a piece of work.
`specs/` holds the design; `plans/` holds the implementation plan derived from
it.

## These are point-in-time records

Each document describes the repository **as it was on the date in its
filename**. Read the design and the requirements as authoritative; read the
operational details as history.

In particular, do not follow these as live runbooks:

- **Required-check lists.** Several plans list `CodeQL` among the required
  status checks. That was true when they were written; CodeQL was retired on
  2026-07-31 (cave-yp21x). `CLAUDE.md` carries the current list.
- **Absolute paths.** Some plans hard-code a machine-local checkout or worktree
  path such as `/Users/<someone>/…/coven-cave/.worktrees/<branch>`. Those were
  the author's paths, not portable instructions. Everything is repo-relative
  from your own checkout root.
- **Branch and worktree names.** Named branches and worktrees in these plans are
  long since merged, renamed, or deleted.

They have deliberately not been rewritten. A plan is a record of what was
approved and how it was carried out; editing it later to match today's
repository would make it a worse record, not a better one.

## Why this directory is versioned

It was previously listed in `.gitignore`, so `git add` dropped new files here
silently — no error, no untracked-file noise. Beads went on citing paths under
it as durable while the files existed only on the authoring machine.

**Four approved designs were lost that way** before anyone noticed, and one of
them (cave-21rp) lost its implementation branch too, leaving a bead that read
"approved design and plan, in progress" while sitting at zero.

What made it easy to miss: 27 files here were already tracked because they
predate the ignore rule, and tracked files stay tracked regardless. The
directory looked versioned while every new file was discarded.

Fixed in cave-8zjr5. `/.superpowers` — the tool's scratch directory, a
different thing — remains ignored.

## Durability

Committing a design here makes it survive the authoring machine, which is what
this directory is for. It does not make it survive a checkout that is never
pushed. If a design matters, get it onto `origin`, and consider also pasting it
into the bead's `DESIGN` field, which syncs through Dolt independently of git.

Approval is the durability boundary. Once a spec or plan is approved, land it
on `main` through a docs-only PR even if its implementation is deferred,
reworked, or abandoned. A Bead may cite an approved design only by a path that
resolves on `main`.

Archive tags remain valuable recovery evidence, but they are not the canonical
home of an approved design: a reader should not need to discover a retired
branch name before they can open the document that governs active work.
