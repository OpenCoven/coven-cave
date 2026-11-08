import { NextResponse } from "next/server";
import { rejectNonLocalRequest } from "@/lib/server/api-security";
import {
  deleteRetainedSubmissions,
  exportRetainedSubmissions,
  summarizeRetainedSubmissions,
} from "@/lib/server/opencoven-submissions-retained";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Saved submissions, reachable whether or not the optional implementation is in
 * this build (#6400). GET summarizes, `?download=1` returns the file's exact
 * bytes, and DELETE needs an explicit `?confirm=delete`.
 */
function unreadable() {
  return NextResponse.json({ ok: false, error: "Saved submissions couldn't be read." }, { status: 500 });
}

export async function GET(req: Request) {
  const forbidden = rejectNonLocalRequest(req);
  if (forbidden) return forbidden;
  try {
    if (new URL(req.url).searchParams.get("download") !== "1") {
      return NextResponse.json({ ok: true, ...(await summarizeRetainedSubmissions()) });
    }
    const raw = await exportRetainedSubmissions();
    if (raw === null) return NextResponse.json({ ok: false, error: "No saved submissions." }, { status: 404 });
    return new Response(raw, {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": 'attachment; filename="opencoven-submissions.json"',
        "cache-control": "no-store",
      },
    });
  } catch {
    return unreadable();
  }
}

export async function DELETE(req: Request) {
  const forbidden = rejectNonLocalRequest(req);
  if (forbidden) return forbidden;
  if (new URL(req.url).searchParams.get("confirm") !== "delete") {
    return NextResponse.json({ ok: false, error: "Deleting needs confirm=delete." }, { status: 400 });
  }
  try {
    return NextResponse.json({ ok: true, deleted: await deleteRetainedSubmissions() });
  } catch {
    return NextResponse.json({ ok: false, error: "Saved submissions couldn't be deleted." }, { status: 500 });
  }
}
