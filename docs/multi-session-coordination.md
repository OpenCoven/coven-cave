# Multi-session coordination — cross-session signal

When two or more Claude Code sessions are working in the same repo at the same
time, they can produce overlapping or wasted work without ever colliding at the
git level. This doc names the failure modes, explains why the cheap ones are
caught and the costly ones aren't, and lists the signals that would actually
shrink the costly category.

## The two outcomes of shared-surface contention

When two sessions touch the same surface, their work ends up in one of two
buckets. Only one of them is currently caught.

### Duplicate work (cheap — git catches it)

Two sessions independently write the same fix.

- Git detects identical patches at merge/push time.
- "Already up-to-date" or merge conflict surfaces the collision.
- Worst case: a `chore(cleanup)` commit lands twice on the same branch under
  the same name (e.g. `#65`/`#73` both titled `fix(nav): … remove unused
  GroupMode`, same branch, identical 1806-byte diff, 9h apart). Even then the
  damage is bounded — wasted review cycles, no broken behavior.

In practice this is rare in this repo. When the historical search turned up
near-duplicate commits, most were rebase-replay artifacts: the same logical
commit (same `author_date`, different `commit_date` and parent) lands on `main`
twice via two merge resolutions. That isn't duplicate authorship; it's the
same patch counted twice.

### Orphaned work (expensive — nothing catches it)

Session A polishes a surface; Session B replaces or removes that surface
upstream without knowing. A's work lands, builds clean, ships, and dies within
the hour.

The canonical example (2026-06-08 / 09 evening):

```
23:20  #305 lands — polishes sessions-view.tsx (+286 lines incl. tests)
23:58  ced714c    — ChatSurface drops the SessionsView fallback
00:30  14466de    — sessions-view.tsx, .css, polish test all deleted (-2132)
```

PR #305 lived for ~70 minutes. The polish ideas may have informed the
ChatList direction, but the actual code is gone from `main`. The author of the
deletion knew — they explicitly named "the chat-polish test that targeted only
SessionsView internals" as something to drop, meaning they were aware they
were reverting just-merged work.

Both sessions did locally-valid work. Neither did the other's work. The waste
isn't redundancy; it's misallocation.

## Why duplicate is caught but orphaned isn't

Duplicate work lives in the *codebase*. Two diffs against the same lines
collide at commit/push time, and git refuses to silently lose data.

Orphaned work lives in *intent*. "Session B is about to delete this surface"
exists only in Session B's running context — never in the file tree, never in
the index, never in `git status`. Session A's diff against the soon-to-be-
dead file passes typecheck, passes the suite, builds clean, and ships. There
is no point in the standard developer loop where the fact of impending
removal becomes visible.

This means orphaned-work prevention can't be retrofitted via git or CI alone.
The signal has to live somewhere both sessions check before committing to a
direction.

## Signals that would actually help

Listed cheapest first.

### 1. Surface-claim file — `.claude/claims.json` ✅ IMPLEMENTED

**Status:** Built as an automatic PreToolUse hook —
`scripts/surface-claim-guard.mjs`, wired in `.claude/settings.json` (matcher
`Edit|Write|NotebookEdit`). It removes the "nothing forces sessions to write
claims" fragility below: claims are now a *byproduct* of editing, requiring zero
discipline.

On every Edit/Write to the **shared primary checkout**, the hook:
- records this session's claim on the target file (keyed by `session_id`);
- prunes claims with no activity in the last ~2h;
- if another live session already claimed that exact file, surfaces a collision
  warning to both the user (`systemMessage`) and the model
  (`hookSpecificOutput.additionalContext`).

It is **advisory only** — it never blocks or fails an edit (always exits 0, even
on corrupt input). Edits inside `.worktrees/` are skipped: those sessions are
already isolated, and their divergence surfaces at PR/merge time (see §2). The
warning fires for the *second* session to touch a file — exactly the moment a
clobber would otherwise happen silently. Covered by
`scripts/surface-claim-guard.test.mjs`.

---

A flat file recording "Session X has begun work touching surfaces Y and Z."
Updated when a session starts a non-trivial task on a surface; cleared on
session exit or when the task lands.

