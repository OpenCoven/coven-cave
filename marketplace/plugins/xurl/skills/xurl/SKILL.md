---
name: xurl
description: Use X/Twitter safely: draft posts, look up public context, prepare approved-post workflows, and keep social publishing actions explicit.
---

# xurl

Use X/Twitter safely: draft posts, look up public context, prepare approved-post workflows, and keep social publishing actions explicit.

## Use When
- Draft posts
- Inspect approved post status
- Post only after explicit approval

## Guardrails
- Do not post, reply, like, repost, or delete without approval
- Preserve exact approved text when posting
- Record post IDs or failure reasons

## Default Flow

1. Confirm the user intent and whether the action is read-only or state-changing.
2. Use the narrowest available tool scope and collect only the context needed for the task.
3. For state-changing or external actions, stop for explicit approval before acting.
4. Summarize what changed or what was learned, including relevant object IDs or links.
