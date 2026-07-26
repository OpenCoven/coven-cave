---
name: memory-timeline-manager
description: Route notes to memory/YYYY-MM-DD.md or MEMORY.md, promote durable snippets with timestamps, and prune only after confirmation.
---

# Memory Timeline Manager

Route notes to memory/YYYY-MM-DD.md or MEMORY.md, promote durable snippets with timestamps, and prune only after confirmation.

## Use When
- Append a concise timeline bullet to today's memory/YYYY-MM-DD.md, creating the dated file if missing
- Promote a durable snippet into MEMORY.md under a timestamped heading via promote_snippet.py
- Run a weekly review sweep to identify durable items and mark stale notes as archive or delete-candidate

## Guardrails
- Only write to MEMORY.md and memory/*.md unless the user explicitly asks otherwise
- Prefer additive edits and create a dated backup in memory/ before uncertain or large changes
- Ask for confirmation before deleting or bulk-pruning memory files

## Default Flow

1. Confirm the user intent and whether the action is read-only or state-changing.
2. Use the narrowest available tool scope and collect only the context needed for the task.
3. For state-changing or external actions, stop for explicit approval before acting.
4. Summarize what changed or what was learned, including relevant object IDs or links.
