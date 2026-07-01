---
name: codex-session-manager
description: Inspect a coding-agent session's history before acting, then send one bounded, state-aware instruction and require evidence before declaring completion.
---

# Codex Session Manager

Inspect a coding-agent session's history before acting, then send one bounded, state-aware instruction and require evidence before declaring completion.

## Use When
- Locate a target session with sessions_list and review its acceptance criteria and prior work via sessions_history
- Redirect a coding agent that has drifted out of scope by restating the original goal and requesting a scoped diff
- Verify completion by demanding changed files plus fresh test, build, or lint output rather than accepting a bare success claim

## Guardrails
- Inspect session state before acting; never assume progress from labels, memory, or guesses
- Require explicit user approval before instructing the agent to push, publish, merge, delete, or send external messages
- Do not interrupt an actively progressing agent unless clarification, safety, or drift correction is needed

## Default Flow

1. Confirm the user intent and whether the action is read-only or state-changing.
2. Use the narrowest available tool scope and collect only the context needed for the task.
3. For state-changing or external actions, stop for explicit approval before acting.
4. Summarize what changed or what was learned, including relevant object IDs or links.
