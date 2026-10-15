/**
 * GET /api/marketplace/pack-prompts?id=<pluginId>
 *
 * Prompt-pack previews for the marketplace detail pane (cave-1f9h). Resolves
 * the id against the catalog allowlist (shared resolveCatalogName — the id
 * only SELECTS an entry, the path is built from the entry's own name), then
 * scans marketplace/plugins/<name>/prompts and returns each template's full
 * metadata + body so the client can render real cards and a "Try it".
 *
 * Read-only and works pre-install (the pack files ship in the repo; install is
 * track-only). Not a mutation, so no local-origin gate.
 */

import { NextResponse } from "next/server";
import path from "node:path";
import { resolveCatalogName } from "@/lib/server/marketplace-catalog-resolve";
import { ensureMarketplacePlugin } from "@/lib/server/marketplace-payload";
import { scanPromptsDir } from "@/lib/server/prompt-scan";
import type { PromptOption } from "@/lib/slash-prompt";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id") ?? "";
  const name = await resolveCatalogName(id);
  if (!name) {
    return NextResponse.json({ ok: false, error: `unknown plugin "${id}"` }, { status: 400 });
  }
  const prompts: PromptOption[] = [];
  try {
    await scanPromptsDir(path.join(await ensureMarketplacePlugin(name), "prompts"), `pack:${name}`, prompts);
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Could not load plugin payload" }, { status: 503 });
  }
  return NextResponse.json({ ok: true, prompts });
}
