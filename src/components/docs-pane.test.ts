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
  /const FEEDBACK_URL = "https:\/\/feedback\.opencoven\.ai"/,
  "CovenPane points Feedback at the OpenCoven feedback site",
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

// Non-embeddable hosts (x.com refuses framing) don't get a dead iframe. First-
// party Coven hosts are framed in the page.
assert.match(source, /label: "Docs"[\s\S]{0,120}?embeddable: true/, "Docs is embeddable");
assert.match(source, /label: "Feedback"[\s\S]{0,120}?embeddable: true/, "Feedback is embeddable");
assert.match(source, /label: "X"[\s\S]{0,120}?embeddable: false/, "X is not embeddable");
assert.match(source, /\{activeTab\.embeddable \? \([\s\S]*?<iframe/, "the iframe only renders for an embeddable tab");
assert.match(source, /opens in a new tab/, "non-embeddable tabs show an open-in-new-tab panel");
assert.match(source, /Open \{activeTab\.label\}/, "the panel has a prominent Open action");

// The tab bar is a complete tablist: roving tabIndex, aria-controls → a labelled
// tabpanel, and Left/Right arrow navigation.
assert.match(source, /id=\{`coven-tab-\$\{tab\.id\}`\}/, "each tab has a stable id");
assert.match(source, /aria-controls="coven-tabpanel"/, "tabs point at the panel");
assert.match(source, /tabIndex=\{tab\.id === activeTabId \? 0 : -1\}/, "tablist uses a roving tab stop");
assert.match(source, /role="tabpanel"\s*\n\s*id="coven-tabpanel"\s*\n\s*aria-labelledby=\{`coven-tab-\$\{activeTabId\}`\}/, "the content area is a labelled tabpanel");
assert.match(source, /function onTablistKeyDown[\s\S]{0,200}?ArrowRight/, "Left/Right arrows navigate the tablist");

console.log("docs-pane.test.ts passed");
