---
name: desktop-commander
description: Use Desktop Commander for local shell and file work with explicit, narrow intent.
---

# Desktop Commander

Use Desktop Commander for local shell and file work with explicit, narrow intent.

## Use When
- Run scoped local commands
- Edit or move local files
- Inspect running processes

## Guardrails
- Confirm before destructive commands or deletes
- Use the narrowest path scope
- Never run commands that exfiltrate secrets

## Default Flow

1. Confirm the user intent and whether the action is read-only or state-changing.
2. Use the narrowest available tool scope and collect only the context needed for the task.
3. For state-changing or external actions, stop for explicit approval before acting.
4. Summarize what changed or what was learned, including relevant object IDs or links.
