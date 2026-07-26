---
name: maintainer-bar
description: Build and run the SwiftUI app, then drive ghcrawl through the ghcrawl-op wrapper in --json mode to refresh, cluster, and semantically search repo issues.
---

# MaintainerBar — Maintainer Menu Bar Skill

Build and run the SwiftUI app, then drive ghcrawl through the ghcrawl-op wrapper in --json mode to refresh, cluster, and semantically search repo issues.

## Use When
- Refresh a repo's issue clusters and browse them with ghcrawl-op clusters --min-size 2 --limit 30 --json
- Run semantic search over issues like ghcrawl-op search --query 'download stalls' --json and inspect cluster or thread detail
- Build and run the MaintainerBar menu bar app with swift build and swift run MaintainerBar on the macOS node

## Guardrails
- Secrets are never stored on disk — GitHub token comes from gh auth token and the OpenAI key from op read via the ghcrawl-op wrapper
- All build, run, and ghcrawl commands must execute on the macOS node (MB Black), not a remote host
- ghcrawl uses OpenAI embeddings for search, which incurs external API usage; keep calls in --json mode for machine-readable output

## Default Flow

1. Confirm the user intent and whether the action is read-only or state-changing.
2. Use the narrowest available tool scope and collect only the context needed for the task.
3. For state-changing or external actions, stop for explicit approval before acting.
4. Summarize what changed or what was learned, including relevant object IDs or links.
