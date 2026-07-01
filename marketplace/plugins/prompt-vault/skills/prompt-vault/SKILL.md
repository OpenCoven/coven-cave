---
name: prompt-vault
description: Use the pv CLI to add prompts with comma-separated tags, search by substring, list or filter by tag, and export the library to JSON for backup.
---

# Prompt Vault

Use the pv CLI to add prompts with comma-separated tags, search by substring, list or filter by tag, and export the library to JSON for backup.

## Use When
- Save a prompt the user liked with pv add "<text>" --tags refactor,code-review and return its ID
- Find a prompt for reuse with pv search "X" and present the best match for the current task
- List prompts newest-first or filter by tag, and export the whole library with pv export > prompts.json

## Guardrails
- Requires the pv CLI installed globally; data lives locally at ~/.prompt-vault.db with no sync — use pv export to back up
- Search is basic substring (LIKE %query%) matching, so broaden or narrow keywords when a match is missed
- Escape inner quotes or use single quotes around prompt text so the CLI arg parses correctly

## Default Flow

1. Confirm the user intent and whether the action is read-only or state-changing.
2. Use the narrowest available tool scope and collect only the context needed for the task.
3. For state-changing or external actions, stop for explicit approval before acting.
4. Summarize what changed or what was learned, including relevant object IDs or links.
