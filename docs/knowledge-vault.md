# Knowledge Vault

The **Knowledge Vault** is curated, human-authored reference knowledge that is
injected into **every harness** (claude, codex, hermes, openclaw) at chat time.
It is deliberately **separate from memory**:

| | Memory | Knowledge Vault |
|---|---|---|
| Author | the familiar (auto-written as it works) | you (curated) |
| Lifetime | evolves / drifts per day | durable, stable |
| Scope | per-familiar, per-day | global or an explicit familiar allow-list |
| Storage | `~/.coven/.../memory/<date>.md` | `~/.coven/knowledge/<id>.md` |
| Intent | the agent's notebook | authoritative background facts |

Use it for style guides, glossaries, domain facts, API contracts, "house rules"
— anything you want *every* harness to treat as authoritative context without
copy-pasting it into each prompt.

## How the cross-harness tie-in works

Every harness is spawned from a single constructed prompt in
`src/app/api/chat/send/route.ts`. The vault is wrapped onto that prompt via
`buildPromptWithKnowledgeVault(...)`, so the same curated knowledge reaches all
harnesses with no per-harness plumbing. Entries land inside a `<KNOWLEDGE_VAULT>`
block, clearly labelled as durable reference material (not memory).

## Storage format

One Markdown file per entry under `~/.coven/knowledge/` (override with
`COVEN_KNOWLEDGE_DIR`). Each file has a small YAML frontmatter:

```markdown
---
title: API Style Guide
tags: [api, conventions]
scope: global            # or a list/space-separated set of familiar ids, e.g. "sage echo"
enabled: true
---
Routes are kebab-case. Every change ships through a PR.
```

- `scope: global` (or omitted) → reaches every familiar.
- `scope: sage echo` → only those familiars' prompts.
- `enabled: false` → kept on disk but never injected.

## Managing entries — `/api/knowledge`

```
GET    /api/knowledge                  → { ok, entries }   (full list)
GET    /api/knowledge?familiarId=sage  → { ok, entries }   (what sage would receive)
POST   /api/knowledge                  body { title, body, tags?, scope?, enabled?, id? } → { ok, entry }
DELETE /api/knowledge?id=<id>          → { ok, deleted }
```

The entry `id` is the only user input that touches the filesystem and is gated on
a strict slug allow-list (`isValidKnowledgeId`) before any path is built — the
route can't escape the vault directory. When `id` is omitted on POST, it is
slugified from the title.
