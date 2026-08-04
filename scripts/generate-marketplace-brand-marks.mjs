import { readFileSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SaxesParser } from "saxes";
import * as simpleIcons from "simple-icons";

const CHECK = process.argv.includes("--check");
const MAX_SOURCE_SVG_BYTES = 16 * 1024;
const MAX_EMBEDDED_ASSET_BYTES = 180 * 1024;
const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const XMLNS_NAMESPACE = "http://www.w3.org/2000/xmlns/";
const XLINK_NAMESPACE = "http://www.w3.org/1999/xlink";
const ALLOWED_SVG_ELEMENTS = new Set([
  "circle",
  "clipPath",
  "defs",
  "desc",
  "ellipse",
  "g",
  "line",
  "linearGradient",
  "mask",
  "path",
  "polygon",
  "polyline",
  "radialGradient",
  "rect",
  "stop",
  "svg",
  "symbol",
  "title",
  "use",
]);
const LOCAL_REFERENCE_RE = /^#[A-Za-z_][A-Za-z0-9_.:-]*$/;
const SVG_NUMBER = "([+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][+-]?\\d+)?)";
const VIEW_BOX_RE = new RegExp(
  `^\\s*${SVG_NUMBER}(?:\\s+|\\s*,\\s*)${SVG_NUMBER}(?:\\s+|\\s*,\\s*)${SVG_NUMBER}(?:\\s+|\\s*,\\s*)${SVG_NUMBER}\\s*$`,
);

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = resolve(SCRIPT_DIR, "..");
const CATALOG_PATH = resolve(ROOT_DIR, "marketplace/marketplace.json");
const LEDGER_PATH = resolve(ROOT_DIR, "marketplace/brand-marks.json");
const ASSET_DIR = resolve(ROOT_DIR, "marketplace/brand-assets");
const OUTPUT_PATH = resolve(ROOT_DIR, "src/lib/marketplace-brand-marks.gen.ts");

function validateLocalReference(value, label, context, references) {
  const normalized = value.trim();
  if (normalized !== value || !LOCAL_REFERENCE_RE.test(normalized)) {
    throw new Error(`${label}: ${context} must be a same-document #id reference`);
  }
  references.add(normalized.slice(1));
}

function validateUrlFunctions(value, label, context, references) {
  if (value.includes("\\")) {
    throw new Error(`${label}: ${context} contains an unsupported escape`);
  }

  const remainder = value.replace(
    /url\s*\(\s*(?:"([^"]*)"|'([^']*)'|([^"')]*))\s*\)/gi,
    (_match, doubleQuoted, singleQuoted, bare) => {
      validateLocalReference(doubleQuoted ?? singleQuoted ?? bare, label, context, references);
      return "";
    },
  );
  if (/url/i.test(remainder)) {
    throw new Error(`${label}: ${context} contains an unsupported URL expression`);
  }
}

function validateViewBox(value, label) {
  const match = VIEW_BOX_RE.exec(value);
  const numbers = match?.slice(1).map(Number);
  if (
    !numbers ||
    numbers.some((number) => !Number.isFinite(number)) ||
    numbers[2] <= 0 ||
    numbers[3] <= 0
  ) {
    throw new Error(`${label}: viewBox must contain four finite numbers with positive width and height`);
  }
}

