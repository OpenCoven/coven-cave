---
name: next-devtools
description: Use Next.js DevTools MCP to debug a running Next.js app against its real runtime state.
---

# Next.js DevTools

Use Next.js DevTools MCP to debug a running Next.js app against its real runtime state.

## Use When
- Read build and runtime errors
- Inspect routes and server actions
- Trace logs from the dev server

## Guardrails
- Requires a running Next.js 16+ dev server
- Treat the endpoint as local-only
- Confirm the target project before acting

## Default Flow

1. Confirm the user intent and whether the action is read-only or state-changing.
2. Use the narrowest available tool scope and collect only the context needed for the task.
3. For state-changing or external actions, stop for explicit approval before acting.
4. Summarize what changed or what was learned, including relevant object IDs or links.
