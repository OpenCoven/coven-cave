import sharp from "sharp";

import type { ResearchGenerationStat } from "../research-generations.ts";

/**
 * Research infographic renderer — turns an infographic generation's extracted
 * stat sheet into a shareable SVG poster and a PNG export.
 *
 * Tooling decision (kept local and deterministic on purpose): the poster is a
 * hand-built SVG rasterized by Sharp, the exact path the video renderer
 * already proves. Chart engines (ECharts SSR) were rejected for this kind
 * because the extracted stats are heterogeneous units ("16.4%", "5/25",
 * "~15x") — plotting them on one axis would be misleading decoration, which
 * the extraction contract forbids. Satori (JSX→SVG) remains a follow-up
 * option if richer typography is ever needed; it requires bundling fonts.
 */

export const INFOGRAPHIC_WIDTH = 1_200;
const PADDING = 72;
const COLUMNS = 2;
const CARD_GAP = 24;
const CARD_HEIGHT = 200;
const HEADER_HEIGHT = 220;
const FOOTER_HEIGHT = 96;
const CARD_WIDTH = (INFOGRAPHIC_WIDTH - PADDING * 2 - CARD_GAP) / COLUMNS;

/**
 * Concrete server-artifact palette. These hex values are the sRGB equivalents
 * of the default Coven oklch declarations in
 * src/styles/globals/foundations.css (--background, --card, --foreground,
 * --muted-foreground). SVGs rendered by Sharp cannot inherit browser CSS
 * variables, and Sharp's librsvg does not parse oklch() at all — oklch fills
 * silently render as black — so the palette must stay in hex here.
 */
export const COVEN_INFOGRAPHIC_RENDER_PALETTE = {
  background: "#1c1b1d",
  card: "#202023",
  accent: "#9386d0",
  primaryText: "#fafafa",
  secondaryText: "#929198",
} as const;

export type ResearchInfographicRenderPalette = {
  background: string;
  card: string;
  accent: string;
  primaryText: string;
  secondaryText: string;
};

export type ResearchInfographicInput = {
  title: string;
  sourceTitle: string;
  stats: ResearchGenerationStat[];
};

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function wrap(value: string, maxChars: number): string[] {
  const words = value.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    if (line && line.length + word.length + 1 > maxChars) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines.length > 0 ? lines : [""];
}

export function infographicHeight(statCount: number): number {
  const rows = Math.ceil(statCount / COLUMNS);
  return HEADER_HEIGHT + rows * (CARD_HEIGHT + CARD_GAP) + FOOTER_HEIGHT;
}

export function infographicToSvg(
  input: ResearchInfographicInput,
  palette: ResearchInfographicRenderPalette = COVEN_INFOGRAPHIC_RENDER_PALETTE,
): string {
  if (input.stats.length === 0) {
    throw new Error("infographic has no stats");
  }
  const height = infographicHeight(input.stats.length);
  const titleLines = wrap(input.title, 44).slice(0, 2);
  const titleMarkup = titleLines
    .map(
      (line, index) =>
        `<text x="${PADDING + 32}" y="${104 + index * 52}" class="title">${escapeXml(line)}</text>`,
    )
    .join("");
  const kickerY = 104 + (titleLines.length - 1) * 52 + 48;
  const cardMarkup = input.stats
    .map((stat, index) => {
      const column = index % COLUMNS;
      const row = Math.floor(index / COLUMNS);
      const x = PADDING + column * (CARD_WIDTH + CARD_GAP);
      const y = HEADER_HEIGHT + row * (CARD_HEIGHT + CARD_GAP);
      const valueLine = wrap(stat.value, 22)[0];
      const contextLines = wrap(stat.context, 42).slice(0, 4);
      const contextMarkup = contextLines
        .map(
          (line, lineIndex) =>
            `<text x="${x + 32}" y="${y + 104 + lineIndex * 26}" class="context">${escapeXml(line)}</text>`,
        )
        .join("");
      return `<g>
    <rect x="${x}" y="${y}" width="${CARD_WIDTH}" height="${CARD_HEIGHT}" rx="12" class="card"/>
    <rect x="${x}" y="${y}" width="8" height="${CARD_HEIGHT}" rx="4" class="bar"/>
    <text x="${x + 32}" y="${y + 60}" class="value">${escapeXml(valueLine)}</text>
    ${contextMarkup}
  </g>`;
    })
    .join("\n  ");
  const sourceLine = wrap(`Source: ${input.sourceTitle}`, 92)[0];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${INFOGRAPHIC_WIDTH}" height="${height}" viewBox="0 0 ${INFOGRAPHIC_WIDTH} ${height}">
  <style>
    .base { fill: ${palette.background}; }
    .card { fill: ${palette.card}; }
    .bar { fill: ${palette.accent}; }
    .title { fill: ${palette.primaryText}; font-family: system-ui, sans-serif; font-size: 42px; font-weight: 700; }
    .value { fill: ${palette.accent}; font-family: system-ui, sans-serif; font-size: 40px; font-weight: 700; }
    .context { fill: ${palette.secondaryText}; font-family: system-ui, sans-serif; font-size: 21px; }
    .footer { fill: ${palette.secondaryText}; font-family: system-ui, sans-serif; font-size: 20px; }
  </style>
  <rect width="100%" height="100%" class="base"/>
  <rect x="${PADDING}" y="${PADDING - 8}" width="12" height="120" rx="6" class="bar"/>
  ${titleMarkup}
  <text x="${PADDING + 32}" y="${kickerY}" class="footer">Stat sheet · ${input.stats.length} extracted figure${input.stats.length === 1 ? "" : "s"}</text>
  ${cardMarkup}
  <text x="${PADDING}" y="${height - 44}" class="footer">${escapeXml(sourceLine)}</text>
</svg>`;
}

export async function renderInfographicPng(svg: string): Promise<Uint8Array> {
  return new Uint8Array(await sharp(Buffer.from(svg)).png().toBuffer());
}
