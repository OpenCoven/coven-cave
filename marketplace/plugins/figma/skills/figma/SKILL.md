---
name: figma
description: Use Figma MCP to pull design context and specs into implementation without guessing values.
---

# Figma

Use Figma MCP to pull design context and specs into implementation without guessing values.

## Use When
- Read frame and component structure
- Pull spacing, color, and type tokens
- Translate a design into code

## Guardrails
- Do not edit or publish designs without approval
- Respect file and team permissions
- Confirm the target node before extracting

## Default Flow

1. Confirm the user intent and whether the action is read-only or state-changing.
2. Use the narrowest available tool scope and collect only the context needed for the task.
3. For state-changing or external actions, stop for explicit approval before acting.
4. Summarize what changed or what was learned, including relevant object IDs or links.
