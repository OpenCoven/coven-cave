# Skills Directory Integration Design

**Date:** 2026-07-04
**Status:** Approved direction; pending written-spec review
**Surfaces:** `MarketplaceViewSurface`, `SkillBrowser`, role skill chips, workflow skill pickers, `/api/skills/*`

## Goal

Turn the Marketplace `Skills` section into a Cave-native skills directory that
feels comparable to `skills.sh`: searchable, ranked, install-aware, trust-aware,
and useful before and after a skill is installed.

The Skills section remains inside the existing Marketplace hub. It should not
become a standalone marketing page or a separate top-level mode. The hub already
groups `Browse`, `Roles`, `Skills`, and `Capabilities`; this work upgrades the
Skills room so it can serve as both the remote directory and the local installed
skill manager.

## Current State

- `src/components/marketplace-view.tsx` owns the Marketplace hub and loads local
  skills through `/api/skills/local`.
- `src/components/skill-browser.tsx` renders the current three-column local
  browser: category rail, card list, and local `SKILL.md` preview.
- `src/components/skill-detail-drawer.tsx` is still used by role skill chips,
  but it is a separate drawer model from the Skills tab detail pane.
- `src/app/api/skills/local/route.ts` scans shared Coven skills and
  `~/.claude/skills`; DELETE is local-origin gated and constrained to scanned
  skill directories.
- `src/app/api/skills/file/route.ts` previews allow-listed local skill files
  through `src/lib/server/skill-file-paths.ts`.
- `src/app/api/skills/route.ts` proxies the local daemon skill endpoint, but it
  does not provide a registry directory model.
- `src/lib/server/skill-scan.ts` parses `SKILL.md` frontmatter for local skills.

The current Skills tab is good as a file manager for already-installed skills,
but it does not answer registry questions: what is popular, which skills are
official or audited, which agent they target, how to install them, or whether a
local installed skill matches a remote directory entry.

## Reference Shape

The external reference is `skills.sh`. The useful product patterns to adapt are:

- terminal-like header and command affordance
- install command in the form `npx skills add <owner/repo>`
- directory navigation by topics, official entries, audits, and docs
- ranked skill list with install/activity signals
- search, time-window tabs, and agent compatibility filters
- detail surfaces that explain source, tags, agent support, audit state, and
  install path

Cave should use those patterns without copying the site literally. The result
needs to be dense, maintainer-oriented, and consistent with the existing
Marketplace visual system.

## Chosen Approach

Build a registry-backed Skills directory inside the existing Marketplace hub,
then merge local installed skills into the same normalized list.

Rejected alternatives:

- **Local-only polish:** lowest risk, but it would keep Cave from answering the
  main discovery and install questions.
- **Standalone Skills route:** gives the surface more room, but fragments the
  hub and weakens the existing `Browse | Roles | Skills | Capabilities` model.
- **Registry-only rebuild:** attractive for discovery, but it would lose the
  concrete file-management affordances that already work for installed skills.

## Product Design

### Entry and header

`MarketplaceViewSurface` keeps `Skills` as the selected section. When active,
the header changes from a simple local count to a directory header with:

- a compact terminal-style brand line for skills discovery
- a command bar showing the selected skill install command
- copy-to-clipboard for `npx skills add <owner/repo>`
- status pills for registry state, audited count, official count, and installed
  count
- `/` search focus using the existing Marketplace shortcut

The header is a product control surface, not a hero. It should leave the ranked
list visible in the first viewport.

### Navigation and filtering

The Skills section exposes directory-level controls:

- ranking tabs: `All Time`, `Trending`, `Hot`
- trust tabs or toggles: `Official`, `Audited`, `Installed`
- agent filters: `All agents`, `Codex`, `Claude Code`, `Cursor`, `Copilot`,
  `Windsurf`, and any additional agents returned by the registry
- topic chips from registry tags plus local skill tags
- search across name, owner, repo, description, topics, tags, agents, and local
  path

Filters should combine predictably. Selecting `Installed` narrows the same list
instead of switching to a different UI.

### Ranked list

Replace the current card list with a table-like ranked list optimized for scan:

