---
name: tinyfish-browser
description: Verify TINYFISH_API_KEY, create a session over the API, and drive the returned cdp_url with a DevTools-Protocol client.
---

# TinyFish Browser

Verify TINYFISH_API_KEY, create a session over the API, and drive the returned cdp_url with a DevTools-Protocol client.

## Use When
- Create a remote browser session for a target URL and receive session_id, cdp_url, and authenticated base_url
- Connect Playwright or Puppeteer to the cdp_url websocket to drive the page programmatically
- Poll session state through the authenticated base_url using the X-API-Key header

## Guardrails
- Run the pre-flight TINYFISH_API_KEY check first; if unset, stop and ask rather than falling back to other browser tools
- Treat base_url as authenticated (requires X-API-Key) and not browsable in a normal web view
- Reuse sessions keyed by target URL since they auto-close after ~1h idle and there is no terminate endpoint

## Default Flow

1. Confirm the user intent and whether the action is read-only or state-changing.
2. Use the narrowest available tool scope and collect only the context needed for the task.
3. For state-changing or external actions, stop for explicit approval before acting.
4. Summarize what changed or what was learned, including relevant object IDs or links.
