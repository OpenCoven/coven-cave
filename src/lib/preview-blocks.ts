import { markdownCodeRanges } from "./github-blocks.ts";

export type PreviewBlock = {
  url: string;
  title: string;
};

export type PreviewTextPiece =
  | { kind: "text"; text: string }
  | { kind: "preview"; preview: PreviewBlock };

const MARKER_RE = /<coven:preview\b((?:\s+[a-zA-Z-]+="[^"]*")*)\s*\/>/g;
const ATTR_RE = /([a-zA-Z-]+)="([^"]*)"/g;
const ALLOWED_ATTRS = new Set(["url", "title"]);

function parseAttrs(raw: string): Record<string, string> | null {
  const attrs: Record<string, string> = {};
  ATTR_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = ATTR_RE.exec(raw)) !== null) {
    if (Object.hasOwn(attrs, match[1]) || !ALLOWED_ATTRS.has(match[1])) return null;
    attrs[match[1]] = match[2];
  }
  return attrs;
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (normalized === "localhost" || normalized === "::1") return true;
  const octets = normalized.split(".");
  return octets.length === 4
    && octets[0] === "127"
    && octets.every((octet) => /^\d{1,3}$/.test(octet) && Number(octet) <= 255);
}

export function isRenderablePreviewUrl(value: string | null | undefined): boolean {
  if (!value) return false;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(value)) return false;
  try {
    const url = new URL(value);
    return (
      (url.protocol === "http:" || url.protocol === "https:")
      && !url.username
      && !url.password
      && isLoopbackHostname(url.hostname)
    );
  } catch {
    return false;
  }
}

function previewFromAttrs(attrs: Record<string, string>): PreviewBlock | null {
  if (!isRenderablePreviewUrl(attrs.url)) return null;
  const url = new URL(attrs.url.trim()).toString();
  return {
    url,
    title: attrs.title?.trim().slice(0, 120) || "Local preview",
  };
}

function inRanges(ranges: Array<[number, number]>, index: number): boolean {
  return ranges.some(([start, end]) => index >= start && index < end);
}

function hasUnquotedGt(text: string, from: number): boolean {
  let inQuote = false;
  for (let index = from; index < text.length; index += 1) {
    if (text[index] === '"') inQuote = !inQuote;
    else if (text[index] === ">" && !inQuote) return true;
  }
  return false;
}

/** Hide an unterminated marker tail while an assistant turn is streaming. */
export function stripIncompletePreviewMarker(text: string): string {
  if (!text || !text.includes("<coven:p")) return text;
  const tail = text.lastIndexOf("<coven:p");
  if (
    tail === -1
    || hasUnquotedGt(text, tail)
    || inRanges(markdownCodeRanges(text), tail)
  ) {
    return text;
  }
  const fragment = text.slice(tail);
  const markerName = "<coven:preview";
  const afterName = fragment.slice(markerName.length, markerName.length + 1);
  return markerName.startsWith(fragment.slice(0, markerName.length))
    && (!afterName || /[\s/>]/.test(afterName))
    ? text.slice(0, tail)
    : text;
}

export function slicePreviewBlocks(text: string): PreviewTextPiece[] {
  const visibleText = stripIncompletePreviewMarker(text);
  if (!visibleText.includes("<coven:preview")) return [{ kind: "text", text: visibleText }];
  const codeRanges = markdownCodeRanges(visibleText);
  const pieces: PreviewTextPiece[] = [];
  let cursor = 0;
  MARKER_RE.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = MARKER_RE.exec(visibleText)) !== null) {
    if (inRanges(codeRanges, match.index)) continue;
    if (match.index > cursor) {
      pieces.push({ kind: "text", text: visibleText.slice(cursor, match.index) });
    }
    const attrs = parseAttrs(match[1]);
    const preview = attrs ? previewFromAttrs(attrs) : null;
    if (preview) pieces.push({ kind: "preview", preview });
    cursor = match.index + match[0].length;
  }

  if (cursor === 0) return [{ kind: "text", text: visibleText }];
  if (cursor < visibleText.length) {
    pieces.push({ kind: "text", text: visibleText.slice(cursor) });
  }
  return pieces;
}

export function stripPreviewMarkers(text: string): string {
  return slicePreviewBlocks(text)
    .filter((piece): piece is Extract<PreviewTextPiece, { kind: "text" }> => piece.kind === "text")
    .map((piece) => piece.text)
    .join("");
}
