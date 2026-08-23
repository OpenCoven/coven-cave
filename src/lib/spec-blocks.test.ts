import assert from "node:assert/strict";
import { sliceSpecBlocks } from "./spec-blocks.ts";

const titled = sliceSpecBlocks(
  'Before\n```spec title="Reader"\n# Body\n\n## Goal\nText\n```\nAfter',
);
assert.deepEqual(titled.map((piece) => piece.kind), ["text", "spec", "text"]);
assert.equal(titled[1].kind === "spec" ? titled[1].spec.title : "", "Reader");
assert.equal(titled[1].kind === "spec" ? titled[1].spec.kind : "", "spec");
assert.equal(titled[1].kind === "spec" ? titled[1].spec.sectionCount : 0, 2);

const heading = sliceSpecBlocks("```spec\n# Heading title\n\nBody\n```");
assert.equal(heading[0].kind === "spec" ? heading[0].spec.title : "", "Heading title");

const fallback = sliceSpecBlocks("```spec\nBody only\n```");
assert.equal(fallback[0].kind === "spec" ? fallback[0].spec.title : "", "Familiar spec");
assert.equal(fallback[0].kind === "spec" ? fallback[0].spec.readingMinutes : 0, 1);

const handoff = sliceSpecBlocks(
  'Before\n````handoff title="Auth handoff"\n# Auth handoff\n\n## Next action\nRun the focused tests.\n````\nAfter',
);
assert.deepEqual(handoff.map((piece) => piece.kind), ["text", "spec", "text"]);
assert.equal(handoff[1].kind === "spec" ? handoff[1].spec.kind : "", "handoff");
assert.equal(handoff[1].kind === "spec" ? handoff[1].spec.title : "", "Auth handoff");
assert.equal(handoff[1].kind === "spec" ? handoff[1].spec.sectionCount : 0, 2);

const handoffFallback = sliceSpecBlocks("```handoff\nContinue from the current branch.\n```");
assert.equal(
  handoffFallback[0].kind === "spec" ? handoffFallback[0].spec.title : "",
  "Familiar handoff",
);

const multiple = sliceSpecBlocks(
  "```spec\n# One\n```\nBetween\n```handoff\n# Two\n```",
);
assert.deepEqual(multiple.map((piece) => piece.kind), ["spec", "text", "spec"]);
assert.equal(multiple[2].kind === "spec" ? multiple[2].spec.kind : "", "handoff");

const nested = sliceSpecBlocks(
  '````spec title="With code"\n# API\n\n```ts\nconst value = true;\n```\n````',
);
assert.equal(nested[0].kind, "spec");
assert.match(nested[0].kind === "spec" ? nested[0].spec.markdown : "", /```ts/);

const literalExample = [
  "````markdown",
  '```handoff title="Example only"',
  "# This must stay literal",
  "```",
  "````",
].join("\n");
assert.deepEqual(
  sliceSpecBlocks(literalExample),
  [{ kind: "text", text: literalExample }],
  "a document fence inside another Markdown fence stays literal example text",
);

const tildeExample = [
  "~~~markdown",
  '```spec title="Example only"',
  "# This must also stay literal",
  "```",
  "~~~",
].join("\n");
assert.deepEqual(
  sliceSpecBlocks(tildeExample),
  [{ kind: "text", text: tildeExample }],
  "a spec fence inside a tilde fence stays literal example text",
);

assert.deepEqual(sliceSpecBlocks("```spec\n\n```"), [
  { kind: "text", text: "```spec\n\n```" },
]);
assert.deepEqual(sliceSpecBlocks("```spec\nunfinished"), [
  { kind: "text", text: "```spec\nunfinished" },
]);
assert.equal(sliceSpecBlocks("    ```spec\n    literal\n    ```")[0].kind, "text");
assert.deepEqual(sliceSpecBlocks("```handoff\n\n```"), [
  { kind: "text", text: "```handoff\n\n```" },
]);

console.log("spec-blocks: all assertions passed");
