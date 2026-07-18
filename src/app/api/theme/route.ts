import { NextResponse } from "next/server";

import { PreferencesValidationError } from "@/lib/preferences-schema";
import { readJsonBody } from "@/lib/server/api-security";
import { PreferencesConflictError } from "@/lib/server/preferences-store";
import {
  loadTheme,
  saveTheme,
  themeSnapshotFromPreferences,
  type ThemeSaveInput,
} from "@/lib/server/theme-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_THEME_BODY_BYTES = 256 * 1024;

export async function GET() {
  try {
    const theme = await loadTheme();
    return NextResponse.json({ ok: true, theme }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "failed to load theme" },
      { status: 500 },
    );
  }
}

export async function PUT(req: Request) {
  const parsed = await readJsonBody<ThemeSaveInput>(req, MAX_THEME_BODY_BYTES);
  if (!parsed.ok) return parsed.response;
  const body = parsed.body;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ ok: false, error: "invalid json body" }, { status: 400 });
  }
  if (body.tokenOnly !== true && typeof body.themeId !== "string") {
    return NextResponse.json({ ok: false, error: "themeId required" }, { status: 400 });
  }

  try {
    const theme = await saveTheme(body);
    return NextResponse.json({ ok: true, theme }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof PreferencesConflictError) {
      return NextResponse.json(
        {
          ok: false,
          error: error.message,
          theme: themeSnapshotFromPreferences(error.current),
        },
        { status: 409 },
      );
    }
    if (error instanceof PreferencesValidationError || error instanceof TypeError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
    }
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "failed to save theme" },
      { status: 500 },
    );
  }
}
