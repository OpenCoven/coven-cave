# User-owned Marketplace and curated Skills preview implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Marketplace show only installed or authored user inventory and add an honest, distinctive Coming Soon destination for the future OpenCoven-curated Skills catalog.

**Architecture:** Filter catalog inventory at the server boundary, synthesize truthful cards for install records whose catalog metadata is gone, and expose a local-only normalized skill listing without changing dormant remote registry APIs. Keep the existing Marketplace host, cards, drawers, and Build flow, but make the default information architecture `Yours | Skills | Build` (plus the existing flag-gated Crafts tab) and isolate the Coming Soon composition in one component.

**Tech Stack:** Next.js App Router, React 19, TypeScript, token-only CSS, Node source-contract tests, existing Cave config and skill scanners.

**Commit policy:** This repository is in the conservative Beads profile. Run every verification checkpoint below, but do not execute a commit or push unless Val explicitly authorizes it.

---

## File map

### Create

- `src/components/marketplace/skills-coming-soon.tsx` — the isolated Skills preview and its two navigation callbacks.
- `src/components/marketplace/skills-coming-soon.test.ts` — source contracts for copy, ordered curation sequence, actions, routing ownership, responsive CSS, and reduced motion.
- `src/app/api/marketplace/owned-route.test.ts` — route-level source contracts for owned-only catalog selection and guarded unlisted-record removal.

### Modify

- `src/lib/marketplace-catalog.ts` — add the `unlisted` model flag and pure owned-inventory selection.
- `src/lib/marketplace-catalog.test.ts` — behavior coverage for installed-only filtering and missing-catalog fallbacks.
- `src/app/api/marketplace/route.ts` — return drafts plus owned catalog/install records only.
- `src/app/api/marketplace/uninstall/route.ts` — allow removal of a known unlisted track-only install record while retaining the Craft guard.
- `src/lib/server/skills-directory.ts` — add a pure local-entry normalizer and an async local-only listing path.
- `src/lib/server/skills-directory.test.ts` — local-only normalization, search, source, and no-registry-shape coverage.
- `src/app/api/skills/directory/route.ts` — opt into local-only listing with `scope=local`.
- `src/app/api/skills/directory/use/route.ts` — resolve Marketplace prompt requests from scanned local skills without a registry call or CLI execution.
- `src/app/api/skills/directory/use/route.test.ts` — pin the local-only prompt lookup and directive path.
- `src/lib/surface-warmup-registry.ts` — point Marketplace skill warmup at `scope=local`.
- `src/components/marketplace/marketplace-view-model.ts` — expose Yours and Skills as separate sections and remove discovery-only visible filters.
- `src/components/marketplace/marketplace-view-model.test.ts` — pin the new visible section and search contract.
- `src/components/marketplace/skill-explore-card.tsx` — present local owned skill metadata without install metrics or install controls.
- `src/components/marketplace/skill-explore-drawer.tsx` — local-only preview/prompt/delete detail, with no remote command or install action.
- `src/components/marketplace/skill-explore.test.ts` — replace registry-discovery pins with owned-local skill pins.
- `src/components/marketplace/marketplace-card.tsx` — render unlisted local install records without inferred capability/trust claims.
- `src/components/marketplace/marketplace-detail.tsx` — make the unlisted detail truthful.
- `src/components/marketplace/marketplace-detail.test.ts` — pin the unlisted decision treatment.
- `src/components/marketplace-view.tsx` — load owned-only data, remove discovery controls and network search, route Skills to Coming Soon, and route Build back to owned skills.
- `src/components/marketplace/crafts-marketplace.test.ts` — update section wording and assert published Craft data is already owned-only.
- `src/components/marketplace/crafts-visibility.test.ts` — keep the flag contract while renaming Browse to Yours.
- `src/styles/globals/surface-marketplace.css` — add the responsive curator shelf and remove styles left unused by deleted discovery chips if no other consumer remains.
- `src/lib/surface-preference-specs.ts` — keep old values parseable for migration, but update comments to the owned inventory semantics.
- `scripts/run-tests.mjs` — wire the two new source-contract tests.
- `docs/marketplace.md` — document owned inventory, dormant publisher metadata, and the future curated Skills shelf.
- `docs/superpowers/specs/2026-07-29-marketplace-owned-coming-soon-design.md` — mark the reviewed spec approved for implementation.

---

### Task 1: Select owned catalog inventory at the API boundary

**Files:**

- Modify: `src/lib/marketplace-catalog.ts`
- Modify: `src/lib/marketplace-catalog.test.ts`
- Modify: `src/app/api/marketplace/route.ts`
- Modify: `src/app/api/marketplace/uninstall/route.ts`
- Create: `src/app/api/marketplace/owned-route.test.ts`
- Modify: `scripts/run-tests.mjs`

- [ ] **Step 1: Write the failing pure behavior test**

Add `selectOwnedMarketplacePlugins` to the imports in
`src/lib/marketplace-catalog.test.ts`, then add this fixture after the existing
merge assertions:

```ts
const ownedInstallMap = {
  fetch: installed.fetch,
  "tinyfish-search": installed["tinyfish-search"],
  "legacy-local-record": {
    version: "0.4.2",
    source: "legacy",
    installedAt: "2026-07-01T00:00:00.000Z",
  },
};
const ownedOnly = selectOwnedMarketplacePlugins(
  mergeCatalog(sanitizeMarketplacePlugins(marketplacePlugins), manifests, ownedInstallMap),
  ownedInstallMap,
);

assert.deepEqual(
  ownedOnly.map((plugin) => plugin.id),
  ["fetch", "legacy-local-record", "tinyfish-search"],
  "owned inventory contains every installed record and no uninstalled seed",
);
const unlistedOwned = ownedOnly.find((plugin) => plugin.id === "legacy-local-record");
assert.equal(unlistedOwned?.unlisted, true, "missing catalog metadata is explicit");
assert.equal(unlistedOwned?.installed, true, "unlisted local records stay owned");
assert.equal(unlistedOwned?.available, false, "unlisted records never claim remote installability");
assert.equal(unlistedOwned?.description, "Installed locally. Catalog details are no longer available.");
assert.deepEqual(
  ownedInstallMap["legacy-local-record"],
  {
    version: "0.4.2",
    source: "legacy",
    installedAt: "2026-07-01T00:00:00.000Z",
  },
  "owned selection never mutates Cave install state",
);
```

- [ ] **Step 2: Run the pure test and verify the red state**

Run:

```bash
node --require ./scripts/css-source-contract-hook.cjs --experimental-strip-types src/lib/marketplace-catalog.test.ts
```

Expected: FAIL because `selectOwnedMarketplacePlugins` is not exported.

- [ ] **Step 3: Add the model flag and pure selector**

Add this optional field to `MarketplacePlugin`:

```ts
  /** Install state retained locally after its catalog card disappeared. */
  unlisted?: boolean;
```

Add these helpers after `mergeCatalog`:

```ts
function humanizeMarketplaceId(id: string): string {
  return id
    .split(/[-_.]+/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function unlistedInstalledPlugin(
  id: string,
  installation: MarketplaceInstallationState,
): MarketplacePlugin {
  return {
    id,
    displayName: humanizeMarketplaceId(id) || id,
    description: "Installed locally. Catalog details are no longer available.",
    category: "Local installs",
    author: "Local install",
    trust: "local-tool",
    policy: { installation: "UNAVAILABLE", authentication: "NONE" },
    capabilities: [],
    keywords: [],
    roleAffinity: [],
    kind: "skill",
    version: installation.version,
    installed: true,
    installation: { ...installation },
    updateAvailable: false,
    requiresSetup: false,
    available: false,
    requiredConfig: [],
    configured: true,
    unlisted: true,
  };
}

export function selectOwnedMarketplacePlugins(
  plugins: MarketplacePlugin[],
  installed: InstalledMap,
): MarketplacePlugin[] {
  const owned = plugins.filter((plugin) => plugin.installed);
  const represented = new Set(owned.map((plugin) => plugin.id));
  const unlisted = Object.entries(installed)
    .filter(([id]) => !represented.has(id))
    .map(([id, installation]) => unlistedInstalledPlugin(id, installation));
  return [...owned, ...unlisted].sort((a, b) => a.displayName.localeCompare(b.displayName));
}
```

- [ ] **Step 4: Make the Marketplace route return drafts plus owned records**

Import `selectOwnedMarketplacePlugins` in
`src/app/api/marketplace/route.ts`. Replace the final merge/composition block
with:

```ts
  const merged = mergeCatalog(marketplaceSafePlugins, manifests, cfg.marketplace.installed);
  const renderableCatalog = sanitizeMarketplaceCatalogCards(merged.map((plugin) => ({
    ...plugin,
    configured: plugin.requiredConfig.every((field) => hasConfiguredSecretMetadata(field.env)),
  })));
  const ownedCatalog = selectOwnedMarketplacePlugins(
    renderableCatalog,
    cfg.marketplace.installed,
  );
  const plugins = [
    ...drafts.map((draft) => draft.plugin),
    ...ownedCatalog,
  ];
  return NextResponse.json({ ok: true, plugins });
```

This ordering deliberately runs the shared-catalog familiar sanitizer before
local fallback synthesis. A locally owned legacy id can appear without
re-introducing its deleted shared metadata.

- [ ] **Step 5: Write the failing route contract**

Create `src/app/api/marketplace/owned-route.test.ts`:

```ts
// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const listRoute = readFileSync(new URL("./route.ts", import.meta.url), "utf8");
const uninstallRoute = readFileSync(new URL("./uninstall/route.ts", import.meta.url), "utf8");

assert.match(
  listRoute,
  /selectOwnedMarketplacePlugins\(\s*renderableCatalog,\s*cfg\.marketplace\.installed,\s*\)/,
  "Marketplace returns only locally owned catalog/install records",
);
assert.match(
  listRoute,
  /\.\.\.drafts\.map\(\(draft\) => draft\.plugin\)[\s\S]*\.\.\.ownedCatalog/,
  "local Craft drafts stay ahead of owned catalog items",
);
assert.match(
  uninstallRoute,
  /const installedRecord = cfg\.marketplace\.installed\[id\]/,
  "uninstall validates an unlisted id against current local install state",
);
assert.match(
  uninstallRoute,
  /installedRecord\?\.(?:runtime|craftVersion)/,
  "unlisted verified Craft records cannot fall through track-only removal",
);
assert.match(
  uninstallRoute,
  /if \(!plugin && !installedRecord\)/,
  "arbitrary ids remain rejected",
);

console.log("marketplace owned-route.test.ts: ok");
```

Wire it next to the other Marketplace route tests in the app suite in
`scripts/run-tests.mjs`.

- [ ] **Step 6: Run the route contract and verify the red state**

Run:

```bash
node --require ./scripts/css-source-contract-hook.cjs --experimental-strip-types src/app/api/marketplace/owned-route.test.ts
```

Expected: FAIL because the uninstall route does not read `installedRecord`.

- [ ] **Step 7: Guard unlisted track-only removal**

Import `loadConfig` alongside `uninstallMarketplacePlugin` in
`src/app/api/marketplace/uninstall/route.ts`. After parsing `id`, load current
state and replace the plugin validation with:

```ts
  const [plugin, cfg] = await Promise.all([
    id ? catalogPlugin(id) : Promise.resolve(null),
    loadConfig(),
  ]);
  const installedRecord = cfg.marketplace.installed[id];
  if (!plugin && !installedRecord) {
    return NextResponse.json({ ok: false, error: `unknown plugin "${id}"` }, { status: 400 });
  }
  if (
    plugin?.kind === "craft"
    || installedRecord?.runtime === "codex"
    || typeof installedRecord?.craftVersion === "string"
  ) {
    return NextResponse.json(
      { ok: false, error: "Crafts require verified Codex removal", code: "craft_transaction_required" },
      { status: 409 },
    );
  }
  await uninstallMarketplacePlugin(id);
  return NextResponse.json({ ok: true });
```

- [ ] **Step 8: Run focused catalog and route tests**

Run:

```bash
node --require ./scripts/css-source-contract-hook.cjs --experimental-strip-types src/lib/marketplace-catalog.test.ts
node --require ./scripts/css-source-contract-hook.cjs --experimental-strip-types src/app/api/marketplace/owned-route.test.ts
node --require ./scripts/css-source-contract-hook.cjs --experimental-strip-types src/app/api/marketplace/crafts-routes.test.ts
```

Expected: all three pass.

- [ ] **Step 9: Checkpoint without committing**

Run:

```bash
git diff --check
git status --short
```

Expected: only Task 1 files plus the approved spec/plan are changed. Do not
commit without explicit authorization.

---

### Task 2: Add a local-only normalized skills path

**Files:**

- Modify: `src/lib/server/skills-directory.ts`
- Modify: `src/lib/server/skills-directory.test.ts`
- Modify: `src/app/api/skills/directory/route.ts`
- Modify: `src/app/api/skills/directory/use/route.ts`
- Modify: `src/app/api/skills/directory/use/route.test.ts`
- Modify: `src/lib/surface-warmup-registry.ts`

- [ ] **Step 1: Write the failing local-normalizer test**

Add `localSkillDirectoryEntries` to the imports in
`src/lib/server/skills-directory.test.ts`, then add:

```ts
const localDirectory = localSkillDirectoryEntries([
  {
    id: "owned-research",
    name: "Owned Research",
    description: "Research from local sources.",
    tags: ["research"],
    path: "/Users/test/.coven/skills/owned-research/SKILL.md",
    familiar: "global",
  },
  {
    id: "owned-code",
    name: "Owned Code",
    description: "Coding from local sources.",
    path: "/Users/test/.agents/skills/owned-code/SKILL.md",
    familiar: "agents-user",
  },
], "research");

assert.equal(localDirectory.length, 1, "local search filters without a registry call");
assert.equal(localDirectory[0].id, "owned-research");
assert.equal(localDirectory[0].installed, true);
assert.equal(localDirectory[0].source, "local");
assert.equal(localDirectory[0].trust.source, "local");
assert.equal(localDirectory[0].local?.scope, "coven");
assert.equal(localDirectory[0].installsAllTime, 0, "local skills never invent registry metrics");
assert.equal(localDirectory[0].registryUrl, undefined);
```

- [ ] **Step 2: Run the test and verify the red state**

Run:

```bash
node --require ./scripts/css-source-contract-hook.cjs --experimental-strip-types --import ./scripts/test-alias-register.mjs src/lib/server/skills-directory.test.ts
```