```jsonc
{
  "ttys029": {
    "started": "2026-06-08T23:24Z",
    "surfaces": ["src/components/inbox-escalations-view.tsx"],
    "intent": "feat: severity rails + filter chips + bulk actions"
  },
  "ttys044": {
    "started": "2026-06-08T23:55Z",
    "surfaces": ["src/components/chat-surface.tsx", "src/components/sessions-view.tsx"],
    "intent": "refactor: dedupe to single chat list, then delete SessionsView"
  }
}
```

Before starting work on a surface, a session greps claims for collisions.
Before committing, a session re-checks for surface overlap and surfaces the
collision to the user.

Fragile because: nothing forces sessions to write claims, claims go stale, and
the file becomes another source of merge conflict if checked in. Mitigations:
keep it gitignored (so it doesn't conflict), expire entries older than ~2
hours, and treat the absence of a claim as "no claim made" rather than "no
work in progress."

This is the cheapest first move and the most likely to actually get adopted.

### 2. Worktree-per-session as default, not exception

CLAUDE.md already documents the worktree convention. The orphaned-work case
above happened on the *primary checkout* with 5+ sessions sharing it. If each
session had its own `.worktrees/<branch>` from the start, they'd still have
been writing to the same `main` eventually — but the divergence would have
surfaced at the merge/PR moment, not at the silent deletion moment.

Worktrees don't prevent orphaning; they make it visible earlier. A `gh pr
create` for a worktree's branch surfaces the diff against current `main`
*before* merging, which is the first moment another session's deletion would
show up as a conflict or a stale-context warning.

### 3. Intent-tagged commits with sentinel-style assertions

The `sidebar-minimal.test.ts` update in PR #298 is a good pattern: when
removing a surface, leave a *negative-import sentinel* test that asserts the
file isn't reintroduced. Future sessions running the suite see the assertion
break the moment they recreate the surface — even if they don't read commit
history. This works *after* the orphaning has happened but at least prevents
re-orphaning the same surface twice.

Companion to this: when adding a new surface that's likely to be touched by
parallel sessions (large component, IA-load-bearing), drop a positive-import
sentinel in the same test that says "X must still be the consumer of Y" so
that someone removing Y notices Y has a known consumer.

### 4. Pre-commit broadcast (expensive, rarely justified)

A pre-commit hook that pings a shared file/socket announcing "session X is
about to commit Y" and waits N seconds for objections. Catches the most
adversarial cases but adds latency to every commit and forces network/IPC
plumbing. Mention here for completeness; don't build it unless the cheaper
options have demonstrably failed.

## Practical recommendations for sessions

Until any of the above is built, sessions should:

1. **Check live sessions before non-trivial work.** `ps -ef | grep ' claude --'`
   plus `lsof -p <pid> | awk '$4=="cwd"'` shows who's where. Five sessions in
   one cwd is the smell.

2. **Diagnose before risky git operations.** Already in CLAUDE.md, but worth
   re-emphasising: rebases, cherry-picks, and `reset --hard` on a shared
   checkout race with concurrent work. The 2026-06-08 incident where another
   session's `reset --hard` wiped uncommitted edits is the canonical example.

3. **When polishing a surface, briefly check `git log -p` on its consumers.**
   If the consumer's recent history shows it's being decoupled from your
   surface, your polish may be about to be orphaned. A 30-second check, not a
   full audit.

4. **Surface intent to the user when starting structural work.** "I'm about to
   delete SessionsView" is the kind of statement that, if surfaced to the
   user, gives them a chance to say "wait, another session is polishing
   that." The user is the only entity with cross-session visibility today.

5. **Prefer worktrees for any task that involves more than three file edits**
   or any structural change. The worktree itself is a cheap signal —
   `git worktree list` is one of the only places where "Session B is working
   on branch C" is visible to Session A.

## Open questions

- Is `.claude/claims.json` worth prototyping, or does worktree-as-default
  cover enough of the gap?
- Does any of this generalise beyond Claude Code? The same failure mode
  could exist for human pair-programming sessions sharing one checkout, but
  humans usually have a Slack channel.
- The user is currently the cross-session bridge by hand ("session A is
  doing X, session B is doing Y"). Does any of this make their job easier
  or just relocate the bookkeeping?

## Source

Patterns observed via `git log` on `origin/main` over the 2026-05-30 →
2026-06-09 window. The orphaning case (PR #305 → `14466de`) is reconstructable
from commits alone; the duplicate-work false positives required diffing
`author_date` vs `commit_date` on near-duplicate subjects. No prior cross-
session coordination doc existed in this repo when this was written.
