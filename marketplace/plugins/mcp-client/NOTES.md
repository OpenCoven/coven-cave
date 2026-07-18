# NOTES — Universal MCP Client

## Provenance
Vendored verbatim from [coleam00/second-brain-skills](https://github.com/coleam00/second-brain-skills)
(`.claude/skills/mcp-client/`) at commit `75e1e9cd60ef46bffbd294fdfe4d0320cee2f563`
(fetched 2026-07-06). Authored by Cole Medin (coleam00); the generated `plugin.json` author/license
fields are stamped by `scripts/sync-marketplace.py` and do not reflect upstream authorship.

## What's vendored
The complete upstream skill: `SKILL.md`, `scripts/mcp_client.py` (the Python client the skill
drives), and `references/` (example config, MCP server notes, Python SDK notes). Nothing was
excluded or modified.

## Config & secrets
The skill expects a user-created `references/mcp-config.json` (copied from
`references/example-mcp-config.json`) holding real server URLs and API keys. Only the example
ships here — a real config must never be committed. The script also honors `MCP_CONFIG_PATH`.

## Runtime requirements
`scripts/mcp_client.py` needs Python 3.10+ with the `mcp` package for stdio servers and network
access for remote (SSE / streamable HTTP / Bearer) servers.

## Sync integration
`skill.managed: "manual"` in `marketplace/catalog.json` — the authored SKILL.md is the source of
truth; `sync-marketplace.py` generates only the manifests and never rewrites the skill body.
Re-vendor by re-copying from upstream and updating the commit hash above.
