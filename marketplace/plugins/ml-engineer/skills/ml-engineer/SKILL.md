---
name: ml-engineer
description: Analyze the ML problem and targets first, then build modular versioned pipelines from data validation through serving and monitoring with drift-based retraining.
---

# ML Engineer

Analyze the ML problem and targets first, then build modular versioned pipelines from data validation through serving and monitoring with drift-based retraining.

## Use When
- Design a modular pipeline that validates data first, versions every artifact, and fails fast on schema drift
- Select a training and HPO approach by data size, using Optuna Bayesian search with trial and time budgets
- Set up prediction and feature drift monitoring with PSI/KS tests that trigger automated retraining

## Guardrails
- Run data validation before training to catch schema drift, missing values, and distribution shifts
- Version data, features, models, configs, and code so runs are reproducible and rollbackable
- Configure a fallback model, health checks, and logging before serving any endpoint to production

## Default Flow

1. Confirm the user intent and whether the action is read-only or state-changing.
2. Use the narrowest available tool scope and collect only the context needed for the task.
3. For state-changing or external actions, stop for explicit approval before acting.
4. Summarize what changed or what was learned, including relevant object IDs or links.
