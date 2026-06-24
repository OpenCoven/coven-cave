---
name: context7
description: Use Context7 to fetch current, version-specific docs before writing code against a library.
---

# Context7

Use Context7 to fetch current, version-specific docs before writing code against a library.

## Use When
- Resolve a library to its current docs
- Pull API usage for the installed version
- Avoid stale or hallucinated API calls

## Guardrails
- Match docs to the version actually installed
- Cite the library and version used
- Prefer official docs over generated summaries

## Default Flow

1. Confirm the user intent and whether the action is read-only or state-changing.
2. Use the narrowest available tool scope and collect only the context needed for the task.
3. For state-changing or external actions, stop for explicit approval before acting.
4. Summarize what changed or what was learned, including relevant object IDs or links.
