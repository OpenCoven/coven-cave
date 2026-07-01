---
name: tinyfish-search
description: Call the TinyFish Search API (or scripts/search.sh) to fetch ranked, structured web results ready for LLM consumption.
---

# TinyFish Search

Call the TinyFish Search API (or scripts/search.sh) to fetch ranked, structured web results ready for LLM consumption.

## Use When
- Run a basic web search and consume the results[] array directly to cite or open sources
- Target a specific country and language with location and language parameters
- Wrap searches with scripts/search.sh for quick queries with optional --location/--language

## Guardrails
- Requires TINYFISH_API_KEY; run the pre-flight check and stop to ask the user if it is unset
- Do not fall back to other search tools when the key is missing
- Pass the key via the X-API-Key header only to the TinyFish endpoint

## Default Flow

1. Confirm the user intent and whether the action is read-only or state-changing.
2. Use the narrowest available tool scope and collect only the context needed for the task.
3. For state-changing or external actions, stop for explicit approval before acting.
4. Summarize what changed or what was learned, including relevant object IDs or links.
