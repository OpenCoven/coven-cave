export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { loadConfig, saveConfig } from "@/lib/cave-config";

const ALLOWED_TOP_LEVEL_KEYS = new Set(["addons", "defaults", "familiars", "roles", "marketplace", "multiHost"]);

export async function GET() {
  try {
    const config = await loadConfig();
    return NextResponse.json({ ok: true, config });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "failed to load config" },
      { status: 500 },
    );
  }
}

export async function PATCH(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }

  // Reject unknown top-level keys
  for (const key of Object.keys(body)) {
    if (!ALLOWED_TOP_LEVEL_KEYS.has(key)) {
      return NextResponse.json(
        { ok: false, error: `unknown config key: ${key}` },
        { status: 400 },
      );
    }
  }

  try {
    const updated = await saveConfig(body as Parameters<typeof saveConfig>[0]);
    return NextResponse.json({ ok: true, config: updated });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "failed to save config" },
      { status: 500 },
    );
  }
}
