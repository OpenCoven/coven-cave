---
name: mongodb
description: Use MongoDB MCP for read-first data inspection with approved, scoped writes.
---

# MongoDB

Use MongoDB MCP for read-first data inspection with approved, scoped writes.

## Use When
- List collections and indexes
- Run read-only find/aggregate queries
- Prepare data changes for review

## Guardrails
- Default to read-only; confirm writes and deletes
- Never reveal the connection string
- Scope queries to the smallest dataset needed

## Default Flow

1. Confirm the user intent and whether the action is read-only or state-changing.
2. Use the narrowest available tool scope and collect only the context needed for the task.
3. For state-changing or external actions, stop for explicit approval before acting.
4. Summarize what changed or what was learned, including relevant object IDs or links.
