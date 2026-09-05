# Review-First Coding Desk Design

**Date:** 2026-09-01

## Goal

Make the Coding Desk a minimal, review-oriented workspace that answers three
questions immediately:

1. Which repository sessions need attention?
2. What changed in the selected session?
3. What is the next useful action?

The default session queue must contain only human-created, active sessions that
are outside familiar workspaces and are attached to a verified GitHub
repository. Other local sessions remain reachable through an explicit
secondary filter.

## Current problems

- `isCodeRailSession()` excludes only archived and generated sessions, so
  rootless folders, non-Git repositories, non-GitHub repositories, and familiar
  workspace sessions can enter the Desk.
- The top bar exposes six equal-weight destinations: Sessions, Work, Activity,
  PRs, Issues, and Reviews. This makes the primary review workflow compete with
  secondary GitHub browsing.
- Session rows optimize for recency and repeat status through both a dot and a
  word, but do not prioritize failures, open pull requests, or changed work.
- The session rail and header picker use related but independently assembled
  lists, making filtering and ordering liable to drift.
- File, review, and terminal panels can all consume space even when they have
  no actionable content.

## Definitions

### Familiar workspace

A path equal to or nested under the configured familiar workspace roots,
including the default `~/.coven/workspaces/familiars/*` tree and relocated
workspace roots from familiar configuration.

Linked Git worktrees are not familiar workspaces. They are valid repository
work and remain eligible.

### Verified GitHub repository session

A session is verified when all of the following are true:

- it is not archived;
- it is not generator-created;
- its project root exists and Git confirms it is inside a work tree;
- its `remote.origin.url` normalizes through `normalizeGitHubRepoUrl()` to
  `https://github.com/{owner}/{repo}`;
- its project root is not inside a familiar workspace.

A non-empty `project_root`, branch name, pull-request URL, or generic Git
context is not sufficient proof by itself.

## Information architecture

The top-level Desk navigation becomes:

- **Review** — the default repository-session queue and selected workbench;
- **Work** — scheduled and queued work;
- **GitHub** — activity, pull requests, issues, and review requests.

The current Activity, PRs, Issues, and Reviews destinations become secondary
filters inside GitHub. Deep links continue to resolve to their equivalent
GitHub filter.

## Session queue

### Modes

The queue has two modes:

- **Reviewable** — default; only verified GitHub repository sessions outside
  familiar workspaces.
- **All local** — explicit opt-in; every current session accepted by the
  existing archived/generated visibility posture.

The mode is shared by the rail and session picker. It is not silently persisted
across devices. Opening the Desk starts in Reviewable mode.

When sessions are excluded, the queue header may show a muted count such as
`7 other local` that switches to All local. Excluded paths and remote URLs are
never exposed in the count or empty state.

### Ordering

Reviewable sessions sort by actionable state before recency:

1. failed;
2. open pull request with changes;
3. running;
4. changed and idle;
5. clean idle.

Rows remain grouped by GitHub repository. Repository groups sort by the highest
priority session they contain, then by newest update. Sessions within a group
use the same priority and recency ordering.

### Row hierarchy

Each compact row contains:

- primary: session title;
- secondary: branch, when attributable to that session;
- trailing signals: pull-request number, diffstat or changed-file count, and
  relative update time;
- one accessible status treatment, not a redundant dot plus status word.

Repository identity belongs in the group heading as `owner/repo`, avoiding
repetition on every row.

## Repository evidence

`SessionGitContext` gains a canonical, optional `repositoryUrl`. Git enrichment
reads `remote.origin.url` through the existing bounded `GitRunner` and accepts
it only after `normalizeGitHubRepoUrl()` succeeds.

The server also classifies familiar-workspace membership from trusted local
configuration and returns a boolean session field. The browser never infers
familiar workspace membership from string fragments or a hard-coded home path.

The pure Coding Desk model derives:

- whether a session is reviewable;
- why it is excluded;
- repository grouping;
- actionable priority;
- Reviewable and All local counts.

This model is the single source used by both the rail and header picker.

## Workbench chrome

- Source remains the visual center.
- The review rail opens automatically only when the selected session has
  changes or a pull request; otherwise it starts as the existing narrow spine.
- The terminal starts as its compact bottom bar and retains the user's explicit
  open state per session.
- Empty review, pull-request, and inspector content does not reserve a full
  column.
- Pane widths continue to use existing resizable primitives and semantic
  tokens.

## Keyboard and focus

- `/` focuses session search when the queue or workbench is active.
- `J` and `K` move through visible sessions while focus is outside text input.
- `Enter` opens the focused session.
- A dedicated shortcut toggles Reviewable and All local.
- Existing deep-link and pending-file navigation still select an otherwise
  excluded session for that navigation only, with an `Outside current filter`
  indicator. Direct navigation must never appear broken because of the default
  filter.

## Empty and degraded states

- No reviewable sessions: `No GitHub repository sessions need review.`
- Git is unavailable or times out: the session is excluded from Reviewable and
  remains available in All local.
- Origin is absent, malformed, credential-bearing, or non-GitHub: exclude from
  Reviewable without rendering the raw remote.
- Familiar workspace classification fails: fail closed for Reviewable and keep
  the session in All local.
- A selected session becomes ineligible after refresh: keep it mounted until
  the user changes selection, then return to the filtered queue.

## Accessibility

- Reviewable and All local use a labeled single-select control with counts.
- Status is conveyed by text and accessible names, not color alone.
- Group headings identify repository boundaries.
- Keyboard navigation follows DOM order and preserves visible focus.
- Compact rows retain the existing minimum pointer target.

## Validation

### Unit coverage

- GitHub and non-GitHub origin normalization;
- familiar workspace exclusion, including relocated roots;
- linked worktree inclusion;
- rootless, missing, archived, and generated exclusions;
- actionable sorting and repository grouping;
- picker and rail parity;
- deep-link override behavior.

### Integration coverage

- the default Desk shows only Reviewable sessions;
- All local reveals excluded sessions without changing global chat visibility;
- GitHub subfilters preserve existing Activity, PR, Issue, and Review behavior;
- narrow layouts remain list-first;
- review rail and terminal defaults respond to selected-session content;
- keyboard search and queue traversal work without stealing text-input keys.

## Non-goals

- Deleting or archiving excluded sessions.
- Treating every Git repository as a GitHub repository.
- Excluding linked Git worktrees.
- Changing global chat session visibility.
- Replacing the existing source, diff, terminal, or GitHub readers.
- Adding a new repository registry or background filesystem crawler.
