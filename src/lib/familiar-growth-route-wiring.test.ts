import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

/**
 * Lightweight assertions that the Familiar Growth dashboard route + bento
 * dashboard link stay wired together. Pure file-text reads — no React render —
 * so this runs in the same Node test loader as the rest of the suite.
 * Render-level coverage for the components themselves is exercised by the dev
 * preview route and Playwright (when the page is hit).
 */
describe("Familiar Growth route wiring", () => {
  it("wires the dashboard route breadcrumb and dashboard growth link", () => {
    const page = readFileSync(
      new URL("../app/dashboard/familiars/growth/page.tsx", import.meta.url),
      "utf8",
    );
    const bento = readFileSync(
      new URL("../components/dashboard/bento-dashboard.tsx", import.meta.url),
      "utf8",
    );

    assert.match(page, /Dashboard/);
    assert.match(page, /Familiars/);
    assert.match(page, /Growth/);
    assert.match(bento, /href="\/dashboard\/familiars\/growth"/);
    assert.match(bento, /performance matrix/);
  });
});
