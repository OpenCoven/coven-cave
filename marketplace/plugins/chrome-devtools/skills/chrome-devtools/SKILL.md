---
name: chrome-devtools
description: Use Chrome DevTools MCP to inspect live pages, network, and performance during debugging.
---

# Chrome DevTools

Use Chrome DevTools MCP to inspect live pages, network, and performance during debugging.

## Use When
- Trace a failing network request
- Profile a slow page
- Inspect DOM and console state

## Guardrails
- Do not interact with authenticated sessions without approval
- Treat captured network data as sensitive
- Close controlled browser instances when done

## Default Flow

1. Confirm the user intent and whether the action is read-only or state-changing.
2. Use the narrowest available tool scope and collect only the context needed for the task.
3. For state-changing or external actions, stop for explicit approval before acting.
4. Summarize what changed or what was learned, including relevant object IDs or links.
