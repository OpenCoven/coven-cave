# Marketplace Brand Logos Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add recognizable, local brand marks to every eligible Marketplace application card and standard detail header while preserving the existing kind-icon fallback for generic, ambiguous, and unlisted entries.

**Architecture:** A checked-in coverage ledger classifies all 128 catalog IDs. A build-time generator resolves monochrome paths from `simple-icons`, converts selected multicolor Iconify “SVG Logos” entries and reviewed official SVGs into embedded data URIs, and emits one runtime-only TypeScript registry. A shared presentational component renders that registry in both Marketplace identity tiles; absent entries keep the current Phosphor icon.

**Tech Stack:** TypeScript 6, React 19, Next.js 16, Node.js ESM scripts, `simple-icons@16.28.0`, `@iconify-json/logos@1.2.12`, inline SVG, local SVG data URIs, Node assertion tests, Coven design tokens.

---

## File structure

- Create `marketplace/brand-marks.json` — handwritten, exhaustive catalog classification and source metadata.
- Create `marketplace/brand-assets/*.svg` — reviewed official SVG inputs only for brands absent from the two packaged sources; never served directly.
- Create `scripts/generate-marketplace-brand-marks.mjs` — validates catalog coverage and sources, sanitizes/embeds SVG data, and emits the runtime registry.
- Create `scripts/marketplace-brand-marks.test.mjs` — independent coverage, safety, and generation-freshness contract.
- Create `src/lib/marketplace-brand-marks.gen.ts` — generated runtime registry; no source URLs, package imports, or remote assets.
- Create `src/components/marketplace/marketplace-brand-mark.tsx` — decorative shared renderer and pure lookup helper.
- Create `src/components/marketplace/marketplace-brand-mark.test.ts` — source-contract tests for lookup, accessibility, sizing, and both call sites.
- Modify `src/components/marketplace/marketplace-card.tsx` — replace only the leading identity glyph when a mark exists.
- Modify `src/components/marketplace/marketplace-detail.tsx` — apply the same replacement to the standard detail header.
- Modify `src/styles/globals/surface-marketplace.css` — token-sized brand-mark hooks inside existing tiles.
- Modify `scripts/run-tests.mjs` — wire both new tests into the app suite.
- Modify `package.json` and `pnpm-lock.yaml` — generation-only dependencies and scripts; no runtime dependency.

The Marketplace catalog schema, sync pipeline, installation behavior, Crafts, Knowledge packs, and generic metadata icons remain untouched.
No asset is fetched at runtime; package data and reviewed SVGs are resolved only by the generator.

## Coverage ledger

`marketplace/brand-marks.json` uses this shape:

```json
{
  "schemaVersion": 1,
  "brands": {
    "github": { "kind": "simple-icons", "icon": "github" },
    "gmail": { "kind": "iconify-logos", "icon": "google-gmail" },
    "canva": {
      "kind": "asset",
      "asset": "canva.svg",
      "sourceUrl": "https://www.canva.com/newsroom/news/canva-brand/"
    }
  },
  "generic": ["filesystem"],
  "unresolved": {
    "serena": "No stable, authoritative SVG mark is published."
  }
}
```

The complete intended classification is fixed below. The test compares these sections with `marketplace/marketplace.json`, so every catalog ID appears exactly once.

### Simple Icons mappings (theme-aware `currentColor`)

```text
github=github
linear=linear
vercel=vercel
xurl=x
git=git
chrome-devtools=googlechrome
searxng=searxng
supabase=supabase
mongodb=mongodb
terraform=terraform
notion=notion
atlassian=atlassian
stripe=stripe
netdata=netdata
unity=unity
nuget=nuget
nuxt-dev=nuxt
next-devtools=nextdotjs
1password=1password
linear-issue-management=linear
ask-curl=curl
lit-ui-designer=lit
tauri-apple-release=tauri
daily-dev-agentic=dailydotdev
threejs-animation=threedotjs
postgres=postgresql
sentry=sentry
cloudflare-docs=cloudflare
huggingface=huggingface
elevenlabs=elevenlabs
sqlite=sqlite
shadcn-ui-and-radix=shadcnui
tailwind-design-tokens=tailwindcss
framer-motion-patterns=framer
```

### Iconify SVG Logos mappings (embedded multicolor data URI)

