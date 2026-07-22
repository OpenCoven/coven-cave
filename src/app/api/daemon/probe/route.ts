import { NextResponse } from "next/server";
import { probeDaemonUrl } from "@/lib/server/daemon-probe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON body" }, { status: 400 });
  }
  const url = typeof body === "object" && body !== null && "url" in body
    ? String((body as { url?: unknown }).url ?? "").trim()
    : "";
  if (!url) return NextResponse.json({ ok: false, error: "invalid hub URL" }, { status: 400 });
  try {
    return NextResponse.json(await probeDaemonUrl(url));
  } catch {
    return NextResponse.json({ ok: false, error: "invalid hub URL" }, { status: 400 });
  }
}
