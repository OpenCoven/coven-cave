---
name: unity
description: Use the Unity MCP bridge to inspect and modify a running Unity project with explicit intent.
---

# Unity

Use the Unity MCP bridge to inspect and modify a running Unity project with explicit intent.

## Use When
- Inspect scene and asset structure
- Apply approved editor changes
- Automate repetitive editor tasks

## Guardrails
- Confirm a running Editor and correct project before acting
- Do not delete assets without approval
- Keep edits scoped to the current task

## Default Flow

1. Confirm the user intent and whether the action is read-only or state-changing.
2. Use the narrowest available tool scope and collect only the context needed for the task.
3. For state-changing or external actions, stop for explicit approval before acting.
4. Summarize what changed or what was learned, including relevant object IDs or links.
