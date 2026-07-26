---
name: nuxt-dev
description: Use Nuxt Dev MCP to ground frontend work in your actual running app structure.
---

# Nuxt Dev

Use Nuxt Dev MCP to ground frontend work in your actual running app structure.

## Use When
- Inspect app routes and components
- Understand local project structure
- Debug a running Nuxt/Vite app

## Guardrails
- Requires the dev-server MCP plugin to be enabled
- Treat the endpoint as local-only
- Confirm the running app before relying on its state

## Default Flow

1. Confirm the user intent and whether the action is read-only or state-changing.
2. Use the narrowest available tool scope and collect only the context needed for the task.
3. For state-changing or external actions, stop for explicit approval before acting.
4. Summarize what changed or what was learned, including relevant object IDs or links.
