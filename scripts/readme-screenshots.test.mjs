// The README's screenshots and screenshots/manifest.json must describe the
// same set of images, so every image the README shows has a scripted capture
// and nothing is captured that the README does not use.

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";

import { readmeImages } from "./capture-screenshots.mjs";

const root = new URL("../", import.meta.url);
const readme = readFileSync(new URL("README.md", root), "utf8");
const manifest = JSON.parse(readFileSync(new URL("screenshots/manifest.json", root), "utf8"));
const guide = readFileSync(new URL("screenshots/CONTRIBUTING.md", root), "utf8");

test("readmeImages finds local screenshots in both HTML and Markdown form", () => {
  const sample = [
    '<img src="screenshots/home.png" alt="Home surface" width="820">',
    "![Chat](screenshots/chat.png)",
    '<img src="https://img.shields.io/badge/x-y-blue" alt="badge">',
  ].join("\n");
  assert.deepEqual(readmeImages(sample), [
    { file: "home.png", alt: "Home surface" },
    { file: "chat.png", alt: "Chat" },
  ]);
});

test("every README screenshot has a manifest capture, and the reverse", () => {
  const shown = readmeImages(readme).map((image) => image.file).sort();
  const captured = manifest.captures.map((capture) => capture.file).sort();
  assert.ok(shown.length > 0, "README shows no local screenshots");
  assert.deepEqual(captured, shown);
});

test("each capture names a surface, carries the README's alt text and exists on disk", () => {
  const alts = new Map(readmeImages(readme).map((image) => [image.file, image.alt]));
  for (const capture of manifest.captures) {
    assert.match(capture.mode, /^[a-z-]+$/, `${capture.file} needs a surface mode`);
    assert.ok(capture.waitFor, `${capture.file} needs a selector that proves the surface rendered`);
    assert.equal(capture.alt, alts.get(capture.file), `${capture.file} alt text differs from the README`);
    assert.ok(existsSync(new URL(`screenshots/${capture.file}`, root)), `${capture.file} is missing`);
  }
});

test("the screenshots guide lists every captured file", () => {
  for (const capture of manifest.captures) {
    assert.ok(guide.includes(`\`${capture.file}\``), `screenshots/CONTRIBUTING.md does not list ${capture.file}`);
  }
});
