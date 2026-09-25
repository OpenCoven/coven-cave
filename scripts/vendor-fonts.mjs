#!/usr/bin/env node
// Vendored Google Fonts for next/font/local (#5533).
//
// Builds used to fetch 24 families from Google at compile time through
// next/font/google, and a failed fetch failed the whole job. This script runs
// the same Next.js Google Fonts pipeline once (validation, axes, CSS URL,
// fetch, fallback-font choice), keeps the latin @font-face files, and writes:
//
//   src/assets/fonts/*.woff2          the font files
//   src/assets/fonts/manifest.json    per-file weight, style, unicode-range, sha256
//   src/app/fonts.ts                  next/font/local declarations, generated
//
// Usage:
//   node scripts/vendor-fonts.mjs --refresh   network: re-download and regenerate
//   node scripts/vendor-fonts.mjs --check     offline: fonts.ts and files match the manifest
//
// To add or change a family, edit FAMILIES below and run --refresh.

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const FONT_DIR = path.join(ROOT, "src/assets/fonts");
export const MANIFEST_PATH = path.join(FONT_DIR, "manifest.json");
export const FONTS_MODULE_PATH = path.join(ROOT, "src/app/fonts.ts");
const SUBSETS = ["latin"];
const GOOGLE_FONTS_REPO = "https://raw.githubusercontent.com/google/fonts/main";

/**
 * The catalog, in fonts.ts order. `fn` is the next/font/google function name,
 * `weight`/`style` are the arguments that function took. `preload` is true
 * only for the canonical trio (DESIGN.md §4).
 */
export const FAMILIES = [
  { group: "canonical", id: "ebGaramond", fn: "EB_Garamond", variable: "--font-eb-garamond", style: ["normal", "italic"], preload: true, exported: true },
  { group: "canonical", id: "inter", fn: "Inter", variable: "--font-inter", preload: true, exported: true },
  { group: "canonical", id: "jetbrainsMono", fn: "JetBrains_Mono", variable: "--font-jetbrains-mono", preload: true, exported: true },
  { group: "legacy", id: "geistSans", fn: "Geist", variable: "--font-geist-sans", exported: true },
  { group: "legacy", id: "geistMono", fn: "Geist_Mono", variable: "--font-geist-mono", exported: true },
  { group: "legacy", id: "fredoka", fn: "Fredoka", variable: "--font-fredoka", weight: ["300", "400", "500", "600", "700"], exported: true },
  { group: "serif", id: "instrumentSerif", fn: "Instrument_Serif", variable: "--font-instrument-serif", weight: ["400"], style: ["normal", "italic"], exported: true },
  { group: "serif", id: "fraunces", fn: "Fraunces", variable: "--font-fraunces", exported: true },
  { group: "sans", id: "roboto", fn: "Roboto", variable: "--font-roboto" },
  { group: "sans", id: "openSans", fn: "Open_Sans", variable: "--font-open-sans" },
  { group: "sans", id: "lato", fn: "Lato", variable: "--font-lato", weight: ["400", "700"] },
  { group: "sans", id: "sourceSans3", fn: "Source_Sans_3", variable: "--font-source-sans-3" },
  { group: "sans", id: "notoSans", fn: "Noto_Sans", variable: "--font-noto-sans" },
  { group: "sans", id: "ibmPlexSans", fn: "IBM_Plex_Sans", variable: "--font-ibm-plex-sans", weight: ["400", "500", "600", "700"] },
  { group: "sans", id: "workSans", fn: "Work_Sans", variable: "--font-work-sans" },
  { group: "sans", id: "dmSans", fn: "DM_Sans", variable: "--font-dm-sans" },
  { group: "sans", id: "manrope", fn: "Manrope", variable: "--font-manrope" },
  { group: "sans", id: "figtree", fn: "Figtree", variable: "--font-figtree" },
  { group: "sans", id: "publicSans", fn: "Public_Sans", variable: "--font-public-sans" },
  { group: "mono", id: "firaCode", fn: "Fira_Code", variable: "--font-fira-code" },
  { group: "mono", id: "sourceCodePro", fn: "Source_Code_Pro", variable: "--font-source-code-pro" },
  { group: "mono", id: "ibmPlexMono", fn: "IBM_Plex_Mono", variable: "--font-ibm-plex-mono", weight: ["400", "500", "600", "700"] },
  { group: "mono", id: "robotoMono", fn: "Roboto_Mono", variable: "--font-roboto-mono" },
  { group: "mono", id: "spaceMono", fn: "Space_Mono", variable: "--font-space-mono", weight: ["400", "700"] },
  { group: "mono", id: "inconsolata", fn: "Inconsolata", variable: "--font-inconsolata" },
];

