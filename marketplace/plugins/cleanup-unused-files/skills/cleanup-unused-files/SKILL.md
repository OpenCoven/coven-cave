---
name: cleanup-unused-files
description: Audit likely large cache and build directories, then delete reproducible junk with exact paths after making blast radius explicit.
---

# Cleanup Unused Files

Audit likely large cache and build directories, then delete reproducible junk with exact paths after making blast radius explicit.

## Use When
- Nuke repo build output like target/, dist/, .next/, coverage/, and .turbo/ to shrink a checkout
- Clear package-manager and SDK caches such as ~/.npm, ~/.bun, ~/.rustup, and ~/Library/Caches
- Perform a machine-wide developer state reset before reclaiming maximum disk regardless of re-download cost

## Guardrails
- Deletions are destructive and irreversible; prefer exact paths over broad globs and be explicit about blast radius
- Pause and confirm before touching mixed-purpose directories that may hold user-authored content, credentials, custom models, or local databases
- Call out that removing tool state like ~/.rustup, ~/.cargo, or ~/.codex forces reinstalls, re-downloads, or loss of local session state

## Default Flow

1. Confirm the user intent and whether the action is read-only or state-changing.
2. Use the narrowest available tool scope and collect only the context needed for the task.
3. For state-changing or external actions, stop for explicit approval before acting.
4. Summarize what changed or what was learned, including relevant object IDs or links.
