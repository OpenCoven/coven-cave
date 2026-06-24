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

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MARKETPLACE_DIR = path.join(process.cwd(), "marketplace");

/**
 * Resolve the user-provided id to the matching catalog entry's OWN name string
 * (sourced from the trusted marketplace.json, not the request). Returns null
 * when the id is not in the catalog. Downstream filesystem paths are built from
 * this file-derived name — the request value only selects from the allowlist,
 * it never constructs a path (avoids js/path-injection).
 */
async function resolveCatalogName(id: string): Promise<string | null> {
  try {
    const raw = JSON.parse(await readFile(path.join(MARKETPLACE_DIR, "marketplace.json"), "utf8"));
    const plugins = raw && Array.isArray(raw.plugins) ? raw.plugins : [];
    const match = plugins.find((p: { name?: string }) => p.name === id);
    return match && typeof match.name === "string" ? match.name : null;
  } catch {
    return null;
  }
}

async function pluginVersion(name: string): Promise<string> {
  try {
    const m = JSON.parse(
      await readFile(path.join(MARKETPLACE_DIR, "plugins", name, "plugin.json"), "utf8"),
    );
    return typeof m?.version === "string" ? m.version : "0.0.0";
  } catch {
    return "0.0.0";
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
  const name = id ? await resolveCatalogName(id) : null;
  if (!name) {
    return NextResponse.json({ ok: false, error: `unknown plugin "${id}"` }, { status: 400 });
  }
  const installedAt = await installMarketplacePlugin(name, await pluginVersion(name), "catalog");
  return NextResponse.json({ ok: true, installedAt });
}
