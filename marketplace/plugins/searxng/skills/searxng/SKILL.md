---
name: searxng
description: Use SearXNG for privacy-respecting web search against a self-chosen instance.
---

# SearXNG Search

Use SearXNG for privacy-respecting web search against a self-chosen instance.

## Use When
- Search without tracking
- Page through results
- Read a result URL's content

## Guardrails
- Use a trusted SearXNG instance
- Record source URLs
- Prefer primary sources

## Default Flow

1. Confirm the user intent and whether the action is read-only or state-changing.
2. Use the narrowest available tool scope and collect only the context needed for the task.
3. For state-changing or external actions, stop for explicit approval before acting.
4. Summarize what changed or what was learned, including relevant object IDs or links.
