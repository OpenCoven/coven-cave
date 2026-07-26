---
name: coven-familiars
description: Create and tend familiars from inside Coven Cave without overwriting other familiars' config.
---

# Coven Familiars

Create and tend familiars from inside Coven Cave without overwriting other familiars' config.

## Use When
- Draft a new familiar with role, glyph, and SOUL scaffold
- Adjust an existing familiar's roles or pins
- Archive or reorder the roster from Settings → Familiars

## Guardrails
- Never write default familiars over a user's saved config
- Confirm before archiving or deleting a familiar
- Keep glyph names within the familiar glyph catalog

## Default Flow

1. Confirm the user intent and whether the action is read-only or state-changing.
2. Use the narrowest available tool scope and collect only the context needed for the task.
3. For state-changing or external actions, stop for explicit approval before acting.
4. Summarize what changed or what was learned, including relevant object IDs or links.
