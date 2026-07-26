---
name: sqlite
description: Query a local SQLite file read-first; confirm before schema or data changes.
---

# SQLite

Query a local SQLite file read-first; confirm before schema or data changes.

## Use When
- List tables and inspect schema
- Run a read-only query
- Summarize row counts and shapes

## Guardrails
- Prefer read-only queries; no writes without approval
- Back up before any schema change
- Bound result sets with LIMIT

## Default Flow

1. Confirm the user intent and whether the action is read-only or state-changing.
2. Use the narrowest available tool scope and collect only the context needed for the task.
3. For state-changing or external actions, stop for explicit approval before acting.
4. Summarize what changed or what was learned, including relevant object IDs or links.
