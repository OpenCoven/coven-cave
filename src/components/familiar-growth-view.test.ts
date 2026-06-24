import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FamiliarGrowthView } from "./familiar-growth-view";
import type { FamiliarGrowthInitialData } from "./familiar-growth-view";

const emptyData: FamiliarGrowthInitialData = {
  familiars: [],
  sessions: [],
  covenEntries: [],
  retroSnapshot: {
    generatedAt: "2026-06-24T12:00:00.000Z",
    summary: {
      totalRuns: 0,
      accepted: 0,
      reverted: 0,
      runningFamiliars: 0,
      familiarsWithData: 0,
      trackCounts: { synthesis: 0, prompt: 0, memory: 0 },
      lastRun: null,
    },
    familiars: [],
    runs: [],
  },
};

describe("FamiliarGrowthView", () => {
  it("renders without a selected familiar", () => {
    const html = renderToStaticMarkup(
      createElement(FamiliarGrowthView, { standalone: true, initialData: emptyData }),
    );

    assert.match(html, /Familiar Growth &amp; Performance/);
    assert.match(html, /No familiars available/);
  });

  it("renders the familiar sidebar and selected report when data is provided", () => {
    const html = renderToStaticMarkup(
      createElement(FamiliarGrowthView, {
        standalone: true,
        initialData: {
          ...emptyData,
          familiars: [{ id: "cody", display_name: "Cody", role: "Coding familiar" }],
          sessions: [
            {
              id: "s1",
              project_root: "/tmp",
              harness: "codex",
              title: "Ship feature",
              status: "completed",
              exit_code: 0,
              archived_at: null,
              created_at: "2026-06-23T12:00:00.000Z",
              updated_at: "2026-06-23T12:00:00.000Z",
              familiarId: "cody",
            },
          ],
        },
      }),
    );

    assert.match(html, /Familiar roster/);
    assert.match(html, /Cody/);
    assert.match(html, /Growth report for Cody/);
  });

  it("wires the dashboard route breadcrumb and dashboard growth link", () => {
    const page = readFileSync(new URL("../app/dashboard/familiars/growth/page.tsx", import.meta.url), "utf8");
    const cockpit = readFileSync(new URL("./dashboard/dashboard-cockpit.tsx", import.meta.url), "utf8");

    assert.match(page, /Dashboard/);
    assert.match(page, /Familiars/);
    assert.match(page, /Growth/);
    assert.match(cockpit, /href="\/dashboard\/familiars\/growth"/);
    assert.match(cockpit, /Growth/);
  });
});
