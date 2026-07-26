---
name: azure-devops
description: Use Azure DevOps MCP for planning and review context without silently changing work state.
---

# Azure DevOps

Use Azure DevOps MCP for planning and review context without silently changing work state.

## Use When
- Read work items and pipelines
- Summarize build or release status
- Draft work-item updates

## Guardrails
- Do not create, complete, or reassign work without approval
- Keep status reports dated and concrete
- Respect project-level access boundaries

## Default Flow

1. Confirm the user intent and whether the action is read-only or state-changing.
2. Use the narrowest available tool scope and collect only the context needed for the task.
3. For state-changing or external actions, stop for explicit approval before acting.
4. Summarize what changed or what was learned, including relevant object IDs or links.
