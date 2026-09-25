// Vendored fonts (#5533): builds must not fetch Google Fonts, and the checked-in
// files, manifest and generated fonts.ts must agree. Runs offline.
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  FAMILIES,
  FONTS_MODULE_PATH,
  MANIFEST_PATH,
  checkVendoredFonts,
  parseFontFaces,
  refresh,
  renderFontsModule,
} from "./vendor-fonts.mjs";

test("fonts.ts, manifest.json, the woff2 files and their licenses agree", () => {
  assert.deepEqual(checkVendoredFonts(), []);
});

test("no source declares a next/font/google font", () => {
  // Every next/font/google call fetches from Google at build time; one failed
  // fetch fails the job. Fonts go through the vendored next/font/local files.
  let hits = "";
  try {
    hits = execFileSync("git", ["grep", "-lE", "from ['\"]next/font/google['\"]", "--", "src"], { encoding: "utf8" });
  } catch (error) {
    if (error.status !== 1) throw error; // 1 = no matches
  }
  assert.equal(hits, "", `next/font/google imported in:\n${hits}`);
});

test("every catalog family is vendored with its fallback and latin range", () => {
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
  assert.deepEqual(manifest.families.map((family) => family.id), FAMILIES.map((spec) => spec.id));
  for (const family of manifest.families) {
    assert.ok(family.files.length > 0, `${family.family} has files`);
    assert.match(family.fallbackFont, /^(Arial|Times New Roman)$/);
    assert.match(family.unicodeRange, /^U\+0000-00FF/);
    for (const file of family.files) assert.match(file.file, /\.woff2$/);
  }
  const source = readFileSync(FONTS_MODULE_PATH, "utf8");
  const preloaded = FAMILIES.filter((spec) => spec.preload).map((spec) => spec.id);
  assert.deepEqual(preloaded, ["ebGaramond", "inter", "jetbrainsMono"]);
  for (const spec of FAMILIES) {
    const call = source.match(new RegExp(`const ${spec.id} = localFont\\(\\{[\\s\\S]*?\\n\\}\\);`))?.[0];
    assert.ok(call, `fonts.ts declares ${spec.id}`);
    assert.equal(call.includes("preload: false"), !spec.preload, `${spec.id} preload matches the catalog`);
  }
});

test("parseFontFaces keeps only requested subsets and reads each descriptor", () => {
  const css = `
/* cyrillic */
@font-face {
  font-family: 'Inter';
  font-style: normal;
  font-weight: 100 900;
  font-display: swap;
  src: url(https://fonts.gstatic.com/s/inter/cyr.woff2) format('woff2');
  unicode-range: U+0301, U+0400-045F;
}
/* latin */
@font-face {
  font-family: 'Inter';
  font-style: italic;
  font-weight: 400;
  font-display: swap;
  src: url(https://fonts.gstatic.com/s/inter/latin.woff2) format('woff2');
  unicode-range: U+0000-00FF, U+0131;
}`;
  assert.deepEqual(parseFontFaces(css), [
    {
      style: "italic",
      weight: "400",
      unicodeRange: "U+0000-00FF, U+0131",
      url: "https://fonts.gstatic.com/s/inter/latin.woff2",
    },
  ]);
  assert.throws(
    () => parseFontFaces("/* latin */ @font-face { font-style: normal; src: url(x.woff2); }"),
    /Incomplete @font-face/,
  );
});

/** Next's offline helpers plus stubbed network calls; `failOnFontFetch` makes the Nth font download throw. */
function stubbedHelpers({ failOnFontFetch = Infinity } = {}) {
  const require = createRequire(import.meta.url);
  const google = (file) => require(`next/dist/compiled/@next/font/dist/google/${file}`);
  let fontFetches = 0;
  return {
    ...google("validate-google-font-function-call"),
    ...google("get-font-axes"),
    ...google("get-google-fonts-url"),
    fetchCSSFromGoogleFonts: async (_url, family) =>
      `/* latin */ @font-face { font-family: '${family}'; font-style: normal; font-weight: 400; ` +
      `src: url(https://fonts.gstatic.com/${encodeURIComponent(family)}.woff2) format('woff2'); ` +
      `unicode-range: U+0000-00FF; }`,
    fetchFontFile: async (url) => {
      fontFetches += 1;
      if (fontFetches >= failOnFontFetch) throw new Error("simulated network failure");
      return Buffer.from(`font bytes for ${url}`);
    },
    getFallbackFontOverrideMetrics: () => ({ fallbackFont: "Arial" }),
    fetchLicense: async () => "Copyright ... SIL Open Font License, Version 1.1",
  };
}

function snapshot(directory) {
  const entries = {};
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else entries[path.relative(directory, full)] = readFileSync(full).toString("base64");
    }
  };
  walk(directory);
  return entries;
}

test("a failed --refresh download leaves the checked-in fonts and fonts.ts untouched", async () => {
  const sandbox = mkdtempSync(path.join(tmpdir(), "vendor-fonts-"));
  try {
    const fontDir = path.join(sandbox, "fonts");
    const fontsModulePath = path.join(sandbox, "fonts.ts");
    cpSync(path.dirname(MANIFEST_PATH), fontDir, { recursive: true });
    writeFileSync(fontsModulePath, readFileSync(FONTS_MODULE_PATH));
    const before = snapshot(sandbox);

    await assert.rejects(
      refresh({ fontDir, fontsModulePath, next: stubbedHelpers({ failOnFontFetch: 3 }) }),
      /simulated network failure/,
    );
    assert.deepEqual(snapshot(sandbox), before, "no file was added, removed or changed");
    assert.deepEqual(readdirSync(sandbox).sort(), ["fonts", "fonts.ts"], "no staging leftovers");
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});

test("a successful --refresh replaces the fonts, manifest and fonts.ts together", async () => {
  const sandbox = mkdtempSync(path.join(tmpdir(), "vendor-fonts-"));
  try {
    const fontDir = path.join(sandbox, "fonts");
    const fontsModulePath = path.join(sandbox, "fonts.ts");
    cpSync(path.dirname(MANIFEST_PATH), fontDir, { recursive: true });
    writeFileSync(path.join(fontDir, "stale.woff2"), "left over from an older catalog");
    writeFileSync(fontsModulePath, "stale");

    await refresh({ fontDir, fontsModulePath, next: stubbedHelpers() });
    const manifest = JSON.parse(readFileSync(path.join(fontDir, "manifest.json"), "utf8"));
    assert.equal(manifest.families.length, FAMILIES.length);
    assert.equal(readFileSync(fontsModulePath, "utf8"), renderFontsModule(manifest));
    assert.ok(!readdirSync(fontDir).includes("stale.woff2"), "files outside the new catalog are gone");
    assert.deepEqual(readdirSync(sandbox).sort(), ["fonts", "fonts.ts"], "no staging or previous copies remain");
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});

test("renderFontsModule refuses a manifest missing a catalog family", () => {
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
  manifest.families = manifest.families.filter((family) => family.id !== "inter");
  assert.throws(() => renderFontsModule(manifest), /no entry for inter/);
});
