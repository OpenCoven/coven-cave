# Marketplace

Coven Cave is the canonical user-facing marketplace surface for first-party OpenCoven plugins and MCP integrations. The seeded package catalog lives in `marketplace/catalog.json`, and `scripts/sync-marketplace.py` expands that catalog into:

- `marketplace/plugins/<name>/plugin.json`
- `marketplace/plugins/<name>/skills/<name>/SKILL.md`
- `marketplace/plugins/<name>/.codex-plugin/plugin.json`
- `marketplace/marketplace.json`
- `marketplace/.claude-plugin/marketplace.json`
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

## Knowledge Packs

`kind: "knowledge-pack"` entries bundle a seeded knowledge base — folders with
entity schemas, entry templates, an agent skill, cadence prompts, and audit
workflows — compiled by the sync script into `plugins/<pack>/pack.json` plus
copied `templates/` and whole `skills/<id>/` directories (so `references/`
ship). Install & seed flows, the vault/project seed targets, and the skill
package install API are documented in [knowledge-packs.md](knowledge-packs.md).

## Crafts

Crafts sit between Roles and Skills: a Craft is a **versioned, installable
Role loadout** — a bundle of marketplace plugins plus bundled skills, prompt
templates, and workflows that a Role equips as one unit. The model composes as:

```
Familiar → Role → Craft → Skills / MCPs / prompts / workflows / capabilities
```

- **Plugin** stays the distribution format. Every Craft is a `catalog.json`
  entry with `kind: "craft"`, and `scripts/sync-marketplace.py` expands it into
  a standard multi-resource Codex plugin package under
  `marketplace/plugins/<name>/` like any other package.
- **Craft** adds a `craft` specification (`schemaVersion:
  "opencoven.craft.v1"`): `components.required` / `components.optional`
  reference other catalog plugins by name; `bundled.skills` / `bundled.prompts`
  / `bundled.workflows` carry sourced resources with per-file `contentHash`
  (`sha256:`) pins; plus `requiredCapabilities`, `recommendedRoles`, and
  `provenance` (upstream, commit, license, modifications, source, licensePath).
  Optional `mcpServers` declare servers the bundle needs.
- **Collection** is the curated presentation layer — the "Featured
  collections" strips defined in `COLLECTIONS`
  (`src/lib/marketplace-catalog.ts`) group catalog entries, including Crafts,
  for browsing. Collections are ordering/curation only; they carry no install
  semantics.
- **Grimoire** is the human-reviewed publication analog: audited research
  Craft content follows the same draft-first, human-approved trail the Coven
  Grimoire uses for public writing. No Craft content reaches the catalog
  without a human-reviewed PR.

Equipping is a **routing and presentation boundary, not a security sandbox**:
an equipped Craft changes what a Role surfaces and routes to, and effective
composition is resolved by `src/lib/role-craft-composition.ts`, but it grants
no isolation beyond what the underlying runtime enforces.

### Lifecycle

Preview → verify/install → equip → resolve → detach → remove:

- **Preview.** `GET /api/marketplace/crafts/plan?id=<craft>` returns the exact
  install plan (components, bundled resources, required config) before
  anything is written. Read-only, so it is not local-origin gated.
- **Install (verified).** `POST /api/marketplace/crafts/install` runs the
  transactional installer (`src/lib/server/craft-install-service.ts`): every
  component installs through the runtime (Codex) with verification, and the
  install is recorded in `~/.coven/cave/config.json` under
  `marketplace.installed` with `runtime`, `verifiedAt`, and `craftVersion`.
  Failures roll back under a keyed transaction lock, preserving diagnostics.
  The generic `/api/marketplace/install` track-only route refuses Crafts.
  Installs require the `opencoven-first-party` Codex marketplace to be
  registered once — current Codex CLIs read the manifest from
  `.claude-plugin/marketplace.json` inside the registered root:

  ```bash
  codex plugin marketplace add /path/to/coven-cave/marketplace
  ```

- **Equip / detach.** `POST /api/roles/crafts` attaches or detaches an
  installed Craft on a Role manifest (`src/lib/server/role-crafts.ts`).
  Version drift surfaces as `craft_update_required`.
- **Remove.** `POST /api/marketplace/crafts/uninstall` refuses while any Role
  still has the Craft equipped (`craft_equipped`, with affected-role
  diagnostics) — detach everywhere first.

All mutating Craft routes are local-origin gated and guard malformed JSON
bodies; the contract is asserted in `src/app/api/api-contracts.test.ts` and
`src/app/api/marketplace/crafts-routes.test.ts`.

### Draft Crafts

The Crafts tab authors **reversible local draft Crafts** through one
progressive drawer (`src/components/marketplace/craft-create-drawer.tsx`;
flow spec in [`craft-ux.md`](craft-ux.md)):

- **Describe it** (default): the operator states a goal; a chat brief carrying
  the full drafts-API contract dispatches to a familiar
  (`src/lib/craft-agent-prompt.ts`, mirrored by the `craft-builder` skill).
  The in-flight build persists as a sessionStorage watch
  (`src/lib/craft-arrival.ts`) that the drawer *and* the Crafts tab resume —
  arrival is announced and opens the draft wherever the operator is.
