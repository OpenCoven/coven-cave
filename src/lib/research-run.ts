/**
 * Pure helpers for the `/research` flow — turning a free-text topic into a
 * deep-research prompt and persisting the result as a Library document.
 *
 * The network/agent side lives in src/app/api/library/research/route.ts; this
 * module holds the deterministic, unit-tested pieces: prompt construction, slug
 * + filename derivation, and frontmatter assembly. The research output is
 * written into a familiar's `research/research/` collection so it shows up in
 * the Library next to hand-written synthesis docs.
 */

/** The subdirectory (under a familiar's research root) research runs land in. */
export const RESEARCH_COLLECTION_DIR = "research";

export function slugifyTopic(topic: string): string {
  const slug = topic
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  return slug || "untitled";
}

/** `2026-06-28-topic-slug.md` — date-prefixed so runs sort chronologically. */
export function researchDocFilename(topic: string, dateIso: string): string {
  const date = dateIso.slice(0, 10);
  return `${date}-${slugifyTopic(topic)}.md`;
}

/**
 * Build the instruction prompt handed to the familiar's agent. We ask for a
 * self-contained, well-structured markdown brief with sources — the same shape
 * as a research synthesis doc — and explicitly forbid frontmatter (we add our
 * own) so the body renders cleanly.
 */
export function buildResearchPrompt(topic: string): string {
  const clean = topic.trim();
  return [
    `You are conducting focused research and writing a synthesis brief on the following topic:`,
    ``,
    `"${clean}"`,
    ``,
    `Produce a thorough, well-organized markdown document that a knowledgeable reader could act on. Requirements:`,
    `- Open with a 2-3 sentence executive summary.`,
    `- Use clear "##" section headings (e.g. Background, Key findings, Trade-offs, Open questions).`,
    `- Be concrete and specific; prefer facts, mechanisms, and examples over generalities.`,
    `- Where you rely on a source or tool result, cite it inline with a markdown link.`,
    `- End with a "## Sources" section listing the references you used.`,
    ``,
    `Do NOT include a YAML frontmatter block and do NOT repeat the topic as a top-level "# " title — start directly with the summary. Write only the document.`,
  ].join("\n");
}

export type ResearchDocInput = {
  topic: string;
  body: string;
  familiar: string;
  dateIso: string;
};

/** Assemble the final document (frontmatter + body) written to disk. */
export function buildResearchDoc({ topic, body, familiar, dateIso }: ResearchDocInput): string {
  const title = topic.trim().replace(/\s+/g, " ");
  const safeTitle = title.replace(/"/g, "'");
  const frontmatter = [
    "---",
    `title: "${safeTitle}"`,
    `familiar: ${familiar}`,
    `date: ${dateIso.slice(0, 10)}`,
    `source: research`,
    `tags: research`,
    "---",
    "",
  ].join("\n");
  return `${frontmatter}# ${title}\n\n${body.trim()}\n`;
}

/** Validate + normalize a user-supplied topic; returns null when unusable. */
export function normalizeTopic(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  if (trimmed.length < 3 || trimmed.length > 500) return null;
  return trimmed;
}
