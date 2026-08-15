// @ts-nocheck
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import {
  marketplaceLogoCoverage,
  marketplaceMonogram,
  resolveMarketplaceLogo,
} from "./marketplace-logo.ts";
import registry from "./marketplace-logo-registry.gen.json" with { type: "json" };

const root = path.resolve(import.meta.dirname, "../..");
const catalog = JSON.parse(await readFile(path.join(root, "marketplace/marketplace.json"), "utf8"));
const catalogIds = catalog.plugins.map((plugin) => plugin.name);
const registryIds = Object.keys(registry.entries);

assert.deepEqual(
  registryIds,
  catalogIds,
  "the generated logo audit must classify every catalog entry in catalog order",
);
assert.deepEqual(
  marketplaceLogoCoverage(),
  {
    catalogCount: catalogIds.length,
    brandCount: registry.brandCount,
    monogramCount: registry.monogramCount,
  },
);
assert.equal(
  registry.brandCount + registry.monogramCount,
  catalogIds.length,
  "brand and monogram classifications must cover the full catalog exactly once",
);
assert.ok(registry.brandCount >= 35, "the curated brand set must not silently regress");

for (const plugin of catalog.plugins) {
  const logo = resolveMarketplaceLogo(plugin.name, plugin.displayName ?? plugin.name);
  assert.ok(logo.monogram.length >= 1 && logo.monogram.length <= 2, `${plugin.name} has a usable fallback`);
  if (logo.kind === "brand") {
    assert.ok(logo.svgPath, `${plugin.name} brand mark has an inline SVG path`);
    assert.equal(logo.assetPath, `/marketplace-logos/${plugin.name}.png`);
  }
}

assert.equal(resolveMarketplaceLogo("github", "GitHub").slug, "github");
assert.equal(resolveMarketplaceLogo("cloudflare-docs", "Cloudflare Docs").slug, "cloudflare");
assert.equal(resolveMarketplaceLogo("next-devtools", "Next.js DevTools").slug, "nextdotjs");
assert.equal(resolveMarketplaceLogo("tailwind-design-tokens", "Tailwind Design Tokens").slug, "tailwindcss");
assert.equal(resolveMarketplaceLogo("canva", "Canva").kind, "monogram");
assert.equal(resolveMarketplaceLogo("canva", "Canva").monogram, "CA");
assert.equal(resolveMarketplaceLogo("unlisted-local-tool", "Unlisted Local Tool").monogram, "UT");
assert.equal(marketplaceMonogram("Prompt Pack: Shipping"), "PS");
assert.equal(marketplaceMonogram("GitHub"), "GH");
assert.equal(marketplaceMonogram("OpenCoven"), "OC");

const expectedAssets = Object.entries(registry.entries)
  .filter(([, logo]) => logo.kind === "brand")
  .map(([id]) => `${id}.png`)
  .sort();
const actualAssets = (await readdir(path.join(root, "public/marketplace-logos")))
  .filter((name) => name.endsWith(".png"))
  .sort();
assert.deepEqual(actualAssets, expectedAssets, "generated iOS logo assets exactly match branded entries");
for (const asset of actualAssets) {
  const bytes = await readFile(path.join(root, "public/marketplace-logos", asset));
  assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], `${asset} is a PNG`);
}

const componentSource = await readFile(
  path.join(root, "src/components/marketplace/marketplace-logo.tsx"),
  "utf8",
);
assert.match(componentSource, /data-marketplace-logo-kind=\{resolved\.kind\}/);
assert.match(componentSource, /resolved\.kind === "brand" && resolved\.svgPath/);
assert.match(componentSource, /marketplace-logo__monogram/);

for (const file of [
  "src/components/marketplace/marketplace-card.tsx",
  "src/components/marketplace/marketplace-detail.tsx",
  "src/components/marketplace/craft-detail.tsx",
  "src/components/marketplace/knowledge-pack-detail.tsx",
  "src/components/marketplace/skill-explore-card.tsx",
  "src/components/marketplace/skill-explore-drawer.tsx",
]) {
  const source = await readFile(path.join(root, file), "utf8");
  assert.match(source, /<MarketplaceLogo/, `${file} uses the shared marketplace identity`);
}

const iosModels = await readFile(
  path.join(root, "apps/ios/CovenCave/CovenCave/Models/MarketplaceModels.swift"),
  "utf8",
);
const iosView = await readFile(
  path.join(root, "apps/ios/CovenCave/CovenCave/Views/PluginsPanel.swift"),
  "utf8",
);
const iosClient = await readFile(
  path.join(root, "apps/ios/CovenCave/CovenCave/Networking/CaveClient.swift"),
  "utf8",
);
assert.match(iosModels, /struct MarketplaceLogoIdentity: Codable, Hashable/);
assert.match(iosView, /MarketplacePluginLogo\(plugin: plugin, size:/);
assert.match(iosView, /CachedImageView\(/);
assert.match(iosView, /plugin\.logo\?\.monogram/);
assert.match(iosClient, /func marketplaceLogoSource\(for plugin: MarketplacePlugin\) -> CaveImageSource\?/);
assert.match(iosClient, /\.authenticatedRemoteURL\(resolved, bearerToken: token\)/);

const marketplaceRoute = await readFile(
  path.join(root, "src/app/api/marketplace/route.ts"),
  "utf8",
);
assert.match(marketplaceRoute, /logo: plugin\.logo \?\? resolveMarketplaceLogo\(plugin\.id, plugin\.displayName\)/);

console.log(`marketplace-logo.test.ts: ${catalogIds.length} entries covered`);
