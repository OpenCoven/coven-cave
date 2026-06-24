---
name: playwright
description: Use Playwright to navigate and verify web pages through the accessibility tree, not screenshots alone.
---

# Playwright

Use Playwright to navigate and verify web pages through the accessibility tree, not screenshots alone.

## Use When
- Reproduce a UI bug in a browser
- Extract structured data from a page
- Verify a deployed change end to end

## Guardrails
- Do not submit forms or trigger payments without approval
- Respect site terms and robots rules
- Avoid logging into accounts without explicit consent

## Default Flow

1. Confirm the user intent and whether the action is read-only or state-changing.
2. Use the narrowest available tool scope and collect only the context needed for the task.
3. For state-changing or external actions, stop for explicit approval before acting.
4. Summarize what changed or what was learned, including relevant object IDs or links.
