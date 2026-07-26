---
name: apify
description: Use Apify Actors for prebuilt scraping and automation tasks instead of hand-rolling crawlers.
---

# Apify

Use Apify Actors for prebuilt scraping and automation tasks instead of hand-rolling crawlers.

## Use When
- Run a Store actor to extract data
- Automate a repetitive web task
- Collect structured datasets

## Guardrails
- Confirm actor cost and scope before running
- Respect target site terms
- Do not run actors that mutate external state without approval

## Default Flow

1. Confirm the user intent and whether the action is read-only or state-changing.
2. Use the narrowest available tool scope and collect only the context needed for the task.
3. For state-changing or external actions, stop for explicit approval before acting.
4. Summarize what changed or what was learned, including relevant object IDs or links.
