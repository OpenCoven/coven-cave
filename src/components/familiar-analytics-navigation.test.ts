// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

describe("Familiar analytics navigation wiring", () => {
  it("wires the inspector Analytics tab to FamiliarAnalyticsView", () => {
    const source = readFileSync(new URL("./inspector-pane.tsx", import.meta.url), "utf8");

    assert.match(source, /import \{ FamiliarAnalyticsView \} from "@\/components\/familiar-analytics-view"/);
    assert.match(source, /type Tab = "memory" \| "familiar" \| "analytics" \| "inbox"/);
    assert.match(source, /analytics: "Analytics"/);
    assert.match(source, /tab === "analytics"[\s\S]*<FamiliarAnalyticsView familiarId=\{familiar\.id\} \/>/);
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
