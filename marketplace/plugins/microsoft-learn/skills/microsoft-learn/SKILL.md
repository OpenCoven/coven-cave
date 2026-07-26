---
name: microsoft-learn
description: Use Microsoft Learn MCP for authoritative, current Microsoft/Azure documentation.
---

# Microsoft Learn

Use Microsoft Learn MCP for authoritative, current Microsoft/Azure documentation.

## Use When
- Look up Azure or .NET docs
- Confirm current API guidance
- Cite official Microsoft sources

## Guardrails
- Prefer official docs over generated summaries
- Cite the page used
- Match guidance to the relevant product version

## Default Flow

1. Confirm the user intent and whether the action is read-only or state-changing.
2. Use the narrowest available tool scope and collect only the context needed for the task.
3. For state-changing or external actions, stop for explicit approval before acting.
4. Summarize what changed or what was learned, including relevant object IDs or links.
