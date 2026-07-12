/**
 * Pure SKILL.md composition for the Marketplace Build tab — shared by the
 * client (live preview) and the server writer (src/lib/server/skill-build.ts),
 * so the previewed text and the written file are the same artifact. No node
 * imports: this module must stay client-safe.
 *
 * The frontmatter grammar targets the app's own scanner
 * (src/lib/server/skill-scan.ts): single-line `key: value` pairs and
 * dash-list `tags:` entries.
 */

export const MAX_SKILL_NAME_CHARS = 80;
export const MAX_SKILL_DESCRIPTION_CHARS = 500;
export const MAX_SKILL_INSTRUCTIONS_BYTES = 64 * 1024;
const MAX_SLUG_CHARS = 64;
const MAX_TAGS = 12;
const SAFE_TAG_RE = /^[A-Za-z0-9][A-Za-z0-9 ._-]*$/;

export const SKILL_BUILD_ROOTS = [
  { id: "coven", label: "Coven shared", pathHint: "~/.coven/skills" },
  { id: "claude", label: "Claude Code", pathHint: "~/.claude/skills" },
  { id: "codex", label: "Codex", pathHint: "~/.codex/skills" },
  { id: "agents", label: "Shared agents", pathHint: "~/.agents/skills" },
] as const;

export type SkillBuildRootId = (typeof SKILL_BUILD_ROOTS)[number]["id"];

export type SkillBuildDraft = {
  name: string;
  description: string;
  instructions: string;
  tags?: string[];
};

/** Directory-name id for a skill: lowercase kebab, `[a-z0-9-]` only. */
export function slugifySkillName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG_CHARS)
    .replace(/-+$/, "");
}

// Frontmatter values are single-line in the scanner's `key: value` grammar —
// collapse whitespace/newlines and swap double quotes (its regex treats them
// as delimiters) for singles.
function frontmatterValue(value: string): string {
  return value.replace(/\s+/g, " ").replace(/"/g, "'").trim();
}

export function normalizedSkillTags(tags: readonly string[] | undefined): string[] {
  if (!tags) return [];
  const out: string[] = [];
  for (const raw of tags) {
    const tag = raw.trim();
    if (!tag || !SAFE_TAG_RE.test(tag) || out.includes(tag)) continue;
    out.push(tag);
    if (out.length >= MAX_TAGS) break;
  }
  return out;
}

/** The exact SKILL.md text a build writes — also drives the live preview. */
export function composeSkillMd(draft: SkillBuildDraft): string {
  const lines = [
    "---",
    `name: ${frontmatterValue(draft.name)}`,
    `description: ${frontmatterValue(draft.description)}`,
    "version: 0.1.0",
  ];
  const tags = normalizedSkillTags(draft.tags);
  if (tags.length > 0) {
    lines.push("tags:");
    for (const tag of tags) lines.push(`  - ${tag}`);
  }
  lines.push("---", "");
  const body = draft.instructions.replace(/\r\n/g, "\n").trim();
  return `${lines.join("\n")}\n${body}\n`;
}
