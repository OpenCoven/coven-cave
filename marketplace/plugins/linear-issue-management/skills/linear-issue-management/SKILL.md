---
name: linear-issue-management
description: Discover exact team/project/label/state IDs and search for duplicates before executing one focused GraphQL mutation.
---

# Linear Issue Management

Discover exact team/project/label/state IDs and search for duplicates before executing one focused GraphQL mutation.

## Use When
- Create a well-structured issue after confirming teamId and searching existing issues to avoid duplicates
- Resolve mutually-exclusive grouped labels (e.g. Infra vs Improvement) before a create or update mutation
- Additively update or search an existing issue by key, URL slug, or title keywords and return its key and URL

## Guardrails
- Never print, log, or commit the Linear API token; inject it via 1Password-backed env instead of files
- Discover IDs from the API rather than guessing from memory, and use GraphQL variables not string interpolation
- Treat mutations as external state changes needing approval unless the user gave a direct instruction

## Default Flow

1. Confirm the user intent and whether the action is read-only or state-changing.
2. Use the narrowest available tool scope and collect only the context needed for the task.
3. For state-changing or external actions, stop for explicit approval before acting.
4. Summarize what changed or what was learned, including relevant object IDs or links.
