import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const catalog = JSON.parse(readFileSync(new URL("../marketplace/marketplace.json", import.meta.url), "utf8"));
const ledger = JSON.parse(readFileSync(new URL("../marketplace/brand-marks.json", import.meta.url), "utf8"));

assert.equal(ledger.schemaVersion, 1);
assert.equal(
  ledger.notice,
  "Product names and marks belong to their owners. Inclusion identifies an integration and does not imply endorsement.",
  "the trademark notice remains exact",
);

const catalogIds = catalog.plugins.map((plugin) => plugin.name);
const brandIds = Object.keys(ledger.brands);
const genericIds = [...ledger.generic];
const unresolvedIds = Object.keys(ledger.unresolved);
const classifiedIds = [...brandIds, ...genericIds, ...unresolvedIds];

assert.deepEqual(brandIds, [...brandIds].sort(), "brands stay alphabetized in source");
assert.deepEqual(genericIds, [...genericIds].sort(), "generic fallbacks stay alphabetized in source");
assert.deepEqual(unresolvedIds, [...unresolvedIds].sort(), "unresolved IDs stay alphabetized in source");
assert.deepEqual(
  [...classifiedIds].sort(),
  [...catalogIds].sort(),
  "every catalog ID is classified exactly once",
);
assert.equal(new Set(classifiedIds).size, classifiedIds.length, "classifications never overlap");
assert.equal(brandIds.length, 62, "brand coverage only changes through an explicit ledger review");
assert.equal(genericIds.length, 55, "generic fallback count is ratcheted");
assert.equal(unresolvedIds.length, 11, "unresolved brand candidates stay explicit");

assert.deepEqual(ledger.brands.github, { kind: "simple-icons", icon: "github" });
assert.deepEqual(ledger.brands.gmail, { kind: "iconify-logos", icon: "google-gmail" });
assert.deepEqual(ledger.unresolved, {
  azure: "Microsoft's trademark guidelines require an express license for logos and product icons; no license is documented.",
  "azure-devops": "Microsoft's trademark guidelines require an express license for logos and product icons; no license is documented.",
  brightdata: "Official trademark policy requires written consent for logo use; no consent is documented.",
  canva: "Canva's trademark policy requires approval for logo use on products and websites; no approval is documented.",
  dbhub: "No stable, authoritative SVG mark is published.",
  "desktop-commander": "No stable, authoritative SVG mark is published.",
  fabric: "Microsoft's trademark guidelines require an express license for logos and product icons; no license is documented.",
  "microsoft-learn": "Microsoft's trademark guidelines require an express license for logos and product icons; no license is documented.",
  nodriver: "No stable, authoritative SVG mark is published.",
  "pptx-generator": "Microsoft's trademark guidelines require an express license for logos and product icons; no license is documented.",
  serena: "No stable, authoritative SVG mark is published.",
});

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

const generator = new URL("./generate-marketplace-brand-marks.mjs", import.meta.url);
assert.equal(existsSync(generator), true, "brand registry generator exists");

const { resolveIconifyLogo, sanitizeSvg } = await import(generator.href);
assert.equal(typeof resolveIconifyLogo, "function", "Iconify lookup is independently testable");
assert.throws(
  () => resolveIconifyLogo({ icons: {} }, "constructor", "prototype-key"),
  /SVG Logos icon constructor was not found/,
  "inherited Object prototype keys are never treated as Iconify entries",
);
for (const invalidIcon of [null, {}, { body: "" }, { body: "   " }, { body: 42 }]) {
  assert.throws(
    () => resolveIconifyLogo({ icons: { broken: invalidIcon } }, "broken", "invalid-icon"),
    /SVG Logos icon broken has no non-empty body/,
  );
}
const validIconifyLogo = { body: '<path d="M0 0h1v1H0z"/>', width: 1, height: 1 };
assert.equal(
  resolveIconifyLogo({ icons: { valid: validIconifyLogo } }, "valid", "valid-icon"),
  validIconifyLogo,
);
const validLocalGradient = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><defs><linearGradient id="brand-gradient"><stop offset="0" stop-color="#fff"/></linearGradient></defs><path fill="url(#brand-gradient)" d="M0 0h16v16H0z"/></svg>`;
assert.equal(sanitizeSvg(validLocalGradient, "local-gradient"), validLocalGradient);

const unsafeSvgCases = {
  "whitespace-prefixed remote href": `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><use href="  https://example.com/mark.svg#icon"/></svg>`,
  "entity-encoded remote href": `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><use href="https&#58;//example.com/mark.svg#icon"/></svg>`,
  "protocol-relative href": `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><use href="//example.com/mark.svg#icon"/></svg>`,
  "data href": `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><use href="data:image/svg+xml;base64,PHN2Zy8+"/></svg>`,
  "javascript href": `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><use href="javascript:alert(1)"/></svg>`,
  "non-http scheme": `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><use href="file:///tmp/mark.svg#icon"/></svg>`,
  "external fragment": `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><use href="mark.svg#icon"/></svg>`,
  "malformed XML": `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><path></svg>`,
  "unclosed XML": `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><path>`,
  "wrong root": `<html xmlns="http://www.w3.org/1999/xhtml" viewBox="0 0 1 1"></html>`,
  "wrong namespace": `<svg xmlns="https://example.com/not-svg" viewBox="0 0 1 1"></svg>`,
  "wrong-case viewBox": `<svg xmlns="http://www.w3.org/2000/svg" viewbox="0 0 1 1"></svg>`,
  "hex viewBox number": `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 0x10 1"></svg>`,
  "invalid viewBox separators": `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0,,0,1,1"></svg>`,
  "non-positive viewBox": `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 0 1"></svg>`,
  "non-finite viewBox": `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 Infinity 1"></svg>`,
  "script element": `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><script>alert(1)</script></svg>`,
  "foreignObject element": `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><foreignObject/></svg>`,
  "event attribute": `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1" onload="alert(1)"></svg>`,
};
for (const [label, source] of Object.entries(unsafeSvgCases)) {
  assert.throws(() => sanitizeSvg(source, label), undefined, `${label} is rejected`);
}

const check = spawnSync(process.execPath, [fileURLToPath(generator), "--check"], {
  cwd: fileURLToPath(new URL("..", import.meta.url)),
  encoding: "utf8",
});
assert.equal(check.status, 0, check.stderr || check.stdout);

const generated = readFileSync(new URL("../src/lib/marketplace-brand-marks.gen.ts", import.meta.url), "utf8");
assert.doesNotMatch(generated, /https?:\/\//, "runtime registry contains no remote URL");
assert.doesNotMatch(generated, /from ["'](?:simple-icons|@iconify)/, "runtime registry imports no generation package");
assert.doesNotMatch(generated, /<svg\b/i, "runtime registry contains no raw SVG markup");
assert.doesNotMatch(generated, /dangerouslySetInnerHTML/, "runtime registry needs no dangerous HTML rendering");
assert.match(generated, /Product names and marks belong to their owners/);

const generatedSvgData = [...generated.matchAll(/"data:image\/svg\+xml;base64,([A-Za-z0-9+/=]+)"/g)].map(
  ([, encoded]) => Buffer.from(encoded, "base64").toString("utf8"),
);
assert.ok(generatedSvgData.length > 0, "generated registry embeds reviewed SVG data");
for (const [index, svg] of generatedSvgData.entries()) {
  assert.equal(sanitizeSvg(svg, `generated-data-uri-${index}`), svg.trim());
}

console.log("marketplace-brand-marks.test.mjs: coverage ok");
