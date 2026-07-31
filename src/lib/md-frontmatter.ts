/**
 * Markdown frontmatter — parse/serialize the small YAML header used across
 * memory, knowledge, and other markdown docs.
 *
 * Shared by the MdEditor title/tags header and any surface that needs to
 * round-trip a document without disturbing frontmatter keys it doesn't own:
 * unknown keys are preserved verbatim through parse → update → serialize.
 */

import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

export type MdDocument = {
  /** True when the raw text began with a `---` frontmatter block. */
  hasFrontmatter: boolean;
  /** `title:` frontmatter value, when present and a non-empty string. */
  title: string | null;
  /** Normalized, deduped `tags:` list (array or comma/space separated string). */
  tags: string[];
  /** Every other frontmatter key, preserved for round-tripping. */
  rest: Record<string, unknown>;
  /** Document body without the frontmatter block. */
  body: string;
};

export type MdLeadingComments = {
  hiddenPrefix: string;
  visibleBody: string;
};

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

function isLineBreak(text: string, index: number): boolean {
  return text[index] === "\n" || (text[index] === "\r" && text[index + 1] === "\n");
}

function consumeLineBreak(text: string, index: number): number {
  if (text[index] === "\r" && text[index + 1] === "\n") return index + 2;
  if (text[index] === "\n") return index + 1;
  return index;
}

function consumeCompleteComment(text: string, index: number): number | null {
  let cursor = index;
  while (text[cursor] === " " || text[cursor] === "\t") cursor++;
  if (!text.startsWith("<!--", cursor)) return null;

  const close = text.indexOf("-->", cursor + 4);
  if (close === -1) return null;

  cursor = close + 3;
  let trail = cursor;
  while (text[trail] === " " || text[trail] === "\t") trail++;
  if (trail === text.length) return trail;
  if (isLineBreak(text, trail)) return consumeLineBreak(text, trail);
  return cursor;
}

export function normalizeMdTags(value: unknown): string[] {
  let tags: string[] = [];
  if (Array.isArray(value)) tags = value.map((t) => String(t).trim()).filter(Boolean);
  else if (typeof value === "string") {
    tags = value
      .split(/[,\s]+/)
      .map((t) => t.trim())
      .filter(Boolean);
  }
  // Dedupe (first occurrence wins): duplicate tags break React keys downstream.
  return [...new Set(tags)];
}

export function splitLeadingMdComments(body: string): MdLeadingComments {
  let cursor = 0;
  let hiddenEnd = 0;
  let sawComment = false;

  while (cursor < body.length) {
    let lineEnd = cursor;
    while (lineEnd < body.length && !isLineBreak(body, lineEnd)) lineEnd++;

    const line = body.slice(cursor, lineEnd);
    if (line.trim().length === 0) {
      const next = lineEnd < body.length ? consumeLineBreak(body, lineEnd) : lineEnd;
      if (!sawComment) {
        const commentEnd = consumeCompleteComment(body, next);
        if (commentEnd === null) return { hiddenPrefix: "", visibleBody: body };
      }
      cursor = next;
      hiddenEnd = cursor;
      continue;
    }

    const commentEnd = consumeCompleteComment(body, cursor);
    if (commentEnd === null) {
      if (!sawComment) return { hiddenPrefix: "", visibleBody: body };
      break;
    }

    sawComment = true;
    cursor = commentEnd;
    hiddenEnd = cursor;
  }

  return sawComment
    ? { hiddenPrefix: body.slice(0, hiddenEnd), visibleBody: body.slice(hiddenEnd) }
    : { hiddenPrefix: "", visibleBody: body };
}

export function joinLeadingMdComments(
  hiddenPrefix: string,
  visibleBody: string,
): string {
  return `${hiddenPrefix}${visibleBody}`;
}

/** Parse raw markdown (with optional YAML frontmatter) into an MdDocument.
 *  Malformed YAML degrades gracefully: the whole text becomes the body. */
export function parseMdDocument(raw: string): MdDocument {
  const match = raw.match(FRONTMATTER_RE);
  if (!match) {
    return { hasFrontmatter: false, title: null, tags: [], rest: {}, body: raw };
  }
  let front: Record<string, unknown> = {};
  try {
    const parsed = parseYaml(match[1]);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      front = parsed as Record<string, unknown>;
    } else {
      return { hasFrontmatter: false, title: null, tags: [], rest: {}, body: raw };
    }
  } catch {
    return { hasFrontmatter: false, title: null, tags: [], rest: {}, body: raw };
  }
  const { title, tags, ...rest } = front;
  return {
    hasFrontmatter: true,
    title: typeof title === "string" && title.trim() ? title.trim() : null,
    tags: normalizeMdTags(tags),
    rest,
    body: match[2] ?? "",
  };
}

/** Serialize an MdDocument back to raw markdown. Emits a frontmatter block
 *  only when there is something to say (title, tags, preserved keys, or the
 *  source doc already had one). Key order: title, tags, then preserved keys. */
export function serializeMdDocument(doc: MdDocument): string {
  const hasHeader =
    doc.hasFrontmatter || doc.title !== null || doc.tags.length > 0 || Object.keys(doc.rest).length > 0;
  if (!hasHeader) return doc.body;
  const front: Record<string, unknown> = {};
  if (doc.title !== null) front.title = doc.title;
  if (doc.tags.length > 0) front.tags = doc.tags;
  for (const [key, value] of Object.entries(doc.rest)) front[key] = value;
  const yaml = Object.keys(front).length > 0 ? stringifyYaml(front).trimEnd() : "";
  const body = doc.body.replace(/^\n/, "");
  return `---\n${yaml}\n---\n\n${body.trimEnd()}\n`;
}

/** Convenience: rewrite only title/tags on a raw doc, preserving everything else. */
export function updateMdDocumentHeader(
  raw: string,
  header: { title?: string | null; tags?: string[] },
): string {
  const doc = parseMdDocument(raw);
  if (header.title !== undefined) doc.title = header.title && header.title.trim() ? header.title.trim() : null;
  if (header.tags !== undefined) doc.tags = normalizeMdTags(header.tags);
  return serializeMdDocument(doc);
}
