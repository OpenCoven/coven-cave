---
name: slack
description: Use Slack read-first; never post, react, or DM without explicit approval.
---

# Slack

Use Slack read-first; never post, react, or DM without explicit approval.

## Use When
- Search channel history for context
- Summarize a thread
- Post an approved status update

## Guardrails
- Do not post, react, or DM without approval
- Preserve exact approved text when posting
- Record message timestamps/permalinks

## Default Flow

1. Confirm the user intent and whether the action is read-only or state-changing.
2. Use the narrowest available tool scope and collect only the context needed for the task.
3. For state-changing or external actions, stop for explicit approval before acting.
4. Summarize what changed or what was learned, including relevant object IDs or links.
