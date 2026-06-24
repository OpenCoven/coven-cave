---
name: stackql
description: Use StackQL for SQL-native cloud inspection, preferring read-only queries before provisioning.
---

# StackQL

Use StackQL for SQL-native cloud inspection, preferring read-only queries before provisioning.

## Use When
- Query cloud resources with SQL
- Audit configuration across providers
- Prepare provisioning for review

## Guardrails
- Default to read-only SELECTs; confirm any provisioning or mutation
- Never expose provider credentials
- Scope queries to the smallest provider/account needed

## Default Flow

1. Confirm the user intent and whether the action is read-only or state-changing.
2. Use the narrowest available tool scope and collect only the context needed for the task.
3. For state-changing or external actions, stop for explicit approval before acting.
4. Summarize what changed or what was learned, including relevant object IDs or links.
