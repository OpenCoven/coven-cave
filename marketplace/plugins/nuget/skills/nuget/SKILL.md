---
name: nuget
description: Use NuGet MCP for current package versions and vulnerability-aware dependency choices.
---

# NuGet

Use NuGet MCP for current package versions and vulnerability-aware dependency choices.

## Use When
- Check latest package versions
- Plan dependency upgrades
- Review packages for known vulnerabilities

## Guardrails
- Requires the .NET 10 SDK (provides the dnx command)
- Confirm before changing project dependencies
- Prefer fixed, current versions
- Flag supply-chain risks explicitly

## Default Flow

1. Confirm the user intent and whether the action is read-only or state-changing.
2. Use the narrowest available tool scope and collect only the context needed for the task.
3. For state-changing or external actions, stop for explicit approval before acting.
4. Summarize what changed or what was learned, including relevant object IDs or links.
