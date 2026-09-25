#!/usr/bin/env node
// Vendors Cave's Google Fonts and generates src/app/fonts.ts, so no build
// (CI, release or offline dev) fetches fonts from Google (#5533).
//
// FAMILIES below is the source of truth; it replaces the hand-written
// next/font/google calls. For each family this script:
//   1. builds the exact stylesheet URL next/font/google would request (Next's
//      own helpers), fetches Google's CSS with Next's user agent, and saves it
//      plus every woff2 it references under vendor/google-fonts;
//   2. generates one next/font/local instance per family and subset. They all
//      share the family name and each carries Google's unicode-range, so
//      browsers still load only the subsets a page's text needs. The latin
//      instance owns the CSS variable, the preload flag and the fallback
//      metrics, as next/font/google did.
//
//   pnpm fonts:vendor          # fetch from Google, then regenerate fonts.ts
//   pnpm fonts:generate        # offline: regenerate fonts.ts from vendor/
//   pnpm fonts:vendor:check    # offline: vendor/ and fonts.ts match FAMILIES

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const FONTS_TS = path.join(ROOT, "src/app/fonts.ts");
export const VENDOR_DIR = path.join(ROOT, "vendor/google-fonts");
export const RESPONSES_JSON = path.join(VENDOR_DIR, "responses.json");
const FILES_DIR = path.join(VENDOR_DIR, "files");
const FILES_FROM_FONTS_TS = "../../vendor/google-fonts/files";

const GOOGLE = "next/dist/compiled/@next/font/dist/google";
const { validateGoogleFontFunctionCall } = require(`${GOOGLE}/validate-google-font-function-call.js`);
const { getFontAxes } = require(`${GOOGLE}/get-font-axes.js`);
const { getGoogleFontsUrl } = require(`${GOOGLE}/get-google-fonts-url.js`);
const { calculateSizeAdjustValues } = require("next/dist/server/font-utils.js");

// Same user agent as next's fetch-resource.js: it decides that Google serves woff2.
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/104.0.0.0 Safari/537.36";

/**
 * Cave's type catalog. OpenCoven canonical type system (DESIGN.md §4):
 * Display (serif) EB Garamond, UI (sans) Inter, Mono JetBrains Mono.
 *
 * Every `--font-*` cssVar in src/lib/font-catalog.ts must appear here, so the
 * catalog's fontStack() output renders the chosen family. Only the canonical
 * trio preloads; the rest load lazily, and only for text that uses them.
 * `options` are next/font/google options (they pick the weights and styles
 * Google serves). Static families need an explicit `weight`.
 */
export const FAMILIES = [
  // Canonical Coven trio: preload, so a fresh profile renders it immediately.
  { name: "ebGaramond", fn: "EB_Garamond", options: { variable: "--font-eb-garamond", subsets: ["latin"], style: ["normal", "italic"] } },
  { name: "inter", fn: "Inter", options: { variable: "--font-inter", subsets: ["latin"] } },
  { name: "jetbrainsMono", fn: "JetBrains_Mono", options: { variable: "--font-jetbrains-mono", subsets: ["latin"] } },
  // Additional Coven serifs.
  { name: "instrumentSerif", fn: "Instrument_Serif", options: { variable: "--font-instrument-serif", subsets: ["latin"], weight: ["400"], style: ["normal", "italic"], preload: false } },
  { name: "fraunces", fn: "Fraunces", options: { variable: "--font-fraunces", subsets: ["latin"], preload: false } },
  // Geist / Geist Mono were the previous shipped defaults; they stay
  // selectable so users who chose them keep working.
  { name: "geistSans", fn: "Geist", options: { variable: "--font-geist-sans", subsets: ["latin"], preload: false } },
  { name: "geistMono", fn: "Geist_Mono", options: { variable: "--font-geist-mono", subsets: ["latin"], preload: false } },
  // Fredoka was the home-composer headline before type system v1.2. It stays
  // declared for custom themes that still reference --font-fredoka.
  { name: "fredoka", fn: "Fredoka", options: { variable: "--font-fredoka", subsets: ["latin"], weight: ["300", "400", "500", "600", "700"], preload: false } },
  // Sans catalog.
  { name: "roboto", fn: "Roboto", options: { variable: "--font-roboto", subsets: ["latin"], preload: false } },
  { name: "openSans", fn: "Open_Sans", options: { variable: "--font-open-sans", subsets: ["latin"], preload: false } },
  { name: "lato", fn: "Lato", options: { variable: "--font-lato", subsets: ["latin"], weight: ["400", "700"], preload: false } },
  { name: "sourceSans3", fn: "Source_Sans_3", options: { variable: "--font-source-sans-3", subsets: ["latin"], preload: false } },
  { name: "notoSans", fn: "Noto_Sans", options: { variable: "--font-noto-sans", subsets: ["latin"], preload: false } },
  { name: "ibmPlexSans", fn: "IBM_Plex_Sans", options: { variable: "--font-ibm-plex-sans", subsets: ["latin"], weight: ["400", "500", "600", "700"], preload: false } },
  { name: "workSans", fn: "Work_Sans", options: { variable: "--font-work-sans", subsets: ["latin"], preload: false } },
  { name: "dmSans", fn: "DM_Sans", options: { variable: "--font-dm-sans", subsets: ["latin"], preload: false } },
  { name: "manrope", fn: "Manrope", options: { variable: "--font-manrope", subsets: ["latin"], preload: false } },
  { name: "figtree", fn: "Figtree", options: { variable: "--font-figtree", subsets: ["latin"], preload: false } },
  { name: "publicSans", fn: "Public_Sans", options: { variable: "--font-public-sans", subsets: ["latin"], preload: false } },
  // Mono catalog.
  { name: "firaCode", fn: "Fira_Code", options: { variable: "--font-fira-code", subsets: ["latin"], preload: false } },
  { name: "sourceCodePro", fn: "Source_Code_Pro", options: { variable: "--font-source-code-pro", subsets: ["latin"], preload: false } },
  { name: "ibmPlexMono", fn: "IBM_Plex_Mono", options: { variable: "--font-ibm-plex-mono", subsets: ["latin"], weight: ["400", "500", "600", "700"], preload: false } },
  { name: "robotoMono", fn: "Roboto_Mono", options: { variable: "--font-roboto-mono", subsets: ["latin"], preload: false } },
  { name: "spaceMono", fn: "Space_Mono", options: { variable: "--font-space-mono", subsets: ["latin"], weight: ["400", "700"], preload: false } },
  { name: "inconsolata", fn: "Inconsolata", options: { variable: "--font-inconsolata", subsets: ["latin"], preload: false } },
];