Expected: FAIL because `localSkillDirectoryEntries` is not exported.

- [ ] **Step 3: Normalize local skills without remote metadata**

Expand `SkillDirectoryEntry["source"]` and
`SkillDirectoryListResponse["source"]` to include `"local"`. Change
`addInstalledLocalOnly` to return `source: "local"`.

Add:

```ts
export function localSkillDirectoryEntries(
  locals: LocalSkillEntry[],
  query?: string,
): SkillDirectoryEntry[] {
  const q = normalizeSearchQuery(query);
  const entries = uniqueEntries(locals.map(addInstalledLocalOnly));
  return q ? entries.filter((entry) => matchesEntryQuery(entry, q)) : entries;
}

async function scanLocalSkillEntries(): Promise<LocalSkillEntry[]> {
  const raw: LocalSkillEntry[] = [];
  await scanSkillsDir(path.join(covenHome(), "skills"), "global", raw);
  raw.push(...await scanClaudeUserSkills());
  raw.push(...await scanCodexUserSkills());
  raw.push(...await scanAgentSharedSkills());
  return dedupeByRealPath(raw);
}

export async function listLocalSkillDirectoryEntries(
  query?: string,
): Promise<SkillDirectoryListResponse> {
  const locals = await scanLocalSkillEntries();
  return {
    ok: true,
    source: "local",
    fetchedAt: new Date().toISOString(),
    entries: localSkillDirectoryEntries(locals, query),
  };
}
```

Refactor `listSkillDirectoryEntriesWithLocal` to call
`scanLocalSkillEntries()` rather than repeating the four scan operations.

- [ ] **Step 4: Route `scope=local` without changing remote compatibility**

Import `listLocalSkillDirectoryEntries` in
`src/app/api/skills/directory/route.ts` and change `GET` to:

```ts
export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const query = params.get("q") ?? undefined;
  const data: SkillDirectoryListResponse = params.get("scope") === "local"
    ? await listLocalSkillDirectoryEntries(query)
    : await listSkillDirectoryEntriesWithLocal(query);
  return NextResponse.json(data);
}
```

This preserves the dormant remote default for non-Marketplace callers.

- [ ] **Step 5: Point the warm resource at the local scope**

Replace the Marketplace skill resource in
`src/lib/surface-warmup-registry.ts` with:

```ts
defineResource(
  "marketplace:skills",
  (signal) => json(signal, "/api/skills/directory?scope=local"),
  2 * 60_000,
);
```

- [ ] **Step 6: Add route/source assertions**

In `src/components/marketplace/skill-explore.test.ts`, replace the remote
endpoint assertions with:

```ts
const warmup = readFileSync(new URL("../../lib/surface-warmup-registry.ts", import.meta.url), "utf8");
const directoryRoute = readFileSync(new URL("../../app/api/skills/directory/route.ts", import.meta.url), "utf8");

assert.match(warmup, /"marketplace:skills"[\s\S]*"\/api\/skills\/directory\?scope=local"/);
assert.match(directoryRoute, /params\.get\("scope"\) === "local"[\s\S]*listLocalSkillDirectoryEntries/);
```

- [ ] **Step 7: Keep Marketplace prompt resolution local-only**

In `src/app/api/skills/directory/use/route.ts`, import
`listLocalSkillDirectoryEntries` and expand the request body:

```ts
type UseBody = {
  id?: unknown;
  source?: unknown;
  scope?: unknown;
  path?: unknown;
};
```

After parsing `id` and `source`, select the directory and entry with:

```ts
  const localOnly = parsed.body.scope === "local";
  const localPath = typeof parsed.body.path === "string" ? parsed.body.path : "";
  const directory = localOnly
    ? await listLocalSkillDirectoryEntries()
    : await listSkillDirectoryEntriesWithLocal();
  const entry = localOnly && localPath
    ? directory.entries.find((candidate) => candidate.local?.path === localPath) ?? null
    : matchDirectoryEntry(id, directory.entries, source);
  if (!entry) {
    return NextResponse.json({ ok: false, error: `skill "${id}" not found` }, { status: 404 });
  }

  if (localOnly) {
    return NextResponse.json({
      ok: true,
      prompt: localSkillDirective(entry),
      source: "local-directive",
      entry,
    });
  }
```

The path only disambiguates entries already returned by the allow-listed local
scanner; this route must not read or execute the submitted path directly. Keep
the existing constrained `npx skills use` path for dormant non-Marketplace
callers.

Add these source assertions to
`src/app/api/skills/directory/use/route.test.ts`:

```ts
assert.match(route, /parsed\.body\.scope === "local"/, "Marketplace can request a local-only prompt");
assert.match(route, /listLocalSkillDirectoryEntries\(\)/, "local prompt resolution performs no registry listing");
assert.match(route, /candidate\.local\?\.path === localPath/, "duplicate local ids are disambiguated by an allow-listed scanned path");
assert.match(route, /if \(localOnly\)[\s\S]*localSkillDirective\(entry\)/, "local prompt resolution never shells out to the Skills CLI");
```

- [ ] **Step 8: Run focused skills tests**

Run:

```bash
node --require ./scripts/css-source-contract-hook.cjs --experimental-strip-types --import ./scripts/test-alias-register.mjs src/lib/server/skills-directory.test.ts
node --require ./scripts/css-source-contract-hook.cjs --experimental-strip-types src/components/marketplace/skill-explore.test.ts
node --require ./scripts/css-source-contract-hook.cjs --experimental-strip-types src/app/api/skills/directory/use/route.test.ts
```

Expected: all three pass after the Task 2 assertion rewrite.

- [ ] **Step 9: Checkpoint without committing**

Run `git diff --check` and `git status --short`. Do not commit without explicit
authorization.

---

### Task 3: Build the Skills Coming Soon destination

**Files:**

- Create: `src/components/marketplace/skills-coming-soon.tsx`
- Create: `src/components/marketplace/skills-coming-soon.test.ts`
- Modify: `src/styles/globals/surface-marketplace.css`
- Modify: `scripts/run-tests.mjs`

- [ ] **Step 1: Write the failing source contract**

Create `src/components/marketplace/skills-coming-soon.test.ts`:

```ts
// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const component = readFileSync(new URL("./skills-coming-soon.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../../styles/globals/surface-marketplace.css", import.meta.url), "utf8");

assert.match(component, /Skills worth summoning\./, "the preview has one characteristic thesis");
assert.match(component, /A smaller, reviewed skills marketplace is taking shape\./);
assert.match(component, /<ol className="marketplace-coming-soon__shelf"/, "the real review order is semantic");
for (const step of ["Review the source", "Verify the behavior", "Publish for familiars"]) {
  assert.match(component, new RegExp(step), `${step} is part of the curation path`);
}
assert.match(component, /onViewOwnedSkills/, "the preview returns to the user's skills");
assert.match(component, /onBuildSkill/, "the preview opens local authoring");
assert.match(css, /\.marketplace-coming-soon__slot\s*\{[\s\S]*border-style:\s*dashed/, "future shelf slots use invitation grammar");
assert.match(css, /@container marketplace \(max-width: 640px\)[\s\S]*marketplace-coming-soon__shelf/, "the shelf responds to pane width");
assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*marketplace-coming-soon__slot/, "entrance motion has a reduced-motion state");
assert.doesNotMatch(component, /installs|Official|Community|release date/i, "the preview contains no fake catalog proof");

console.log("skills-coming-soon.test.ts: ok");
```

