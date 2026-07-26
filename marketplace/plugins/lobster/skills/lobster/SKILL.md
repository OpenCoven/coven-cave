---
name: lobster
description: Compose piped Lobster commands or .lobster workflow files to run deterministic multi-step automations with approval gates and persistent state.
---

# Lobster — Workflow Shell

Compose piped Lobster commands or .lobster workflow files to run deterministic multi-step automations with approval gates and persistent state.

## Use When
- Chain exec/where/pick/head/table commands into one pipeline to filter and report data
- Author a .lobster workflow with a required approval gate before a deploy or send step
- Track PR state changes or triage email using built-in recipes and diff.last snapshots

## Guardrails
- Approval gates are hard stops; the pipeline cannot continue without an explicit resume token
- Lobster never owns tokens — it relies on env vars or OpenClaw's existing auth
- Persist cursors/checkpoints via state.set/state.get so reruns resume rather than reprocess

## Default Flow

1. Confirm the user intent and whether the action is read-only or state-changing.
2. Use the narrowest available tool scope and collect only the context needed for the task.
3. For state-changing or external actions, stop for explicit approval before acting.
4. Summarize what changed or what was learned, including relevant object IDs or links.
