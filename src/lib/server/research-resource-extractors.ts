import { canonicalJson } from "../research-protocol/digest.ts";
import type {
  ResourceNormalizationReceiptV1,
  ResourcePageBoundaryV1,
} from "../research-resource-contracts.ts";

export const RESEARCH_EXTRACTION_LIMITS = {
  maxTextInputBytes: 16 * 1024 * 1024,
  maxNormalizedBytes: 64 * 1024 * 1024,
  maxPdfPages: 2_000,
  maxPdfPageBytes: 2 * 1024 * 1024,
} as const;

export type ResearchExtractionLimits = {
  [Key in keyof typeof RESEARCH_EXTRACTION_LIMITS]: number;
};

export const RESEARCH_EXTRACTOR_VERSIONS = {
  text: { extractorId: "cave-text", extractorVersion: "1" },
  markdown: { extractorId: "cave-markdown", extractorVersion: "1" },
  html: { extractorId: "cave-html-markdown", extractorVersion: "1" },
  json: { extractorId: "cave-canonical-json", extractorVersion: "1" },
  pdf: { extractorId: "pdfjs-text", extractorVersion: "6.2.108-cave-1" },
} as const satisfies Record<string, ResourceNormalizationReceiptV1>;

export type ResearchExtractionInput = {
  bytes: Uint8Array;
  contentType?: string | null;
  sourceUrl?: string;
};

export type ExtractedResearchResource = {
  normalizedBytes: Uint8Array;
  normalizedMediaType:
    | "text/plain; charset=utf-8"
    | "text/markdown; charset=utf-8"
    | "application/json";
  normalizationReceipt: ResourceNormalizationReceiptV1;
  pageBoundaries?: ResourcePageBoundaryV1[];
  title?: string;
};

export class ResearchResourceExtractionError extends Error {
  readonly code:
    | "unsupported_media"
    | "input_too_large"
    | "normalized_too_large"
    | "invalid_utf8"
    | "malformed_html"
    | "malformed_json"
    | "malformed_pdf"
    | "pdf_page_limit"
    | "pdf_page_too_large";
  readonly retryable = false;

  constructor(code: ResearchResourceExtractionError["code"], message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ResearchResourceExtractionError";
    this.code = code;
  }
}

function mediaType(contentType: string | null | undefined): string {
  return (contentType ?? "").split(";", 1)[0].trim().toLowerCase();
}

function decodeUtf8(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    throw new ResearchResourceExtractionError("invalid_utf8", "resource text is not valid UTF-8", {
      cause: error,
    });
  }
}

function normalizeNewlines(value: string): string {
  return value.replace(/\r\n?/g, "\n");
}

function encodeBounded(value: string, limit: number): Uint8Array {
  const encoded = new TextEncoder().encode(value);
  if (encoded.byteLength > limit) {
    throw new ResearchResourceExtractionError(
      "normalized_too_large",
      "normalized resource exceeds the byte limit",
    );
  }
  return encoded;
}

const HTML_ENTITIES: Readonly<Record<string, string>> = {
  amp: "&", apos: "'", gt: ">", lt: "<", nbsp: " ", quot: '"',
};

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]{1,6});/gi, (whole, raw: string) => {
      const point = Number.parseInt(raw, 16);
      return point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff)
        ? String.fromCodePoint(point) : whole;
    })
    .replace(/&#([0-9]{1,7});/g, (whole, raw: string) => {
      const point = Number.parseInt(raw, 10);
      return point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff)
        ? String.fromCodePoint(point) : whole;
    })
    .replace(/&([a-z]+);/gi, (whole, name: string) => HTML_ENTITIES[name.toLowerCase()] ?? whole);
}