Wire it near the other Marketplace component tests in `scripts/run-tests.mjs`.

- [ ] **Step 2: Run the test and verify the red state**

Run:

```bash
node --require ./scripts/css-source-contract-hook.cjs --experimental-strip-types src/components/marketplace/skills-coming-soon.test.ts
```

Expected: FAIL with `ENOENT` for `skills-coming-soon.tsx`.

- [ ] **Step 3: Create the isolated component**

Create `src/components/marketplace/skills-coming-soon.tsx`:

```tsx
"use client";

import { Icon, type IconName } from "@/lib/icon";
import { Button } from "@/components/ui/button";

const CURATION_STEPS: ReadonlyArray<{
  icon: IconName;
  title: string;
  detail: string;
}> = [
  {
    icon: "ph:book-open",
    title: "Review the source",
    detail: "Ownership, provenance, and maintenance are clear.",
  },
  {
    icon: "ph:flask",
    title: "Verify the behavior",
    detail: "Instructions are tested in Cave before they are listed.",
  },
  {
    icon: "ph:seal-check",
    title: "Publish for familiars",
    detail: "The reviewed skill becomes ready to discover.",
  },
];

export function SkillsComingSoon({
  onViewOwnedSkills,
  onBuildSkill,
}: {
  onViewOwnedSkills: () => void;
  onBuildSkill: () => void;
}) {
  return (
    <div
      role="tabpanel"
      id="marketplace-panel-skills"
      aria-labelledby="marketplace-tab-skills"
      className="marketplace-coming-soon"
    >
      <section className="marketplace-coming-soon__stage" aria-labelledby="marketplace-coming-soon-heading">
        <div className="marketplace-coming-soon__copy">
          <p className="marketplace-coming-soon__eyebrow">
            OpenCoven Skills <span>Coming soon</span>
          </p>
          <h2 id="marketplace-coming-soon-heading">Skills worth summoning.</h2>
          <p>
            A smaller, reviewed skills marketplace is taking shape. The first shelf
            stays empty until the work earns a place here.
          </p>
        </div>

        <ol className="marketplace-coming-soon__shelf" aria-label="Skills publication path">
          {CURATION_STEPS.map((step, index) => (
            <li className="marketplace-coming-soon__slot" key={step.title}>
              <span className="marketplace-coming-soon__number" aria-hidden>
                {String(index + 1).padStart(2, "0")}
              </span>
              <Icon name={step.icon} width={18} aria-hidden />
              <strong>{step.title}</strong>
              <p>{step.detail}</p>
            </li>
          ))}
        </ol>

        <div className="marketplace-coming-soon__actions">
          <Button variant="secondary" size="sm" leadingIcon="ph:sparkle" onClick={onViewOwnedSkills}>
            View your skills
          </Button>
          <Button variant="primary" size="sm" leadingIcon="ph:hammer" onClick={onBuildSkill}>
            Build a skill
          </Button>
        </div>
      </section>
    </div>
  );
}
```

- [ ] **Step 4: Add the token-only curator shelf**

Append this focused block to `src/styles/globals/surface-marketplace.css`:

```css
/* ── Curated Skills preview ── */
.marketplace-coming-soon {
  display: grid;
  min-height: 0;
  flex: 1;
  place-items: center;
  overflow-y: auto;
  padding: var(--space-8) var(--space-6);
}
.marketplace-coming-soon__stage {
  width: min(960px, 100%);
  border: 1px solid var(--border-hairline);
  border-radius: var(--radius-panel);
  background: var(--bg-raised);
  padding: var(--space-8);
}
.marketplace-coming-soon__copy {
  max-width: 640px;
}
.marketplace-coming-soon__eyebrow {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin: 0 0 var(--space-3);
  color: var(--text-muted);
  font-size: var(--text-2xs);
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.marketplace-coming-soon__eyebrow span {
  border: 1px solid var(--border-hairline);
  border-radius: var(--radius-pill);
  padding: var(--space-1) var(--space-2);
  color: var(--text-secondary);
}
.marketplace-coming-soon__copy h2 {
  margin: 0;
  color: var(--text-primary);
  font-family: var(--font-serif);
  font-size: var(--text-display);
  font-weight: 500;
  line-height: 1.1;
}
.marketplace-coming-soon__copy > p:last-child {
  max-width: 560px;
  margin: var(--space-3) 0 0;
  color: var(--text-secondary);
  font-size: var(--text-base);
  line-height: 1.5;
}
.marketplace-coming-soon__shelf {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--space-3);
  margin: var(--space-8) 0 0;
  border-bottom: 2px solid var(--border-strong);
  padding: 0 0 var(--space-3);
  list-style: none;
}
.marketplace-coming-soon__slot {
  display: grid;
  min-height: 180px;
  align-content: start;
  gap: var(--space-2);
  border: 1px dashed var(--border-strong);
  border-radius: var(--radius-card);
  background: color-mix(in oklch, var(--bg-base) 72%, transparent);
  padding: var(--space-4);
  animation: marketplace-coming-soon-rise var(--duration-slow) var(--ease-decelerate) both;
}
.marketplace-coming-soon__slot:nth-child(2) {
  animation-delay: calc(var(--duration-fast) * 0.5);
}
.marketplace-coming-soon__slot:nth-child(3) {
  animation-delay: var(--duration-fast);
}
.marketplace-coming-soon__slot > svg {
  color: var(--accent-presence);
}
.marketplace-coming-soon__slot strong {
  color: var(--text-primary);
  font-size: var(--text-md);
}
.marketplace-coming-soon__slot p {
  margin: 0;
  color: var(--text-muted);
  font-size: var(--text-sm);
  line-height: 1.45;
}
.marketplace-coming-soon__number {
  color: var(--text-muted);
  font-family: var(--font-mono);
  font-size: var(--text-2xs);
  letter-spacing: 0.08em;
}
.marketplace-coming-soon__actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin-top: var(--space-6);
}
@keyframes marketplace-coming-soon-rise {
  from {
    opacity: 0;
    transform: translateY(var(--space-2));
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
@container marketplace (max-width: 640px) {
  .marketplace-coming-soon {
    place-items: start stretch;
    padding: var(--space-5) var(--space-4);
  }
  .marketplace-coming-soon__stage {
    padding: var(--space-5);
  }
  .marketplace-coming-soon__shelf {
    grid-template-columns: minmax(0, 1fr);
    border-bottom: 0;
    border-left: 2px solid var(--border-strong);
    padding: 0 0 0 var(--space-3);
  }
  .marketplace-coming-soon__slot {
    min-height: 0;
  }
}
@media (prefers-reduced-motion: reduce) {
  .marketplace-coming-soon__slot {
    animation: none;
  }
}
```

`--ease-decelerate` is declared in
`src/styles/globals/foundations.css`; use it exactly as shown.

- [ ] **Step 5: Run the Coming Soon contract**

Run:

```bash
node --require ./scripts/css-source-contract-hook.cjs --experimental-strip-types src/components/marketplace/skills-coming-soon.test.ts
```

Expected: PASS.

- [ ] **Step 6: Run the CSS tokenizer before hand edits accumulate**

