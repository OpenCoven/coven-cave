---
name: board
description: Use the bin/board CLI to add, claim, and complete tasks on BOARD.md rather than editing the file by hand.
---

# BOARD — Shared Task Board

Use the bin/board CLI to add, claim, and complete tasks on BOARD.md rather than editing the file by hand.

## Use When
- Propose a new task with `board add` so the rest of the roster can see it
- Claim or reassign another agent's task with `board claim` before starting work
- Flip a task to done with `board done` and tail recent activity with `board log`

## Guardrails
- Never rewrite the append-only activity log at the bottom of BOARD.md
- Only configured roster agents are valid --agent values; retired identities are rejected
- Substring matches for claim/done must be unique or the CLI exits non-zero; narrow the query and retry

## Default Flow

1. Confirm the user intent and whether the action is read-only or state-changing.
2. Use the narrowest available tool scope and collect only the context needed for the task.
3. For state-changing or external actions, stop for explicit approval before acting.
4. Summarize what changed or what was learned, including relevant object IDs or links.