export function sanitizeSvg(source, label) {
  const ids = new Set();
  const references = new Set();
  let depth = 0;
  let rootCount = 0;
  let sawViewBox = false;
  const parser = new SaxesParser({ xmlns: true, fileName: label });

  parser.on("doctype", () => {
    throw new Error(`${label}: document types are unsupported`);
  });
  parser.on("processinginstruction", () => {
    throw new Error(`${label}: processing instructions are unsupported`);
  });
  parser.on("opentag", (node) => {
    if (depth === 0) {
      rootCount += 1;
      if (node.local !== "svg" || node.uri !== SVG_NAMESPACE) {
        throw new Error(`${label}: root must be svg in the SVG namespace`);
      }
    }
    depth += 1;

    if (node.uri !== SVG_NAMESPACE || !ALLOWED_SVG_ELEMENTS.has(node.local)) {
      throw new Error(`${label}: unsupported SVG element ${node.name}`);
    }

    for (const attribute of Object.values(node.attributes)) {
      if (attribute.uri === XMLNS_NAMESPACE) continue;
      const localName = attribute.local.toLowerCase();
      if (localName.startsWith("on")) {
        throw new Error(`${label}: event attribute ${attribute.name} is unsupported`);
      }
      if (localName === "style") {
        throw new Error(`${label}: style attributes are unsupported`);
      }
      if (attribute.prefix && !(attribute.uri === XLINK_NAMESPACE && localName === "href")) {
        throw new Error(`${label}: namespaced attribute ${attribute.name} is unsupported`);
      }
      if (localName === "href" || localName === "src") {
        validateLocalReference(attribute.value, label, attribute.name, references);
      } else {
        validateUrlFunctions(attribute.value, label, attribute.name, references);
      }
      if (localName === "id") {
        if (ids.has(attribute.value)) throw new Error(`${label}: duplicate SVG id ${attribute.value}`);
        ids.add(attribute.value);
      }
      if (depth === 1 && attribute.local === "viewBox") {
        validateViewBox(attribute.value, label);
        sawViewBox = true;
      }
    }
  });
  parser.on("closetag", () => {
    depth -= 1;
  });

  try {
    parser.write(source).close();
  } catch (error) {
    if (error instanceof Error && error.message.startsWith(`${label}:`)) throw error;
    throw new Error(`${label}: invalid SVG XML (${error instanceof Error ? error.message : String(error)})`);
  }

  if (rootCount !== 1 || !sawViewBox) {
    throw new Error(`${label}: exactly one SVG root with a viewBox is required`);
  }
  for (const reference of references) {
    if (!ids.has(reference)) throw new Error(`${label}: unresolved same-document reference #${reference}`);
  }
  return source.trim();
}

