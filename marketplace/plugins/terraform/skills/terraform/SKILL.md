---
name: terraform
description: Use Terraform MCP for provider-accurate IaC authoring and read-first workspace inspection.
---

# Terraform

Use Terraform MCP for provider-accurate IaC authoring and read-first workspace inspection.

## Use When
- Look up provider/resource schemas
- Draft accurate Terraform config
- Inspect workspace and run status

## Guardrails
- Do not apply, destroy, or change state without approval
- Treat state and variables as sensitive
- Show plans before any apply

## Default Flow

1. Confirm the user intent and whether the action is read-only or state-changing.
2. Use the narrowest available tool scope and collect only the context needed for the task.
3. For state-changing or external actions, stop for explicit approval before acting.
4. Summarize what changed or what was learned, including relevant object IDs or links.
