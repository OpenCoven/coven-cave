# User-owned Marketplace and curated Skills preview

**Date:** 2026-07-29
**Status:** Approved for implementation
**Bead:** `cave-ehhmi`
**Surface:** `MarketplaceViewSurface`

## Goal

Reset Marketplace around inventory the user already owns:

- show catalog packages the user has installed;
- show locally installed or authored skills;
- show local Craft drafts where the existing Crafts feature policy permits;
- stop presenting or fetching unowned third-party discovery inventory; and
- reserve a distinct Skills destination for a future OpenCoven-curated
  marketplace, represented honestly as Coming Soon.

The reset is per-user and non-destructive. Checked-in package metadata remains
available for existing installs, release tooling, and future curation. No local
skill, Craft draft, or install record is deleted.

## Current-state findings

- `marketplace/marketplace.json` contains 128 seeded catalog entries.
- Val's local Cave config currently contains 77 Marketplace install records.
- Nine of those install records no longer have a matching catalog entry, so a
  catalog-only filter would silently hide owned state.
- The local scan roots currently contain 69 `SKILL.md` files before real-path
  deduplication.
- One local Craft draft exists.
- `GET /api/marketplace` currently returns every seeded catalog item plus local
  Craft drafts.
- `GET /api/skills/directory` currently contacts `skills.sh` (or another
  configured registry), falls back to a bundled fixture, and merges local
  skills into the remote results.
- Marketplace loads that remote directory on mount and again while Explore
  search changes.

## Chosen structure

Marketplace uses three visible sections in the production-default flag state:

1. **Yours** — installed and authored inventory.
2. **Skills** — the future curated OpenCoven Skills marketplace preview.
3. **Build** — the existing local skill authoring flow.

This separation keeps current inventory operational without making a future
catalog look populated before Val has curated it.

When the existing Crafts feature flag is explicitly enabled, **Crafts** remains
available between Yours and Skills. It receives the same owned-only data: local
drafts and installed Crafts, never unowned published catalog entries. This
preserves the gated authoring capability without expanding the production
default.

### Rejected alternatives

- **Mix Coming Soon into the owned grid.** This is a smaller visual change, but
  it conflates personal inventory with the future public catalog and makes the
  preview disappear beneath a large installed collection.
- **Make Coming Soon the Marketplace landing.** This creates a stronger launch
  moment, but buries installed items and weakens Marketplace as the management
  surface for things the user already owns.

## Data contract

### Owned catalog packages

`GET /api/marketplace` becomes an owned-inventory endpoint for this surface:

- merge checked-in catalog metadata with `marketplace.installed`;
- keep only installed catalog items;
- prepend valid local Craft drafts;
- synthesize a minimal local-only card for every installed record that has no
  renderable catalog entry; and
- never mutate the underlying install map while reading.

A local-only fallback card exposes only install-record data:

- stable id;
- humanized display name;
- installed version and timestamp;
- source;
- a plain explanation that catalog details are unavailable; and
- an explicit `unlisted` marker in the client model.

It must not guess capabilities, trust, configuration requirements, repository,
or remote installability. Generic removal may clear an unlisted track-only
record only after validating that the id is currently present in
`marketplace.installed`; it cannot remove arbitrary config keys.

Craft installs keep their verified runtime removal path. Craft drafts keep their
existing local lifecycle.

### Owned skills

Marketplace stops calling the remote directory for its inventory. Add a
local-only normalized listing path that:

- scans the same Coven, Claude, Codex, and shared-agent roots already supported
  by `/api/skills/local`;
- deduplicates physical paths;
- converts every result to the existing `SkillBrowserEntry` contract;
- marks every entry installed and locally sourced;
- filters search locally; and
- performs no registry, fallback-fixture, remote Markdown, or install-command
  fetch.

The remote directory implementation may remain dormant for compatibility with
other server routes, but Marketplace mount, search, Build refresh, and surface
warmup must not call it.

## Yours experience

The `browse` route id remains the internal compatibility id, but its visible
label becomes **Yours**. Existing roles/capabilities aliases still land there.

The pool contains:

- installed catalog cards;
- unlisted local install cards;
- locally installed or authored skill cards; and
- locally authored Craft drafts allowed by the active feature policy.

The current unified card grammar and detail drawers remain. Users can:

- search owned items;
- filter by item type;
- inspect and configure installed catalog items;
- remove supported catalog installs;
- open, inspect, and delete local skills through the existing guarded path; and
- open supported local Craft drafts.

Discovery-only UI is removed from Yours:

- Featured collections;
- recommendation ordering;
- install buttons for unowned packages;
- remote install metrics;
- official/community discovery chips;
- directory topics derived from remote inventory; and
- any count that includes unavailable catalog entries.

