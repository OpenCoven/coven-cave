// @ts-nocheck
import assert from "node:assert/strict";

import { artifactSource } from "./artifact-source.ts";
import { buildReactSrcDoc } from "./canvas-react-harness.ts";

const reactCode = "export default function App() { return <main>Hello</main>; }";
const reactSource = artifactSource(reactCode, "react");
const reactHarness = buildReactSrcDoc(reactCode);

assert.equal(reactSource.code, reactCode, "React source remains the exact saved component");
assert.equal(reactSource.language, "tsx", "React source highlights as TSX");
assert.equal(reactSource.label, "React · TSX", "React source is visibly labelled as React and TSX");
assert.notEqual(reactSource.code, reactHarness, "React source is never replaced by the generated preview harness");
assert.doesNotMatch(reactSource.code, /<!doctype html>/i, "the displayed React source has no harness document");

const htmlCode = "<!doctype html><html><body>Hello</body></html>";
const htmlSource = artifactSource(htmlCode, "html");

assert.equal(htmlSource.code, htmlCode, "HTML source remains the exact saved document");
assert.equal(htmlSource.language, "html", "HTML source highlights as HTML");
assert.equal(htmlSource.label, "HTML", "HTML source is labelled as HTML");
assert.deepEqual(artifactSource(htmlCode), htmlSource, "legacy artifacts without a kind remain HTML");

console.log("artifact source contract: ok");
