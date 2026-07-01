---
name: pr-agent
description: Run the review, prepare, and merge phases through scripts/pr-* wrappers, validating .local artifacts and checkpoints between each.
---

# PR Agent — Maintainer Workflow Orchestrator

Run the review, prepare, and merge phases through scripts/pr-* wrappers, validating .local artifacts and checkpoints between each.

## Use When
- Review a PR read-only via scripts/pr-review, emitting review.md and review.json with severity-ranked findings
- Prepare via scripts/pr-prepare: rebase, fix BLOCKER/IMPORTANT findings, update changelog, then run build/check/test gates
- Merge via scripts/pr-merge with a locally signed squash commit and co-author trailers, ending in MERGED state

## Guardrails
- Read-only during review; push to the PR head branch only, never to main, and never git clean -fdx
- Validate handoff artifacts and require checkpoint answers before advancing; phases cannot be skipped
- Never use gh pr merge --auto; re-sign any unsigned commits and verify MERGED (not CLOSED) before cleanup

## Default Flow

1. Confirm the user intent and whether the action is read-only or state-changing.
2. Use the narrowest available tool scope and collect only the context needed for the task.
3. For state-changing or external actions, stop for explicit approval before acting.
4. Summarize what changed or what was learned, including relevant object IDs or links.
