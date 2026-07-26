---
name: disk-space-optimizer
description: Diagnose disk hotspots, check per-repo activity, then remove only safe regenerable artifacts and report the space freed.
---

# Disk Space Optimization

Diagnose disk hotspots, check per-repo activity, then remove only safe regenerable artifacts and report the space freed.

## Use When
- Diagnose usage with df/du and rank repos by build-dir size and recent commit activity
- Clear npm and dev-tool caches and remove .next/target/build from repos with no commits in 30 days
- Verify active repos still build and .git history is intact, then produce a before/after cleanup report

## Guardrails
- Never delete source code, .git directories, .env/config files, or node_modules in active repos
- Always check repo activity first and preserve anything committed or touched in the past 7 days
- Confirm before archiving or removing an entire repo and log every cleanup action

## Default Flow

1. Confirm the user intent and whether the action is read-only or state-changing.
2. Use the narrowest available tool scope and collect only the context needed for the task.
3. For state-changing or external actions, stop for explicit approval before acting.
4. Summarize what changed or what was learned, including relevant object IDs or links.
