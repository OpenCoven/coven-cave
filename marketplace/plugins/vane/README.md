# Vane Search plugin

Cited AI answers from a self-hosted [Vane](https://github.com/ItzCrazyKns/Vane)
(formerly Perplexica) instance. The plugin bundles its own zero-dependency MCP
server, `server/vane-mcp.mjs`, which talks to Vane's `GET /api/providers` and
`POST /api/search` endpoints over stdio JSON-RPC.

## Run Vane

```bash
docker run -d -p 127.0.0.1:3030:3000 -v vane-data:/home/vane/data --name vane itzcrazykns1337/vane:latest
```

Then open <http://127.0.0.1:3030>, and under **Settings** add at least one
provider that offers a chat model and an embedding model (the tool cannot do
this for you). Port 3030 is used because Coven Cave's dev servers occupy
3000–3010.

## Enable the plugin

Install **Vane Search** from the Coven Cave Marketplace (category *Browser &
Web*) and set the **Vane Instance URL** when prompted. The default,
`http://127.0.0.1:3030`, matches the docker command above.

## Tools

| Tool | What it does |
| --- | --- |
| `vane_search` | `{ query, sources?=["web"], mode?="speed", systemInstructions?, history? }` → Vane's answer plus a numbered Sources list (title, URL, snippet); the sources also come back as `structuredContent.sources`. |
| `vane_providers` | Lists configured providers and their chat/embedding model keys. |

Treat the synthesized answer as a lead. Cite and verify the returned URLs; see
[`skills/vane/SKILL.md`](skills/vane/SKILL.md).

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `VANE_URL` | `http://127.0.0.1:3030` | Base URL of the Vane instance. |
| `VANE_TIMEOUT_MS` | `120000` | Per-request timeout; `quality` mode can be slow. |
| `VANE_ALLOW_REMOTE` | unset | Set to `1` to permit a non-loopback `VANE_URL`. Queries leave the machine through that instance's SearXNG, so this is explicit opt-in. |
| `VANE_CHAT_PROVIDER_ID`, `VANE_CHAT_MODEL` | unset | Pin the chat provider (uuid) and model key. |
| `VANE_EMBEDDING_PROVIDER_ID`, `VANE_EMBEDDING_MODEL` | unset | Pin the embedding provider (uuid) and model key. |

Without pins the server uses the first provider that exposes a chat model and
the first that exposes an embedding model, and caches that choice for the
process lifetime. Run `vane_providers` to see the ids and keys to pin.

## How the server path resolves

The manifest launches `node ${CLAUDE_PLUGIN_ROOT}/server/vane-mcp.mjs`.
`${CLAUDE_PLUGIN_ROOT}` is the variable both Claude Code and Codex plugin
loaders expand to the installed plugin directory, so the bundled server
resolves wherever the plugin is installed as a plugin. Coven Cave's own
marketplace install is track-only (it records the install and never spawns
servers), and its MCP doctor reports the entry as `needs-config` naming
`CLAUDE_PLUGIN_ROOT` and `VANE_URL` until a harness supplies them.

To register the server directly with a client that is not loading it as a
plugin, substitute the absolute path, for example:

```bash
claude mcp add vane -e VANE_URL=http://127.0.0.1:3030 -- node /path/to/coven-cave/marketplace/plugins/vane/server/vane-mcp.mjs
```

## Tool errors

All failures come back as `isError: true` text results so the agent can act
on them:

- **unreachable** — Vane is not running; the message includes the docker
  command above.
- **no providers** — nothing configured in Vane's Settings yet.
- **HTTP 4xx/5xx** — Vane's status code and a short body preview.
- **timeout** — exceeded `VANE_TIMEOUT_MS`.
- **non-loopback refusal** — `VANE_URL` is not loopback and
  `VANE_ALLOW_REMOTE=1` is not set.

## Tests

```bash
node scripts/vane-mcp-server.test.mjs
```

The test boots a fake Vane on an ephemeral loopback port, spawns the server
over stdio, and covers initialize, tools/list, a cited search, env-pinned
models, an unreachable instance, empty providers, HTTP errors, and the
non-loopback refusal.
