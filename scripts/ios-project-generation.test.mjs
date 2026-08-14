import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// cave-d8ma3: on a fresh clone the three Resources bundles do not exist yet —
// they are gitignored build artifacts. `xcodegen generate` SCANS the source
// directory, so anything absent at generate time never enters the resource
// build phase. project.yml's preBuildScripts generate them, but that runs at
// BUILD time (after the scan) and is deliberately non-fatal, so the archive
// succeeds and ships an app with a blank markdown view and a dead terminal.
//
// The order therefore has to be structural, not documentary: generate the
// bundles, prove they exist, and only then run xcodegen.
const read = (p) => readFile(new URL(`../${p}`, import.meta.url), "utf8");

const wrapper = await read("scripts/ios-xcodegen.sh");
const simulator = await read("scripts/ios-simulator.sh");
const readme = await read("apps/ios/CovenCave/README.md");

// --- the wrapper generates first, then scans ---------------------------------
// Compare positions in CODE only. These files explain themselves at length, and
// an indexOf over the whole text finds "xcodegen generate" in the header comment
// long before the actual command — which reports the order backwards.
const code = (src) =>
  src
    .split("\n")
    .map((line) => (line.trim().startsWith("#") ? "" : line))
    .join("\n");
const wrapperCode = code(wrapper);
const genIdx = wrapperCode.indexOf("build-ios-markdown.mjs");
const termIdx = wrapperCode.indexOf("build-ios-terminal.mjs");
const scanIdx = wrapperCode.indexOf("xcodegen generate");
assert.ok(genIdx > 0, "the wrapper should build the markdown bundle");
assert.ok(termIdx > 0, "the wrapper should build the terminal bundle");
assert.ok(scanIdx > 0, "the wrapper should run xcodegen");
assert.ok(
  genIdx < scanIdx && termIdx < scanIdx,
  "both bundles must be generated BEFORE xcodegen scans for sources",
);

// --- and refuses to scan when a bundle is missing -----------------------------
// Non-fatal generation is what makes this silent. The wrapper is the one place
// that must fail loudly, so a missing bundle can never reach an archive.
assert.match(
  wrapper,
  /set -euo pipefail/,
  "the wrapper should abort on any failing step",
);
// wrapperCode, not wrapper: the header comment names all three files, so a
// full-text search passes even when the check loop does not mention them. This
// is the third assertion in this file to have that shape — see the two notes
// above. Search executable lines only.
for (const resource of ["markdown.html", "terminal.html", "markdown.css"]) {
  assert.ok(
    wrapperCode.includes(resource),
    `the wrapper should assert ${resource} exists before generating the project`,
  );
}
// Anchored to the missing-bundle block itself. A bare /exit 1/ over the whole
// file passes on the unrelated xcodegen/node preflight exits, so deleting this
// very guard left the assertion green — verified by mutation.
const missingBlock = wrapperCode.match(/if \[ \$\{#missing\[@\]\}[\s\S]*?\nfi/);
assert.ok(missingBlock, "the wrapper should branch on the missing-bundle list");
assert.match(
  missingBlock[0],
  /exit 1/,
  "a missing bundle should exit non-zero rather than warn",
);

// --- nothing else may call xcodegen directly ----------------------------------
// A second call site is how this regresses: ios-simulator.sh had exactly this
// bug — it ran `xcodegen generate` with no generation step ahead of it.
assert.doesNotMatch(
  code(simulator),
  /^\s*xcodegen generate/m,
  "ios-simulator.sh must go through the wrapper, not call xcodegen itself",
);
assert.match(
  simulator,
  /ios-xcodegen\.sh/,
  "ios-simulator.sh should invoke the wrapper",
);

// --- the documented path is the enforced one ----------------------------------
assert.match(
  readme,
  /ios-xcodegen\.sh/,
  "the README should point at the wrapper so the manual archive path matches CI",
);

console.log("ios-project-generation.test.mjs: ok");
