import { NextResponse } from "next/server";

import { rejectNonLocalRequest } from "@/lib/server/api-security";
import { readAutoresearchDocument } from "@/lib/server/research-autoloop";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_PATH_LENGTH = 4_096;

export async function GET(req: Request) {
  const forbidden = rejectNonLocalRequest(req);
  if (forbidden) return forbidden;

  const requestedPath = new URL(req.url).searchParams.get("path")?.trim() ?? "";
  if (!requestedPath || requestedPath.length > MAX_PATH_LENGTH) {
    return NextResponse.json({ ok: false, error: "path required" }, { status: 400 });
  }
  try {
    return NextResponse.json({
      ok: true,
      content: await readAutoresearchDocument(requestedPath),
    });
  } catch {
    return NextResponse.json(
      { ok: false, error: "document unavailable" },
      { status: 404 },
    );
  }
}
