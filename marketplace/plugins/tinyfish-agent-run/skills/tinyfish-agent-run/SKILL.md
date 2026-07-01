---
name: tinyfish-agent-run
description: Verify TINYFISH_API_KEY is set, run scripts/agent-run.sh <url> <goal>, and parse the streamed JSON events for live progress and the final result payload.
---

# TinyFish Agent Run

Verify TINYFISH_API_KEY is set, run scripts/agent-run.sh <url> <goal>, and parse the streamed JSON events for live progress and the final result payload.

## Use When
- Execute an autonomous browsing goal like extracting the first product names and prices from a shop URL and return JSON
- Render each PROGRESS.purpose as a live status line and surface navigation targets to an embedded browser view
- Parse the COMPLETE event's result field for the final structured payload once the run finishes

## Guardrails
- Requires the TINYFISH_API_KEY environment variable; run the pre-flight check and stop to ask the user if it is not set
- Calls the external TinyFish agent API over the network, so goals run against live sites — scope them tightly
- Do not fall back to other tools when the key is missing — the task requires TinyFish

## Default Flow

1. Confirm the user intent and whether the action is read-only or state-changing.
2. Use the narrowest available tool scope and collect only the context needed for the task.
3. For state-changing or external actions, stop for explicit approval before acting.
4. Summarize what changed or what was learned, including relevant object IDs or links.
