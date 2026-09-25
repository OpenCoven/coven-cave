// Builds must not fetch Google Fonts (#5533). src/app/fonts.ts is generated
// from vendor/google-fonts by scripts/vendor-google-fonts.mjs: next/font/local
// instances that keep Google's per-subset unicode-range and fallback metrics.
// This pins that the vendored set, the generated file and FAMILIES agree, and
// that nothing reaches back to next/font/google or the network.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const { FAMILIES, check, parseStylesheet, stylesheetUrl } = await import("../../scripts/vendor-google-fonts.mjs");

const problems = check();
assert.deepEqual(problems, [], `vendored fonts are current:\n${problems.join("\n")}`);

const fontsTs = readFileSync(new URL("../app/fonts.ts", import.meta.url), "utf8");
assert.doesNotMatch(fontsTs, /next\/font\/google/, "fonts.ts never uses the networked Google loader");
assert.doesNotMatch(fontsTs, /https?:\/\//, "fonts.ts never references a remote URL");
assert.match(fontsTs, /^import localFont from "next\/font\/local";$/m);

// Every referenced file is vendored.
for (const [, filePath] of fontsTs.matchAll(/path: "([^"]+)"/g)) {
  assert.ok(existsSync(new URL(filePath, new URL("../app/fonts.ts", import.meta.url))), `${filePath} exists`);
}

// Parity with next/font/google: each family keeps every subset Google serves,
// one latin instance owns the variable, and only the canonical trio preloads.
const responses = JSON.parse(readFileSync(new URL("../../vendor/google-fonts/responses.json", import.meta.url), "utf8"));
const instances = [...fontsTs.matchAll(/^const (\w+) = localFont\(\{\n([\s\S]*?)\n\}\);$/gm)];
assert.equal(instances.length, [...fontsTs.matchAll(/= localFont\(/g)].length, "every instance block parses");
const preloaded = instances.filter(([, , body]) => /\n {2}preload: true,/.test(body)).map(([, name]) => name);
assert.deepEqual(preloaded, ["ebGaramond", "inter", "jetbrainsMono"], "only the canonical trio preloads");
for (const family of FAMILIES) {
  const subsets = parseStylesheet(responses[stylesheetUrl(family)]);
  assert.ok(subsets.some((entry) => entry.subset === "latin"), `${family.fn} has a latin subset`);
  for (const entry of subsets) {
    assert.ok(fontsTs.includes(`value: ${JSON.stringify(entry.unicodeRange)}`), `${family.fn} keeps its ${entry.subset} unicode-range`);
  }
  assert.equal(
    fontsTs.split(`variable: ${JSON.stringify(family.options.variable)},`).length - 1,
    1,
    `${family.options.variable} is declared exactly once`,
  );
}

console.log("font-vendoring.test.ts: ok");
