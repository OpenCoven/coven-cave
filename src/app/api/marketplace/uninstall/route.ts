/**
 * POST /api/marketplace/uninstall  { id }
 *
 * Validates the plugin id against the generated catalog, then removes its
 * track-only install record from cave-config via uninstallMarketplacePlugin.
 */

import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { uninstallMarketplacePlugin } from "@/lib/cave-config";
import { sanitizeMarketplacePlugins, type MarketplaceJsonPlugin } from "@/lib/marketplace-catalog";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MARKETPLACE_DIR = path.join(process.cwd(), "marketplace");

async function catalogPlugin(id: string): Promise<MarketplaceJsonPlugin | null> {
  try {
    const raw = JSON.parse(await readFile(path.join(MARKETPLACE_DIR, "marketplace.json"), "utf8"));
    const plugins = sanitizeMarketplacePlugins(
      raw && Array.isArray(raw.plugins) ? (raw.plugins as MarketplaceJsonPlugin[]) : [],
    );
    return plugins.find((p: { name?: string }) => p.name === id) ?? null;
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  let body: { id?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }
  const id = typeof body?.id === "string" ? body.id : "";
  const plugin = id ? await catalogPlugin(id) : null;
  if (!plugin) {
    return NextResponse.json({ ok: false, error: `unknown plugin "${id}"` }, { status: 400 });
  }
  if (plugin.kind === "craft") {
    return NextResponse.json(
      { ok: false, error: "Crafts require verified Codex removal", code: "craft_transaction_required" },
      { status: 409 },
    );
  }
  await uninstallMarketplacePlugin(id);
  return NextResponse.json({ ok: true });
}
