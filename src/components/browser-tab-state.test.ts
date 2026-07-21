import assert from "node:assert/strict";
import { test } from "node:test";
import { browserTabTitle, defaultPinnedTabs, normalizeBrowserUrl, resolveRestoredBrowserNavigation } from "./browser-tab-state.ts";

test("default browser tabs retain the user-facing pinned destinations", () => {
  assert.deepEqual(defaultPinnedTabs().map((tab) => tab.id), [
    "home",
    "opencoven-docs",
    "opencoven-feedback",
    "github",
  ]);
});

test("browser URLs retain convenience input and safe navigation rules", () => {
  assert.equal(normalizeBrowserUrl("localhost:3000/docs"), "http://localhost:3000/docs");
  assert.equal(normalizeBrowserUrl("opencoven.ai"), "https://opencoven.ai/");
  assert.equal(normalizeBrowserUrl("javascript:alert(1)"), "https://www.google.com/search?q=javascript%3Aalert(1)");
});

test("tab titles prefer supplied page titles and compact host names", () => {
  assert.equal(browserTabTitle("https://www.opencoven.ai/docs", "Docs"), "Docs");
  assert.equal(browserTabTitle("https://www.opencoven.ai/docs", "https://www.opencoven.ai/docs"), "opencoven.ai");
});

test("a removed restored tab falls back without applying its old address", () => {
  const result = resolveRestoredBrowserNavigation(defaultPinnedTabs(), "removed-tab", "https://example.test/old");
  assert.deepEqual(result, {
    activeTabId: "home",
    address: "https://opencoven.ai",
    restoredTabExists: false,
  });
});
