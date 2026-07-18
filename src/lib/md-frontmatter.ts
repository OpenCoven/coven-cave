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

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

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
