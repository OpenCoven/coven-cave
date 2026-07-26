---
name: supabase
description: Use Supabase MCP for project inspection and approved changes, preferring read-only first.
---

# Supabase

Use Supabase MCP for project inspection and approved changes, preferring read-only first.

## Use When
- Inspect tables and policies
- Run read-only queries
- Prepare schema or function changes for review

## Guardrails
- Prefer read-only mode; confirm writes and migrations
- Scope to a single project
- Never reveal the access token

## Default Flow

1. Confirm the user intent and whether the action is read-only or state-changing.
2. Use the narrowest available tool scope and collect only the context needed for the task.
3. For state-changing or external actions, stop for explicit approval before acting.
4. Summarize what changed or what was learned, including relevant object IDs or links.
