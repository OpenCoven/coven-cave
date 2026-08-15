import assert from "node:assert/strict";
import test from "node:test";
import {
  isRenderablePreviewUrl,
  slicePreviewBlocks,
  stripIncompletePreviewMarker,
  stripPreviewMarkers,
} from "./preview-blocks.ts";

test("preview URLs accept only loopback HTTP origins", () => {
  for (const value of [
    "http://localhost:3000",
    "https://localhost/demo",
    "http://127.0.0.1:4173/path?mode=dark",
    "http://127.23.4.5",
    "http://[::1]:3000",
  ]) {
    assert.equal(isRenderablePreviewUrl(value), true, value);
  }
  for (const value of [
    "https://example.com",
    "http://0.0.0.0:3000",
    "http://192.168.1.2:3000",
    "file:///tmp/demo.html",
    "javascript:alert(1)",
    "http://user:pass@localhost:3000",
    "http://localhost.evil.test",
  ]) {
    assert.equal(isRenderablePreviewUrl(value), false, value);
  }
});

test("preview markers become ordered cards and unsafe markers disappear", () => {
  const pieces = slicePreviewBlocks([
    "Before",
    '<coven:preview url="http://127.0.0.1:3000/demo" title="Demo" />',
    '<coven:preview url="https://example.com" title="Unsafe" />',
    "After",
  ].join("\n"));
  assert.deepEqual(pieces.map((piece) => piece.kind), ["text", "preview", "text", "text"]);
  assert.deepEqual(
    pieces.find((piece) => piece.kind === "preview")?.preview,
    { url: "http://127.0.0.1:3000/demo", title: "Demo" },
  );
  assert.equal(
    stripPreviewMarkers(pieces.map((piece) => piece.kind === "text" ? piece.text : "").join("")),
    "Before\n\n\nAfter",
  );
  assert.equal(
    stripPreviewMarkers('<coven:preview url="https://example.com" title="Unsafe" />'),
    "",
  );
});

test("markers inside Markdown fences stay literal", () => {
  const text = [
    "```text",
    '<coven:preview url="http://localhost:3000" title="Example" />',
    "```",
  ].join("\n");
  assert.deepEqual(slicePreviewBlocks(text), [{ kind: "text", text }]);
});

test("streaming preview fragments stay hidden outside Markdown fences", () => {
  assert.equal(stripIncompletePreviewMarker("Ready\n<coven:pre"), "Ready\n");
  assert.equal(
    stripIncompletePreviewMarker('Ready\n<coven:preview url="http://localhost:3000'),
    "Ready\n",
  );
  assert.deepEqual(slicePreviewBlocks("Ready\n<coven:pre"), [
    { kind: "text", text: "Ready\n" },
  ]);

  const fenced = "```text\n<coven:pre\n```";
  assert.equal(stripIncompletePreviewMarker(fenced), fenced);
});

test("duplicate and unknown attributes fail closed", () => {
  for (const marker of [
    '<coven:preview url="http://localhost:3000" url="http://127.0.0.1:3000" />',
    '<coven:preview url="http://localhost:3000" onclick="alert(1)" />',
  ]) {
    assert.equal(slicePreviewBlocks(marker).some((piece) => piece.kind === "preview"), false);
    assert.equal(stripPreviewMarkers(marker), "");
  }
});