function markdownText(value: string): string {
  return decodeHtmlEntities(value)
    .replace(/\\/g, "\\\\")
    .replace(/([`*_[\]])/g, "\\$1")
    .replace(/[ \t]+/g, " ")
    .trim();
}

function safeHtmlLink(rawHref: string, sourceUrl: string | undefined): string | null {
  try {
    const url = sourceUrl ? new URL(decodeHtmlEntities(rawHref), sourceUrl) : new URL(decodeHtmlEntities(rawHref));
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function stripHiddenAndActiveHtml(html: string): string {
  let value = html.replace(/<!--[\s\S]*?-->/g, " ");
  for (const tag of ["script", "style", "noscript", "template", "svg", "canvas", "iframe", "object", "head"]) {
    value = value.replace(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}[^>]*>`, "gi"), " ");
    value = value.replace(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*$`, "gi"), " ");
  }
  value = value.replace(/<(?:meta|link|base|input)\b[^>]*>/gi, " ");
  // The reviewed hidden forms are removed as complete same-tag blocks. This is
  // intentionally conservative and never interprets CSS or executes a DOM.
  value = value.replace(
    /<([a-z][a-z0-9:-]*)\b(?=[^>]*(?:\shidden(?:\s|=|>)|aria-hidden\s*=\s*["']?true|style\s*=\s*["'][^"']*(?:display\s*:\s*none|visibility\s*:\s*hidden)))[^>]*>[\s\S]*?<\/\1[^>]*>/gi,
    " ",
  );
  return value;
}

/** Deterministic, no-DOM HTML to a deliberately small Markdown subset. */
export function htmlToDeterministicMarkdown(
  rawHtml: string,
  sourceUrl?: string,
): { title?: string; markdown: string } {
  const html = normalizeNewlines(rawHtml);
  const titleMatch = /<title\b[^>]*>([\s\S]*?)<\/title[^>]*>/i.exec(html);
  const title = titleMatch ? decodeHtmlEntities(titleMatch[1]).replace(/\s+/g, " ").trim() : "";
  let body = stripHiddenAndActiveHtml(html);
  const anchorCount = body.match(/<a\b/gi)?.length ?? 0;
  if (
    sourceUrl
    && body.length + anchorCount * Math.min(sourceUrl.length, 8_192)
      > RESEARCH_EXTRACTION_LIMITS.maxNormalizedBytes
  ) {
    throw new ResearchResourceExtractionError(
      "normalized_too_large",
      "HTML link expansion exceeds the normalized byte limit",
    );
  }
  body = body.replace(
    /<a\b[^>]*\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a[^>]*>/gi,
    (_whole, doubleHref: string, singleHref: string, bareHref: string, labelHtml: string) => {
      const label = markdownText(labelHtml.replace(/<[^>]+>/g, " "));
      const href = safeHtmlLink(doubleHref ?? singleHref ?? bareHref ?? "", sourceUrl);
      return href && label ? `[${label}](${href})` : label;
    },
  );
  for (let level = 6; level >= 1; level -= 1) {
    body = body.replace(
      new RegExp(`<h${level}\\b[^>]*>([\\s\\S]*?)<\\/h${level}[^>]*>`, "gi"),
      (_whole, content: string) => `\n${"#".repeat(level)} ${markdownText(content.replace(/<[^>]+>/g, " "))}\n`,
    );
  }
  body = body
    .replace(/<(?:strong|b)\b[^>]*>([\s\S]*?)<\/(?:strong|b)[^>]*>/gi, "**$1**")
    .replace(/<(?:em|i)\b[^>]*>([\s\S]*?)<\/(?:em|i)[^>]*>/gi, "*$1*")
    .replace(/<code\b[^>]*>([\s\S]*?)<\/code[^>]*>/gi, (_whole, content: string) => `\`${markdownText(content)}\``)
    .replace(/<li\b[^>]*>([\s\S]*?)<\/li[^>]*>/gi, (_whole, content: string) => `\n- ${content}\n`)
    .replace(/<blockquote\b[^>]*>([\s\S]*?)<\/blockquote[^>]*>/gi, (_whole, content: string) =>
      `\n${content.replace(/<[^>]+>/g, " ").split("\n").map((line) => `> ${markdownText(line)}`).join("\n")}\n`)
    .replace(/<(?:br|\/p|\/div|\/section|\/article|\/main|\/nav|\/ul|\/ol|\/pre)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  const markdown = decodeHtmlEntities(body)
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!markdown && !title) {
    throw new ResearchResourceExtractionError("malformed_html", "HTML contains no extractable content");
  }
  return { ...(title ? { title } : {}), markdown };
}

function sniffGenericText(bytes: Uint8Array): "text/plain" | "text/html" | "application/json" {
  const text = decodeUtf8(bytes);
  if (/\u0000/.test(text) || /[\u0001-\u0008\u000b\u000c\u000e-\u001f]/.test(text)) {
    throw new ResearchResourceExtractionError("unsupported_media", "generic binary input is unsupported");
  }
  const trimmed = text.trimStart();
  if (trimmed.startsWith("%PDF-")) {
    throw new ResearchResourceExtractionError(
      "unsupported_media",
      "PDF input requires an explicit application/pdf content type",
    );
  }
  if (/^(?:<!doctype\s+html\b|<html\b|<head\b|<body\b)/i.test(trimmed)) return "text/html";
  if (/^[\[{]/.test(trimmed)) {
    try {
      JSON.parse(text);
      return "application/json";
    } catch {
      // A leading brace is still valid ordinary text when it is not JSON.
    }
  }
  return "text/plain";
}

async function extractPdf(
  bytes: Uint8Array,
  limits: ResearchExtractionLimits,
): Promise<ExtractedResearchResource> {
  let loadingTask: { promise: Promise<any>; destroy(): Promise<void> } | undefined;
  try {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    loadingTask = pdfjs.getDocument({
      data: Uint8Array.from(bytes),
      useSystemFonts: false,
    }) as typeof loadingTask;
    const document = await loadingTask!.promise;
    if (document.numPages > limits.maxPdfPages) {
      throw new ResearchResourceExtractionError("pdf_page_limit", "PDF exceeds the page limit");
    }
    const chunks: Uint8Array[] = [];
    const pageBoundaries: ResourcePageBoundaryV1[] = [];
    let offset = 0;
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent({ disableNormalization: false });
      const parts: string[] = [];
      for (const item of content.items as Array<{ str?: unknown; hasEOL?: unknown }>) {
        if (typeof item.str !== "string" || item.str.length === 0) continue;
        parts.push(item.str);
        parts.push(item.hasEOL === true ? "\n" : " ");
      }
      const pageText = normalizeNewlines(parts.join(""))
        .replace(/[ \t]+\n/g, "\n")
        .replace(/[ \t]{2,}/g, " ")
        .trimEnd() + "\n";
      const pageBytes = new TextEncoder().encode(pageText);
      if (pageBytes.byteLength > limits.maxPdfPageBytes) {
        throw new ResearchResourceExtractionError("pdf_page_too_large", "PDF page exceeds the normalized byte limit");
      }
      if (offset + pageBytes.byteLength > limits.maxNormalizedBytes) {
        throw new ResearchResourceExtractionError("normalized_too_large", "normalized PDF exceeds the byte limit");
      }
      chunks.push(pageBytes);
      pageBoundaries.push({ page: pageNumber, start: offset, end: offset + pageBytes.byteLength });
      offset += pageBytes.byteLength;
      page.cleanup?.();
    }
    const normalizedBytes = new Uint8Array(offset);
    let cursor = 0;
    for (const chunk of chunks) {
      normalizedBytes.set(chunk, cursor);
      cursor += chunk.byteLength;
    }
    return {
      normalizedBytes,
      normalizedMediaType: "text/plain; charset=utf-8",
      normalizationReceipt: { ...RESEARCH_EXTRACTOR_VERSIONS.pdf },
      pageBoundaries,
    };
  } catch (error) {
    if (error instanceof ResearchResourceExtractionError) throw error;
    throw new ResearchResourceExtractionError("malformed_pdf", "PDF extraction failed", { cause: error });
  } finally {
    await loadingTask?.destroy().catch(() => {});
  }
}

/** Normalize one fetched resource without executing or loading its contents. */
export async function extractResearchResource(
  input: ResearchExtractionInput,
  options: { limits?: Partial<ResearchExtractionLimits> } = {},
): Promise<ExtractedResearchResource> {
  const limits: ResearchExtractionLimits = { ...RESEARCH_EXTRACTION_LIMITS, ...options.limits };
  let kind = mediaType(input.contentType);
  if (!kind || kind === "application/octet-stream" || kind === "binary/octet-stream") {
    if (input.bytes.byteLength > limits.maxTextInputBytes) {
      throw new ResearchResourceExtractionError("input_too_large", "generic input exceeds the text byte limit");
    }
    kind = sniffGenericText(input.bytes);
  }
  if (kind === "application/pdf") return extractPdf(input.bytes, limits);
  if (input.bytes.byteLength > limits.maxTextInputBytes) {
    throw new ResearchResourceExtractionError("input_too_large", "text input exceeds the byte limit");
  }
  const text = normalizeNewlines(decodeUtf8(input.bytes));
  if (kind === "text/plain") {
    return {
      normalizedBytes: encodeBounded(text, limits.maxNormalizedBytes),
      normalizedMediaType: "text/plain; charset=utf-8",
      normalizationReceipt: { ...RESEARCH_EXTRACTOR_VERSIONS.text },
    };
  }
  if (kind === "text/markdown" || kind === "text/x-markdown" || kind === "application/markdown") {
    return {
      normalizedBytes: encodeBounded(text, limits.maxNormalizedBytes),
      normalizedMediaType: "text/markdown; charset=utf-8",
      normalizationReceipt: { ...RESEARCH_EXTRACTOR_VERSIONS.markdown },
    };
  }
  if (kind === "text/html" || kind === "application/xhtml+xml") {
    const extracted = htmlToDeterministicMarkdown(text, input.sourceUrl);
    return {
      normalizedBytes: encodeBounded(extracted.markdown, limits.maxNormalizedBytes),
      normalizedMediaType: "text/markdown; charset=utf-8",
      normalizationReceipt: { ...RESEARCH_EXTRACTOR_VERSIONS.html },
      ...(extracted.title ? { title: extracted.title } : {}),
    };
  }
  if (kind === "application/json" || kind.endsWith("+json")) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      throw new ResearchResourceExtractionError("malformed_json", "resource JSON is malformed", {
        cause: error,
      });
    }
    return {
      normalizedBytes: encodeBounded(canonicalJson(parsed), limits.maxNormalizedBytes),
      normalizedMediaType: "application/json",
      normalizationReceipt: { ...RESEARCH_EXTRACTOR_VERSIONS.json },
    };
  }
  throw new ResearchResourceExtractionError("unsupported_media", "resource media type is unsupported");
}
