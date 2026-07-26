// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("./search-input.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");

// The component owns its single clear button.
assert.match(src, /export const SearchInput/, "exports SearchInput");
assert.match(src, /ui-search-input-clear/, "renders its own clear button");
assert.match(src, /type="search"/, "uses a native search input");

// …so the native type="search" clear glyph must be suppressed, or every shared
// search field shows a doubled ✕ (our button + the webkit glyph).
assert.match(
  css,
  /\.ui-search-input-field::-webkit-search-cancel-button[\s\S]{0,80}appearance:\s*none/,
  "globals suppresses the native webkit search-cancel glyph on the shared field",
);

console.log("search-input.test.ts OK");
