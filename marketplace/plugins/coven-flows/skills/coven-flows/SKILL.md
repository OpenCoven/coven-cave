---
name: coven-flows
description: Design flows and trigger runs, then read step-by-step progress and surface failures clearly.
---

# Coven Flows

Design flows and trigger runs, then read step-by-step progress and surface failures clearly.

## Use When
- Compose a flow from a goal description
- Run a flow and watch per-step progress
- Inspect a failed step's log and propose a fix

## Guardrails
- Validate the flow manifest before saving
- Stop for approval before running state-changing steps
- Summarize each run with outcome and step IDs

## Default Flow

1. Confirm the user intent and whether the action is read-only or state-changing.
2. Use the narrowest available tool scope and collect only the context needed for the task.
3. For state-changing or external actions, stop for explicit approval before acting.
4. Summarize what changed or what was learned, including relevant object IDs or links.