Run:

```bash
node scripts/codemods/tokenize-css.mjs
git diff -- src/styles/globals/surface-marketplace.css
```

Expected: no unrelated CSS changes; accept only deterministic tokenization
inside the new block.

- [ ] **Step 7: Checkpoint without committing**

Run `git diff --check` and `git status --short`. Do not commit without explicit
authorization.

---

### Task 4: Make skill cards and detail local-owned only

**Files:**

- Modify: `src/components/marketplace/skill-explore-card.tsx`
- Modify: `src/components/marketplace/skill-explore-drawer.tsx`
- Modify: `src/components/marketplace/skill-explore.test.ts`

- [ ] **Step 1: Replace remote-discovery assertions with local-owned assertions**

In `src/components/marketplace/skill-explore.test.ts`, keep the canonical type,
card, drawer, and source-scoped key assertions. Replace assertions for debounced
registry search, install toggles, install metrics, and remote commands with:

```ts
const card = readFileSync(new URL("./skill-explore-card.tsx", import.meta.url), "utf8");
const drawer = readFileSync(new URL("./skill-explore-drawer.tsx", import.meta.url), "utf8");

assert.match(card, /Local skill/, "owned skill cards state their local source");
assert.match(card, /onOpen/, "owned skill cards remain inspectable");
assert.doesNotMatch(card, /installsAllTime|Official|Community|onToggleInstall/, "owned cards contain no discovery proof or install action");
assert.match(drawer, /\/api\/skills\/file\?path=/, "owned detail previews only an allow-listed local file");
assert.match(drawer, /Delete this local skill/, "owned detail retains guarded deletion");
assert.match(drawer, /Skill prompt copied/, "owned detail retains the prompt action");
assert.doesNotMatch(drawer, /installCommand|registryUrl|Install skill|onInstallToggle/, "owned detail has no remote installation path");
```

- [ ] **Step 2: Run the contract and verify the red state**

Run:

```bash
node --require ./scripts/css-source-contract-hook.cjs --experimental-strip-types src/components/marketplace/skill-explore.test.ts
```

Expected: FAIL on the discovery/install assertions.

- [ ] **Step 3: Simplify `SkillExploreCard`**

Change its props to:

```ts
export type SkillExploreCardProps = {
  skill: SkillBrowserEntry;
  onOpen: (skill: SkillBrowserEntry) => void;
};
```

Remove `Button`, install formatting, install counts, trust chips, and toggle
callbacks. Keep the existing card title button and description, then render:

```tsx
      <div className="marketplace-card__decision" aria-label="Installed local skill">
        <span className="marketplace-card__decision-chip">
          <Icon name="ph:check-circle" width={11} aria-hidden /> Installed
        </span>
        <span className="marketplace-card__decision-chip">
          <Icon name="ph:folder-open" width={11} aria-hidden /> Local skill
        </span>
        {skill.local?.version ? (
          <span className="marketplace-card__decision-chip">
            <Icon name="ph:tag" width={11} aria-hidden /> {skill.local.version}
          </span>
        ) : null}
      </div>
      <div className="marketplace-card__meta">
        <span>
          <Icon name="ph:sparkle" width={11} aria-hidden /> Skill
        </span>
        <span>
          <Icon name="ph:folder-open" width={11} aria-hidden /> {skill.local?.scope ?? "local"}
        </span>
      </div>
```

`ph:tag` is already present in `ICON_NAMES`; use it without regenerating the
icon bundle.

- [ ] **Step 4: Simplify `SkillExploreDrawer`**

Change props to:

```ts
export type SkillExploreDrawerProps = {
  skill: SkillBrowserEntry | null;
  onClose: () => void;
  onChanged?: () => void;
};
```

Remove `installed`, `busy`, `onInstallToggle`, remote source resolution,
install-command copy, share, registry preview, official/install metrics, and
default agent invention. Load body only when `skill?.path` exists:

```ts
const skillPath = skill?.local?.path ?? skill?.path ?? null;

useEffect(() => {
  if (!skill || !skillPath) {
    setBody({ status: "idle", text: null, error: null });
    return;
  }
  const controller = new AbortController();
  setBody({ status: "loading", text: null, error: null });
  void fetch(`/api/skills/file?path=${encodeURIComponent(skillPath)}`, {
    cache: "no-store",
    signal: controller.signal,
  })
    .then((response) => response.json())
    .then((json: { ok?: boolean; text?: string; error?: string }) => {
      if (controller.signal.aborted) return;
      if (!json.ok) {
        setBody({ status: "error", text: null, error: json.error ?? "read failed" });
        return;
      }
      setBody({ status: "loaded", text: json.text ?? "", error: null });
    })
    .catch((error: unknown) => {
      if (!controller.signal.aborted) {
        setBody({
          status: "error",
          text: null,
          error: error instanceof Error ? error.message : "read failed",
        });
      }
    });
  return () => controller.abort();
}, [skill, skillPath]);
```

Keep `handlePrompt`, the two-step `handleDelete`, `useFocusTrap`, focus return,
the local `SKILL.md` body, and announcements. Change the prompt request body to:

```ts
body: JSON.stringify({
  id: skill.id,
  scope: "local",
  path: skillPath,
}),
```

This asks the use route to match only a path returned by the allow-listed local
scanner and to return a static directive without registry access or CLI
execution. The footer becomes:

```tsx
        <div className="flex flex-wrap items-center gap-2 border-t border-[var(--border-hairline)] bg-[var(--bg-panel)] px-5 py-4">
          <Button
            variant="secondary"
            size="sm"
            leadingIcon="ph:clipboard-text"
            onClick={handlePrompt}
            title="Copy the generated skill prompt"
          >
            Prompt
          </Button>
          {canDelete ? (
            confirmingDelete ? (
              <div className="ml-auto flex items-center gap-2">
                <Button variant="ghost" size="sm" onClick={() => setConfirmingDelete(false)}>
                  Cancel
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  leadingIcon="ph:trash"
                  loading={deleting}
                  onClick={handleDelete}
                >
                  Delete
                </Button>
              </div>
            ) : (
              <IconButton
                icon="ph:trash"
                size="sm"
                danger
                className="ml-auto"
                aria-label="Delete this local skill"
                onClick={handleDelete}
                disabled={deleting}
                title="Delete this local skill"
              />
            )
          ) : null}
        </div>
```

- [ ] **Step 5: Run the owned skill contract**

Run:

```bash
node --require ./scripts/css-source-contract-hook.cjs --experimental-strip-types src/components/marketplace/skill-explore.test.ts
```

Expected: PASS.

- [ ] **Step 6: Checkpoint without committing**

Run `git diff --check` and `git status --short`. Do not commit without explicit
authorization.

---

### Task 5: Rewire Marketplace to Yours, Skills, and Build

**Files:**

- Modify: `src/components/marketplace/marketplace-view-model.ts`
- Modify: `src/components/marketplace/marketplace-view-model.test.ts`
- Modify: `src/components/marketplace-view.tsx`
- Modify: `src/components/marketplace/crafts-marketplace.test.ts`
- Modify: `src/components/marketplace/crafts-visibility.test.ts`
- Modify: `src/lib/surface-preference-specs.ts`

- [ ] **Step 1: Write the failing view-model contract**