- **Pick roles** (remembered once chosen): select one familiar's roles —
  switching familiars retains each familiar's picks — then **preview the real
  extraction ledger before anything is written** (client-side synthesis via
  the pure `buildCraftDraftFromRoles`), optionally rename (bounded
  `displayName`; the id stays derived), and save
  (`POST /api/marketplace/crafts/drafts`).

Direct and effective skills, tools, MCP servers, plugins, prompts, and
workflows are collected with origin labels into a review ledger
(`src/lib/craft-draft.ts`). The draft detail renders that attributed ledger
(shared `CraftDraftPreview`), shows a lifecycle strip
(Draft → Published → Installed → Equipped), verifies the draft through the
**draft-aware plan** — `GET /api/marketplace/crafts/plan` falls back to the
drafts store and returns `ok: true` plus `draftDiagnostics` naming extracted
local references that can't verify until publication — and offers Adjust
roles (seeded re-edit, recreate-and-replace), Refine in chat, Prepare for
catalog, and guarded delete. Drafts are local authoring state — publishing
one into the catalog still goes through the human-reviewed update process
below.

### Human-Reviewed Upstream Updates

Craft content is vendored, pinned, and only updated by humans:

- Upstream sources are vendored under `marketplace/craft-sources/<craft>/`,
  and each bundled resource records its `sourcePath` and `contentHash`.
- `provenance` pins the upstream `commit`, `license`, `licensePath`, and lists
  every local `modification`.
- Updating a Craft from upstream means a **human-reviewed PR** that
  re-vendors the content, refreshes hashes/commit/modifications, bumps the
  Craft `version`, and re-runs `python3 scripts/sync-marketplace.py --check`
  plus `scripts/crafts-audited-content.test.mjs` (which asserts the pinned
  commit, license, per-skill content hashes, and generated plugin packages).
  No automated pipeline pulls upstream changes into the catalog.

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

Cave records local marketplace installs in `~/.coven/cave/config.json` under `marketplace.installed`. This records which package the user chose so Cave can layer configuration, export application, and harness setup on top. It never stores raw secrets — see Configuration & Validation below.

## Configuration & Validation

The Marketplace surface lives as a **Marketplace** tab on the Roles page. Beyond browse + track-install, it can configure and validate a package:

- **Credential collection.** Each required `userConfig` field declares the env var its MCP server resolves (`env` key in `catalog.json`). The Configure modal collects values, split by `sensitive`:
  - **Sensitive** secrets (e.g. `github_token` → `GITHUB_PAT`) are stored as **1Password `op://` references** via the vault (`/api/vault`). Cave never stores the raw secret value.
  - **Non-sensitive** config (e.g. a filesystem root path) is written to `.env.local` via `/api/marketplace/config`. The env key is always taken from the trusted manifest (allowlist-selected), never built from the request.
- **Secret validation.** For fields with a registered validator (`src/lib/secret-validators.ts`, GitHub only today), the modal can **Test** the resolved secret server-side against the provider's API (GitHub `/user`) — pass/fail + login, never returning the token. `POST /api/marketplace/config/validate`. Advisory: validation does not gate the "Configured" state.
- **Endpoint validation.** Remote (URL-based) MCP plugins (Linear, Vercel, Canva, Asana) have no stored secret — they authenticate via in-client OAuth. The detail drawer's **Connection** section offers **Test connection**, a generic reachability probe (`src/lib/endpoint-validators.ts`) that POSTs a JSON-RPC `initialize` and reports reachable / sign-in-on-connect / unreachable. `POST /api/marketplace/validate-endpoint`. Advisory connectivity check, not user auth.

All package-id → filesystem-path lookups go through the path-injection-safe `resolveCatalogName` in `src/app/api/marketplace/config/catalog-config.ts` — any new route that reads a manifest by id must reuse it.

## Prompt packs

Packs whose capability is `prompts` ship reusable composer templates. The detail pane previews each template (icon, description, body snippet, tags) via `GET /api/marketplace/pack-prompts?id=<pack>` — which works pre-install — and offers a **Try it** that hands the body to the Home composer. See [`prompt-packs.md`](prompt-packs.md) for the file format, the `{{placeholder|default}}` grammar and Tab flow, precedence rules, and how to author a pack.

## Deferred / future work

Captured for later (not yet built):

- **Asana OAuth client credentials.** Asana declares optional (non-required) `asana_client_id` / `asana_client_secret` userConfig for MCP V2 pre-registration. They are not env-wired to the remote server and are not currently surfaced or validated. Surfacing/validating them is possible but low-value and potentially misleading unless the transport is rewired.
- **Richer endpoint probe.** Parse the MCP `initialize` response to surface the server's negotiated protocol version and advertised tool count per remote plugin (enhances the shared `checkMcpEndpoint`, benefits every remote plugin — not Asana/Canva-specific).
- **Token scope inspection.** Go beyond "token works" to report whether a GitHub token carries the scopes a package needs (e.g. `repo`, `read:user`).
- **Background reachability.** Periodic remote-endpoint checks with a status dot on remote cards, instead of on-demand only.
- **Raw-secret entry.** Optionally allow typing a raw secret value (→ `.env.local`) for users without the 1Password CLI, if the op://-only friction proves too high.
