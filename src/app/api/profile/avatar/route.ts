export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import {
  deleteUserAvatarFile,
  readUserAvatarFile,
  writeUserAvatarFile,
} from "@/lib/server/user-avatar-file";

export async function GET(req: NextRequest) {
  const avatar = await readUserAvatarFile();
  if (!avatar) return new NextResponse(null, { status: 404 });
  const etag = `"${avatar.updatedAt}-${avatar.bytes.byteLength}"`;
  const headers = {
    "Content-Type": avatar.mime,
    "Cache-Control": "no-cache",
    ETag: etag,
  };
  if (req.headers.get("if-none-match") === etag) {
    return new NextResponse(null, { status: 304, headers });
  }
  return new NextResponse(new Uint8Array(avatar.bytes), { status: 200, headers });
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }
  if (!body || typeof body !== "object") {
    return NextResponse.json({ ok: false, error: "body must be an object" }, { status: 400 });
  }
  const { dataUrl, mime } = body as { dataUrl?: unknown; mime?: unknown };
  if (typeof dataUrl !== "string" || typeof mime !== "string") {
    return NextResponse.json({ ok: false, error: "dataUrl and mime are required" }, { status: 400 });
  }
  const res = await writeUserAvatarFile({ dataUrl, mime });
  if (!res.ok) return NextResponse.json({ ok: false, error: res.reason }, { status: 400 });
  const avatar = await readUserAvatarFile();
  return NextResponse.json({ ok: true, updatedAt: avatar?.updatedAt ?? null });
}

export async function DELETE() {
  await deleteUserAvatarFile();
  return NextResponse.json({ ok: true });
}
