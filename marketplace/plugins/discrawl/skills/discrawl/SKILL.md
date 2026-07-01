---
name: discrawl
description: Check archive freshness with status/doctor, run bounded search and channel slices, and use read-only SQL for exact counts before ever mutating the DB.
---

# Discrawl

Check archive freshness with status/doctor, run bounded search and channel slices, and use read-only SQL for exact counts before ever mutating the DB.

## Use When
- Search the local Discord archive with bounded slices like discrawl search --limit 20 or messages --channel '#maintainers' --days 7
- Check sync freshness with discrawl status --json and refresh only when stale via discrawl sync --source wiretap
- Run read-only SQL such as select count(*) from messages for exact counts and rankings across the archive

## Guardrails
- Never use --unsafe --confirm unless the user explicitly requests a reviewed DB mutation
- Wiretap reads local Discord Desktop artifacts only — do not extract user tokens, call Discord as the user, or write to Discord storage
- Git-share snapshots must not include secrets or @me DM rows; report date spans, channel names, counts, and known gaps

## Default Flow

1. Confirm the user intent and whether the action is read-only or state-changing.
2. Use the narrowest available tool scope and collect only the context needed for the task.
3. For state-changing or external actions, stop for explicit approval before acting.
4. Summarize what changed or what was learned, including relevant object IDs or links.