Extend `src/components/marketplace/marketplace-view-model.test.ts`:

```ts
assert.match(source, /\{ id: "browse", label: "Yours"/, "owned inventory is the landing section");
assert.match(source, /\{ id: "skills", label: "Skills"/, "curated Skills has its own section");
assert.match(source, /browse: "Search your items"/, "owned search is explicit");
assert.doesNotMatch(source, /label: "Installed"/, "owned inventory has no redundant Installed filter");
assert.doesNotMatch(source, /browse: "Everything your familiars can equip/, "discovery copy is retired");
```

- [ ] **Step 2: Run the model test and verify the red state**

Run:

```bash
node --require ./scripts/css-source-contract-hook.cjs --experimental-strip-types src/components/marketplace/marketplace-view-model.test.ts
```

Expected: FAIL because Browse is still labeled Explore and Skills is not a
visible section.

- [ ] **Step 3: Update the centralized Marketplace model**

Make `MARKETPLACE_SECTIONS`:

```ts
export const MARKETPLACE_SECTIONS: ReadonlyArray<{ id: MarketplaceSection; label: string; icon: IconName }> = [
  { id: "browse", label: "Yours", icon: "ph:squares-four" },
  ...(caveCrafts()
    ? [{ id: "crafts", label: "Crafts", icon: "ph:package-bold" } satisfies {
        id: MarketplaceSection;
        label: string;
        icon: IconName;
      }]
    : []),
  { id: "skills", label: "Skills", icon: "ph:sparkle" },
  { id: "build", label: "Build", icon: "ph:flow-arrow" },
];
```

Use these hints:

```ts
browse: "Things you already installed or authored, kept together in one local inventory.",
skills: "A smaller, reviewed OpenCoven Skills marketplace is being curated.",
build: "Author a new skill directly in a local skill root.",
```

Change the search label type to exclude `skills` and set:

```ts
browse: "Search your items",
crafts: "Search your Crafts",
roles: "Search your items",
```

Keep `"installed"` in `MarketplaceStatusFilter` only as a persisted migration
value, but remove it from `MARKETPLACE_STATUS_FILTERS`. Keep **All** and
**Needs setup**.

- [ ] **Step 4: Remove remote discovery state from `MarketplaceViewSurface`**

In `src/components/marketplace-view.tsx`:

- remove `CollectionStrip`, `COLLECTIONS`, `resolveCollection`,
  `sourceTarget`, and install-toggle imports;
- import `SkillsComingSoon`;
- remove `topic`, `collectionId`, `activeCollection`, `collectionIds`,
  `skillTopics`, `skillMatchesTopic`, `skillInstalled`, `skillBusyIds`,
  `skillInFlight`, `skillIsInstalled`, and `toggleSkill`;
- keep `skills`, `skillsLoaded`, `skillsError`, and `exploreSkill`;
- change `loadSkills(search = "")` to `loadSkills(force = false)` and always
  call `readSurfaceResource("marketplace:skills", force)`;
- remove the debounced query effect entirely; `filteredSkills` already performs
  local string filtering;
- add this migration effect for the retired visible status:

```ts
useEffect(() => {
  if (status === "installed") setStatus("all");
}, [status, setStatus]);
```

- remove collection normalization and Featured collections;
- sort Yours by name regardless of the old recommendation preference;
- retain the Crafts sort preference only inside the feature-gated Crafts tab.

The local loader body should be:

```ts
  const loadSkills = useCallback(async (force = false) => {
    skillsCtl.current?.abort();
    const ctl = new AbortController();
    skillsCtl.current = ctl;
    setSkillsLoaded(false);
    try {
      const { data: json } = await readSurfaceResource<{
        ok?: boolean;
        entries?: SkillBrowserEntry[];
        error?: string;
      }>("marketplace:skills", force);
      if (ctl.signal.aborted) return;
      if (!json.ok) throw new Error(json.error ?? "skills unavailable");
      setSkills(json.entries ?? []);
      setSkillsError(null);
    } catch (error) {
      if (ctl.signal.aborted) return;
      setSkills([]);
      setSkillsError(error instanceof Error ? error.message : "skills unavailable");
    } finally {
      if (!ctl.signal.aborted) setSkillsLoaded(true);
    }
  }, []);
```

- [ ] **Step 5: Replace discovery filtering with owned filtering**

Use these derivations:

```ts
  const showSkillType = kind === "all" || kind === "skill";
  const statusOkPlugin = useCallback(
    (plugin: MarketplacePlugin) =>
      status !== "needs-setup" || pluginBadgeState(plugin) === "needs-setup",
    [status],
  );

  const filteredPlugins = useMemo(() => {
    const matched = filterPlugins(visiblePlugins, {
      query,
      category: kind === "skill" ? "All" : category,
      kind,
    }).filter(statusOkPlugin);
    return sortPlugins(matched, "name");
  }, [visiblePlugins, query, category, kind, statusOkPlugin]);

  const q = query.trim().toLowerCase();
  const filteredSkills = useMemo(() => {
    if (!showSkillType || status === "needs-setup") return [] as SkillBrowserEntry[];
    if (kind === "all" && category !== "All") return [] as SkillBrowserEntry[];
    return skills.filter((skill) => {
      if (!q) return true;
      return [
        skill.name,
        skill.description ?? "",
        skill.owner ?? "",
        (skill.topics ?? skill.tags ?? []).join(" "),
      ].join(" ").toLowerCase().includes(q);
    });
  }, [skills, showSkillType, status, kind, category, q]);
```

Keep `typeCount` based on `visiblePlugins` plus local skills. Replace
`statusCount` with:

```ts
const statusCount = useCallback(
  (id: MarketplaceStatusFilter) =>
    id === "needs-setup"
      ? visiblePlugins.filter((plugin) => pluginBadgeState(plugin) === "needs-setup").length
      : visiblePlugins.length + skills.length,
  [visiblePlugins, skills],
);
```

- [ ] **Step 6: Add explicit section and owned-skills navigation**

Replace `selectSection` so `skills` is no longer an alias for Browse:

```ts
  const selectSection = useCallback((next: MarketplaceSection) => {
    setDeepLinkSection(null);
    setStoredSection(next === "roles" || next === "capabilities" ? "browse" : next);
    setQuery("");
  }, [setStoredSection]);
```

Keep `selectSection("skills")` for the Coming Soon tab. Add:

```ts
  const viewOwnedSkills = useCallback(() => {
    setDeepLinkSection(null);
    setStoredSection("browse");
    setKind("skill");
    setStatus("all");
    setCategory("All");
    setQuery("");
  }, [setCategory, setKind, setStatus, setStoredSection]);
```

Use it for:

- Coming Soon's **View your skills**;
- Build's `onViewSkills`; and
- any internal link that means “show the user's installed/authored skills.”

- [ ] **Step 7: Render owned-only groups and truthful empty states**

Keep the two default groups, but change their copy to:

```ts
{ key: "tools", name: "Tools & connectors", sub: "Installed services and local integrations.", plugins: connectors, skills: [] }
{ key: "skills", name: "Your skills", sub: "Installed and authored SKILL.md procedures.", plugins: pluginSkills, skills: filteredSkills }
```

Render `SkillExploreCard` with only:

```tsx
<SkillExploreCard
  key={`skill:${skill.slug ?? skill.path ?? skill.id}:${skill.id}`}
  skill={skill}
  onOpen={setExploreSkill}
/>
```

