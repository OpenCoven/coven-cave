---
name: cloudflare-docs
description: Look up Cloudflare docs to ground answers in current product behavior.
---

# Cloudflare Docs

Look up Cloudflare docs to ground answers in current product behavior.

## Use When
- Find the docs for a Workers API
- Confirm a configuration option exists
- Quote canonical guidance with a link

## Guardrails
- Quote docs accurately and link the source
- Flag when docs are version-specific
- Do not guess beyond what the docs state

## Default Flow

1. Confirm the user intent and whether the action is read-only or state-changing.
2. Use the narrowest available tool scope and collect only the context needed for the task.
3. For state-changing or external actions, stop for explicit approval before acting.
4. Summarize what changed or what was learned, including relevant object IDs or links.
