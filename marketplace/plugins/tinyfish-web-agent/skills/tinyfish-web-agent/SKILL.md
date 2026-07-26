---
name: tinyfish-web-agent
description: Verify TINYFISH_API_KEY, then POST a URL and an explicit JSON-shaped goal to the run-sse endpoint, adding stealth or proxy config for protected or geo-restricted sites.
---

# TinyFish Web Agent

Verify TINYFISH_API_KEY, then POST a URL and an explicit JSON-shaped goal to the run-sse endpoint, adding stealth or proxy config for protected or geo-restricted sites.

## Use When
- Extract product info from a page as a well-specified JSON object or array via the run-sse endpoint
- Scrape a bot-protected site by adding browser_profile: stealth to the request body
- Reach a geo-restricted site by routing through a country with a proxy_config block

## Guardrails
- Requires the TINYFISH_API_KEY environment variable; run the pre-flight check and stop to ask the user if it is not set — do not fall back to other tools
- Calls the external TinyFish API over the network against live sites; make separate parallel calls for independent sources rather than one combined prompt
- Always specify the exact JSON structure you want returned so extraction is reliable and machine-readable

## Default Flow

1. Confirm the user intent and whether the action is read-only or state-changing.
2. Use the narrowest available tool scope and collect only the context needed for the task.
3. For state-changing or external actions, stop for explicit approval before acting.
4. Summarize what changed or what was learned, including relevant object IDs or links.
