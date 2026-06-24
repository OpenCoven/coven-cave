# Marketplace

Coven Cave is the canonical user-facing marketplace surface for first-party OpenCoven plugins and MCP integrations. The seeded package catalog lives in `marketplace/catalog.json`, and `scripts/sync-marketplace.py` expands that catalog into:

- `marketplace/plugins/<name>/plugin.json`
- `marketplace/plugins/<name>/skills/<name>/SKILL.md`
- `marketplace/plugins/<name>/.codex-plugin/plugin.json`
- `marketplace/marketplace.json`
- `marketplace/exports/codex/marketplace.json`
- `marketplace/exports/mcp/mcp.json`
- `marketplace/exports/roles/role-affinity.json`

## Design

The Cave catalog is the canonical package metadata because Cave is where familiars, roles, skills, and setup state meet. Generated package directories keep Coven Code, Codex, MCP-only clients, and role-affinity views from drifting away from that Cave-owned source.

Each catalog entry includes:

- package metadata for Cave and compatible clients
- optional MCP server configuration
- user-config declarations for sensitive setup values
- trust level, source references, and role affinity
- one generated Skill that tells familiars how to use the integration safely

## Seed Packages

The first seed starts with integrations already used by Val's familiar lanes:

- GitHub
- Gmail
- Google Calendar
- Linear
- Canva
- Vercel
- Asana
- xurl

It also includes a conservative common MCP starter set:

- Filesystem
- Git
- Fetch
- Memory
- Sequential Thinking
- Time

## Trust Levels

`official-remote` packages point at a service-operated remote MCP endpoint, such as Linear, Vercel, Canva, or Asana.

`reference-local` packages use MCP reference servers. These are useful defaults, but installers should still apply local threat-model checks.

`preview-local` packages use a local tool or preview integration whose exact command surface may move before a stable marketplace release.

`local-tool` packages wrap a local OpenCoven or OpenClaw tool that is part of Val's familiar setup rather than an external MCP service.

## Updating

Edit `marketplace/catalog.json`, then run:

```bash
python3 scripts/sync-marketplace.py
python3 scripts/sync-marketplace.py --check
```

The check command fails if generated packages or exports are missing or stale.

## Local Install State

Cave records local marketplace installs in `~/.coven/cave-config.json` under `marketplace.installed`. This records which package the user chose so Cave can layer configuration, export application, and harness setup on top. It never stores raw secrets — see Configuration & Validation below.

## Configuration & Validation

The Marketplace surface lives as a **Marketplace** tab on the Roles page. Beyond browse + track-install, it can configure and validate a package:

- **Credential collection.** Each required `userConfig` field declares the env var its MCP server resolves (`env` key in `catalog.json`). The Configure modal collects values, split by `sensitive`:
  - **Sensitive** secrets (e.g. `github_token` → `GITHUB_PERSONAL_ACCESS_TOKEN`) are stored as **1Password `op://` references** via the vault (`/api/vault`). Cave never stores the raw secret value.
  - **Non-sensitive** config (e.g. a filesystem root path) is written to `.env.local` via `/api/marketplace/config`. The env key is always taken from the trusted manifest (allowlist-selected), never built from the request.
- **Secret validation.** For fields with a registered validator (`src/lib/secret-validators.ts`, GitHub only today), the modal can **Test** the resolved secret server-side against the provider's API (GitHub `/user`) — pass/fail + login, never returning the token. `POST /api/marketplace/config/validate`. Advisory: validation does not gate the "Configured" state.
- **Endpoint validation.** Remote (URL-based) MCP plugins (Linear, Vercel, Canva, Asana) have no stored secret — they authenticate via in-client OAuth. The detail drawer's **Connection** section offers **Test connection**, a generic reachability probe (`src/lib/endpoint-validators.ts`) that POSTs a JSON-RPC `initialize` and reports reachable / sign-in-on-connect / unreachable. `POST /api/marketplace/validate-endpoint`. Advisory connectivity check, not user auth.

All package-id → filesystem-path lookups go through the path-injection-safe `resolveCatalogName` in `src/app/api/marketplace/config/catalog-config.ts` — any new route that reads a manifest by id must reuse it.

## Deferred / future work

Captured for later (not yet built):

- **Asana OAuth client credentials.** Asana declares optional (non-required) `asana_client_id` / `asana_client_secret` userConfig for MCP V2 pre-registration. They are not env-wired to the remote server and are not currently surfaced or validated. Surfacing/validating them is possible but low-value and potentially misleading unless the transport is rewired.
- **Richer endpoint probe.** Parse the MCP `initialize` response to surface the server's negotiated protocol version and advertised tool count per remote plugin (enhances the shared `checkMcpEndpoint`, benefits every remote plugin — not Asana/Canva-specific).
- **Token scope inspection.** Go beyond "token works" to report whether a GitHub token carries the scopes a package needs (e.g. `repo`, `read:user`).
- **Background reachability.** Periodic remote-endpoint checks with a status dot on remote cards, instead of on-demand only.
- **Raw-secret entry.** Optionally allow typing a raw secret value (→ `.env.local`) for users without the 1Password CLI, if the op://-only friction proves too high.
