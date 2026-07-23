# MCP doctor — debugging the cave's MCP catalog

The cave lists MCP servers in two places: the live per-harness capability scan
(what a familiar's runtime actually loaded) and the **well-known servers** grid
fed by the marketplace registry at `marketplace/exports/mcp/mcp.json`. The
registry alone says nothing about whether an entry would actually work on this
machine — the MCP doctor closes that gap.

## What it checks

`GET /api/mcp/health` runs `src/lib/mcp-doctor.ts` over every registry entry
and returns one honest verdict per server:

| status         | meaning                                                                                                        |
| -------------- | -------------------------------------------------------------------------------------------------------------- |
| `ready`        | remote (`http`/`sse`) endpoint answered a real JSON-RPC `initialize` probe, or the stdio launcher (`npx`, `uvx`, `docker`, …) is installed and nothing else is required |
| `needs-config` | the entry references `${PLACEHOLDER}` values (env keys, connection strings, roots) the user must supply first — nothing can be probed until then |
| `unavailable`  | the endpoint did not respond, or the stdio launcher is not installed on the machine running the cave server     |

Each result carries a `detail` line and `requires`: the *names* of unmet
placeholders. Values are never read, echoed, or stored, and the doctor never
spawns a server process — stdio verification is launcher + configuration
readiness, by design (spawning ~40 `npx`/`uvx` processes from a route would
not be acceptable).

## Where it surfaces

In the familiar tab's **MCP & plugins** card, the well-known grid has a
**Check servers** action. It calls the route on demand (never on mount),
and pins a verdict pill on each server card; hovering shows the detail and any
unmet requirement names. Remote endpoints that answer 401/403 are `ready` —
remote MCP servers authenticate in-client via OAuth, so "sign in on connect"
is the healthy state.

## Debugging from a terminal

```bash
curl -s http://127.0.0.1:3000/api/mcp/health | jq '.servers[] | select(.status != "ready")'
```

Typical fixes:

- `needs-config` — export the named `${PLACEHOLDER}` values in the environment
  of the runtime that launches the server (the familiar's harness config, not
  the cave), e.g. `GITHUB_PAT`, `COVEN_MCP_FILESYSTEM_ROOT`.
- `unavailable` (stdio) — install the launcher (`npm i -g`/`uv`/`docker`/…)
  on the machine running the cave server.
- `unavailable` (remote) — endpoint outage or network/proxy issue; the probe
  timeout is 5s per endpoint.

The doctor's probe is `checkMcpEndpoint` in `src/lib/endpoint-validators.ts`,
shared with the marketplace's per-plugin **validate endpoint** action.
