---
name: azure
description: Use Azure MCP for cloud resource inspection and approved operations via your signed-in Azure context.
---

# Azure MCP Server

Use Azure MCP for cloud resource inspection and approved operations via your signed-in Azure context.

## Use When
- List resources and configs
- Read logs and metrics
- Prepare infrastructure changes for review

## Guardrails
- Do not provision, delete, or change resources without approval
- Treat resource configs as sensitive
- Prefer scoped, subscription-aware queries

## Default Flow

1. Confirm the user intent and whether the action is read-only or state-changing.
2. Use the narrowest available tool scope and collect only the context needed for the task.
3. For state-changing or external actions, stop for explicit approval before acting.
4. Summarize what changed or what was learned, including relevant object IDs or links.