```text
gmail=google-gmail
google-calendar=google-calendar
asana=asana-icon
markitdown=microsoft-icon
playwright=playwright
figma=figma
codex-session-manager=openai-icon
slack=slack
```

### Reviewed official-asset mappings

Reuse one asset for product families so the mark cannot drift between related listings.

```text
context7=context7.svg
firecrawl=firecrawl.svg
tavily=tavily.svg
apify=apify.svg
activepieces=activepieces.svg
stackql=stackql.svg
openclaw-dev=openclaw.svg
openclaw-trust=openclaw.svg
lobster=openclaw.svg
tinyfish-browser=tinyfish.svg
tinyfish-fetch=tinyfish.svg
tinyfish-search=tinyfish.svg
tinyfish-agent-run=tinyfish.svg
tinyfish-web-agent=tinyfish.svg
heygen-skills=heygen.svg
higgsfield-generate=higgsfield.svg
exa=exa.svg
e2b=e2b.svg
browserbase=browserbase.svg
remotion=remotion.svg
```

Use these authoritative review sources in the ledger. Store the exact downloadable SVG source in `sourceUrl` when the provider exposes one; otherwise store the official brand page or upstream repository plus the asset's upstream path in `sourcePath`.

| Asset | Review source |
| --- | --- |
| `context7.svg` | `https://github.com/upstash/context7` |
| `firecrawl.svg` | `https://github.com/firecrawl/firecrawl` |
| `tavily.svg` | `https://github.com/tavily-ai/tavily-mcp` |
| `apify.svg` | `https://github.com/apify/actors-mcp-server` |
| `activepieces.svg` | `https://github.com/activepieces/activepieces` |
| `stackql.svg` | `https://stackql.io/` |
| `openclaw.svg` | `https://github.com/openclaw/openclaw` |
| `tinyfish.svg` | `https://www.tinyfish.ai/` |
| `heygen.svg` | `https://www.heygen.com/brand-kit` |
| `higgsfield.svg` | `https://higgsfield.ai/` |
| `exa.svg` | `https://docs.exa.ai/reference/exa-mcp` |
| `e2b.svg` | `https://github.com/e2b-dev/mcp-server` |
| `browserbase.svg` | `https://github.com/browserbase/mcp-server-browserbase` |
| `remotion.svg` | `https://www.remotion.dev/` |

If an authoritative source does not publish a usable SVG or its usage terms prohibit this descriptive integration placement, move that ID to `unresolved` with the exact reason instead of tracing, approximating, or generating a logo. Never use screenshots, favicons, AI-generated marks, or third-party logo redraws for this section.

### Intentional unresolved entries

```text
azure=Microsoft's trademark guidelines require an express license for logos and product icons; no license is documented.
azure-devops=Microsoft's trademark guidelines require an express license for logos and product icons; no license is documented.
brightdata=Official trademark policy requires written consent for logo use; no consent is documented.
canva=Canva's trademark policy requires approval for logo use on products and websites; no approval is documented.
dbhub=No stable, authoritative SVG mark is published.
desktop-commander=No stable, authoritative SVG mark is published.
fabric=Microsoft's trademark guidelines require an express license for logos and product icons; no license is documented.
microsoft-learn=Microsoft's trademark guidelines require an express license for logos and product icons; no license is documented.
nodriver=No stable, authoritative SVG mark is published.
pptx-generator=Microsoft's trademark guidelines require an express license for logos and product icons; no license is documented.
serena=No stable, authoritative SVG mark is published.
```

### Intentional generic fallbacks

```text
filesystem
fetch
memory
sequential-thinking
time
coven-familiars
codeflow-maintainer
coven-parallel-work
disk-space-optimizer
memory-timeline-manager
pr-agent
research-ingestion
archivists-index
alchemists-crucible
oracles-measure
scribes-quill
grand-research-ritual
artificers-codex
seekers-lens
skill-scanner
epub-to-pdf
ml-engineer
project-manager
ritual-dapp-frontend
board
opencoven-design
prompt-engineer
cleanup-unused-files
discrawl
maintainer-bar
ocr
opencoven-role-creation-process
prompt-vault
security-agent
coven-flows
coven-memory
coven-evals
coven-canvas
coven-automations
wcag-a11y-audit
form-ux-patterns
dataviz-dashboard-ux
command-palette-keyboard-ux
empty-loading-error-states
mobile-touch-ux
design-system-landscape
pretext
brand-voice-generator
mcp-client
skill-creator
sop-creator
worldbuilding
prompt-pack-essentials
prompt-pack-shipping
charms-loom
```

