import { NextResponse } from "next/server";
import { archiveMemoryFile } from "@/lib/server/memory-trash";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body: { path?: string };
  try { body = await req.json(); } catch {
    return NextResponse.json({ ok: false, error: "invalid json body" }, { status: 400 });
  }
  if (!body.path) return NextResponse.json({ ok: false, error: "path required" }, { status: 400 });
  const result = await archiveMemoryFile(body.path);
  const status = result.ok
    ? 200
    : result.error.startsWith("protected") ? 409
    : result.error === "path not allowed" ? 403
    : 404;
  return NextResponse.json(result, { status });
}
