/**
 * User prompt-template file serializer (cave-jg6k) — the write-side mirror of
 * prompt-scan.ts, in the exact shape scripts/sync-marketplace.py emits for
 * packs (frontmatter name/description/icon/tags + body). Round-trip safety is
 * pinned by the route test: serialize → scanPromptsDir must reproduce the
 * template.
 */

/** File-name/id slug. Also the ONLY path component the API ever accepts —
 *  the regex confines writes and deletes to direct children of
 *  ~/.coven/prompts (no separators, no dots, no traversal). */
export const PROMPT_SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** Derive a slug from a display name: lowercase, alphanumeric runs joined by
 *  single dashes, trimmed to 64 chars. Returns null when nothing survives.
 *  Dash-trimming is a linear scan, not an anchored `-+$` regex — the latter
 *  is a polynomial-ReDoS shape on all-dash input (flagged by CodeQL). */
export function promptSlug(name: string): string | null {
  const joined = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 64);
  let start = 0;
  let end = joined.length;
  while (start < end && joined[start] === "-") start += 1;
  while (end > start && joined[end - 1] === "-") end -= 1;
  const slug = joined.slice(start, end);
  return PROMPT_SLUG_RE.test(slug) ? slug : null;
}

/** Single-line frontmatter scalar: collapse every whitespace run (newlines
 *  included) to a single space so the value can't break the YAML block.
 *  `\s+` is linear — the earlier `\s*\r?\n\s*` overlapped and was a
 *  polynomial-ReDoS shape. */
function scalar(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/** Serialize a template to the .md shape prompt-scan.ts reads. Tags are
 *  filtered to non-empty single-line strings; the body is dropped in
 *  verbatim (it may itself contain {{placeholders}}). */
export function serializePromptTemplate({
  name,
  description,
  icon,
  tags,
  body,
}: {
  name: string;
  description?: string;
  icon?: string;
  tags?: string[];
  body: string;
}): string {
  const lines = ["---", `name: ${scalar(name)}`];
  if (description?.trim()) lines.push(`description: ${scalar(description)}`);
  if (icon?.trim()) lines.push(`icon: ${scalar(icon)}`);
  const cleanTags = (tags ?? []).map(scalar).filter(Boolean);
  if (cleanTags.length) {
    lines.push("tags:");
    for (const tag of cleanTags) lines.push(`  - ${tag}`);
  }
  lines.push("---", "", body.replace(/\r\n/g, "\n").trim(), "");
  return lines.join("\n");
}
