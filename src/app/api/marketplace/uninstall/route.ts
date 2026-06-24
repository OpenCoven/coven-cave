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
  await uninstallMarketplacePlugin(id);
  return NextResponse.json({ ok: true });
}
