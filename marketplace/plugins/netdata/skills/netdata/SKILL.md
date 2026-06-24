---
name: netdata
description: Use Netdata to investigate live infrastructure health before drawing conclusions about incidents.
---

# Netdata

Use Netdata to investigate live infrastructure health before drawing conclusions about incidents.

## Use When
- Inspect real-time metrics
- Correlate alerts with logs
- Spot anomalies during an incident

## Guardrails
- Treat telemetry as sensitive
- Do not change agent config without approval
- Cite the time window and node inspected

## Default Flow

1. Confirm the user intent and whether the action is read-only or state-changing.
2. Use the narrowest available tool scope and collect only the context needed for the task.
3. For state-changing or external actions, stop for explicit approval before acting.
4. Summarize what changed or what was learned, including relevant object IDs or links.
