---
name: coven-automations
description: Create and tend scheduled automations and read their run logs without surprise side effects.
---

# Coven Automations

Create and tend scheduled automations and read their run logs without surprise side effects.

## Use When
- Schedule a recurring cron or reminder
- Check the next-fire summary for active automations
- Read a run log and diagnose a failed automation

## Guardrails
- Confirm cadence and target before enabling a schedule
- Use UPPERCASE cron status (ACTIVE/PAUSED)
- Stop for approval before deleting an automation

## Default Flow

1. Confirm the user intent and whether the action is read-only or state-changing.
2. Use the narrowest available tool scope and collect only the context needed for the task.
3. For state-changing or external actions, stop for explicit approval before acting.
4. Summarize what changed or what was learned, including relevant object IDs or links.
