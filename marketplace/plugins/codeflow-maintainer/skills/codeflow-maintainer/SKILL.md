---
name: codeflow-maintainer
description: Drive a PR through triage, review, prepare, merge, and post-merge modes, answering the checkpoint questions before each transition.
---

# CodeFlow Maintainer Skill

Drive a PR through triage, review, prepare, merge, and post-merge modes, answering the checkpoint questions before each transition.

## Use When
- Triage an incoming PR for problem clarity, scope match, and duplicates before committing to review
- Produce BLOCKER/IMPORTANT/MINOR/NOTE review findings in .local/review.md and review.json without editing code
- Prepare a PR by rebasing onto main, fixing findings, updating the changelog, and running build/check/test gates

## Guardrails
- Review mode is read-only; never modify code, and push only to the PR head branch, never to main
- Modes cannot be skipped and each transition requires the checkpoint questions answered
- Verify the PR reaches MERGED state and squash-merge with Co-authored-by trailers for author and maintainer

## Default Flow

1. Confirm the user intent and whether the action is read-only or state-changing.
2. Use the narrowest available tool scope and collect only the context needed for the task.
3. For state-changing or external actions, stop for explicit approval before acting.
4. Summarize what changed or what was learned, including relevant object IDs or links.
