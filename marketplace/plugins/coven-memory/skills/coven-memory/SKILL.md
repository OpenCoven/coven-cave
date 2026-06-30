---
name: coven-memory
description: Capture durable facts to memory and reference the knowledge vault without leaking secrets.
---

# Coven Memory & Knowledge

Capture durable facts to memory and reference the knowledge vault without leaking secrets.

## Use When
- Save a non-obvious project fact as a memory
- Recall relevant memories before acting
- Add a curated reference to the knowledge vault

## Guardrails
- Never store secrets or credentials in memory or knowledge
- One fact per memory; update rather than duplicate
- Verify a referenced file still exists before recommending it

## Default Flow

1. Confirm the user intent and whether the action is read-only or state-changing.
2. Use the narrowest available tool scope and collect only the context needed for the task.
3. For state-changing or external actions, stop for explicit approval before acting.
4. Summarize what changed or what was learned, including relevant object IDs or links.