- rank
- skill name and description
- owner/repo or local source
- compatible agents
- activity window signal
- all-time installs
- trust badges
- installed state

Rows must have stable height and predictable keyboard behavior. On narrow panes,
the list can collapse secondary metrics under the name, but the rank, skill,
trust state, and installed state must remain visible.

### Detail panel

The right detail panel becomes the single detail model for both remote and local
skills. It shows:

- name, owner/repo, description, tags, topics, and compatible agents
- install command and copy action for remote entries
- official/audited/source trust badges
- registry URL and source URL when known
- local path, reveal action, delete action, and `SKILL.md` preview when
  installed
- registry summary or README excerpt when remote-only and available
- a clear unavailable state when registry detail cannot be loaded

The existing `SkillDetailDrawer` should either wrap this detail model or be
retired after role skill chips can open the same panel.

### Installed skills

Local scan results remain authoritative for installed state. A registry entry
is marked installed when it matches a local skill by one of these keys, in order:

1. exact registry slug, if stored locally
2. owner/repo identifier from frontmatter or install metadata
3. package/name alias from frontmatter
4. local skill id or directory name

Unmatched local skills appear as installed local-only entries with no registry
rank. They can still be searched, previewed, revealed, and deleted.

### Role and workflow links

Role skill chips and workflow skill pickers should route into the same Skills
directory detail surface:

- exact local or registry match opens the detail panel
- unknown skill text switches to `Skills` and pre-filters the query
- workflow skill pickers can reuse the normalized directory data for labels,
  tags, compatible agents, and install state

This keeps skill discovery, role inspection, and workflow assembly aligned.

## Data Model

Introduce a normalized directory entry type near the Skills feature boundary:

```ts
type SkillDirectoryEntry = {
  id: string;
  slug: string;
  name: string;
  description?: string;
  owner?: string;
  repo?: string;
  packageName?: string;
  tags: string[];
  topics: string[];
  agents: string[];
  installCommand?: string;
  installsAllTime?: number;
  activity8w?: number;
  trendScore?: number;
  hotScore?: number;
  trust: {
    official: boolean;
    audited: boolean;
    source: "registry" | "local" | "daemon" | "fallback";
  };
  registryUrl?: string;
  sourceUrl?: string;
  local?: {
    installed: boolean;
    path?: string;
    scope?: "coven" | "claude-user" | "other-local";
    version?: string;
  };
};
```

The implementation can split this into server and client types, but this is the
contract the UI should consume.

## Data Sources

### Local scan

`/api/skills/local` remains the source for installed skills. Its scanner can be
extended to parse optional fields used for registry matching, such as:

- `owner`
- `repo`
- `source`
- `agents`
- `topics`
- `install`
- `registry`

Existing skills without those fields must continue to work.

### Registry adapter

Add a server-side registry adapter for remote skills. The adapter should hide
registry-provider details behind a small internal API such as
`listSkillDirectoryEntries()` and `getSkillDirectoryEntry(slug)`.

When a `skills.sh` API token or OIDC path is configured, the adapter can query
the live registry. When it is not configured, the UI must still work from a
bundled fallback fixture or recent cache.

### Fallback fixture and cache

Add a checked-in fallback fixture for development and offline mode. It should be
small, representative, and safe to render without network access. If a live
registry query succeeds, cache the normalized result server-side with a clear
timestamp so the UI can show whether data is live or cached.

The UI should distinguish these states:

- live registry
- cached registry
- fallback fixture
- local-only
- registry unavailable

## API Design

Add or extend server routes so the client does not call external registries
directly:

- `GET /api/skills/directory` returns normalized entries, filter metadata,
  source state, and scan timestamp.
- `GET /api/skills/directory/[slug]` returns richer registry detail when
  available.
- `POST /api/skills/install` installs a registry skill through a constrained
  server-side command wrapper.
- Existing `GET /api/skills/local`, `DELETE /api/skills/local`, and
  `GET /api/skills/file` remain the local installed-skill authority.

Install route constraints:

- local-origin gated
- accepts only known registry slugs or exact owner/repo identifiers
- derives the command server-side instead of executing arbitrary client input
- supports explicit agent target options only from an allow-list
- streams or returns structured progress and final local scan state