/** The exact stylesheet URL next/font/google requests for one family. */
export function stylesheetUrl({ fn, options }) {
  const { fontFamily, weights, styles, display, selectedVariableAxes } = validateGoogleFontFunctionCall(fn, options);
  return getGoogleFontsUrl(fontFamily, getFontAxes(fontFamily, weights, styles, selectedVariableAxes), display);
}

async function fetchWithRetry(url, as) {
  let lastError;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      const response = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      return as === "text" ? await response.text() : Buffer.from(await response.arrayBuffer());
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
    }
  }
  throw new Error(`Failed to fetch ${url}: ${lastError?.message ?? lastError}`);
}

/** Local file name for a gstatic URL: stable, flat, and unique per URL. */
function localName(fontUrl) {
  const base = path.basename(new URL(fontUrl).pathname);
  const digest = createHash("sha256").update(fontUrl).digest("hex").slice(0, 10);
  return `${digest}-${base}`;
}

/** Google's stylesheet as subsets of faces: [{ subset, unicodeRange, faces: [{ file, weight, style }] }]. */
export function parseStylesheet(css) {
  // Google lists every subset of one style before the next style, so group
  // by subset across the whole stylesheet, keeping first-seen order.
  const bySubset = new Map();
  for (const block of css.split(/(?=\/\* [^*]+ \*\/)/)) {
    const subset = /\/\* ([^*]+) \*\//.exec(block)?.[1];
    const face = /@font-face\s*\{([^}]*)\}/.exec(block)?.[1];
    if (!subset || !face) continue;
    const prop = (name) => new RegExp(`${name}:\\s*([^;]+);`).exec(face)?.[1].trim();
    const file = /src: url\(([^)]+)\)/.exec(face)?.[1];
    const unicodeRange = prop("unicode-range");
    if (!file || !unicodeRange) throw new Error(`Unrecognised @font-face in subset ${subset}`);
    let entry = bySubset.get(subset);
    if (!entry) {
      entry = { subset, unicodeRange, faces: [] };
      bySubset.set(subset, entry);
    } else if (entry.unicodeRange !== unicodeRange) {
      throw new Error(`Subset ${subset} has two unicode-ranges`);
    }
    entry.faces.push({ file, weight: prop("font-weight"), style: prop("font-style") });
  }
  return [...bySubset.values()];
}

