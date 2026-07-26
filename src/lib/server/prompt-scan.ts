import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { parseFrontmatter, parseListField } from "./skill-scan";
import type { PromptOption } from "../slash-prompt";

/**
 * Flat prompt-template scanner. A template is a single .md file — YAML
 * frontmatter (name, description, optional icon/tags) plus a body that is
 * dropped into the composer verbatim. Used by /api/prompts for the user's
 * ~/.coven/prompts directory and for installed marketplace prompt packs
 * (marketplace/plugins/<id>/prompts/). Reuses the SKILL.md frontmatter parser.
 */

export type PromptSource = PromptOption["source"];

export async function scanPromptsDir(
  dir: string,
  source: PromptSource,
  out: PromptOption[],
): Promise<void> {
  let files: string[] = [];
  try {
    const dirents = await readdir(dir, { withFileTypes: true });
    files = dirents
      .filter((e) => (e.isFile() || e.isSymbolicLink()) && e.name.endsWith(".md"))
      .map((e) => e.name)
      .sort();
  } catch {
    return;
  }

  for (const file of files) {
    try {
      const text = await readFile(path.join(dir, file), "utf8");
      const fm = parseFrontmatter(text);
      // Body = everything after the frontmatter block; a template with no body
      // has nothing to insert, so it is skipped rather than served empty.
      const body = text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "").trim();
      if (!body) continue;
      const id = path.basename(file, ".md");
      const tags = parseListField(text, "tags");
      out.push({
        id,
        name: fm.name ?? id,
        description: fm.description,
        icon: fm.icon,
        tags: tags.length ? tags : undefined,
        body,
        source,
        path: path.join(dir, file),
      });
    } catch {
      continue;
    }
  }
}

/** Merge template lists by id — user files override packs, packs override
 *  built-ins — so a user can retune a shipped template without forking it. */
export function mergePrompts(
  builtin: PromptOption[],
  user: PromptOption[],
  packs: PromptOption[] = [],
): PromptOption[] {
  const byId = new Map<string, PromptOption>();
  for (const p of builtin) byId.set(p.id, p);
  for (const p of packs) byId.set(p.id, p);
  for (const p of user) byId.set(p.id, p);
  return [...byId.values()];
}