Status filtering may retain **Needs setup**, because an installed package can
still need configuration. The redundant **Installed** status filter is removed:
every item in Yours is owned.

Loading failures remain distinct from true empty state. A truly empty Yours
surface says that installed and authored items will appear here and links to
Build. A filtered empty state offers **Clear filters**.

## Skills Coming Soon experience

The `skills` route id becomes a visible **Skills** section and does not load
inventory or expose search.

### Visual thesis

The signature line is:

> Skills worth summoning.

This is the surface's single flourish. Supporting copy is plain:

> A smaller, reviewed skills marketplace is taking shape. The first shelf
> stays empty until the work earns a place here.

### Curator's shelf

A responsive, token-only composition presents the real future publication
sequence as three quiet shelf slots:

1. **Review the source** — ownership, provenance, and maintenance are clear.
2. **Verify the behavior** — instructions are tested in Cave.
3. **Publish for familiars** — the reviewed skill becomes discoverable.

The slots use the design system's dashed-affordance grammar because they
represent future placement, not fake catalog cards. One continuous horizontal
shelf line ties them together on wide panes and becomes a vertical sequence in
narrow panes. No fake skills, install counts, trust badges, or release dates are
shown.

The page carries a `Coming soon` status pill and two useful exits:

- **View your skills** — returns to Yours prefiltered to Skills.
- **Build a skill** — opens the existing Build section.

Motion is limited to a subtle staged entrance using existing duration/easing
tokens, with a reduced-motion override that renders the final state
immediately.

## Build integration

Build remains functionally unchanged. After a successful save:

- invalidate the local-only skill resource;
- refresh owned skills; and
- **View skills** returns to Yours with the Skills type selected.

It must not navigate to the Coming Soon section or trigger a remote directory
request.

## Routing and preferences

- `browse` remains the persisted id for **Yours**.
- `skills` becomes the persisted id for the Coming Soon section.
- `crafts` remains a feature-gated section and falls back to Yours while the
  flag is disabled.
- legacy links that intentionally mean “show my skills” use an explicit helper
  that selects `browse` plus the Skills type rather than relying on the
  `skills` section id.
- invalid or retired Marketplace preferences continue to normalize safely.
- Search is rendered only for Yours and other sections with real collections;
  Skills Coming Soon and Build do not render search.

## Accessibility and design-system requirements

- Use semantic tokens and shared primitives only.
- All interactive elements receive `.focus-ring`.
- The Coming Soon sequence uses an ordered list because it represents an actual
  review order.
- Decorative shelf elements are hidden from assistive technology.
- The status and explanatory copy do not rely on color.
- The page is usable at narrow pane widths and touch-safe on mobile.
- Any entrance motion has a `prefers-reduced-motion` override.
- Verify dark, light, and one non-default theme.
- Copy follows `docs/coven-design-language.md` section 10.

## Error handling

- Catalog load failure: show a scoped error with **Retry**; do not render a
  convincing empty library.
- Local skill scan failure: keep catalog installs visible and show a scoped
  skills diagnostic.
- Unlisted installed record: show the local-only fallback card; missing catalog
  metadata is not a page-level failure.
- Unsupported removal: keep the item visible and announce the server's
  actionable error.
- Coming Soon requires no network and therefore has no loading state.

## Verification

Focused contracts must prove:

- owned catalog selection excludes every uninstalled seed;
- every installed record is represented, including records missing from the
  catalog;
- drafts remain present without making published unowned Crafts visible;
- Marketplace's skill resource uses the local-only listing path;
- search does not trigger a remote skills-directory request;
- the remote Skills cards and drawer are not mounted by Marketplace;
- the visible sections are `Yours | Skills | Build`;
- Build's **View skills** action selects Yours + Skills;
- Coming Soon copy, ordered review sequence, actions, reduced-motion rule, and
  responsive styling are pinned;
- existing install configuration, local-skill deletion, and Craft guards remain
  intact; and
- all new tests are wired.

Run:

- focused Marketplace/API/source-contract tests;
- `pnpm check:tests-wired`;
- `pnpm typecheck`;
- `pnpm lint`;
- `pnpm test:app`;
- `git diff --check`; and
- rendered native-app verification at desktop and narrow pane widths, in dark,
  light, and one non-default theme.

## Non-goals

- Publishing the first curated Skills collection.
- Deleting checked-in Marketplace packages.
- Deleting or migrating local install records.
- Replacing the Build editor.
- Redesigning Craft authoring or enabling the hidden Crafts section.
- Removing dormant registry APIs that may still serve non-Marketplace callers.
