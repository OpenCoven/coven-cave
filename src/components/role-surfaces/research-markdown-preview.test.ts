import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./research-markdown-preview.tsx", import.meta.url), "utf8");
const actions = readFileSync(new URL("./research-artifact-actions.tsx", import.meta.url), "utf8");

test("the preview uses the same lazy serializer chat renders through", () => {
  assert.match(source, /^"use client";/);
  // Browser-only chunk: importing it eagerly would evaluate during server render.
  assert.match(source, /loadMarkdownPreview\(\)/);
  // renderAsync takes a parsed document, not raw text.
  assert.match(source, /renderAsync\(parse\(markdown\)\)/);
  assert.match(source, /unwrapPreviewShell\(rendered\)/);
});

test("a slow render cannot overwrite a newer one", () => {
  // The log re-renders on every poll while a mission runs.
  assert.match(source, /renderToken/);
  assert.match(source, /token !== renderToken\.current/);
});

test("an unrenderable log falls back to its raw source rather than an empty pane", () => {
  assert.match(source, /research-markdown-preview--raw/);
  assert.match(source, /setFailed\(true\)/);
});

test("only genuinely Markdown artifacts switch away from the verbatim viewer", () => {
  assert.match(actions, /<ResearchMarkdownPreview/);
  assert.match(actions, /isMarkdownArtifact\(viewing\.fileName, artifact\.relativePath\)/);
  assert.match(actions, /endsWith\("\.md"\)/);
  // sources.json and friends must keep the exact-bytes view.
  assert.match(actions, /<pre className="research-artifact-viewer__content">/);
});