export function svgDataUri(svg) {
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function validateCoverage(catalog, ledger) {
  if (ledger.schemaVersion !== 1) throw new Error("brand ledger schemaVersion must be 1");

  const catalogIds = catalog.plugins.map((plugin) => plugin.name).sort();
  const brandIds = Object.keys(ledger.brands).sort();
  const genericIds = [...ledger.generic].sort();
  const unresolvedIds = Object.keys(ledger.unresolved).sort();
  const classifiedIds = [...brandIds, ...genericIds, ...unresolvedIds].sort();

  if (new Set(classifiedIds).size !== classifiedIds.length) {
    throw new Error("marketplace brand classifications overlap");
  }
  if (JSON.stringify(classifiedIds) !== JSON.stringify(catalogIds)) {
    throw new Error("marketplace brand ledger does not exhaustively cover the catalog");
  }

  for (const [id, source] of Object.entries(ledger.brands)) {
    if (!source || !["simple-icons", "iconify-logos", "asset"].includes(source.kind)) {
      throw new Error(`${id}: unsupported marketplace brand source`);
    }
  }
}

function loadIconifyLogos() {
  const require = createRequire(import.meta.url);
  return readJson(require.resolve("@iconify-json/logos/icons.json"));
}

export function resolveIconifyLogo(iconify, iconName, label) {
  if (!iconify?.icons || typeof iconify.icons !== "object" || !Object.hasOwn(iconify.icons, iconName)) {
    throw new Error(`${label}: SVG Logos icon ${iconName} was not found`);
  }
  const icon = iconify.icons[iconName];
  if (
    !icon ||
    typeof icon !== "object" ||
    Array.isArray(icon) ||
    typeof icon.body !== "string" ||
    icon.body.trim().length === 0
  ) {
    throw new Error(`${label}: SVG Logos icon ${iconName} has no non-empty body`);
  }
  return icon;
}

function renderRegistry() {
  const catalog = readJson(CATALOG_PATH);
  const ledger = readJson(LEDGER_PATH);
  validateCoverage(catalog, ledger);

  const catalogById = new Map(catalog.plugins.map((plugin) => [plugin.name, plugin]));
  const simpleIconsBySlug = new Map(
    Object.values(simpleIcons)
      .filter((icon) => icon && typeof icon === "object" && typeof icon.slug === "string")
      .map((icon) => [icon.slug, icon]),
  );
  const iconify = loadIconifyLogos();
  const entries = [];
  const imageSources = new Map();
  const assetNames = [
    ...new Set(
      Object.values(ledger.brands)
        .filter((source) => source.kind === "asset")
        .map((source) => source.asset),
    ),
  ].sort();
  const assetSvgs = new Map();
  let totalAssetBytes = 0;

  for (const assetName of assetNames) {
    const assetPath = resolve(ASSET_DIR, assetName);
    const sourceBytes = statSync(assetPath).size;
    if (sourceBytes > MAX_SOURCE_SVG_BYTES) {
      throw new Error(`${assetName}: source SVG exceeds ${MAX_SOURCE_SVG_BYTES} bytes`);
    }
    totalAssetBytes += sourceBytes;
    assetSvgs.set(assetName, sanitizeSvg(readFileSync(assetPath, "utf8"), assetName));
  }
  if (totalAssetBytes > MAX_EMBEDDED_ASSET_BYTES) {
    throw new Error(`official SVG assets exceed ${MAX_EMBEDDED_ASSET_BYTES} bytes total`);
  }

  for (const id of Object.keys(ledger.brands).sort()) {
    const source = ledger.brands[id];
    const plugin = catalogById.get(id);
    const title = plugin.displayName;

    if (source.kind === "simple-icons") {
      const icon = simpleIconsBySlug.get(source.icon);
      if (!icon) throw new Error(`${id}: Simple Icons slug ${source.icon} was not found`);
      entries.push({ id, kind: "path", title, path: icon.path });
      continue;
    }

    let svg;
    if (source.kind === "iconify-logos") {
      const icon = resolveIconifyLogo(iconify, source.icon, id);
      const width = icon.width ?? iconify.width ?? 24;
      const height = icon.height ?? iconify.height ?? 24;
      svg = sanitizeSvg(
        `<svg viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">${icon.body}</svg>`,
        `${id}:${source.icon}`,
      );
    } else {
      svg = assetSvgs.get(source.asset);
    }

    const src = svgDataUri(svg);
    if (!imageSources.has(src)) imageSources.set(src, `MARKETPLACE_BRAND_IMAGE_${imageSources.size}`);
    entries.push({ id, kind: "image", title, src });
  }

  const lines = [
    "// Generated by scripts/generate-marketplace-brand-marks.mjs. Do not edit.",
    "// Source geometry: Simple Icons and SVG Logos are CC0; reviewed provider assets",
    "// retain their owners' trademarks and usage terms.",
    "// Product names and marks belong to their owners. Inclusion identifies an",
    "// integration and does not imply endorsement.",
    "",
    "export type MarketplaceBrandMarkDefinition =",
    '  | Readonly<{ kind: "path"; title: string; path: string }>',
    '  | Readonly<{ kind: "image"; title: string; src: string }>;',
    "",
  ];

  for (const [src, constantName] of imageSources) {
    lines.push(`const ${constantName} = ${JSON.stringify(src)};`);
  }
  if (imageSources.size) lines.push("");

  lines.push(
    "export const MARKETPLACE_BRAND_MARKS: Readonly<Record<string, MarketplaceBrandMarkDefinition>> = {",
  );
  for (const entry of entries) {
    if (entry.kind === "path") {
      lines.push(
        `  ${JSON.stringify(entry.id)}: { kind: "path", title: ${JSON.stringify(entry.title)}, path: ${JSON.stringify(entry.path)} },`,
      );
    } else {
      lines.push(
        `  ${JSON.stringify(entry.id)}: { kind: "image", title: ${JSON.stringify(entry.title)}, src: ${imageSources.get(entry.src)} },`,
      );
    }
  }
  lines.push("};", "");
  return lines.join("\n");
}

function main() {
  const generated = renderRegistry();
  let current = "";
  try {
    current = readFileSync(OUTPUT_PATH, "utf8");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  if (generated === current) return;
  if (CHECK) {
    console.error("Marketplace brand registry is stale. Run pnpm generate:marketplace-brands");
    process.exitCode = 1;
    return;
  }
  writeFileSync(OUTPUT_PATH, generated);
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) main();
