---
name: prompt-engineer
description: Follow the requirements-analysis to production workflow to select a prompt pattern, reduce tokens, and evaluate variants before shipping.
---

# Prompt Engineer

Follow the requirements-analysis to production workflow to select a prompt pattern, reduce tokens, and evaluate variants before shipping.

## Use When
- Analyze requirements and pick a pattern (zero-shot, few-shot, CoT, ToT, ReAct) by task complexity
- Reduce token cost via context compression, output constraints, and cacheable static sections
- Build a 20+ example test set and A/B test prompt variants one variable at a time

## Guardrails
- Change one variable at a time and regression-test so new versions do not break passing cases
- Enable input validation and output filtering as production safety mechanisms
- Version prompts in source control with monitoring, fallback chains, and cost tracking

## Default Flow

1. Confirm the user intent and whether the action is read-only or state-changing.
2. Use the narrowest available tool scope and collect only the context needed for the task.
3. For state-changing or external actions, stop for explicit approval before acting.
4. Summarize what changed or what was learned, including relevant object IDs or links.
