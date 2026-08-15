---
name: beads
description: Use when Beads itself is part of the task: finding, claiming, closing, or creating tracked work; managing blockers or dependencies; recovering shared project context; or deciding between local and durable tracking. Do not load for routine coding, styling, review, or explanation merely because a repository uses bd; follow explicit repository bookkeeping instructions directly unless Beads guidance is needed.
---

# Beads

Use Beads as the shared project task system. Local plans, scratch files, and personal memories are useful, but they are not the durable source of truth for project work.

## When to Load

Load this skill when the request or current decision is about Beads:

- finding, inspecting, claiming, updating, or closing tracked work
- creating durable follow-up work
- managing blockers or issue dependencies
- recovering shared task context after a reset or handoff
- deciding whether work belongs in local planning or persistent project state

## When Not to Load

Do not load this skill for a self-contained coding, styling, review, or
explanation request merely because the repository contains `.beads` or uses
`bd`. If repository instructions already prescribe routine Beads bookkeeping,
follow those instructions directly. Load this skill only when the task needs
Beads-specific guidance or Beads is itself part of the requested outcome.

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
