/**
 * Image blocks — the `<coven:image …>` marker protocol that lets a familiar
 * put pictures in the transcript and have consecutive ones collapse into ONE
 * carousel instead of a ragged wall of `![](…)` markdown.
 *
 * Same piggyback model as github-blocks/skill-blocks: agents embed
 * self-closing markers in the turn text; the transcript strips them at render
 * and mounts a card at the marker's position.
 *
 *   <coven:image src="https://…/a.png" alt="Home, dark" caption="Before" />
 *   <coven:image src="/api/chat/attachment?id=…" alt="Home, light" />
 *
 * Two markers merge into one carousel when they are ADJACENT (only whitespace
 * between them) or when they carry the same `group="…"` id — the group form
 * lets a familiar interleave prose and still land every shot in one deck,
 * which is the whole reason the attribute exists.
 *
 * Pure and JSX-free (node --test); the React card lives in
 * src/components/image-carousel.tsx.
 */

import { markdownCodeRanges } from "./github-blocks.ts";

/** One picture in a deck. */
export type ImageBlockDescriptor = {
  /** Validated by {@link isRenderableImageSrc} before it ever reaches an <img>. */
  src: string;
  /** Accessible name. Falls back to the caption, then a positional label. */
  alt?: string;
  /** Short line rendered under the picture. */
  caption?: string;
};

/** A deck of one or more pictures rendered by a single carousel card. */
export type ImageCarouselDescriptor = {
  images: ImageBlockDescriptor[];
  /** The `group="…"` id that merged these, when they were merged by group. */
  group?: string;
};

/** One ordered piece of a prose span after image extraction. */
export type ImageTextPiece =
  | { kind: "text"; text: string }
  | { kind: "carousel"; carousel: ImageCarouselDescriptor };

/**
 * Hard cap per deck. A carousel is a browsing affordance, not a dump: past
 * this the DOM cost stops buying anything, so extra markers are dropped rather
 * than mounting an unbounded slide track.
 */
export const MAX_CAROUSEL_IMAGES = 24;

// Attribute values must be double-quoted. Besides keeping a `>` in a caption
// atomic, this makes a quote-edge malformed marker fail the strict match so the
// recovery path can remove only that marker instead of swallowing later prose.
const MARKER_RE = /<coven:image\b((?:\s+[a-zA-Z-]+="[^"]*")*)\s*\/>/g;
const ATTR_RE = /([a-zA-Z-]+)="([^"]*)"/g;

function parseAttrs(raw: string): Record<string, string> | null {
  const out: Record<string, string> = {};
  let m: RegExpExecArray | null;
  ATTR_RE.lastIndex = 0;
  while ((m = ATTR_RE.exec(raw)) !== null) {
    // A model-generated duplicate is ambiguous (and browsers use different
    // duplicate-attribute handling), so fail closed rather than choosing one.
    if (Object.hasOwn(out, m[1])) return null;
    out[m[1]] = m[2];
  }
  return out;
}

/**
 * Sources we are willing to hand a native `<img>`:
 *
 * - `https:` — remote pictures (generated images, docs, avatars).
 * - `data:image/…` — inline payloads the turn already carries.
 * - `blob:` — object URLs minted in-process.
 * - same-origin `/api/chat/attachment` — the attachment store, fetched through
 *   {@link file://src/lib/authed-image.ts} so the packaged sidecar's auth gate
 *   is satisfied.
 *
 * Everything else is refused — `javascript:`, `vbscript:`, `file:`, bare
 * `http:`, protocol-relative `//host/…`, and anything with control characters.
 * Marker text is model output, so this is a security barrier, not a nicety:
 * an unvalidated `src` is a script-execution and local-file-read surface.
 */
