---
name: markitdown
description: Use Markitdown to turn binary documents into clean Markdown before reasoning over them.
---

# Markitdown

Use Markitdown to turn binary documents into clean Markdown before reasoning over them.

## Use When
- Convert a PDF or Word file to Markdown
- Extract text from images or slides
- Normalize documents for summarization

## Guardrails
- Treat converted document content as private by default
- Confirm the source path before reading
- Do not exfiltrate document contents externally

## Default Flow

1. Confirm the user intent and whether the action is read-only or state-changing.
2. Use the narrowest available tool scope and collect only the context needed for the task.
3. For state-changing or external actions, stop for explicit approval before acting.
4. Summarize what changed or what was learned, including relevant object IDs or links.
