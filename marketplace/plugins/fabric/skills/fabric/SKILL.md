---
name: fabric
description: Use Microsoft Fabric MCP for accurate Fabric API context when building against the platform.
---

# Microsoft Fabric

Use Microsoft Fabric MCP for accurate Fabric API context when building against the platform.

## Use When
- Look up Fabric REST API shapes
- Draft Fabric automation accurately
- Confirm current Fabric capabilities

## Guardrails
- Do not change Fabric workspaces without approval
- Treat workspace data as sensitive
- Prefer official API context over guesses

## Default Flow

1. Confirm the user intent and whether the action is read-only or state-changing.
2. Use the narrowest available tool scope and collect only the context needed for the task.
3. For state-changing or external actions, stop for explicit approval before acting.
4. Summarize what changed or what was learned, including relevant object IDs or links.
