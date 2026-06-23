// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./docs-pane.tsx", import.meta.url), "utf8");

assert.match(
  source,
  /const DOCS_URL = "https:\/\/docs\.opencoven\.ai"/,
  "DocsPane points at the OpenCoven docs site",
);

assert.match(
  source,
  /<iframe[\s\S]*src=\{DOCS_URL\}/,
  "DocsPane embeds the docs URL in an iframe",
);

// The framed docs must never be able to navigate the whole app away from
// itself — `allow-top-navigation` is intentionally omitted from the sandbox.
assert.match(source, /sandbox="[^"]*allow-scripts[^"]*"/, "iframe allows scripts (docs search/nav need JS)");
assert.doesNotMatch(
  source,
  /sandbox="[^"]*allow-top-navigation[^"]*"/,
  "iframe sandbox must not allow top navigation",
);

// An external escape hatch is kept in case the docs host ever refuses framing.
assert.match(
  source,
  /href=\{DOCS_URL\}[\s\S]*target="_blank"[\s\S]*rel="noopener noreferrer"/,
  "DocsPane keeps an open-in-new-tab link to the docs",
);

console.log("docs-pane.test.ts passed");
