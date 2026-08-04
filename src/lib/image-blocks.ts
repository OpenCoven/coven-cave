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

// Attributes segment treats quoted strings as atomic so a `>` inside a quoted
// caption can't terminate the match early (same contract as coven:github).
const MARKER_RE = /<coven:image\b((?:[^">]|"[^"]*")*?)\/?>/g;
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
 * - same-origin `/api/…` — the attachment store, fetched through
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
  const value = src.trim();
  // Control characters (incl. a smuggled newline/tab inside `java\nscript:`)
  // are never legitimate here and defeat prefix checks.
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(value)) return false;
  if (value.startsWith("//")) return false;
  if (value.startsWith("/api/")) return true;
  if (value.startsWith("blob:")) return true;
  // `image/svg+xml` is deliberately absent: an inline SVG can carry script, and
  // nothing here can render it inert.
  if (/^data:image\/(png|jpeg|jpg|gif|webp|avif);base64,/i.test(value)) return true;
  if (/^https:\/\/[^/\s]+/i.test(value)) return true;
  return false;
}

/** Descriptor from a marker's attributes; null when malformed or unsafe. */
function imageFromAttrs(attrs: Record<string, string>): ImageBlockDescriptor | null {
  const src = attrs.src?.trim();
  if (!isRenderableImageSrc(src)) return null;
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

/** True when an UNQUOTED `>` exists at/after `from` — quote-aware so a `>`
 *  inside a still-open caption doesn't read as the tag close mid-stream. */
function hasUnquotedGt(s: string, from: number): boolean {
  let inQuote = false;
  for (let i = from; i < s.length; i++) {
    const c = s[i];
    if (c === '"') inQuote = !inQuote;
    else if (c === ">" && !inQuote) return true;
  }
  return false;
}

function inRanges(ranges: Array<[number, number]>, index: number): boolean {
  return ranges.some(([start, end]) => index >= start && index < end);
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
  if (!text || !text.includes("<coven:image")) return [{ kind: "text", text }];

  const codeRanges = markdownCodeRanges(text);
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
  while ((m = MARKER_RE.exec(text)) !== null) {
    if (inRanges(codeRanges, m.index)) continue;
    const between = text.slice(cursor, m.index);
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

  pushText(text.slice(cursor));

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
  return stripIncompleteImageMarker(out);
}

/** Remove only an unterminated marker tail, preserving complete markers for
 *  callers that still need to turn them into cards. */
export function stripIncompleteImageMarker(text: string): string {
  if (!text || !text.includes("<coven:i")) return text;
  const tail = text.lastIndexOf("<coven:i");
  if (tail !== -1 && !hasUnquotedGt(text, tail) && !inRanges(markdownCodeRanges(text), tail)) {
    const frag = text.slice(tail);
    if ("<coven:image".startsWith(frag.slice(0, "<coven:image".length))) {
      return text.slice(0, tail);
    }
  }
  return text;
}
