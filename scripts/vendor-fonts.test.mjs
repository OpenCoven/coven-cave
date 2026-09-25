// Vendored fonts (#5533): builds must not fetch Google Fonts, and the checked-in
// files, manifest and generated fonts.ts must agree. Runs offline.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import test from "node:test";
import {
  FAMILIES,
  FONTS_MODULE_PATH,
  MANIFEST_PATH,
  checkVendoredFonts,
  parseFontFaces,
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

test("renderFontsModule refuses a manifest missing a catalog family", () => {
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
  manifest.families = manifest.families.filter((family) => family.id !== "inter");
  assert.throws(() => renderFontsModule(manifest), /no entry for inter/);
});