---

### Task 1: Pin exhaustive catalog coverage

**Files:**
- Create: `marketplace/brand-marks.json`
- Create: `scripts/marketplace-brand-marks.test.mjs`
- Modify: `scripts/run-tests.mjs:245-255`

- [ ] **Step 1: Recheck ownership and duplicate delivery before implementation**

Run:

```bash
bd show cave-5i04y
gh pr list --state all --search 'marketplace logo OR marketplace brand OR cave-5i04y' --json number,title,state,headRefName,url
git fetch origin main
git status --short --branch
```

Expected: `cave-5i04y` still records this branch as active, no competing PR already delivers the feature, and the worktree contains only the approved spec/plan commits or documents. If `origin/main` moved, rebase the signed spec commit before changing implementation files.

- [ ] **Step 2: Write the failing coverage test**

Create `scripts/marketplace-brand-marks.test.mjs` with the independent coverage contract:

```js
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const catalog = JSON.parse(readFileSync(new URL("../marketplace/marketplace.json", import.meta.url), "utf8"));
const ledger = JSON.parse(readFileSync(new URL("../marketplace/brand-marks.json", import.meta.url), "utf8"));

assert.equal(ledger.schemaVersion, 1);
const catalogIds = catalog.plugins.map((plugin) => plugin.name).sort();
const brandIds = Object.keys(ledger.brands).sort();
const genericIds = [...ledger.generic].sort();
const unresolvedIds = Object.keys(ledger.unresolved).sort();
const classifiedIds = [...brandIds, ...genericIds, ...unresolvedIds].sort();

assert.deepEqual(classifiedIds, catalogIds, "every catalog ID is classified exactly once");
assert.equal(new Set(classifiedIds).size, classifiedIds.length, "classifications never overlap");
assert.equal(brandIds.length, 62, "brand coverage only changes through an explicit ledger review");
assert.equal(genericIds.length, 55, "generic fallback count is ratcheted");
assert.equal(unresolvedIds.length, 11, "unresolved brand candidates stay explicit");

for (const [id, source] of Object.entries(ledger.brands)) {
  assert.ok(["simple-icons", "iconify-logos", "asset"].includes(source.kind), `${id} has a supported source kind`);
  if (source.kind === "asset") {
    assert.match(source.asset, /^[a-z0-9-]+\.svg$/, `${id} uses a local SVG filename`);
    assert.match(source.sourceUrl, /^https:\/\//, `${id} records an authoritative source`);
  } else {
    assert.match(source.icon, /^[a-z0-9-]+$/, `${id} uses a package icon slug`);
  }
}

for (const [id, reason] of Object.entries(ledger.unresolved)) {
  assert.ok(reason.trim().length >= 24, `${id} explains why it has no brand asset`);
}

console.log("marketplace-brand-marks.test.mjs: coverage ok");
```

Append `"scripts/marketplace-brand-marks.test.mjs"` immediately after `scripts/sync-marketplace.test.mjs` in the app suite.

- [ ] **Step 3: Run the test to verify it fails**

Run:

```bash
node scripts/marketplace-brand-marks.test.mjs
```

Expected: FAIL with `ENOENT` for `marketplace/brand-marks.json`.

- [ ] **Step 4: Add the complete ledger**

Create `marketplace/brand-marks.json` from the exact mappings and fallback lists above. Keep keys alphabetized within `brands` and `unresolved`, keep `generic` alphabetized, and include a top-level `notice`:

```json
"notice": "Product names and marks belong to their owners. Inclusion identifies an integration and does not imply endorsement."
```

For each official asset, include both `sourceUrl` and, when applicable, `sourcePath`. Do not add a branded entry until its exact source passes the review rule above.

- [ ] **Step 5: Run the coverage test and wiring guard**

Run:

```bash
node scripts/marketplace-brand-marks.test.mjs
pnpm check:tests-wired
```

Expected: both commands pass and print the coverage success line.

- [ ] **Step 6: Create a review checkpoint**

Run:

```bash
git diff --check
git diff -- marketplace/brand-marks.json scripts/marketplace-brand-marks.test.mjs scripts/run-tests.mjs
```