For a true empty inventory, use:

```tsx
<EmptyState
  icon="ph:squares-four"
  headline="Nothing in your Marketplace yet"
  subtitle="Installed tools and authored skills appear here. Build a skill to start your local collection."
  actions={
    <Button variant="primary" size="sm" leadingIcon="ph:hammer" onClick={() => selectSection("build")}>
      Build a skill
    </Button>
  }
/>
```

Keep **No matches** plus **Clear filters** for filtered emptiness.

- [ ] **Step 8: Render the dedicated Skills destination and simplify header search**

Derive a safely narrowed search label:

```ts
const searchLabel =
  section === "browse" ? SEARCH_LABEL.browse
  : section === "crafts" ? SEARCH_LABEL.crafts
  : null;
```

Render `SearchInput` only when `searchLabel` is non-null and use that string for
both `placeholder` and `aria-label`. Insert the Skills branch before Crafts or
Build:

```tsx
      ) : section === "skills" ? (
        <SkillsComingSoon
          onViewOwnedSkills={viewOwnedSkills}
          onBuildSkill={() => selectSection("build")}
        />
```

Build's save and view handlers become:

```tsx
onSaved={() => {
  invalidateSurfaceResources("marketplace:skills");
  void loadSkills(true);
}}
onViewSkills={viewOwnedSkills}
```

Render the simplified drawer:

```tsx
<SkillExploreDrawer
  key={exploreSkill?.path ?? exploreSkill?.id ?? "none"}
  skill={exploreSkill}
  onClose={() => setExploreSkill(null)}
  onChanged={() => {
    invalidateSurfaceResources("marketplace:skills");
    void loadSkills(true);
  }}
/>
```

- [ ] **Step 9: Keep feature-gated Crafts owned-only**

The API already filters published Crafts to installed records and prepends local
drafts. Keep `caveCrafts()` routing, the Crafts tab, authoring drawer, arrival
watch, verified install/uninstall, and deep-link fallback unchanged. Update
tests only where they say “Browse” or assume unowned published catalog entries.

Add an assertion to `crafts-marketplace.test.ts` that the Marketplace route uses
`selectOwnedMarketplacePlugins`, and retain the existing draft assertions.

- [ ] **Step 10: Update preference comments without breaking migration**

In `src/lib/surface-preference-specs.ts`:

- describe `status` as the owned inventory setup filter;
- retain `"installed"` in the enum so existing local storage parses;
- describe `topic` and `collection` as retired values retained for safe
  preference migration; and
- keep the section enum including `crafts` and `skills`.

- [ ] **Step 11: Run Marketplace view contracts**

Run:

```bash
node --require ./scripts/css-source-contract-hook.cjs --experimental-strip-types src/components/marketplace/marketplace-view-model.test.ts
node --require ./scripts/css-source-contract-hook.cjs --experimental-strip-types src/components/marketplace/skill-explore.test.ts
node --require ./scripts/css-source-contract-hook.cjs --experimental-strip-types src/components/marketplace/skills-coming-soon.test.ts
node --require ./scripts/css-source-contract-hook.cjs --experimental-strip-types src/components/marketplace/crafts-marketplace.test.ts
node --require ./scripts/css-source-contract-hook.cjs --experimental-strip-types src/components/marketplace/crafts-visibility.test.ts
```

Expected: all pass.

- [ ] **Step 12: Checkpoint without committing**

Run `git diff --check` and `git status --short`. Do not commit without explicit
authorization.

---

### Task 6: Make unlisted installed cards and detail truthful

**Files:**

- Modify: `src/components/marketplace/marketplace-card.tsx`
- Modify: `src/components/marketplace/marketplace-detail.tsx`
- Modify: `src/components/marketplace/marketplace-detail.test.ts`

- [ ] **Step 1: Write the failing unlisted detail contract**

Add to `src/components/marketplace/marketplace-detail.test.ts`:

```ts
const cardSource = await readFile(new URL("./marketplace-card.tsx", import.meta.url), "utf8");
assert.match(source, /plugin\.unlisted/, "detail recognizes local install records without catalog metadata");
assert.match(source, /Catalog details unavailable/, "unlisted detail states the metadata gap plainly");
assert.match(cardSource, /plugin\.unlisted/, "cards recognize unlisted local install records");
assert.match(cardSource, /Installed item/, "unlisted cards do not pretend to be catalog Skills");
assert.doesNotMatch(source, /plugin\.unlisted[\s\S]{0,800}Primary ways this listing extends a familiar/, "unlisted detail does not invent capability fit");
```

- [ ] **Step 2: Run the test and verify the red state**

Run:

```bash
node --require ./scripts/css-source-contract-hook.cjs --experimental-strip-types src/components/marketplace/marketplace-detail.test.ts
```

Expected: FAIL because unlisted state has no UI treatment.

- [ ] **Step 3: Special-case unlisted card metadata**

In `MarketplaceCard`:

- compute `const state = plugin.unlisted ? "added" : pluginBadgeState(plugin);`
- make `kindLabel` accept the full plugin or add
  `plugin.unlisted ? "Installed item" : kindLabel(plugin.kind)` at both visible
  kind labels;
- return `{ icon: "ph:check-circle", label: "Installed" }` from
  `setupEffortLabel` when `plugin.unlisted`;
- return `Catalog details unavailable` from `capabilityPreview` and
  `Local record` from `roleFitLabel` when unlisted; and
- show `Local record` instead of a trust label in the meta row.

The existing Added button can call `onRemove`; the server-side Task 1 guard
makes that action safe.

- [ ] **Step 4: Special-case unlisted decision items**

At the start of `detailDecisionItems` in `MarketplaceDetail`, return:

```ts
  if (plugin.unlisted) {
    return [
      {
        label: "Catalog",
        icon: "ph:warning" as const,
        value: "Details unavailable",
        detail: "This local install record no longer has a Marketplace listing.",
      },
      {
        label: "Version",
        icon: "ph:tag" as const,
        value: plugin.installation?.version ?? plugin.version,
        detail: "Recorded in your local Cave configuration.",
      },
      {
        label: "Source",
        icon: "ph:folder-open" as const,
        value: plugin.installation?.source ?? "Local",
        detail: "No capabilities or trust claims are inferred.",
      },
    ];
  }
```

In the standard detail header/body, use **Installed item** as its kind and add a
visible sentence:

```tsx
{plugin.unlisted ? (
  <p className="text-[length:var(--text-sm)] text-[var(--text-muted)]">
    Catalog details unavailable. This installed record is preserved from your local Cave configuration.
  </p>
) : null}
```

`ph:tag` is already present in `ICON_NAMES`.

- [ ] **Step 5: Run card/detail and catalog tests**

Run:

```bash
node --require ./scripts/css-source-contract-hook.cjs --experimental-strip-types src/components/marketplace/marketplace-detail.test.ts
node --require ./scripts/css-source-contract-hook.cjs --experimental-strip-types src/lib/marketplace-catalog.test.ts
node --require ./scripts/css-source-contract-hook.cjs --experimental-strip-types src/app/api/marketplace/owned-route.test.ts
```

Expected: all pass.

- [ ] **Step 6: Checkpoint without committing**

Run `git diff --check` and `git status --short`. Do not commit without explicit
authorization.

