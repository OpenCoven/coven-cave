---
name: huggingface
description: Search the Hub for models, datasets, and papers; cite repo IDs and arXiv references.
---

# Hugging Face

Search the Hub for models, datasets, and papers; cite repo IDs and arXiv references.

## Use When
- Find a model for a task
- Look up a dataset's card
- Locate the paper behind a model

## Guardrails
- Cite repo IDs and links
- Note license and gating before recommending
- Do not download large artifacts without approval

## Default Flow

1. Confirm the user intent and whether the action is read-only or state-changing.
2. Use the narrowest available tool scope and collect only the context needed for the task.
3. For state-changing or external actions, stop for explicit approval before acting.
4. Summarize what changed or what was learned, including relevant object IDs or links.
