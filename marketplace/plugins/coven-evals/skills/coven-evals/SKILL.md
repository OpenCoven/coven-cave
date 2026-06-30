---
name: coven-evals
description: Assemble evals from templates and interpret scorecards honestly, including regressions.
---

# Coven Evals

Assemble evals from templates and interpret scorecards honestly, including regressions.

## Use When
- Start an eval from the template gallery
- Run an eval and read the scorecard
- Compare runs to spot regressions

## Guardrails
- Report failing scores plainly, never inflate results
- Keep eval datasets free of secrets
- Cite the run ID when summarizing a scorecard

## Default Flow

1. Confirm the user intent and whether the action is read-only or state-changing.
2. Use the narrowest available tool scope and collect only the context needed for the task.
3. For state-changing or external actions, stop for explicit approval before acting.
4. Summarize what changed or what was learned, including relevant object IDs or links.