---

### Task 7: Align documentation, test wiring, and the reviewed spec

**Files:**

- Modify: `docs/marketplace.md`
- Modify: `docs/superpowers/specs/2026-07-29-marketplace-owned-coming-soon-design.md`
- Modify: `scripts/run-tests.mjs`

- [ ] **Step 1: Update Marketplace's user-facing data description**

At the top of `docs/marketplace.md`, distinguish the publisher catalog from the
visible owned inventory:

```md
Coven Cave keeps a checked-in publisher catalog for package metadata and
compatibility exports. The in-app Marketplace is intentionally narrower: it
shows items the current user already installed or authored. Unowned publisher
entries do not appear in the product and are not fetched as discovery inventory.
```

Add a **Curated Skills preview** section:

```md
## Curated Skills preview

The Skills section is a Coming Soon space for a deliberately small OpenCoven
catalog. A skill reaches that shelf only after its source is reviewed, its
behavior is verified in Cave, and it is explicitly published for familiars.
Until Val curates the first collection, the section contains no synthetic
listings or borrowed registry metrics.

Locally installed and authored skills remain operational under **Yours** and
new skills can still be authored under **Build**. Marketplace uses the
local-only `scope=local` directory path; dormant remote directory APIs are not
part of its mount or search flow.
```

Update the older “Marketplace surface” section so it describes **Yours** rather
than browse/install discovery. Keep package updating, configuration, security,
and Craft lifecycle documentation intact because existing installs still use
those paths.

- [ ] **Step 2: Mark the approved spec ready for implementation**

Change the spec status to:

```md
**Status:** Approved for implementation
```

- [ ] **Step 3: Verify new tests are wired exactly once**

Run:

```bash
rg -n 'owned-route\\.test|skills-coming-soon\\.test' scripts/run-tests.mjs
pnpm check:tests-wired
```

Expected: each new test appears once; the wiring gate passes.

- [ ] **Step 4: Run design documentation contracts**

Run:

```bash
node scripts/ui-consistency.test.mjs
git diff --check
```

Expected: both pass.

- [ ] **Step 5: Checkpoint without committing**

Run `git status --short`. Do not commit without explicit authorization.

---

### Task 8: Verify behavior and inspect the native Marketplace

**Files:**

- Verify all changed files
- Record evidence in Bead `cave-ehhmi`

- [ ] **Step 1: Run focused Marketplace and skills contracts**

Run:

```bash
for test_file in \
  src/lib/marketplace-catalog.test.ts \
  src/lib/server/skills-directory.test.ts \
  src/app/api/marketplace/owned-route.test.ts \
  src/app/api/marketplace/crafts-routes.test.ts \
  src/components/marketplace/marketplace-view-model.test.ts \
  src/components/marketplace/skill-explore.test.ts \
  src/components/marketplace/skills-coming-soon.test.ts \
  src/components/marketplace/marketplace-detail.test.ts \
  src/components/marketplace/crafts-marketplace.test.ts \
  src/components/marketplace/crafts-visibility.test.ts
do
  if [[ "$test_file" == "src/lib/server/skills-directory.test.ts" ]]; then
    node --require ./scripts/css-source-contract-hook.cjs --experimental-strip-types --import ./scripts/test-alias-register.mjs "$test_file" || exit $?
  else
    node --require ./scripts/css-source-contract-hook.cjs --experimental-strip-types "$test_file" || exit $?
  fi
done
```

Expected: every listed file passes.

- [ ] **Step 2: Run static quality gates**

Run serially:

```bash
pnpm check:tests-wired
pnpm typecheck
pnpm lint
git diff --check
```

Expected: all pass with no warnings promoted to failures.

- [ ] **Step 3: Run the full app suite**

Run:

```bash
pnpm test:app
```

Expected: every app test file passes. If the documented
`vault-ref-cold-start.test.ts` load race appears, preserve the exact failure,
run that file isolated, then rerun the full suite; do not call a single isolated
pass proof of the full suite.

- [ ] **Step 4: Prove the API returns owned state only**

Confirm the chosen verification port is free, then start the native dev app in
the foreground:

```bash
lsof -nP -iTCP:3007 -sTCP:LISTEN
PORT=3007 bash scripts/dev-app.sh
```

Expected from `lsof`: no output. Expected from the wrapper: it selects port
3007 and leaves the Tauri process attached.

From a separate shell:

```bash
curl -s http://127.0.0.1:3007/api/marketplace \
  | jq '{count: (.plugins | length), unowned: [.plugins[] | select((.installed != true) and (.draft != true)) | .id], unlisted: [.plugins[] | select(.unlisted == true) | .id]}'
curl -s 'http://127.0.0.1:3007/api/skills/directory?scope=local' \
  | jq '{source, count: (.entries | length), nonlocal: [.entries[] | select(.source != "local") | .id]}'
```

Expected:

- `unowned` is `[]`;
- `unlisted` includes local install ids missing from catalog metadata;
- skill `source` is `"local"`; and
- `nonlocal` is `[]`.

- [ ] **Step 5: Inspect the native surface**

In the Tauri window:

1. Open Marketplace.
2. Verify the default tabs are **Yours**, **Skills**, and **Build** when Crafts
   is not explicitly enabled.
3. Confirm Yours has only installed catalog records and local skills.
4. Search for an uninstalled seed id and confirm it never appears.
5. Open a normal installed package and confirm setup/manage behavior remains.
6. Open an unlisted installed record and confirm the UI says catalog details
   are unavailable without capability or trust claims.
7. Open a local skill and confirm preview, Prompt, and two-step Delete are
   present; do not complete deletion during verification.
8. Open Skills and verify the curator shelf, ordered review path, and both
   navigation actions.
9. Use **View your skills** and confirm Yours opens with Skills selected.
10. Use **Build a skill**, then return without saving.

- [ ] **Step 6: Verify responsive and theme behavior**

Using the native window:

- wide desktop pane: three shelf slots share one horizontal shelf;
- narrow pane near 640px: slots become a vertical sequence with no horizontal
  overflow;
- default dark mode;
- light mode; and
- one non-default theme.

Confirm focus rings on both actions and that reduced-motion mode renders the
slots without entrance animation.

- [ ] **Step 7: Stop the dev app cleanly**

Send `Ctrl-C` to the attached `scripts/dev-app.sh` terminal. Confirm the wrapper
tears down Tauri and its Next server and releases the selected port.

- [ ] **Step 8: Record final Beads evidence**

Update `cave-ehhmi` with:

- branch and worktree;
- changed files;
- focused, static, and full-suite results;
- API proof counts and empty `unowned`/`nonlocal` arrays;
- native desktop/narrow/theme evidence;
- remaining commit/PR authorization state.

Do not close the Bead until implementation completion criteria and the active
delivery policy are satisfied.

- [ ] **Step 9: Final completion audit**

Inspect:

```bash
git status --short --branch
git diff --stat
git diff --check
bd show cave-ehhmi --json
```

Map each goal clause to direct evidence:

- only user-created/installed items remain;
- no unowned discovery fetch occurs;
- future curation has a dedicated Skills destination;
- the Coming Soon page is rendered and responsive;
- existing owned management remains operational; and
- every required gate passed.

If any evidence is missing or indirect, continue implementation or verification
instead of declaring completion.
