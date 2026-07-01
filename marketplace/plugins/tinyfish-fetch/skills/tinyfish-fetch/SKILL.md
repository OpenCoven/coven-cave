---
name: tinyfish-fetch
description: Verify TINYFISH_API_KEY is set, then POST target URLs to the Fetch API and read rendered content from results[].content.
---

# TinyFish Fetch

Verify TINYFISH_API_KEY is set, then POST target URLs to the Fetch API and read rendered content from results[].content.

## Use When
- Fetch a single URL as clean markdown when a page needs reliable JS rendering
- Fetch multiple URLs in one call or capture a screenshot as base64 PNG
- Route a request through a geo-targeted proxy via proxy_config for country-specific content

## Guardrails
- Run the pre-flight check for TINYFISH_API_KEY and stop to ask the user if it is missing
- Do not fall back to other fetch tools when the key is absent
- Read rendered output only from results[].content, decoding base64 for screenshot format

## Default Flow

1. Confirm the user intent and whether the action is read-only or state-changing.
2. Use the narrowest available tool scope and collect only the context needed for the task.
3. For state-changing or external actions, stop for explicit approval before acting.
4. Summarize what changed or what was learned, including relevant object IDs or links.
