---
name: openclaw-trust
description: Prioritize the highest-risk classes first, translate the trust model into concrete controls, and gate risky automations behind approvals before rollout.
---

# OpenClaw Trust

Prioritize the highest-risk classes first, translate the trust model into concrete controls, and gate risky automations behind approvals before rollout.

## Use When
- Assess a risky workflow against the fast checklist: can untrusted content reach prompt or tool parameters, and is there an approval gate
- Recommend concrete hardening such as default-deny AllowFrom, strict tool argument validation, and least-privilege MCP config
- Draft a threat proposal with scenario, attack path, affected components, and suggested mitigations for the openclaw/trust repo

## Guardrails
- Treat any 'no' or 'unknown' answer on the risk checklist as medium+ risk and require guardrails before rollout
- Route live exploitable vulnerabilities through responsible disclosure, not public issues or PRs
- Prefer approval gates for state-changing actions and never allow free-form shell interpolation of tool arguments

## Default Flow

1. Confirm the user intent and whether the action is read-only or state-changing.
2. Use the narrowest available tool scope and collect only the context needed for the task.
3. For state-changing or external actions, stop for explicit approval before acting.
4. Summarize what changed or what was learned, including relevant object IDs or links.
