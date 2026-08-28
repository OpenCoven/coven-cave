---
name: beads
description: Use when the user asks to manage durable project work with bd or Beads: find ready work, claim or close tasks, create shared follow-up work, inspect dependencies or blockers, recover cross-session context, or choose between local planning and persistent tracking. Do not load merely because a repository uses Beads, or for routine one-turn coding, styling, explanation, or review work that needs no task-tracker operation.
---

# Beads

Use Beads as the shared project task system. Local plans, scratch files, and personal memories are useful, but they are not the durable source of truth for project work.

## When to Load

Load this skill when the current request needs a Beads operation or durable shared task state, including:

- finding, claiming, updating, or closing project work
- creating follow-up work, dependencies, or blocker records
- preserving a handoff or recovering context across sessions
- deciding whether work belongs in local planning or the project tracker

## When Not to Load

Do not load this skill merely because the repository uses Beads. Skip it for routine one-turn implementation, styling, explanation, review, search, or test requests unless the user also needs a task-tracker operation, blocker or dependency management, durable handoff, or context recovery.

Repository workflow may still require running `bd` commands around implementation. Following that workflow does not by itself make Beads expertise part of the user's request.

## First Step

Run:

```bash
bd prime
```

If that prints nothing, check whether the repository has an active Beads workspace:

```bash
bd where
```

## Preferred Route

Use the `bd` CLI when shell access is available. It is the most compact and direct Beads interface.

## Core CLI Workflow

1. Find work:

```bash
bd ready
bd list --status=open
bd list --status=in_progress
```

2. Inspect before editing:

```bash
bd show <id>
```

3. Claim work atomically:

```bash
bd update <id> --claim
```

4. Create durable follow-up work when implementation reveals new tasks:

```bash
bd create "Short title" --description="Why this exists and what needs to be done" --type=task --priority=2
```

5. Close completed work:

```bash
bd close <id> --reason="Completed"
```

## What Belongs In Beads

Use Beads for:

- shared project tasks
- blockers and dependencies
- discovered follow-up work
- work that must survive thread reset, compaction, or handoff
- status that another person or agent should be able to resume

Use agent-local planning tools only for the current turn's execution checklist. Do not treat them as shared project state.

## Rules

- Do not create markdown TODO files as the source of truth when Beads is available.
- Do not use `bd edit`; it opens an interactive editor. Use `bd update` flags instead.
- Prefer `--json` when parsing `bd` output programmatically.
- If hooks are installed, `bd prime` may already be injected. Run it manually when context is missing.
- Do not auto-close or mutate tasks unless the work is actually complete.
