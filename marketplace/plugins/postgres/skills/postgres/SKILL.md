---
name: postgres
description: Query Postgres read-only for analysis; never mutate data without explicit approval.
---

# PostgreSQL

Query Postgres read-only for analysis; never mutate data without explicit approval.

## Use When
- Inspect schema and table shapes
- Run read-only analytical queries
- Explain a slow query plan

## Guardrails
- Prefer read-only queries; no writes without approval
- Never expose connection credentials
- Bound result sets with LIMIT

## Default Flow

1. Confirm the user intent and whether the action is read-only or state-changing.
2. Use the narrowest available tool scope and collect only the context needed for the task.
3. For state-changing or external actions, stop for explicit approval before acting.
4. Summarize what changed or what was learned, including relevant object IDs or links.
