/**
 * POST /api/marketplace/install  { id }
 *
 * Validates the plugin id against the generated catalog, then records a
 * track-only install in cave-config via installMarketplacePlugin. Does not
 * collect secrets or perform runtime wiring (v0).
 */

import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { installMarketplacePlugin } from "@/lib/cave-config";
import { resolveCatalogPlugin } from "@/lib/server/marketplace-catalog-resolve";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MARKETPLACE_DIR = path.join(process.cwd(), "marketplace");

async function pluginManifest(name: string): Promise<{ version: string; kind?: string }> {
  try {
    const m = JSON.parse(
      await readFile(path.join(MARKETPLACE_DIR, "plugins", name, "plugin.json"), "utf8"),
    );
    return {
      version: typeof m?.version === "string" ? m.version : "0.0.0",
      ...(typeof m?.kind === "string" ? { kind: m.kind } : {}),
    };
  } catch {
    return { version: "0.0.0" };
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
  const catalogPlugin = id ? await resolveCatalogPlugin(id) : null;
  if (!catalogPlugin) {
    return NextResponse.json({ ok: false, error: `unknown plugin "${id}"` }, { status: 400 });
  }
  if (catalogPlugin.kind === "craft") {
    return NextResponse.json(
      { ok: false, error: "Crafts require a verified Codex installation", code: "craft_transaction_required" },
      { status: 409 },
    );
  }
  const name = catalogPlugin.name;
  const manifest = await pluginManifest(name);
  if (manifest.kind === "craft") {
    return NextResponse.json(
      { ok: false, error: "Crafts require a verified Codex installation", code: "craft_transaction_required" },
      { status: 409 },
    );
  }
  const installedAt = await installMarketplacePlugin(name, manifest.version, "catalog");
  return NextResponse.json({ ok: true, installedAt });
}