const GROUP_HEADERS = {
  canonical:
    "// ── Canonical Coven trio: preload (a fresh profile renders EB Garamond +\n" +
    "//    Inter + JetBrains Mono immediately, matching DESIGN.md §4). ──",
  legacy:
    "// ── Legacy defaults kept in the catalog as alternatives ──\n" +
    "// Geist / Geist Mono were the previous shipped defaults, and Fredoka the\n" +
    "// pre-v1.2 home headline. They stay declared so existing choices and custom\n" +
    "// themes that reference their cssVars keep working, but they don't preload.",
  serif: "// ── Additional Coven serifs (preload: false, selectable via catalog) ──",
  sans: "// ── Sans catalog (preload: false) ──",
  mono: "// ── Mono catalog (preload: false) ──",
};

const sha256 = (buffer) => createHash("sha256").update(buffer).digest("hex");
const slug = (family) => family.toLowerCase().replace(/[^a-z0-9]+/g, "-");

/** Parse the @font-face blocks Google returns, keeping the requested subsets. */
export function parseFontFaces(css, subsets = SUBSETS) {
  const faces = [];
  const block = /\/\*\s*([\w-]+)\s*\*\/\s*@font-face\s*\{([^}]*)\}/g;
  for (const [, subset, body] of css.matchAll(block)) {
    if (!subsets.includes(subset)) continue;
    const prop = (name) => body.match(new RegExp(`${name}\\s*:\\s*([^;]+);`))?.[1].trim();
    const url = prop("src")?.match(/url\(([^)]+)\)/)?.[1];
    const face = {
      style: prop("font-style"),
      weight: prop("font-weight"),
      unicodeRange: prop("unicode-range"),
      url,
    };
    if (!face.style || !face.weight || !face.unicodeRange || !url) {
      throw new Error(`Incomplete @font-face for subset ${subset}: ${body.trim()}`);
    }
    faces.push(face);
  }
  return faces;
}

async function refresh() {
  const require = createRequire(path.join(ROOT, "package.json"));
  const google = (file) => require(`next/dist/compiled/@next/font/dist/google/${file}`);
  const { validateGoogleFontFunctionCall } = google("validate-google-font-function-call");
  const { getFontAxes } = google("get-font-axes");
  const { getGoogleFontsUrl } = google("get-google-fonts-url");
  const { fetchCSSFromGoogleFonts } = google("fetch-css-from-google-fonts");
  const { fetchFontFile } = google("fetch-font-file");
  const { getFallbackFontOverrideMetrics } = google("get-fallback-font-override-metrics");

  rmSync(FONT_DIR, { recursive: true, force: true });
  mkdirSync(path.join(FONT_DIR, "licenses"), { recursive: true });
  const families = [];
  for (const spec of FAMILIES) {
    const options = validateGoogleFontFunctionCall(spec.fn, {
      subsets: SUBSETS,
      variable: spec.variable,
      ...(spec.weight ? { weight: spec.weight } : {}),
      ...(spec.style ? { style: spec.style } : {}),
    });
    const axes = getFontAxes(options.fontFamily, options.weights, options.styles, options.selectedVariableAxes);
    const url = getGoogleFontsUrl(options.fontFamily, axes, options.display);
    const faces = parseFontFaces(await fetchCSSFromGoogleFonts(url, options.fontFamily, false));
    if (faces.length === 0) throw new Error(`No latin faces for ${options.fontFamily}`);
    const ranges = new Set(faces.map((face) => face.unicodeRange));
    if (ranges.size !== 1) throw new Error(`${options.fontFamily}: latin faces disagree on unicode-range`);

    const files = [];
    for (const face of faces) {
      const file = `${slug(options.fontFamily)}-${face.style}-${face.weight.replace(/\s+/g, "-")}.woff2`;
      const buffer = await fetchFontFile(face.url, false);
      writeFileSync(path.join(FONT_DIR, file), buffer);
      files.push({ file, weight: face.weight, style: face.style, sha256: sha256(buffer) });
      console.log(`  ${file} (${buffer.length} bytes)`);
    }
    // Every catalog family is OFL-1.1, which must travel with the font files.
    const licenseUrl = `${GOOGLE_FONTS_REPO}/ofl/${options.fontFamily.toLowerCase().replace(/[^a-z0-9]/g, "")}/OFL.txt`;
    const licenseResponse = await fetch(licenseUrl);
    if (!licenseResponse.ok) throw new Error(`No OFL license for ${options.fontFamily} at ${licenseUrl}`);
    const licenseFile = `${slug(options.fontFamily)}-OFL.txt`;
    writeFileSync(path.join(FONT_DIR, "licenses", licenseFile), await licenseResponse.text());

    families.push({
      id: spec.id,
      family: options.fontFamily,
      license: "OFL-1.1",
      licenseFile: `licenses/${licenseFile}`,
      googleCssUrl: url,
      fallbackFont: getFallbackFontOverrideMetrics(options.fontFamily)?.fallbackFont ?? "Arial",
      unicodeRange: [...ranges][0],
      files,
    });
  }
  const manifest = { source: "Google Fonts via next/font/google helpers", subsets: SUBSETS, families };
  writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(FONTS_MODULE_PATH, renderFontsModule(manifest));
  console.log(`Vendored ${families.length} families into ${path.relative(ROOT, FONT_DIR)}`);
}

