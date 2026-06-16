type Rgb = [number, number, number];

const DARK_TEXT = "#111111";
const LIGHT_TEXT = "#ffffff";

function srgbToLinear(channel: number): number {
  const value = channel / 255;
  return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance([r, g, b]: Rgb): number {
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}

function contrastRatio(a: Rgb, b: Rgb): number {
  const lighter = Math.max(relativeLuminance(a), relativeLuminance(b));
  const darker = Math.min(relativeLuminance(a), relativeLuminance(b));
  return (lighter + 0.05) / (darker + 0.05);
}

function parseHexColor(color: string): Rgb | null {
  const hex = color.trim().match(/^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i)?.[1];
  if (!hex) return null;
  const normalized =
    hex.length === 3 || hex.length === 4
      ? hex
          .slice(0, 3)
          .split("")
          .map((char) => char + char)
          .join("")
      : hex.slice(0, 6);
  const value = Number.parseInt(normalized, 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function parseRgbColor(color: string): Rgb | null {
  const match = color.trim().match(/^rgba?\((.+)\)$/i);
  if (!match) return null;
  const channels = match[1]
    .replace(/\s*\/\s*[^,)\s]+$/, "")
    .split(/[,\s]+/)
    .filter(Boolean)
    .slice(0, 3)
    .map((part) => {
      if (part.endsWith("%")) return Math.round((Number.parseFloat(part) / 100) * 255);
      return Number.parseFloat(part);
    });
  if (channels.length !== 3 || channels.some((value) => !Number.isFinite(value))) return null;
  return channels.map((value) => Math.max(0, Math.min(255, Math.round(value)))) as Rgb;
}

export function parseCssColorToRgb(color: string): Rgb | null {
  return parseHexColor(color) ?? parseRgbColor(color);
}

export function readableTextColor(color: string, fallback = LIGHT_TEXT): string {
  const rgb = parseCssColorToRgb(color);
  if (!rgb) return fallback;
  const darkContrast = contrastRatio(rgb, [17, 17, 17]);
  const lightContrast = contrastRatio(rgb, [255, 255, 255]);
  return darkContrast >= lightContrast ? DARK_TEXT : LIGHT_TEXT;
}
