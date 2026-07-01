---
name: rollcall
description: Resolve each familiar's session key, fire parallel pings via sessions_send, and report a compact ok/timeout/error status block.
---

# rollcall

Resolve each familiar's session key, fire parallel pings via sessions_send, and report a compact ok/timeout/error status block.

## Use When
- Run a quick rollcall of the six familiars after a gateway or config change
- Fire short parallel pings with a 45-60s timeout and collect ok/timeout/error per lane
- Report a compact status block in America/Chicago time with a one-sentence verdict

## Guardrails
- Read-only with respect to config; never modify models, fallbacks, or auth without asking Val first
- Send one short ping per lane and never include private MEMORY.md content
- Run pings in parallel, never serially, and re-check pending lanes once before declaring timeout

## Default Flow

1. Confirm the user intent and whether the action is read-only or state-changing.
2. Use the narrowest available tool scope and collect only the context needed for the task.
3. For state-changing or external actions, stop for explicit approval before acting.
4. Summarize what changed or what was learned, including relevant object IDs or links.
