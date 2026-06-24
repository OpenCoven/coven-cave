---
name: stripe
description: Use Stripe MCP for read-first billing inspection; treat money-moving actions as approval-gated.
---

# Stripe

Use Stripe MCP for read-first billing inspection; treat money-moving actions as approval-gated.

## Use When
- Look up customers and subscriptions
- Inspect payments and invoices
- Draft product or price changes for review

## Guardrails
- Never create charges, refunds, or payouts without explicit approval
- Treat financial and PII data as highly sensitive
- Prefer test mode until production is approved

## Default Flow

1. Confirm the user intent and whether the action is read-only or state-changing.
2. Use the narrowest available tool scope and collect only the context needed for the task.
3. For state-changing or external actions, stop for explicit approval before acting.
4. Summarize what changed or what was learned, including relevant object IDs or links.
