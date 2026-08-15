import { readFile, readdir, mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import * as simpleIcons from "simple-icons";
import sharp from "sharp";

const ROOT = process.cwd();
const CATALOG_PATH = path.join(ROOT, "marketplace", "marketplace.json");
const OUTPUT_PATH = path.join(ROOT, "src", "lib", "marketplace-logo-registry.gen.json");
const ASSET_DIR = path.join(ROOT, "public", "marketplace-logos");
const CHECK = process.argv.includes("--check");

const BRAND_ALIASES = {
  "chrome-devtools": "googlechrome",
  "cloudflare-docs": "cloudflare",
  "daily-dev-agentic": "dailydotdev",
  "framer-motion-patterns": "framer",
  "linear-issue-management": "linear",
  "next-devtools": "nextdotjs",
  "nuxt-dev": "nuxt",
  "shadcn-ui-and-radix": "shadcnui",
  "tailwind-design-tokens": "tailwindcss",
  "tauri-apple-release": "tauri",
  "threejs-animation": "threedotjs",
};

function normalize(value) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function monogram(value) {
  const words = value.replace(/([a-z0-9])([A-Z])/g, "$1 $2").match(/[A-Za-z0-9]+/g) ?? [];
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return `${words[0][0]}${words.at(-1)[0]}`.toUpperCase();
}

function isSimpleIcon(value) {
  return value
    && typeof value === "object"
    && typeof value.slug === "string"
    && typeof value.title === "string"
    && typeof value.path === "string";
}

const icons = Object.values(simpleIcons).filter(isSimpleIcon);
const bySlug = new Map(icons.map((icon) => [icon.slug, icon]));
const normalizedMatches = new Map();
for (const icon of icons) {
  for (const key of [icon.slug, icon.title]) {
    const normalized = normalize(key);
    const previous = normalizedMatches.get(normalized);
    normalizedMatches.set(normalized, previous && previous.slug !== icon.slug ? null : icon);
  }
}

function resolveBrand(plugin) {
  const aliasedSlug = BRAND_ALIASES[plugin.name];
  if (aliasedSlug) {
    const aliased = bySlug.get(aliasedSlug);
    if (!aliased) throw new Error(`Unknown Simple Icons alias ${aliasedSlug} for ${plugin.name}`);
    return aliased;
  }
  for (const candidate of [plugin.name, plugin.displayName ?? ""]) {
    const matched = normalizedMatches.get(normalize(candidate));
    if (matched) return matched;
  }
  return null;
}

function pngFor(icon) {
  const svg = [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="-2 -2 28 28">',
    `<path fill="#000" d="${icon.path}"/>`,
    "</svg>",
  ].join("");
  return sharp(Buffer.from(svg)).resize(128, 128).png().toBuffer();
}

async function build() {
  const catalog = JSON.parse(await readFile(CATALOG_PATH, "utf8"));
  if (!catalog || !Array.isArray(catalog.plugins)) {
    throw new Error("marketplace/marketplace.json must contain a plugins array");
  }

  const entries = {};
  const brandAssets = new Map();
  for (const plugin of catalog.plugins) {
    if (!plugin || typeof plugin.name !== "string" || !plugin.name.match(/^[a-z0-9][a-z0-9._-]*$/)) {
      throw new Error(`Invalid marketplace plugin name: ${JSON.stringify(plugin?.name)}`);
    }
    const title = typeof plugin.displayName === "string" && plugin.displayName.trim()
      ? plugin.displayName.trim()
      : plugin.name;
    const fallback = monogram(title);
    const brand = resolveBrand(plugin);
    if (brand) {
      const assetPath = `/marketplace-logos/${plugin.name}.png`;
      entries[plugin.name] = {
        kind: "brand",
        title: brand.title,
        monogram: fallback,
        slug: brand.slug,
        svgPath: brand.path,
        assetPath,
        source: brand.source,
      };
      brandAssets.set(`${plugin.name}.png`, await pngFor(brand));
    } else {
      entries[plugin.name] = {
        kind: "monogram",
        title,
        monogram: fallback,
      };
    }
  }

  const registry = {
    schemaVersion: 1,
    generator: "scripts/generate-marketplace-logos.mjs",
    source: {
      name: "Simple Icons",
      license: "CC0-1.0",
      package: "simple-icons",
    },
    catalogCount: catalog.plugins.length,
    brandCount: brandAssets.size,
    monogramCount: catalog.plugins.length - brandAssets.size,
    entries,
  };
  const expectedRegistry = `${JSON.stringify(registry, null, 2)}\n`;

  await mkdir(ASSET_DIR, { recursive: true });
  const existingAssets = (await readdir(ASSET_DIR)).filter((name) => name.endsWith(".png")).sort();
  const expectedAssets = [...brandAssets.keys()].sort();

  if (CHECK) {
    const actualRegistry = await readFile(OUTPUT_PATH, "utf8").catch(() => "");
    if (actualRegistry !== expectedRegistry) {
      throw new Error("marketplace logo registry is stale; run pnpm marketplace:logos");
    }
    if (JSON.stringify(existingAssets) !== JSON.stringify(expectedAssets)) {
      throw new Error("marketplace logo asset inventory is stale; run pnpm marketplace:logos");
    }
    for (const [name, expected] of brandAssets) {
      const actual = await readFile(path.join(ASSET_DIR, name)).catch(() => null);
      if (!actual || !actual.equals(expected)) {
        throw new Error(`marketplace logo asset is stale: ${name}`);
      }
    }
    console.log(`marketplace logos: ${registry.catalogCount} covered (${registry.brandCount} brand, ${registry.monogramCount} monogram)`);
    return;
  }

  await writeFile(OUTPUT_PATH, expectedRegistry);
  for (const stale of existingAssets.filter((name) => !brandAssets.has(name))) {
    await unlink(path.join(ASSET_DIR, stale));
  }
  for (const [name, data] of brandAssets) {
    await writeFile(path.join(ASSET_DIR, name), data);
  }
  console.log(`marketplace logos: generated ${registry.catalogCount} entries (${registry.brandCount} brand, ${registry.monogramCount} monogram)`);
}

await build();
