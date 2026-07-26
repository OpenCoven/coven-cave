---
name: project-manager
description: Create and maintain slugged project directories with CONTEXT.md, dated notes, and a shared bookmarks store, loading relevant context when switching projects.
---

# Project Manager

Create and maintain slugged project directories with CONTEXT.md, dated notes, and a shared bookmarks store, loading relevant context when switching projects.

## Use When
- Create a project by slugifying its name and scaffolding CONTEXT.md plus a notes/ directory
- Append a dated note under HH:MM headers, prefixing decisions with 'Decision:' for later retrieval
- Switch conversation context by loading CONTEXT.md, the latest three note files, and tagged bookmarks

## Guardrails
- Keep context loading efficient by reading only CONTEXT.md, recent notes, and tagged bookmarks
- Use short incremental bookmark IDs and read-then-write _bookmarks.json to avoid clobbering entries
- Exclude underscore-prefixed files like _bookmarks.json when listing projects

## Default Flow

1. Confirm the user intent and whether the action is read-only or state-changing.
2. Use the narrowest available tool scope and collect only the context needed for the task.
3. For state-changing or external actions, stop for explicit approval before acting.
4. Summarize what changed or what was learned, including relevant object IDs or links.
