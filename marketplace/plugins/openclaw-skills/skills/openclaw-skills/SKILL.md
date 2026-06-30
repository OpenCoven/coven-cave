---
name: openclaw-skills
description: Use the migrated OpenClaw skill library from Coven, checking coverage before treating the migration as complete.
---

# OpenClaw Skills

Use the migrated OpenClaw skill library from Coven, checking coverage before treating the migration as complete.

## Use When
- Find the Coven copy of an OpenClaw workspace skill
- Verify OpenClaw skill migration coverage
- Update shared familiar workflows through the Coven skill library

## Guardrails
- Run the Coven `sync-openclaw-skills` coverage check before claiming 100% migration
- Do not overwrite richer Coven-native skills when a represented skill already exists
- Keep secret-bearing examples sanitized before publishing skills

## Default Flow

1. Confirm the user intent and whether the action is read-only or state-changing.
2. Use the narrowest available tool scope and collect only the context needed for the task.
3. For state-changing or external actions, stop for explicit approval before acting.
4. Summarize what changed or what was learned, including relevant object IDs or links.
