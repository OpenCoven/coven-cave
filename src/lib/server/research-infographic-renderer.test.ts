import assert from "node:assert/strict";
import test from "node:test";

import sharp from "sharp";

import type { ResearchGenerationStat } from "../research-generations.ts";
import {
  COVEN_INFOGRAPHIC_RENDER_PALETTE,
  INFOGRAPHIC_WIDTH,
  infographicHeight,
  infographicToSvg,
  renderInfographicPng,
} from "./research-infographic-renderer.ts";

const stats: ResearchGenerationStat[] = [
  { value: "16.4%", context: "Pass@1 improvement from plan-then-implement" },
  { value: "5/25", context: 'Models that "fake" <alignment> & guard goals' },
  { value: "~15x", context: "Token cost of multi-agent orchestration" },
];

test("infographic svg carries every stat with XML escaping", () => {
  const svg = infographicToSvg({
    title: "Key figures — Agent loops",
    sourceTitle: "Agent loops",
    stats,
  });
  assert.match(svg, /16\.4%/);
  assert.match(svg, /~15x/);
  assert.match(svg, /&quot;fake&quot; &lt;alignment&gt; &amp; guard/);
  assert.match(svg, /Key figures — Agent loops/);
  assert.match(svg, /Source: Agent loops/);
  assert.match(svg, /3 extracted figures/);
  assert.doesNotMatch(svg, /<alignment>/);
});

test("infographic svg uses the concrete Coven render palette", () => {
  const svg = infographicToSvg({ title: "T", sourceTitle: "S", stats });
  assert.match(svg, new RegExp(COVEN_INFOGRAPHIC_RENDER_PALETTE.accent.replace("#", "#")));
  assert.ok(svg.includes(COVEN_INFOGRAPHIC_RENDER_PALETTE.background));
  assert.ok(svg.includes(COVEN_INFOGRAPHIC_RENDER_PALETTE.card));
  // Sharp's librsvg silently renders oklch() fills as black; every color in
  // the artifact must stay hex/rgb so the rasterized PNG remains legible.
  assert.doesNotMatch(svg, /oklch\(/);
  for (const color of Object.values(COVEN_INFOGRAPHIC_RENDER_PALETTE)) {
    assert.match(color, /^#[0-9a-f]{6}$/);
  }
});

test("infographic height grows by row and matches the svg viewport", () => {
  assert.ok(infographicHeight(4) > infographicHeight(2));
  assert.equal(infographicHeight(1), infographicHeight(2));
  const svg = infographicToSvg({ title: "T", sourceTitle: "S", stats });
  assert.match(
    svg,
    new RegExp(`width="${INFOGRAPHIC_WIDTH}" height="${infographicHeight(stats.length)}"`),
  );
});

test("infographic rejects an empty stat sheet", () => {
  assert.throws(
    () => infographicToSvg({ title: "T", sourceTitle: "S", stats: [] }),
    /no stats/,
  );
});

test("renderInfographicPng produces a decodable PNG at poster size", async () => {
  const svg = infographicToSvg({ title: "T", sourceTitle: "S", stats });
  const png = await renderInfographicPng(svg);
  const metadata = await sharp(Buffer.from(png)).metadata();
  assert.equal(metadata.format, "png");
  assert.equal(metadata.width, INFOGRAPHIC_WIDTH);
  assert.equal(metadata.height, infographicHeight(stats.length));
});
