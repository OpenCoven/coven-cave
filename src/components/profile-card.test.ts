import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  buildProfileCardViewModel,
  loadProfileCardData,
} from "./profile-card-data.ts";
import { clearCanonicalMemoryResources } from "../lib/canonical-memory-resources.ts";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

describe("Profile card wiring (cave-ujbr)", () => {
  it("mounts ProfileCardView on the canonical familiar profile route and the human /profile route", () => {
    const source = read("../app/dashboard/familiars/[id]/profile/page.tsx");
    assert.match(source, /import \{ ProfileCardView \} from "@\/components\/profile-card"/);
    assert.match(source, /<AnalyticsPageShell>/);
    assert.match(source, /<ProfileCardView kind="familiar" familiarId=\{id\} \/>/);
    assert.match(source, /force-dynamic/);
    // The old top-level twin is a redirect stub into the canonical tree
    // (route consolidation, cave-m4ih.5) — deep links keep working.
    const stub = read("../app/familiars/[id]/profile/page.tsx");
    assert.match(stub, /import \{ redirect \} from "next\/navigation"/);
    assert.match(stub, /redirect\(`\/dashboard\/familiars\/\$\{encodeURIComponent\(id\)\}\/profile\$\{suffix\}`\)/);
    assert.doesNotMatch(stub, /ProfileCardView/, "the stub renders nothing of its own");
    const human = read("../app/profile/page.tsx");
    assert.match(human, /<ProfileCardView kind="human" \/>/);
    assert.match(human, /<AnalyticsPageShell>/);
  });

  it("renders the reference card's regions: rail, stat band, heatmap, panels, collaborators, footer", () => {
    const source = read("./profile-card.tsx");
    assert.match(source, /import "@\/styles\/profile-card\.css"/);
    for (const region of [
      "pfc-rail",
      "pfc-wordmark",
      "pfc-nameplate",
      "pfc-rail-chip",
      "pfc-stat-band",
      "pfc-heatmap",
      "pfc-panels",
      "pfc-collab",
      "pfc-foot",
    ]) {
      assert.match(source, new RegExp(region), `missing region class ${region}`);
    }
    // Numbers come from the pure model; the heatmap carries an SR summary.
    assert.match(source, /buildProfileCardViewModel/);
    assert.match(source, /role="img" aria-label=\{summary\}/);
    // Live like the analytics page, avatar via the sidecar-auth-safe image.
    assert.match(source, /usePausablePoll/);
    assert.match(source, /AuthedImage/);
  });

  it("keeps the card's heatmap legend and footer attribution in the reference language", () => {
    const source = read("./profile-card.tsx");
    assert.match(source, /coven session activity/);
    assert.match(source, /LESS/);
    assert.match(source, /MORE/);
    assert.match(source, /COVEN CAVE \(based on l12m session data\)/);
    assert.match(source, /top collaborators/);
  });

  it("links roster cards to per-familiar profiles beside the analytics link", () => {
    const source = read("./familiars-view-sections.tsx");
    assert.match(source, /href=\{`\/dashboard\/familiars\/\$\{encodeURIComponent\(familiar\.id\)\}\/profile`\}/);
    assert.match(source, /aria-label=\{`Open profile for \$\{familiar\.display_name\}`\}/);
    assert.match(source, /Profile →/);
  });

  it("cross-links analytics → profile and settings → the human profile card", () => {
    const analytics = read("./familiar-analytics-content.tsx");
    assert.match(analytics, /href=\{`\/dashboard\/familiars\/\$\{encodeURIComponent\(model\.familiarId\)\}\/profile`\}/);
    const settings = read("./settings-profile.tsx");
    assert.match(settings, /href="\/profile"/);
    assert.match(settings, /View profile card →/);
  });

  it("returns familiar and human profiles to real parent destinations", () => {
    const source = read("./profile-card.tsx");
    assert.match(source, /href="\/\?mode=agents"/, "familiar profiles return to the Familiars surface");
    assert.match(source, /href="\/settings"/, "the human profile returns to Settings");
    assert.doesNotMatch(source, /\/\?mode=(?:familiars|settings)/, "profile navigation never targets invalid workspace modes");
  });

  it("keeps the profile card fixed-dark and monospace, scoped under .pfc-*", () => {
    const css = readFileSync(new URL("../styles/profile-card.css", import.meta.url), "utf8");
    assert.match(css, /\.pfc-page \{/);
    assert.match(css, /--font-jetbrains-mono/);
    // The mint activity ramp — all five heatmap levels are styled.
    for (const level of [0, 1, 2, 3, 4]) {
      assert.match(css, new RegExp(`\\.pfc-cell\\[data-level="${level}"\\]`));
    }
  });

  it("stretches the card to fill the page height and width (no 1200px island)", () => {
    const css = readFileSync(new URL("../styles/profile-card.css", import.meta.url), "utf8");
    // The page is a flex column so the card can absorb the remaining height…
    assert.match(css, /\.pfc-page \{[\s\S]*?display: flex;[\s\S]*?flex-direction: column;/);
    // …and the card takes it, pinning the footer row to the card's bottom edge.
    assert.match(css, /\.pfc-card \{[\s\S]*?flex: 1;/);
    assert.match(css, /\.pfc-card \{[\s\S]*?grid-template-rows: 1fr auto;/);
    // The metric panels absorb vertical growth inside the main column.
    assert.match(css, /\.pfc-panels \{[\s\S]*?flex: 1;/);
    // No fixed width caps anywhere — the card, topnav and callout track the page.
    assert.doesNotMatch(css, /max-width: 1200px/);
  });

  it("renders canonical memory as unavailable instead of a confirmed zero", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url: RequestInfo | URL) => {
      const value = String(url);
      const body =
        value === "/api/familiars"
          ? {
              ok: true,
              familiars: [
                { id: "cody", display_name: "Cody", role: "agent" },
              ],
            }
          : value === "/api/sessions/list"
            ? { ok: true, sessions: [] }
            : {
                ok: false,
                code: "canonical_memory_unavailable",
              };
      return {
        ok: value !== "/api/coven-memory",
        status: value === "/api/coven-memory" ? 503 : 200,
        json: async () => body,
      } as Response;
    }) as typeof fetch;

    try {
      const data = await loadProfileCardData("familiar", "cody");
      const viewModel = buildProfileCardViewModel(data);
      const memoryTile = viewModel.model.statTiles.find(
        (tile) => tile.label === "memories",
      );

      assert.equal(data.memoryAvailability, "unavailable");
      assert.equal(memoryTile?.value, "—");
      assert.ok(
        viewModel.errors.some((message) => message.includes("memory unavailable")),
      );
    } finally {
      globalThis.fetch = originalFetch;
      clearCanonicalMemoryResources();
    }
  });
});
