---
name: research-ingestion
description: Obtain paper text via PyMuPDF/pdftotext or web fetch, extract structured insights, and optionally scaffold a new skill.
---

# Research Ingestion

Obtain paper text via PyMuPDF/pdftotext or web fetch, extract structured insights, and optionally scaffold a new skill.

## Use When
- Fetch and extract text from an arXiv/PDF/blog URL, falling back to the HTML version or a summarize tool
- Produce a structured extraction of core contribution, key techniques, and agent-workflow implications
- Scaffold a new SKILL.md from paper insights and append a one-line entry to the research-insights log

## Guardrails
- Do not file speculation as confirmed fact; capture limitations and caveats alongside actionable insights
- Write generated skills only to the workspace skills path and keep insight-log entries short and factual
- Verify PDF tooling is available before extraction and use the documented fallbacks when it is not

## Default Flow

1. Confirm the user intent and whether the action is read-only or state-changing.
2. Use the narrowest available tool scope and collect only the context needed for the task.
3. For state-changing or external actions, stop for explicit approval before acting.
4. Summarize what changed or what was learned, including relevant object IDs or links.