async function vendor() {
  const responses = {};
  const files = new Map();
  for (const family of FAMILIES) {
    const url = stylesheetUrl(family);
    const css = await fetchWithRetry(url, "text");
    responses[url] = css.replace(/src: url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/g, (_, fontUrl) => {
      const name = localName(fontUrl);
      files.set(name, fontUrl);
      return `src: url(${name})`;
    });
  }
  rmSync(FILES_DIR, { recursive: true, force: true });
  mkdirSync(FILES_DIR, { recursive: true });
  let bytes = 0;
  for (const [name, fontUrl] of files) {
    const buffer = await fetchWithRetry(fontUrl, "buffer");
    bytes += buffer.length;
    writeFileSync(path.join(FILES_DIR, name), buffer);
  }
  const sorted = Object.fromEntries(Object.entries(responses).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(RESPONSES_JSON, `${JSON.stringify(sorted, null, 2)}\n`);
  console.log(`vendored ${FAMILIES.length} stylesheets, ${files.size} font files, ${(bytes / 1024 / 1024).toFixed(2)} MB`);
}

const camel = (subset) =>
  subset.replace(/(^|-)([a-z0-9])/g, (_, __, ch) => ch.toUpperCase());
const quote = (value) => JSON.stringify(value);

/** The generated src/app/fonts.ts for the vendored responses. */
export function renderFontsTs(responses = JSON.parse(readFileSync(RESPONSES_JSON, "utf8"))) {
  const out = [];
  out.push(
    "// GENERATED by scripts/vendor-google-fonts.mjs from vendor/google-fonts. Do not edit.",
    "// Change a family in that script's FAMILIES, then run `pnpm fonts:vendor` (#5533).",
    "//",
    "// Each Google family is one next/font/local instance per subset. All of a",
    "// family's instances share its font-family name and keep Google's",
    "// unicode-range, so a page downloads only the subsets its text uses. The",
    "// latin instance owns the CSS variable, the preload flag and the fallback",
    "// metrics; the other subsets exist only for their @font-face rules.",
    'import localFont from "next/font/local";',
    "",
  );
  const variables = [];
  const subsetFaces = [];
  for (const family of FAMILIES) {
    const { fontFamily, preload, variable } = validateGoogleFontFunctionCall(family.fn, family.options);
    const css = responses[stylesheetUrl(family)];
    if (!css) throw new Error(`No vendored stylesheet for ${fontFamily}; run pnpm fonts:vendor`);
    const subsets = parseStylesheet(css);
    const latin = subsets.find((entry) => entry.subset === "latin");
    if (!latin) throw new Error(`${fontFamily} has no latin subset`);
    // Google computes fallback metrics against Times New Roman for serifs and
    // Arial otherwise; next/font/local offers the same two.
    const fallback = calculateSizeAdjustValues(fontFamily).fallbackFont;
    out.push(`// ── ${fontFamily} ──`);
    for (const entry of [latin, ...subsets.filter((other) => other !== latin)]) {
      const isLatin = entry === latin;
      const id = isLatin ? family.name : `${family.name}${camel(entry.subset)}`;
      out.push(`const ${id} = localFont({`, "  src: [");
      for (const face of entry.faces) {
        out.push(`    { path: ${quote(`${FILES_FROM_FONTS_TS}/${face.file}`)}, weight: ${quote(face.weight)}, style: ${quote(face.style)} },`);
      }
      out.push("  ],");
      if (isLatin) out.push(`  variable: ${quote(variable)},`);
      out.push(
        '  display: "swap",',
        `  preload: ${isLatin && preload ? "true" : "false"},`,
        `  adjustFontFallback: ${isLatin ? quote(fallback) : "false"},`,
        "  declarations: [",
        `    { prop: "font-family", value: ${quote(`'${fontFamily}'`)} },`,
        `    { prop: "unicode-range", value: ${quote(entry.unicodeRange)} },`,
        "  ],",
        "});",
      );
      (isLatin ? variables : subsetFaces).push(id);
    }
    out.push("");
  }
  out.push(
    "/** Space-joined `.variable` classes for the root <html> element. */",
    `export const fontVariables = [${variables.join(", ")}].map((font) => font.variable).join(" ");`,
    "",
    "/** Non-latin subsets. Referenced so their @font-face rules always ship. */",
    `export const vendoredSubsetFaces = [${subsetFaces.join(", ")}];`,
    "",
  );
  return out.join("\n");
}

function generate() {
  writeFileSync(FONTS_TS, renderFontsTs());
  console.log(`generated ${path.relative(ROOT, FONTS_TS)}`);
}

/** Offline: vendor/ covers FAMILIES exactly and fonts.ts is current. */
export function check() {
  const responses = JSON.parse(readFileSync(RESPONSES_JSON, "utf8"));
  const present = new Set(readdirSync(FILES_DIR));
  const problems = [];
  const wanted = new Set(FAMILIES.map((family) => stylesheetUrl(family)));
  for (const url of wanted) if (!responses[url]) problems.push(`no vendored stylesheet for ${url}`);
  for (const url of Object.keys(responses)) if (!wanted.has(url)) problems.push(`stale stylesheet: ${url}`);
  const referenced = new Set(
    Object.values(responses).flatMap((css) => [...css.matchAll(/src: url\(([^)]+)\)/g)].map((match) => match[1])),
  );
  for (const name of referenced) if (!present.has(name)) problems.push(`missing file ${name}`);
  for (const name of present) if (!referenced.has(name)) problems.push(`unreferenced file ${name}`);
  if (problems.length === 0 && readFileSync(FONTS_TS, "utf8") !== renderFontsTs(responses)) {
    problems.push("src/app/fonts.ts is not the generated output; run pnpm fonts:generate");
  }
  return problems;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes("--check")) {
    const problems = check();
    if (problems.length) {
      console.error(`vendored fonts are out of date:\n  ${problems.join("\n  ")}`);
      console.error("Run: pnpm fonts:vendor");
      process.exit(1);
    }
    console.log("vendored fonts match FAMILIES and src/app/fonts.ts");
  } else if (process.argv.includes("--generate")) {
    generate();
  } else {
    await vendor();
    generate();
  }
}