## Interaction Design

- `/` focuses Skills search through the existing Marketplace shortcut.
- `Enter` on a selected row opens or focuses the detail panel.
- `Cmd/Ctrl+C` on the command bar copies the install command when focused.
- Install updates the row optimistically only after the server accepts the
  request; final state is reconciled from `/api/skills/local`.
- Delete keeps the existing two-step destructive confirmation and local-origin
  gate.
- Reveal keeps the current Tauri desktop behavior and browser clipboard
  fallback.
- Filter changes announce result counts through the existing live region.
- Registry or install failures keep the user's selection and show a scoped
  inline error.

## Visual Design

The page should feel like an operational directory:

- terminal-inspired header treatment, but no oversized landing hero
- table/list-first layout for comparison and fast scanning
- single detail panel, not cards nested inside cards
- compact badges for trust, agents, topics, and installed state
- stable row, toolbar, and detail dimensions across hover, loading, and empty
  states
- mobile and narrow-pane layout that preserves search, ranking tabs, row list,
  and detail access without overlap

Do not turn the Skills section into a marketing splash. The primary value is
finding, inspecting, installing, and managing skills quickly.

## Error Handling

- Registry unavailable: show local installed skills plus fallback or cached
  entries when present.
- Missing registry auth: show fallback/local data and a scoped status message,
  not a full-page failure.
- Remote detail unavailable: keep the row selected and show summary metadata.
- Install failure: clear pending state, keep the command visible, and surface
  the server error.
- Local scan failure: remote directory still renders, but installed markers are
  disabled and the status pill explains why.
- File preview denied by the allow-list: use scanned description or registry
  summary so the detail panel does not go blank.

## Security and Trust

- Do not execute install commands supplied directly by the browser.
- Keep install/delete local-origin gated.
- Preserve the existing file-preview allow-list and byte limit.
- Never expose arbitrary local paths from remote registry data.
- Treat audit badges as metadata, not as a safety guarantee.
- Make source and trust state visible enough that an unaudited skill is not
  confused with an official or audited one.

## Testing

Add source and route tests before relying on rendered verification:

- registry response normalization and fallback fixture loading
- local scan merge and installed-state matching
- ranking sort modes for all-time, trending, and hot
- combined search/filter behavior
- install command derivation from a known slug
- install route rejects arbitrary command input and unlisted agents
- local preview/delete guards still reject unsafe paths
- `MarketplaceViewSurface` keeps `Browse | Roles | Skills | Capabilities`
  ownership and routes role skill chips into the Skills detail path
- workflow skill picker uses normalized labels without losing existing skill ids
- keyboard navigation and live-region announcements for result changes

Rendered verification should cover:

- desktop Skills tab with live or fallback directory data
- narrow pane/mobile Skills tab with no text overlap
- installed local-only skill detail with preview, reveal, and delete controls
- remote-only skill detail with command copy and registry/source links
- registry unavailable state

Expected verification bundle for the implementation PR:

- `node --experimental-strip-types src/components/roles-tools-navigation.test.ts`
- focused new tests for the directory normalizer, API routes, and UI ownership
- `pnpm check:tests-wired`
- `pnpm typecheck`
- `pnpm test:app`
- Playwright screenshot checks for desktop and mobile Skills layouts

## Rollout Phases

1. Add the normalized directory model, fallback fixture, registry adapter, and
   merge tests.
2. Replace `SkillBrowser` with the ranked directory UI inside the existing
   Marketplace `Skills` section.
3. Wire detail panel actions: command copy, install, local preview, reveal,
   delete, and source links.
4. Route role skill chips and workflow skill pickers into the shared detail
   model.
5. Run rendered desktop/mobile QA and open the PR through the protected branch
   path.

## Resolved Defaults

- The directory is registry-backed with local installed skills merged in.
- The UI stays inside Marketplace, not a standalone top-level route.
- A fallback fixture or cache is required so development and offline use still
  render a useful directory.
- Local scan remains authoritative for installed state.
- Registry install work is server-mediated and constrained, not raw shell input
  from the client.
