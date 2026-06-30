---
name: sentry
description: Use Sentry to triage and explain errors; never resolve or mutate issues without approval.
---

# Sentry

Use Sentry to triage and explain errors; never resolve or mutate issues without approval.

## Use When
- Find the most frequent unresolved issues
- Read an event's stack trace and breadcrumbs
- Correlate an error spike with a release

## Guardrails
- Do not resolve, ignore, or assign issues without approval
- Avoid leaking PII from event payloads
- Cite issue IDs and permalinks

## Default Flow

1. Confirm the user intent and whether the action is read-only or state-changing.
2. Use the narrowest available tool scope and collect only the context needed for the task.
3. For state-changing or external actions, stop for explicit approval before acting.
4. Summarize what changed or what was learned, including relevant object IDs or links.
