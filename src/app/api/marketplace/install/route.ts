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

async function catalogHasPlugin(id: string): Promise<boolean> {
  try {
    const raw = JSON.parse(await readFile(path.join(MARKETPLACE_DIR, "marketplace.json"), "utf8"));
    const plugins = raw && Array.isArray(raw.plugins) ? raw.plugins : [];
    return plugins.some((p: { name?: string }) => p.name === id);
  } catch {
    return false;
  }
}

async function pluginVersion(id: string): Promise<string> {
  try {
    const m = JSON.parse(
      await readFile(path.join(MARKETPLACE_DIR, "plugins", id, "plugin.json"), "utf8"),
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
  if (!id || !(await catalogHasPlugin(id))) {
    return NextResponse.json({ ok: false, error: `unknown plugin "${id}"` }, { status: 400 });
  }
  const installedAt = await installMarketplacePlugin(id, await pluginVersion(id), "catalog");
  return NextResponse.json({ ok: true, installedAt });
}
