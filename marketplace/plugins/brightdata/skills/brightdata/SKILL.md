---
name: brightdata
description: Use Bright Data for resilient large-scale web extraction with respect for source policies.
---

# Bright Data

Use Bright Data for resilient large-scale web extraction with respect for source policies.

## Use When
- Search and extract web data
- Navigate sites that block naive scrapers
- Collect market or competitive data

## Guardrails
- Respect site terms and legal limits
- Do not collect personal data without basis
- Record sources and extraction scope

## Default Flow

1. Confirm the user intent and whether the action is read-only or state-changing.
2. Use the narrowest available tool scope and collect only the context needed for the task.
3. For state-changing or external actions, stop for explicit approval before acting.
4. Summarize what changed or what was learned, including relevant object IDs or links.