Expected: only the ledger and its test wiring are present. If the current execution turn explicitly authorizes commits, create a signed commit:

```bash
git add marketplace/brand-marks.json scripts/marketplace-brand-marks.test.mjs scripts/run-tests.mjs
git commit -S -m "test: define marketplace brand coverage"
```

Otherwise leave this unit uncommitted and report it at handoff.

---

### Task 2: Generate a safe, runtime-local registry

**Files:**
- Create: `marketplace/brand-assets/*.svg`
- Create: `scripts/generate-marketplace-brand-marks.mjs`
- Create: `src/lib/marketplace-brand-marks.gen.ts`
- Modify: `scripts/marketplace-brand-marks.test.mjs`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`

- [ ] **Step 1: Add the generation-only packages**

Run:

```bash
pnpm add -D simple-icons@16.28.0 @iconify-json/logos@1.2.12
```

Expected: only `devDependencies` and the lockfile change. Neither package appears under runtime `dependencies`.

- [ ] **Step 2: Extend the test with a failing freshness and safety contract**

Append to `scripts/marketplace-brand-marks.test.mjs`:

```js
const generator = new URL("./generate-marketplace-brand-marks.mjs", import.meta.url);
assert.equal(existsSync(generator), true, "brand registry generator exists");

const check = spawnSync(process.execPath, [fileURLToPath(generator), "--check"], {
  cwd: fileURLToPath(new URL("..", import.meta.url)),
  encoding: "utf8",
});
assert.equal(check.status, 0, check.stderr || check.stdout);

