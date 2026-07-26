---
name: tavily
description: Use Tavily for fast, agent-friendly web search with concise sourced answers.
---

# Tavily

Use Tavily for fast, agent-friendly web search with concise sourced answers.

## Use When
- Answer a current-events question
- Find primary sources fast
- Gather citations for synthesis

## Guardrails
- Prefer primary sources
- Record URLs used
- Flag uncertainty when sources conflict

## Default Flow

1. Confirm the user intent and whether the action is read-only or state-changing.
2. Use the narrowest available tool scope and collect only the context needed for the task.
3. For state-changing or external actions, stop for explicit approval before acting.
4. Summarize what changed or what was learned, including relevant object IDs or links.
