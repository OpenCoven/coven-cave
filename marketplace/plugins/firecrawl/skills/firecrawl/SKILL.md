---
name: firecrawl
description: Use Firecrawl for bounded, structured web extraction with primary-source preference.
---

# Firecrawl

Use Firecrawl for bounded, structured web extraction with primary-source preference.

## Use When
- Scrape a documentation site
- Extract structured fields from pages
- Gather cited research sources

## Guardrails
- Respect site terms and rate limits
- Do not over-quote copyrighted text
- Record source URLs in summaries

## Default Flow

1. Confirm the user intent and whether the action is read-only or state-changing.
2. Use the narrowest available tool scope and collect only the context needed for the task.
3. For state-changing or external actions, stop for explicit approval before acting.
4. Summarize what changed or what was learned, including relevant object IDs or links.
