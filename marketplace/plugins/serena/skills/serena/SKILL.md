---
name: serena
description: Use Serena for symbol-level code navigation and edits instead of dumping whole files into context.
---

# Serena

Use Serena for symbol-level code navigation and edits instead of dumping whole files into context.

## Use When
- Find symbols and references
- Plan precise multi-file edits
- Read project structure semantically

## Guardrails
- Confirm the project root before indexing
- Do not apply edits without approval
- Prefer targeted symbol reads over whole-file dumps

## Default Flow

1. Confirm the user intent and whether the action is read-only or state-changing.
2. Use the narrowest available tool scope and collect only the context needed for the task.
3. For state-changing or external actions, stop for explicit approval before acting.
4. Summarize what changed or what was learned, including relevant object IDs or links.
