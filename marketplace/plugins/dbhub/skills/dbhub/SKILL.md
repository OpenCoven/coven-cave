---
name: dbhub
description: Use DBHub for read-first database inspection with intentional, approved writes.
---

# DBHub

Use DBHub for read-first database inspection with intentional, approved writes.

## Use When
- Inspect schema
- Run read-only queries
- Prepare migrations for review

## Guardrails
- Default to read-only; confirm before any write or DDL
- Never expose credentials from the DSN
- Scope queries to the smallest dataset needed

## Default Flow

1. Confirm the user intent and whether the action is read-only or state-changing.
2. Use the narrowest available tool scope and collect only the context needed for the task.
3. For state-changing or external actions, stop for explicit approval before acting.
4. Summarize what changed or what was learned, including relevant object IDs or links.
