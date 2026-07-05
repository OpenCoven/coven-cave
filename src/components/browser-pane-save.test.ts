// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./browser-pane.tsx", import.meta.url), "utf8");

assert.match(source, /from "@\/components\/ui\/icon-button"/,
  "browser-pane imports IconButton");
assert.doesNotMatch(source, /aria-label="Save to library"|browser-toolbar-save|\/api\/library\/route-link/,
  "integrated Browser should not expose Library save actions while Library is on feature/library");

console.log("browser-pane-save: ok");
