---
name: 1password
description: Retrieve and inject secrets with op, keeping only op:// references on disk and never displaying secret values.
---

# 1Password Secret Management

Retrieve and inject secrets with op, keeping only op:// references on disk and never displaying secret values.

## Use When
- Read a single secret with op read "op://Vault/Item/Field" inside a subshell or pipe
- Build per-skill env files of op:// references and inject them at runtime with op run --env-file
- Register a new secret and its reference for a skill following least-privilege whitelisting

## Guardrails
- Never display secret values or write raw secrets to files; only op:// references are safe to commit
- Always pass --vault when creating items and verify with op item list to avoid duplicates or wrong-vault writes
- Use separate vaults per trust level and service accounts only for unattended automation

## Default Flow

1. Confirm the user intent and whether the action is read-only or state-changing.
2. Use the narrowest available tool scope and collect only the context needed for the task.
3. For state-changing or external actions, stop for explicit approval before acting.
4. Summarize what changed or what was learned, including relevant object IDs or links.
