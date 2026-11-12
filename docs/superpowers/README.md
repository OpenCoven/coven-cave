# Approved specs and plans

GitHub issues cite approved designs here. `specs/` holds the design; `plans/` holds the implementation plan derived from it. Use [GitHub work tracking](../workflows/github-work-tracking.md) for current ownership, execution and delivery.

## These are point-in-time records

Each document describes the repository **as it was on the date in its filename**. Preserve its original design intent and requirements, then read the current issue and newer explicit decisions to determine which parts remain active. A dated plan does not establish current operation-specific authority, ownership or completion.

In particular, do not follow these as live runbooks:

- **Required-check lists.** Historical required contexts and CodeQL policy can differ from current configuration. Refresh branch protection, the exact-head check results and [CLAUDE.md](../../CLAUDE.md); do not treat a dated list or an earlier-head pass as the current gate.
- **Absolute paths.** Some plans hard-code a machine-local checkout or worktree
  path such as `/Users/<someone>/…/coven-cave/.worktrees/<branch>`. Those were
  the author's paths, not portable instructions. Everything is repo-relative
  from your own checkout root.
- **Branch and worktree names.** Named branches and worktrees in these plans are
  long since merged, renamed, or deleted.

Keep the original implementation sequence as history. Correct status annotations and supersession links when needed, without rewriting the approved design into a claim about what shipped. In particular, old Beads repair commands, automatic retirement hooks and recency windows do not override current [branch-curator](../../.agents/skills/branch-curator/SKILL.md) or [worktree policy](../workflows/github-work-tracking.md#worktrees).

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

Committing a design here makes it recoverable in that checkout. Durable approved documents must reach `origin/main` through the protected PR workflow and be linked from the canonical GitHub issue. Beads and Dolt references in older records describe the former tracker; do not recreate that metadata or rely on it as a second durability channel.

Approval is the durability boundary. Once a spec or plan is approved, land it on `main` through a docs-only PR even if its implementation is deferred, reworked or abandoned. Cite the path that resolves on `main`; a published plan is not proof of implementation, acceptance or release.

Archive tags remain valuable recovery evidence, but they are not the canonical
home of an approved design: a reader should not need to discover a retired
branch name before they can open the document that governs active work.
