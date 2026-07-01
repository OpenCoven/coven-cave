---
name: daily-dev-agentic
description: Create a daily.dev feed, follow goal-relevant tags, and run scheduled learning loops that fetch, note, and share insights autonomously.
---

# daily.dev Agentic Learning

Create a daily.dev feed, follow goal-relevant tags, and run scheduled learning loops that fetch, note, and share insights autonomously.

## Use When
- Initialize a personalized feed, select and follow tags, and store config in memory/agentic-learning.md
- Run a learning loop: fetch new posts, fetch full articles, research deeper, and note insights by date
- Share daily updates, a Sunday weekly digest, and threshold alerts on-demand or via cron

## Guardrails
- Requires a daily.dev Plus DAILY_DEV_TOKEN; never send the token to any domain except api.daily.dev
- Respect the 60 req/min rate limit against the API base
- Prune tags that stop yielding value and refine goals as focus sharpens

## Default Flow

1. Confirm the user intent and whether the action is read-only or state-changing.
2. Use the narrowest available tool scope and collect only the context needed for the task.
3. For state-changing or external actions, stop for explicit approval before acting.
4. Summarize what changed or what was learned, including relevant object IDs or links.
