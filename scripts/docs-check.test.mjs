// Contract for scripts/docs-check.mjs, the report-only scan the release train
// runs before a release is recorded: dead local links, source paths that no
// longer exist, and surfaces the product has retired.

import assert from "node:assert/strict";
import { test } from "node:test";

import { deadLinks, livingDocs, missingPaths, retiredMentions } from "./docs-check.mjs";

const exists = (known) => (file) => known.includes(file);

test("livingDocs returns the files linked under the Living heading only", () => {
  const index = [
    "# Documentation index",
    "## Living",
    "- [`golden-paths.md`](golden-paths.md) — journeys",
    "- [`workflows/branching.md`](workflows/branching.md): branching",
    "- [`workflows/`](workflows) — a folder, not a document",
    "## Historical",
    "- [`old.md`](old.md)",
  ].join("\n");
  assert.deepEqual(livingDocs(index), ["docs/golden-paths.md", "docs/workflows/branching.md"]);
});

test("deadLinks reports a relative link whose target is gone", () => {
  const text = "See [the guide](workflows/gone.md#part) and [the index](README.md).\n[site](https://example.test/x) [anchor](#top)";
  assert.deepEqual(deadLinks("docs/a.md", text, exists(["docs/README.md"])), [
    { file: "docs/a.md", line: 1, target: "workflows/gone.md#part" },
  ]);
});

test("deadLinks ignores a placeholder target such as an ellipsis", () => {
  assert.deepEqual(deadLinks("docs/a.md", "Write `![alt](…)` or [text](...) for an image.", exists([])), []);
});

test("deadLinks ignores links inside fenced code", () => {
  const text = "```md\n[example](missing.md)\n```\n";
  assert.deepEqual(deadLinks("docs/a.md", text, exists([])), []);
});

test("missingPaths reports a backticked source path that no longer exists", () => {
  const text = "Edit `src/lib/gone.ts` and `scripts/work-queue.mjs`.\nGlobs like `src/**/*.ts`, `scripts/<name>.mjs` and prose `src/` are skipped.";
  assert.deepEqual(missingPaths("README.md", text, exists(["scripts/work-queue.mjs"])), [
    { file: "README.md", line: 1, target: "src/lib/gone.ts" },
  ]);
});

test("missingPaths accepts a path with a line suffix", () => {
  assert.deepEqual(missingPaths("README.md", "See `scripts/work-queue.mjs:40`.", exists(["scripts/work-queue.mjs"])), []);
});

test("retiredMentions flags a retired surface but not a line that says it was retired", () => {
  const text = "Open Ask Salem from the palette.\nAsk Salem was removed in v0.5.20.\nNothing here.";
  const found = retiredMentions("docs/a.md", text);
  assert.equal(found.length, 1);
  assert.equal(found[0].line, 1);
  assert.match(found[0].target, /Ask Salem/);
});
