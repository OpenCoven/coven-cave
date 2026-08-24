import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const css = await readFile(new URL("../styles/chat-list.css", import.meta.url), "utf8");

test("off-screen chat rows use browser rendering containment", () => {
  assert.match(
    css,
    /\.chat-list-sortable-row\s*\{[^}]*content-visibility:\s*auto;[^}]*contain-intrinsic-size:\s*auto 72px;[^}]*\}/,
  );
  assert.match(
    css,
    /\.chat-list-sortable-row\[data-dragging="true"\]\s*\{[^}]*content-visibility:\s*visible;/,
  );
});
