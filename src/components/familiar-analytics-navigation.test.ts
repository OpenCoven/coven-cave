// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

describe("Familiar analytics navigation wiring", () => {
  it("keeps analytics out of the retired inspector pane, on its standalone pages", () => {
    const source = readFileSync(new URL("./inspector-pane.tsx", import.meta.url), "utf8");
    const chatSurface = readFileSync(new URL("./chat-surface.tsx", import.meta.url), "utf8");
    const analyticsPage = readFileSync(
      new URL("../app/dashboard/familiars/[id]/analytics/page.tsx", import.meta.url),
      "utf8",
    );

    // The inspector sidepanel (and its Analytics section) is retired — the
    // per-familiar analytics pages are the one home for FamiliarAnalyticsView.
    assert.doesNotMatch(source, /FamiliarAnalyticsView/);
    assert.doesNotMatch(chatSurface, /"analytics"|Analytics/);
    assert.match(analyticsPage, /import \{ FamiliarAnalyticsView \} from "@\/components\/familiar-analytics-view"/);
    assert.match(analyticsPage, /<FamiliarAnalyticsView familiarId=\{id\} \/>/);
  });

  it("links growth roster rows to per-familiar analytics", () => {
    const source = readFileSync(new URL("./familiar-growth-view.tsx", import.meta.url), "utf8");

    assert.match(source, /import Link from "next\/link"/);
    assert.match(source, /href=\{`\/dashboard\/familiars\/\$\{encodeURIComponent\(familiar\.id\)\}\/analytics`\}/);
    assert.match(source, /Analytics →/);
  });

  it("links familiar landing cards to per-familiar analytics", () => {
    const source = readFileSync(new URL("./familiars-view.tsx", import.meta.url), "utf8");

    assert.match(source, /import Link from "next\/link"/);
    assert.match(source, /href=\{`\/dashboard\/familiars\/\$\{encodeURIComponent\(familiar\.id\)\}\/analytics`\}/);
    assert.match(source, /aria-label=\{`Open analytics for \$\{familiar\.display_name\}`\}/);
  });
});
