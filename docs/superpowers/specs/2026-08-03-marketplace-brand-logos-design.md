# Marketplace Brand Logos Design

**Date:** 2026-08-03
**Status:** Approved design; awaiting written-spec review
**Bead:** `cave-5i04y`

## Problem

Marketplace application cards and their detail headers currently identify every
entry with the same generic icon for its kind. That keeps the catalog coherent,
but makes recognizable integrations such as GitHub, Slack, Stripe, and Figma
unnecessarily slow to scan. The current catalog contains 128 entries, spanning
external products, generic utilities, and OpenCoven-authored skills and Crafts.
A comprehensive treatment therefore needs an explicit coverage policy rather
than a best-effort collection of icons.

## Decision

Add a local, catalog-keyed brand-mark registry and render it in both Marketplace
card and detail-header identity tiles. Every current entry will be classified as
either:

1. **branded** — a recognizable external product, service, company, framework,
   or project with an authoritative mark;
2. **generic** — a protocol, capability, content pack, OpenCoven-authored item,
   or utility for which the existing kind icon is the clearer identity; or
3. **unresolved** — a name that suggests a brand but has no authoritative asset
   or unambiguous ownership. Unresolved entries use the generic fallback until
   an authoritative mark is available.

“Comprehensive” means every recognizable external brand in the current catalog
is deliberately mapped and every other entry is deliberately classified. It
does not mean inventing marks for generic tools or guessing from product names.

## Registry and asset pipeline

The runtime lookup is keyed by the stable Marketplace `plugin.id`; catalog
titles and URLs are not used to infer brands. The implementation will add:

- a small handwritten source map that associates catalog IDs with an
  authoritative brand source and records intentional generic or unresolved
  classifications;
- `scripts/generate-marketplace-brand-marks.mjs`, which validates the map and
  emits only the SVG data used by the current catalog;
- a checked-in generated TypeScript registry consumed by the client; and
- `MarketplaceBrandMark`, a presentation component that returns `null` when an
  entry has no branded mark.

Simple Icons is the default source for single-path brand geometry and metadata.
It may be installed as a development-only generation dependency; Marketplace
runtime code must not import the package. Brands absent from Simple Icons may
use a checked-in official SVG only when its source and usage are documented.
The generated registry contains the minimal view-box, path, and presentation
data needed by the mapped catalog entries.

No asset is fetched at runtime. There are no favicons, external image hosts,
URL-derived guesses, or new network/privacy failure modes. The Marketplace
catalog schema remains unchanged.

Simple Icons data is distributed under CC0; the source map and generated-file
header will preserve required source notes. All product names and marks remain
trademarks of their owners and imply no endorsement.

## Rendering and visual treatment

`MarketplaceBrandMark` renders an inline SVG inside the identity tile already
owned by `MarketplaceCard` and the standard Marketplace detail header. If the
registry has no mark, each caller renders its existing kind icon unchanged.
Install state, card actions, layout structure, and Marketplace behavior do not
change.

- Inherently multicolor official marks keep their official local fills.
- Single-color marks use `currentColor`, allowing the existing tokenized tile
  foreground to remain legible across themes and modes.
- Brand geometry is optically contained within the existing 36px card tile and
  40px detail tile, using the established icon-size tokens rather than changing
  card density.
- Marks are decorative (`aria-hidden="true"`) because the adjacent product name
  is the accessible identity. A failed or missing lookup produces the generic
  icon, never broken-image UI or an empty tile.

Brand colors and SVG fills live in validated asset data, not ad hoc render
styles. All surrounding spacing, surfaces, borders, radii, focus behavior, and
motion continue to use the Coven design tokens and shared primitives. The
feature must survive every supported palette and mode, with focused visual
checks in representative light and dark combinations.

## Coverage contract

Generation and tests will audit all current catalog IDs. They will fail when:

- a mapped ID does not exist in `marketplace/marketplace.json`;
- an entry is missing a branded, generic, or unresolved classification;
- the same ID appears in more than one classification;
- generated SVG data is malformed, contains a remote URL, or is stale;
- a brand source referenced by the map cannot be resolved; or
- a newly added catalog entry has not been reviewed for brand eligibility.

This keeps future catalog additions explicit without forcing a logo onto every
item. The source map is the reviewable coverage ledger; the generated registry
is an implementation artifact.

## Component behavior

The card and detail header use the same registry and renderer so their identity
cannot drift. The lookup sequence is:

1. resolve the catalog entry by `plugin.id`;
2. render the mapped local brand mark when one exists; and
3. otherwise render the caller's existing kind-specific Phosphor icon.

The renderer has no loading, retry, or error state because all data is local and
validated at generation time. Unexpected runtime input fails closed to the
generic icon.

## Verification

Implementation verification will include:

- focused registry, generator, coverage, and component tests;
- a generation freshness check suitable for CI;
- source-contract checks that both the card and detail header use the shared
  brand renderer and retain the generic fallback;
- `pnpm typecheck`, `pnpm lint`, the design codemod check, and
  `git diff --check`;
- the relevant Marketplace test set followed by the full app suite; and
- native Tauri inspection via `bash scripts/dev-app.sh` at narrow and wide
  Marketplace widths, in representative light and dark themes.

The visual pass will include representative multicolor marks, monochrome marks,
long product names, installed and uninstalled cards, a generic fallback, and the
same branded entry in its detail view. Keyboard focus and accessible-name output
must remain unchanged.

## Out of scope

- Redesigning Marketplace cards, detail navigation, installation, or catalog
  loading.
- Adding logos to OpenCoven-authored skills, Crafts, generic capabilities, or
  ambiguous entries merely to eliminate fallbacks.
- Fetching, proxying, or caching third-party assets at runtime.
- Adding brand fields to Marketplace catalog JSON or changing catalog sync
  semantics.
- Creating new product marks or modifying official brand geometry.
