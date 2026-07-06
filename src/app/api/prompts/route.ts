/**
 * GET /api/prompts
 *
 * Prompt templates for the chat composer's /prompt picker and the Prompt
 * snippets modal. Merges three sources by id (user > pack > builtin):
 *  1. built-in defaults (src/lib/prompt-defaults.ts)
 *  2. installed marketplace prompt packs (marketplace/plugins/<id>/prompts/) —
 *     install is track-only (cave-config marketplace.installed), so packs are
 *     resolved here at scan time rather than copied on install
 *  3. the user's own ~/.coven/prompts/*.md files
 * Read-only.
 */

import { NextResponse } from "next/server";
import path from "node:path";
import { covenHome } from "@/lib/coven-paths";
import { loadConfig } from "@/lib/cave-config";
import { BUILTIN_PROMPTS } from "@/lib/prompt-defaults";
import { mergePrompts, scanPromptsDir } from "@/lib/server/prompt-scan";
import type { PromptOption } from "@/lib/slash-prompt";

export const dynamic = "force-dynamic";

const MARKETPLACE_PLUGINS_DIR = path.join(process.cwd(), "marketplace", "plugins");

export async function GET() {
  const user: PromptOption[] = [];
  await scanPromptsDir(path.join(covenHome(), "prompts"), "user", user);

  const packs: PromptOption[] = [];
  try {
    const cfg = await loadConfig();
    // Installed ids were validated against the catalog allowlist on install;
    // the shape guard keeps a hand-edited config from escaping the plugins dir.
    const installed = Object.keys(cfg.marketplace.installed).filter((id) => /^[\w.-]+$/.test(id));
    await Promise.all(
      installed.map((id) =>
        scanPromptsDir(path.join(MARKETPLACE_PLUGINS_DIR, id, "prompts"), `pack:${id}`, packs),
      ),
    );
  } catch {
    // Config unreadable → built-ins + user files still serve.
  }

  return NextResponse.json({ ok: true, prompts: mergePrompts(BUILTIN_PROMPTS, user, packs) });
}