const generated = readFileSync(new URL("../src/lib/marketplace-brand-marks.gen.ts", import.meta.url), "utf8");
assert.doesNotMatch(generated, /https?:\/\//, "runtime registry contains no remote URL");
assert.doesNotMatch(generated, /from ["'](?:simple-icons|@iconify)/, "runtime registry imports no generation package");
assert.match(generated, /Product names and marks belong to their owners/);
```

- [ ] **Step 3: Run the test to verify it fails**

Run:

```bash
node scripts/marketplace-brand-marks.test.mjs
```

Expected: FAIL because `scripts/generate-marketplace-brand-marks.mjs` does not exist.

- [ ] **Step 4: Add reviewed official SVG inputs**

Create the 14 unique files listed in the official-asset table under `marketplace/brand-assets/`. Normalize each file to a tight `viewBox`, remove XML declarations, comments, metadata, scripts, event attributes, external references, embedded raster images, and unused definitions. Preserve official path geometry and official fills; do not redraw or recolor marks.

Each source SVG must be at most 16 KiB. The full official-asset directory must remain below 180 KiB so the lazy Marketplace chunk does not quietly absorb unbounded artwork.

- [ ] **Step 5: Implement the generator**

Create `scripts/generate-marketplace-brand-marks.mjs` with these exact public contracts:

```js
const CHECK = process.argv.includes("--check");
const MAX_SOURCE_SVG_BYTES = 16 * 1024;
const MAX_EMBEDDED_ASSET_BYTES = 180 * 1024;
const SAFE_SVG_DENY_RE = /<script|<foreignObject|\son[a-z]+\s*=|(?:href|src)\s*=\s*["'](?:https?:|\/\/|data:)|url\s*\(\s*["']?(?:https?:|\/\/|data:)/i;

export function sanitizeSvg(source, label) {
  if (!/<svg\b/i.test(source) || !/viewBox\s*=\s*["'][^"']+["']/i.test(source)) {
    throw new Error(`${label}: SVG and viewBox are required`);
  }
  if (SAFE_SVG_DENY_RE.test(source)) throw new Error(`${label}: unsafe or remote SVG content`);
  return source.trim();
}

export function svgDataUri(svg) {
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}
```

The generator must then:

1. read the catalog and ledger;
2. repeat the exhaustive/overlap validation rather than trusting the test;
3. resolve `simple-icons` by `icon.slug` and emit `{ kind: "path", title, path }`;
4. read `@iconify-json/logos/icons.json`, resolve the requested icon body plus width/height, wrap it in a complete sanitized SVG, and emit `{ kind: "image", title, src: dataUri }`;
5. read reviewed asset SVGs, enforce per-file and total byte caps, sanitize them, and emit the same image shape;
6. deduplicate identical image data so related IDs reference one generated constant;
7. sort every emitted ID for deterministic diffs;
8. write `src/lib/marketplace-brand-marks.gen.ts` only when content differs; and
9. in `--check` mode, compare without writing and exit nonzero with `Run pnpm generate:marketplace-brands` when stale.

The generated file begins with:

```ts
// Generated by scripts/generate-marketplace-brand-marks.mjs. Do not edit.
// Source geometry: Simple Icons and SVG Logos are CC0; reviewed provider assets
// retain their owners' trademarks and usage terms.
// Product names and marks belong to their owners. Inclusion identifies an
// integration and does not imply endorsement.

export type MarketplaceBrandMarkDefinition =
  | Readonly<{ kind: "path"; title: string; path: string }>
  | Readonly<{ kind: "image"; title: string; src: string }>;

export const MARKETPLACE_BRAND_MARKS: Readonly<Record<string, MarketplaceBrandMarkDefinition>> = {
  // deterministic generated entries
};
```

Do not place package imports, source URLs, raw `<svg>` strings, or `dangerouslySetInnerHTML` in the generated runtime module.

- [ ] **Step 6: Wire generation scripts**

Add these `package.json` scripts:

```json
"generate:marketplace-brands": "node scripts/generate-marketplace-brand-marks.mjs",
"check:marketplace-brands": "node scripts/generate-marketplace-brand-marks.mjs --check"
```

Prepend `pnpm generate:marketplace-brands &&` to `prebuild` so production builds always materialize the checked-in registry before Next compiles.

- [ ] **Step 7: Generate and verify**

Run:

```bash
pnpm generate:marketplace-brands
pnpm check:marketplace-brands
node scripts/marketplace-brand-marks.test.mjs
pnpm check:tests-wired
```

Expected: all commands pass; a second generator run produces no diff; the generated module has exactly 62 registry keys and no `http:`/`https:` string.

- [ ] **Step 8: Create a review checkpoint**

Run:

```bash
git diff --check
git status --short
git diff --stat
```

Expected: source assets, generator, generated registry, dependency files, and the extended test only. With explicit commit authority:

```bash
git add marketplace/brand-assets marketplace/brand-marks.json scripts/generate-marketplace-brand-marks.mjs scripts/marketplace-brand-marks.test.mjs src/lib/marketplace-brand-marks.gen.ts package.json pnpm-lock.yaml
git commit -S -m "feat: generate marketplace brand registry"
```

---

### Task 3: Render shared marks with the existing fallback

**Files:**
- Create: `src/components/marketplace/marketplace-brand-mark.tsx`
- Create: `src/components/marketplace/marketplace-brand-mark.test.ts`
- Modify: `src/components/marketplace/marketplace-card.tsx:3-6,103-118`
- Modify: `src/components/marketplace/marketplace-detail.tsx:3-10,455-508`
- Modify: `src/styles/globals/surface-marketplace.css:127-135,192-197`
- Modify: `scripts/run-tests.mjs:390-425`

- [ ] **Step 1: Write the failing renderer source-contract test**

Create `src/components/marketplace/marketplace-brand-mark.test.ts`:

```ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const renderer = readFileSync(new URL("./marketplace-brand-mark.tsx", import.meta.url), "utf8");
const card = readFileSync(new URL("./marketplace-card.tsx", import.meta.url), "utf8");
const detail = readFileSync(new URL("./marketplace-detail.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../../styles/globals/surface-marketplace.css", import.meta.url), "utf8");

assert.match(renderer, /MARKETPLACE_BRAND_MARKS\[pluginId\] \?\? null/, "lookup fails closed");
assert.match(renderer, /aria-hidden="true"/, "marks are decorative beside the product name");
assert.match(renderer, /focusable="false"/, "inline SVG never enters keyboard focus");
assert.match(renderer, /fill="currentColor"/, "single-path marks follow theme foreground");
assert.match(renderer, /alt=""/, "multicolor images expose no duplicate accessible name");
assert.doesNotMatch(renderer, /dangerouslySetInnerHTML|https?:\/\//, "renderer injects no markup or remote URL");

assert.match(card, /const brandMark = marketplaceBrandMark\(plugin\.id\)/);
assert.match(card, /brandMark \? \([\s\S]{0,240}<MarketplaceBrandMark mark=\{brandMark\} size="card"[\s\S]{0,240}: \([\s\S]{0,160}<Icon name=\{kindIcon\(plugin\.kind\)\}/);
assert.match(detail, /const brandMark = marketplaceBrandMark\(plugin\.id\)/);
assert.match(detail, /brandMark \? \([\s\S]{0,240}<MarketplaceBrandMark mark=\{brandMark\} size="detail"[\s\S]{0,240}: \([\s\S]{0,160}<Icon name=\{kindIcon\(plugin\.kind\)\}/);

assert.match(css, /\.marketplace-brand-mark--card[\s\S]{0,160}var\(--icon-md\)/);
assert.match(css, /\.marketplace-brand-mark--detail[\s\S]{0,160}var\(--icon-lg\)/);
assert.doesNotMatch(css, /\.marketplace-brand-mark[^{]*\{[^}]*#[0-9a-f]{3,8}/i, "brand hooks add no CSS colors");

console.log("marketplace-brand-mark.test.ts: ok");
```

Append the test immediately before `marketplace-detail.test.ts` in the app suite.

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
node --experimental-strip-types src/components/marketplace/marketplace-brand-mark.test.ts
```

Expected: FAIL with `ENOENT` for `marketplace-brand-mark.tsx`.

- [ ] **Step 3: Implement the shared renderer**

Create `src/components/marketplace/marketplace-brand-mark.tsx`:

```tsx
import {
  MARKETPLACE_BRAND_MARKS,
  type MarketplaceBrandMarkDefinition,
} from "@/lib/marketplace-brand-marks.gen";

type MarketplaceBrandMarkProps = {
  mark: MarketplaceBrandMarkDefinition;
  size: "card" | "detail";
};

export function marketplaceBrandMark(pluginId: string): MarketplaceBrandMarkDefinition | null {
  return MARKETPLACE_BRAND_MARKS[pluginId] ?? null;
}

export function MarketplaceBrandMark({ mark, size }: MarketplaceBrandMarkProps) {
  const className = `marketplace-brand-mark marketplace-brand-mark--${size}`;
  if (mark.kind === "image") {
    return <img src={mark.src} alt="" aria-hidden="true" draggable={false} className={className} />;
  }
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
      <path d={mark.path} />
    </svg>
  );
}
```

The component remains pure: no fetching, loading state, runtime package import, or mutation.

- [ ] **Step 4: Integrate the card identity tile**

Import `MarketplaceBrandMark` and `marketplaceBrandMark` in `marketplace-card.tsx`. After the existing setup/capability/role calculations, add:

```ts
const brandMark = marketplaceBrandMark(plugin.id);
```

Replace only the icon inside the existing 36px tile:

```tsx
{brandMark ? (
  <MarketplaceBrandMark mark={brandMark} size="card" />
) : (
  <Icon name={kindIcon(plugin.kind)} width={16} className="text-[var(--text-muted)]" />
)}
```

Do not replace the kind icon in the metadata row; that glyph communicates item type, not product identity.

- [ ] **Step 5: Integrate the standard detail identity tile**

Import the same helpers in `marketplace-detail.tsx`. In `StandardMarketplaceDetail`, add:

```ts
const brandMark = marketplaceBrandMark(plugin.id);
```

Replace only the icon inside the existing 40px header tile:

```tsx
{brandMark ? (
  <MarketplaceBrandMark mark={brandMark} size="detail" />
) : (
  <Icon name={kindIcon(plugin.kind)} width={18} className="text-[var(--text-muted)]" />
)}
```

Craft and Knowledge-pack detail components remain unchanged.

- [ ] **Step 6: Add token-sized visual hooks**

Add beside the card identity rules in `surface-marketplace.css`:

```css
.marketplace-brand-mark {
  display: block;
  flex: none;
  object-fit: contain;
  color: var(--text-secondary);
}
.marketplace-brand-mark--card {
  width: var(--icon-md);
  height: var(--icon-md);
}
.marketplace-brand-mark--detail {
  width: var(--icon-lg);
  height: var(--icon-lg);
}
```

Do not add brand-color CSS, new tile surfaces, motion, shadows, borders, or responsive overrides.

- [ ] **Step 7: Run the focused tests**

Run:

```bash
node --experimental-strip-types src/components/marketplace/marketplace-brand-mark.test.ts
node --experimental-strip-types src/components/marketplace/marketplace-detail.test.ts
node scripts/marketplace-brand-marks.test.mjs
pnpm check:tests-wired
```

Expected: all pass. The first test proves both call sites retain the existing fallback.

- [ ] **Step 8: Run focused design and type gates**

Run:

```bash
pnpm codemod:design:check
pnpm typecheck
pnpm lint
git diff --check
```

Expected: all pass; no raw render colors or static inline styles are introduced.

- [ ] **Step 9: Create a review checkpoint**

Run:

```bash
git diff -- src/components/marketplace/marketplace-brand-mark.tsx src/components/marketplace/marketplace-card.tsx src/components/marketplace/marketplace-detail.tsx src/styles/globals/surface-marketplace.css src/components/marketplace/marketplace-brand-mark.test.ts scripts/run-tests.mjs
```

Expected: the diff changes only identity rendering and its tests. With explicit commit authority:

```bash
git add src/components/marketplace/marketplace-brand-mark.tsx src/components/marketplace/marketplace-brand-mark.test.ts src/components/marketplace/marketplace-card.tsx src/components/marketplace/marketplace-detail.tsx src/styles/globals/surface-marketplace.css scripts/run-tests.mjs
git commit -S -m "feat: show brand marks in marketplace"
```

---

### Task 4: Verify generation, bundle behavior, themes, and native layout

**Files:**
- Modify only if a verification gate identifies a real generated-drift or source defect.

- [ ] **Step 1: Run the complete static and focused verification set**

Run:

```bash
pnpm check:marketplace-brands
node scripts/marketplace-brand-marks.test.mjs
node --experimental-strip-types src/components/marketplace/marketplace-brand-mark.test.ts
node --experimental-strip-types src/components/marketplace/marketplace-detail.test.ts
pnpm check:tests-wired
pnpm typecheck
pnpm lint
git diff --check
```

Expected: every command passes.

- [ ] **Step 2: Run the full app suite**

Run:

```bash
pnpm test
```

Expected: all app test files pass. Record the exact file count in `cave-5i04y` notes.

- [ ] **Step 3: Build the production bundle**

Run:

```bash
pnpm build
```

Expected: generation is a no-op, the Marketplace remains in its lazy surface chunk, bundle budgets pass, and no generation-only package appears in a runtime chunk. Verify the latter with:

```bash
rg -n 'simple-icons|@iconify-json/logos' .next/static .next/server
```

Expected: no package import/module reference; brand names inside embedded data are acceptable only in the Marketplace chunk.

- [ ] **Step 4: Launch the native desktop app for visual verification**

Read and apply the repo-local `run-cave-app` skill, then run in the foreground:

```bash
bash scripts/dev-app.sh
```

Use the native Tauri window, not a Codex browser preview. Navigate to Marketplace and verify:

- 760px narrow and 1280px wide layouts;
- Coven dark, Coven light, and one non-default palette;
- Gmail, Google Calendar, Figma, and Slack multicolor marks;
- GitHub, Linear, Tailwind, and Tauri monochrome marks;
- Firecrawl, TinyFish, and OpenClaw reviewed assets;
- Filesystem and Serena generic fallbacks;
- installed and uninstalled cards;
- one branded standard detail header; and
- keyboard focus/accessible names remain on the card button and product title, not the decorative mark.

Expected: marks remain optically contained, names do not shift or clip, no broken images appear, fallbacks match the pre-change UI, and cards retain their current height/density.

- [ ] **Step 5: Inspect the final repository state**

Run:

```bash
pnpm generate:marketplace-brands
git diff --exit-code -- src/lib/marketplace-brand-marks.gen.ts
git diff --check
git status --short --branch
```

Expected: regeneration is clean and the status contains only the planned implementation files/commits. Do not close `cave-5i04y` until the protected PR is merged or Val explicitly declares the local completion criteria sufficient.

- [ ] **Step 6: Record verification on the Bead**

Update `cave-5i04y` notes with:

```text
Implementation branch/worktree; generator check; focused tests; tests-wired; typecheck; lint; full app-suite file count; production build; native widths/themes/representatives checked; final git status; commit/PR state.
```

If commit authority was granted and earlier task commits exist, verify every commit signature with:

```bash
git log --show-signature --format='%h %G? %s' origin/main..HEAD
```

Expected: each authored commit reports a good signature.
