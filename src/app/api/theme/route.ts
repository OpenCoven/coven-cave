import { NextResponse } from "next/server";

import { loadTheme, saveTheme } from "@/lib/server/theme-store";

export const dynamic = "force-dynamic";

export async function GET() {
  const theme = await loadTheme();
  return NextResponse.json({ ok: true, theme });
}

export async function PUT(req: Request) {
  let body: { themeId?: unknown; mode?: unknown; tokens?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json body" }, { status: 400 });
  }
  if (!body || typeof body.themeId !== "string") {
    return NextResponse.json({ ok: false, error: "themeId required" }, { status: 400 });
  }
  const theme = await saveTheme(body);
  return NextResponse.json({ ok: true, theme });
}
