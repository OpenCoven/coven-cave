---
name: skill-scanner
description: Run both the skill-structure gate and the CodeQL SDK security scan, then report a compact ready-to-submit status block.
---

# Skill Scanner

Run both the skill-structure gate and the CodeQL SDK security scan, then report a compact ready-to-submit status block.

## Use When
- Validate skill structure with openclaw skills check and package_skill.py before scanning
- Run the codeql-sdk audit with --fail-on-high and emit JSON plus optional SARIF reports for CI/ClawHub
- Produce a handoff summary (structure, package, scan status, report path, ready-to-submit) for Cody or ClawHub

## Guardrails
- If CodeQL finds no analyzable source, mark the scan not applicable rather than passed; never substitute weaker checks
- If the CodeQL CLI is missing, report it as a blocker and ask before installing it (machine-level change)
- Do not commit .scan-reports/ or print secrets; summarize only rule IDs, severity, file paths, and line numbers

## Default Flow

1. Confirm the user intent and whether the action is read-only or state-changing.
2. Use the narrowest available tool scope and collect only the context needed for the task.
3. For state-changing or external actions, stop for explicit approval before acting.
4. Summarize what changed or what was learned, including relevant object IDs or links.