/** Generate src/app/fonts.ts from the manifest. Pure, so --check can compare. */
export function renderFontsModule(manifest) {
  const byId = new Map(manifest.families.map((family) => [family.id, family]));
  const sections = [];
  let group = null;
  for (const spec of FAMILIES) {
    const family = byId.get(spec.id);
    if (!family) throw new Error(`manifest.json has no entry for ${spec.id}; run --refresh`);
    const lines = [];
    if (spec.group !== group) {
      group = spec.group;
      lines.push(GROUP_HEADERS[group]);
    }
    lines.push(`${spec.exported ? "export " : ""}const ${spec.id} = localFont({`);
    lines.push(`  variable: "${spec.variable}",`);
    lines.push("  src: [");
    for (const file of family.files) {
      lines.push(`    { path: "../assets/fonts/${file.file}", weight: "${file.weight}", style: "${file.style}" },`);
    }
    lines.push("  ],");
    if (!spec.preload) lines.push("  preload: false,");
    lines.push(`  adjustFontFallback: "${family.fallbackFont}",`);
    lines.push(`  declarations: [{ prop: "unicode-range", value: "${family.unicodeRange}" }],`);
    lines.push("});");
    sections.push(lines.join("\n"));
  }
  return `${HEADER}
import localFont from "next/font/local";

// GENERATED by scripts/vendor-fonts.mjs from src/assets/fonts/manifest.json.
// Edit FAMILIES in that script and run \`node scripts/vendor-fonts.mjs --refresh\`.
// next/font/local statically parses these calls at build time, so every
// argument must be an inline literal — no shared consts, spreads, or vars.

${sections.join("\n\n")}

/** Every declared font instance — order is irrelevant; the layout just
 *  needs all \`.variable\` classes on the same element. */
const ALL_FONTS = [
${FAMILIES.map((spec) => `  ${spec.id},`).join("\n")}
];

/** Space-joined \`.variable\` classes for the root <html> element. */
export const fontVariables = ALL_FONTS.map((f) => f.variable).join(" ");
`;
}

const HEADER = `/**
 * Bundled font declarations — the runtime half of the typography feature.
 *
 * OpenCoven canonical type system (DESIGN.md §4):
 *   - Display (serif): EB Garamond
 *   - UI (sans):       Inter
 *   - Mono (code):     JetBrains Mono
 *
 * These three faces preload so a fresh profile renders the classic Coven
 * type system immediately. Everything else in the selectable catalog is
 * \`preload: false\`: its @font-face files download lazily and only for the
 * family whose cssVar is applied to rendered text.
 *
 * Every \`--font-*\` cssVar referenced by FONT_OPTIONS in
 * \`src/lib/font-catalog.ts\` is declared here, and all of their \`.variable\`
 * classes are concatenated into \`fontVariables\`, which the root layout
 * spreads onto <html>.
 *
 * The files are vendored latin subsets of the Google Fonts families (#5533),
 * so builds never reach the network for fonts. Each family keeps the fallback
 * font next/font/google chose for it and Google's latin unicode-range.
 */`;

/** Offline verification: fonts.ts is the rendering of the manifest, and every file matches its hash. */
export function checkVendoredFonts() {
  const problems = [];
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
  if (readFileSync(FONTS_MODULE_PATH, "utf8") !== renderFontsModule(manifest)) {
    problems.push("src/app/fonts.ts differs from the manifest rendering; run node scripts/vendor-fonts.mjs --refresh");
  }
  const listed = new Set();
  for (const family of manifest.families) {
    try {
      if (!readFileSync(path.join(FONT_DIR, family.licenseFile), "utf8").includes("SIL Open Font License")) {
        problems.push(`${family.licenseFile} is not an OFL license text`);
      }
    } catch {
      problems.push(`missing license for ${family.family}`);
    }
    for (const file of family.files) {
      listed.add(file.file);
      let buffer;
      try {
        buffer = readFileSync(path.join(FONT_DIR, file.file));
      } catch {
        problems.push(`missing font file ${file.file}`);
        continue;
      }
      if (sha256(buffer) !== file.sha256) problems.push(`sha256 mismatch for ${file.file}`);
    }
  }
  for (const entry of readdirSync(FONT_DIR)) {
    if (entry.endsWith(".woff2") && !listed.has(entry)) problems.push(`unlisted font file ${entry}`);
  }
  return problems;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const mode = process.argv[2];
  if (mode === "--refresh") {
    await refresh();
  } else if (mode === "--check") {
    const problems = checkVendoredFonts();
    for (const problem of problems) console.error(`✗ ${problem}`);
    if (problems.length) process.exit(1);
    console.log("✓ vendored fonts match manifest.json");
  } else {
    console.error("usage: node scripts/vendor-fonts.mjs --refresh | --check");
    process.exit(2);
  }
}