export function isRenderableImageSrc(src: string | null | undefined): boolean {
  if (!src) return false;
  // Control characters (incl. a smuggled newline/tab inside `java\nscript:`)
  // are never legitimate here. Check the raw attribute before trimming so a
  // leading or trailing newline/tab cannot be normalized into an allowed URL.
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(src)) return false;
  const value = src.trim();
  if (value.startsWith("//")) return false;
  // Model output must not be allowed to turn image rendering into an
  // authenticated GET to an arbitrary API route. Only the read-only image
  // endpoint used by persisted chat attachments is safe here.
  if (/^\/api\/chat\/attachment(?:[?#]|$)/.test(value)) return true;
  if (/^\/api\//.test(value)) return false;
  if (value.startsWith("blob:")) return true;
  // `image/svg+xml` is deliberately absent: an inline SVG can carry script, and
  // nothing here can render it inert.
  if (/^data:image\/(png|jpeg|jpg|gif|webp|avif);base64,/i.test(value)) return true;
  if (/^https:\/\/[^/\s]+/i.test(value)) {
    // A relative `/api/...` is refused above, but the same route reached as an
    // absolute same-origin URL would slip through this arm -- and
    // `needsAuthedImageFetch` turns any same-origin `/api/*` into an
    // authenticated GET, which is the exact capability the relative check
    // exists to deny. This module also runs where no origin is known (SSR,
    // unit tests), so rather than compare origins we refuse every `https:`
    // URL whose path enters `/api/` unless it is the attachment endpoint.
    // Losing third-party hosts that happen to serve pictures under `/api/` is
    // a far cheaper trade than leaving the bypass open.
    let pathname: string;
    try {
      pathname = new URL(value).pathname;
    } catch {
      return false;
    }
    if (/^\/api\/chat\/attachment$/.test(pathname)) return true;
    return !pathname.startsWith("/api/");
  }
  return false;
}

/** Descriptor from a marker's attributes; null when malformed or unsafe. */
function imageFromAttrs(attrs: Record<string, string>): ImageBlockDescriptor | null {
  const rawSrc = attrs.src;
  if (!isRenderableImageSrc(rawSrc)) return null;
  const src = rawSrc.trim();
  const alt = attrs.alt?.trim() || undefined;
  const caption = attrs.caption?.trim() || undefined;
  return { src: src as string, alt, caption };
}

/** The accessible name for a slide — explicit alt, else caption, else position. */
export function imageLabel(image: ImageBlockDescriptor, index: number, total: number): string {
  return image.alt || image.caption || `Image ${index + 1} of ${total}`;
}

/** Stable React key for a deck (its ordered sources). */
export function imageCarouselKey(carousel: ImageCarouselDescriptor): string {
  return carousel.group ? `group:${carousel.group}` : carousel.images.map((i) => i.src).join("|");
}

/** Return the next UNQUOTED `>` at/after `from`, or `-1` — quote-aware so a
 *  `>` inside a caption does not read as a tag close. */
function findUnquotedGt(s: string, from: number): number {
  let inQuote = false;
  for (let i = from; i < s.length; i++) {
    const c = s[i];
    if (c === '"') {
      if (inQuote) {
        inQuote = false;
      } else {
        let before = i - 1;
        while (before >= from && /\s/.test(s[before])) before--;
        // An arbitrary quote in an already-malformed tag is not an attribute
        // delimiter. Only an `=` can open a value quote; otherwise a bad
        // `<coven:image" ...>` prefix would hide every later valid marker.
        inQuote = s[before] === "=";
      }
    }
    else if (c === ">" && !inQuote) return i;
  }
  return -1;
}

function inRanges(ranges: Array<[number, number]>, index: number): boolean {
  return ranges.some(([start, end]) => index >= start && index < end);
}

/**
 * Remove malformed image-marker fragments the strict parser cannot consume.
 * A malformed prefix can otherwise survive beside a later valid marker, making
 * the segmented renderer expose model protocol text. Complete, quote-valid
 * markers and fenced examples remain untouched for their respective callers.
 */
function stripMalformedImageMarkerFragments(text: string): string {
  if (!text || !text.includes("<coven:i")) return text;
  const codeRanges = markdownCodeRanges(text);
  let out = "";
  let cursor = 0;
  let start = text.indexOf("<coven:i");

  while (start !== -1) {
    if (inRanges(codeRanges, start)) {
      start = text.indexOf("<coven:i", start + "<coven:i".length);
      continue;
    }

    MARKER_RE.lastIndex = start;
    const complete = MARKER_RE.exec(text);
    MARKER_RE.lastIndex = 0;
    if (complete?.index === start) {
      start = text.indexOf("<coven:i", start + complete[0].length);
      continue;
    }

    const name = /^<coven:i[a-z]*/.exec(text.slice(start))?.[0] ?? "";
    if (!("<coven:image".startsWith(name) || name.startsWith("<coven:image"))) {
      start = text.indexOf("<coven:i", start + "<coven:i".length);
      continue;
    }

    // This is not a complete, quote-valid marker, so the next unquoted close
    // is only a recovery boundary. Dropping it fail-closed is safer than showing a
    // malformed protocol tag (or its unsafe attributes) in the transcript.
    const end = findUnquotedGt(text, start);
    // Do not use a closing `>` from an example as this marker's recovery
    // boundary. A malformed marker before a fenced example must disappear
    // without consuming that literal example (or any later real marker).
    const protectedRange = codeRanges.find(
      ([rangeStart]) => rangeStart > start && (end === -1 || rangeStart < end),
    );
    out += text.slice(cursor, start);
    if (protectedRange) {
      // Keep the line break that makes a fenced block a fenced block; without
      // it, removing the malformed text would turn the example into ordinary
      // prose on the next parsing pass.
      let protectedStart = protectedRange[0];
      if (text[protectedStart - 1] === "\n") {
        protectedStart -= 1;
        if (text[protectedStart - 1] === "\r") protectedStart -= 1;
      }
      cursor = protectedStart;
      start = text.indexOf("<coven:i", protectedRange[1]);
      continue;
    }
    if (end === -1) return out;
    cursor = end + 1;
    start = text.indexOf("<coven:i", cursor);
  }

  return out + text.slice(cursor);
}

/**
 * The protocol is self-closing, so a closing image marker is always malformed.
 * Remove it outside fences as well as its malformed opening tag; otherwise a
 * model can leave `</coven:image>` behind as visible transcript protocol text.
 */
function stripImageClosingTags(text: string): string {
  if (!text || !text.includes("</coven:image")) return text;
  const codeRanges = markdownCodeRanges(text);
  let out = "";
  let cursor = 0;
  let start = text.indexOf("</coven:image");

  while (start !== -1) {
    if (inRanges(codeRanges, start)) {
      start = text.indexOf("</coven:image", start + "</coven:image".length);
      continue;
    }
    const afterName = text[start + "</coven:image".length] ?? "";
    if (afterName && !/[\s>]/.test(afterName)) {
      start = text.indexOf("</coven:image", start + "</coven:image".length);
      continue;
    }
    const end = findUnquotedGt(text, start);
    out += text.slice(cursor, start);
    if (end === -1) return out;
    cursor = end + 1;
    start = text.indexOf("</coven:image", cursor);
  }

  return out + text.slice(cursor);
}

/**
 * Split one prose span into ordered text/carousel pieces. Adjacent markers
 * (whitespace-only between them) collapse into one deck; markers sharing a
 * `group` id join that group's deck wherever it was opened. Fenced markers
 * stay literal example text. Malformed or unsafe markers are dropped silently
 * — never rendered as raw tags.
 *
 * Returns `[{kind:"text", text}]` unchanged when there is nothing to extract,
 * so callers can cheaply detect "no images".
 */
export function sliceImageBlocks(text: string): ImageTextPiece[] {
  // A generation can end with an incomplete marker. Treat that tail exactly as
  // the streaming path does so a sibling GitHub/artifact block cannot make the
  // segmented settled renderer expose raw model protocol text.
  const visibleText = stripImageClosingTags(stripMalformedImageMarkerFragments(stripIncompleteImageMarker(text)));
  if (!visibleText || !visibleText.includes("<coven:image")) return [{ kind: "text", text: visibleText }];

  const codeRanges = markdownCodeRanges(visibleText);
  const pieces: ImageTextPiece[] = [];
  const byGroup = new Map<string, ImageCarouselDescriptor>();
  let cursor = 0;
  /** The deck a whitespace-adjacent marker would extend, if any. */
  let openRun: ImageCarouselDescriptor | null = null;

  const pushText = (chunk: string) => {
    if (chunk) pieces.push({ kind: "text", text: chunk });
  };

  MARKER_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = MARKER_RE.exec(visibleText)) !== null) {
    if (inRanges(codeRanges, m.index)) continue;
    const between = visibleText.slice(cursor, m.index);
    const attrs = parseAttrs(m[1] ?? "");
    const image = attrs ? imageFromAttrs(attrs) : null;
    const group = attrs?.group?.trim() || undefined;
    cursor = m.index + m[0].length;

    if (!image) {
      // Drop the tag, keep the prose around it, and close any open run so a
      // rejected marker never silently welds two unrelated decks together.
      pushText(between);
      openRun = null;
      continue;
    }

    const existingGroup = group ? byGroup.get(group) : undefined;
    // Whitespace-only prose between two markers means the author wrote them as
    // one deck. Group wins over adjacency: an explicit id is the author saying
    // exactly where this shot belongs.
    const adjacent: ImageCarouselDescriptor | null =
      openRun && between.trim() === "" ? openRun : null;
    // A marker that names a different group starts (or rejoins) that group
    // even when it happens to be adjacent to another deck. Otherwise two
    // explicitly independent groups would be welded together by whitespace.
    const target: ImageCarouselDescriptor | null = group ? existingGroup ?? null : adjacent;

    if (target) {
      // Adjacency swallows the whitespace it merged across; a group merge
      // happens across real prose, which still renders in place.
      if (target !== adjacent) pushText(between);
      if (target.images.length < MAX_CAROUSEL_IMAGES) target.images.push(image);
      openRun = target;
      continue;
    }

    pushText(between);
    const carousel: ImageCarouselDescriptor = { images: [image], group };
    if (group) byGroup.set(group, carousel);
    pieces.push({ kind: "carousel", carousel });
    openRun = carousel;
  }

  pushText(visibleText.slice(cursor));

  const out = pieces.filter((p) => p.kind === "text" || p.carousel.images.length > 0);
  return out.length ? out : [{ kind: "text", text: "" }];
}

/**
 * Remove complete image markers (outside code fences) plus an unterminated
 * tail — the streaming path, so raw tags never flash before the turn settles.
 */
export function stripImageMarkers(text: string): string {
  if (!text || !text.includes("<coven:i")) return text;
  const codeRanges = markdownCodeRanges(text);
  MARKER_RE.lastIndex = 0;
  const out = text.replace(MARKER_RE, (m, _attrs, index: number) =>
    inRanges(codeRanges, index) ? m : "",
  );
  return stripImageClosingTags(stripMalformedImageMarkerFragments(stripIncompleteImageMarker(out)));
}

/** Remove only an unterminated marker tail, preserving complete markers for
 *  callers that still need to turn them into cards. */
export function stripIncompleteImageMarker(text: string): string {
  if (!text || !text.includes("<coven:i")) return text;
  const tail = text.lastIndexOf("<coven:i");
  if (tail !== -1 && findUnquotedGt(text, tail) === -1 && !inRanges(markdownCodeRanges(text), tail)) {
    const frag = text.slice(tail);
    const name = "<coven:image";
    const afterName = frag.slice(name.length, name.length + 1);
    if (
      name.startsWith(frag.slice(0, name.length)) &&
      (!afterName || /[\s/>]/.test(afterName))
    ) {
      return text.slice(0, tail);
    }
  }
  return text;
}
