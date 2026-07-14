/**
 * GET /api/skills/templates — the Build tab's template gallery
 * (docs/authoring-assist.md §1, cave-6ptj).
 *
 * Merges three sources by id (`user > pack > built-in`, the /api/prompts
 * precedence):
 *  1. built-in kinds (src/lib/skill-templates.ts)
 *  2. installed marketplace packs' `skill-templates/*.md` (same file shape as
 *     prompt templates; emitted by scripts/sync-marketplace.py from a
 *     catalog entry's `skillTemplates` array)
 *  3. the user's own ~/.coven/skill-templates/*.md
 *
 * Read-only, no mutation → no local-origin gate (mirrors GET /api/prompts).
 */

import { NextResponse } from "next/server";
import path from "node:path";
import { covenHome } from "@/lib/coven-paths";
import { loadConfig } from "@/lib/cave-config";
import { scanPromptsDir } from "@/lib/server/prompt-scan";
import { SKILL_TEMPLATES, mergeSkillTemplates, type SkillTemplate } from "@/lib/skill-templates";
import type { PromptOption } from "@/lib/slash-prompt";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MARKETPLACE_PLUGINS_DIR = path.join(process.cwd(), "marketplace", "plugins");

function toSkillTemplate(option: PromptOption, source: SkillTemplate["source"]): SkillTemplate {
  return {
    id: option.id,
    name: option.name,
    description: option.description ?? "",
    tags: option.tags ?? [],
    instructions: option.body,
    source,
  };
}

export async function GET() {
  const user: PromptOption[] = [];
  await scanPromptsDir(path.join(covenHome(), "skill-templates"), "user", user);

  const packs: SkillTemplate[] = [];
  try {
    const cfg = await loadConfig();
    // Installed ids were validated against the catalog allowlist on install;
    // the shape guard keeps a hand-edited config from escaping the plugins dir.
    const installed = Object.keys(cfg.marketplace.installed).filter((id) => /^[\w.-]+$/.test(id));
    for (const id of installed) {
      const scanned: PromptOption[] = [];
      await scanPromptsDir(path.join(MARKETPLACE_PLUGINS_DIR, id, "skill-templates"), `pack:${id}`, scanned);
      for (const option of scanned) packs.push(toSkillTemplate(option, `pack:${id}`));
    }
  } catch {
    // Config unreadable → built-ins + user files still serve.
  }

  return NextResponse.json({
    ok: true,
    templates: mergeSkillTemplates(
      SKILL_TEMPLATES,
      packs,
      user.map((option) => toSkillTemplate(option, "user")),
    ),
  });
}
