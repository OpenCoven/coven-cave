---
name: notion
description: Use Notion for knowledge lookup and drafting while keeping page edits behind approval.
---

# Notion

Use Notion for knowledge lookup and drafting while keeping page edits behind approval.

## Use When
- Search the workspace
- Summarize pages and databases
- Draft new content for review

## Guardrails
- Do not create, edit, or move pages without approval
- Respect workspace permissions
- Keep private content private by default

## Default Flow

1. Confirm the user intent and whether the action is read-only or state-changing.
2. Use the narrowest available tool scope and collect only the context needed for the task.
3. For state-changing or external actions, stop for explicit approval before acting.
4. Summarize what changed or what was learned, including relevant object IDs or links.
