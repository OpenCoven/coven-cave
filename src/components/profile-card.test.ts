// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

describe("Profile card wiring (cave-ujbr)", () => {
  it("mounts ProfileCardView on both familiar profile routes and the human /profile route", () => {
    for (const page of [
      "../app/familiars/[id]/profile/page.tsx",
      "../app/dashboard/familiars/[id]/profile/page.tsx",
    ]) {
      const source = read(page);
      assert.match(source, /import \{ ProfileCardView \} from "@\/components\/profile-card"/);
      assert.match(source, /<AnalyticsPageShell>/);
      assert.match(source, /<ProfileCardView kind="familiar" familiarId=\{id\} \/>/);
      assert.match(source, /force-dynamic/);
    }
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
    const source = read("./familiars-view.tsx");
    assert.match(source, /href=\{`\/dashboard\/familiars\/\$\{encodeURIComponent\(familiar\.id\)\}\/profile`\}/);
    assert.match(source, /aria-label=\{`Open profile for \$\{familiar\.display_name\}`\}/);
    assert.match(source, /Profile →/);
  });

  it("cross-links analytics → profile and settings → the human profile card", () => {
    const analytics = read("./familiar-analytics-view.tsx");
    assert.match(analytics, /href=\{`\/dashboard\/familiars\/\$\{encodeURIComponent\(model\.familiarId\)\}\/profile`\}/);
    const settings = read("./settings-profile.tsx");
    assert.match(settings, /href="\/profile"/);
    assert.match(settings, /View profile card →/);
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
});
