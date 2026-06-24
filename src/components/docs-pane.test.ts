// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./docs-pane.tsx", import.meta.url), "utf8");

assert.match(
  source,
  /const DOCS_URL = "https:\/\/docs\.opencoven\.ai"/,
  "CovenPane points at the OpenCoven docs site",
);

assert.match(
  source,
  /const FEEDBACK_URL = "https:\/\/github\.com\/OpenCoven\/coven-cave\/issues\/new\/choose"/,
  "CovenPane points Feedback at the Coven Cave issue chooser",
);

assert.match(
  source,
  /const X_URL = "https:\/\/x\.com\/OpenCvn"/,
  "CovenPane points X at the OpenCoven profile",
);

assert.match(
  source,
  /export function CovenPane\(\)/,
  "DocsPane file should export the renamed CovenPane surface",
);

assert.match(
  source,
  /COVEN_TABS[\s\S]*label: "Docs"[\s\S]*label: "Feedback"[\s\S]*label: "X"/,
  "CovenPane exposes Docs, Feedback, and X as first-class tabs",
);

assert.match(
  source,
  /role="tablist"[\s\S]*aria-label="Coven browser tabs"[\s\S]*role="tab"[\s\S]*aria-selected=\{tab\.id === activeTabId\}/,
  "CovenPane should render accessible native-feeling tabs",
);

assert.match(
  source,
  /<iframe[\s\S]*src=\{activeTab\.url\}/,
  "CovenPane embeds the active tab URL in one browser frame",
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
  /href=\{activeTab\.url\}[\s\S]*target="_blank"[\s\S]*rel="noopener noreferrer"/,
  "CovenPane keeps an open-in-new-tab link to the active tab",
);

console.log("docs-pane.test.ts passed");
