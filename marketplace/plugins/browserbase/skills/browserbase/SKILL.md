---
name: browserbase
description: Automate cloud browsers carefully; never submit forms or auth without approval.
---

# Browserbase

Automate cloud browsers carefully; never submit forms or auth without approval.

## Use When
- Navigate and extract page content
- Run an end-to-end flow check
- Capture a screenshot of a rendered page

## Guardrails
- Do not submit forms or log in without approval
- Respect robots and site terms
- Report URLs visited and actions taken

## Default Flow

1. Confirm the user intent and whether the action is read-only or state-changing.
2. Use the narrowest available tool scope and collect only the context needed for the task.
3. For state-changing or external actions, stop for explicit approval before acting.
4. Summarize what changed or what was learned, including relevant object IDs or links.
