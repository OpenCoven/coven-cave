---
name: activepieces
description: Use Activepieces to invoke prebuilt integrations and flows instead of wiring each API by hand.
---

# Activepieces

Use Activepieces to invoke prebuilt integrations and flows instead of wiring each API by hand.

## Use When
- Trigger an automation flow
- Use a Store piece as a tool
- Connect SaaS apps through one MCP endpoint

## Guardrails
- Confirm scope and side effects before running a flow
- Do not move data between systems without approval
- Keep the tokenized MCP URL secret

## Default Flow

1. Confirm the user intent and whether the action is read-only or state-changing.
2. Use the narrowest available tool scope and collect only the context needed for the task.
3. For state-changing or external actions, stop for explicit approval before acting.
4. Summarize what changed or what was learned, including relevant object IDs or links.
