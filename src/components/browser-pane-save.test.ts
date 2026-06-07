// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./browser-pane.tsx", import.meta.url), "utf8");

assert.match(source, /from "@\/components\/ui\/icon-button"/,
  "browser-pane imports IconButton");
assert.match(source, /icon="ph:bookmark-simple"/,
  "renders a bookmark-simple IconButton");
assert.match(source, /aria-label="Save to library"/,
  "Save button has aria-label");
assert.match(source, /\/api\/library\/route-link/,
  "POSTs to route-link endpoint");
assert.match(source, /kind: "browser"/,
  "uses browser source kind");

console.log("browser-pane-save: 5 assertions passed");
