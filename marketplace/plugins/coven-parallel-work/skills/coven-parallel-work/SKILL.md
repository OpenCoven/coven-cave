---
name: coven-parallel-work
description: Isolate each agent in its own worktree, claim the branch with cv-claim, and rely on pre-commit/pre-push hooks to block unsafe writes.
---

# Coven Parallel Work Protocol

Isolate each agent in its own worktree, claim the branch with cv-claim, and rely on pre-commit/pre-push hooks to block unsafe writes.

## Use When
- Enter a per-branch worktree with cv-wt and acquire a TTL-bounded claim plus a HEAD canary before starting work
- Heartbeat the claim during long sessions and release it after pushing and opening the PR
- Recover from a tripped canary or auto-applied stash by resetting to the expected SHA and rearming the canary

## Guardrails
- Never commit feature work in the primary clone; it stays on main and only fast-forwards
- Set COVEN_AGENT_ID per familiar so claims are attributable when multiple AIs share the machine
- If the canary trips do not push; diagnose via git status and reflog and restore before continuing

## Default Flow

1. Confirm the user intent and whether the action is read-only or state-changing.
2. Use the narrowest available tool scope and collect only the context needed for the task.
3. For state-changing or external actions, stop for explicit approval before acting.
4. Summarize what changed or what was learned, including relevant object IDs or links.
