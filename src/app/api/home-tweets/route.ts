import { NextResponse } from "next/server";
import { isLocalOrigin } from "@/lib/server/local-origin";
import { addTweet, listTweets, removeTweet } from "@/lib/server/home-tweets";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Home Tweets feed — a small user-curated list of X/Twitter post URLs to embed.
 *
 *   GET    /api/home-tweets             → { ok, items }
 *   POST   /api/home-tweets  { url }    → { ok, item }      (add; idempotent)
 *   DELETE /api/home-tweets?id=<id>     → { ok, deleted }
 *
 * URLs are validated to twitter.com/x.com post links before storage; writes are
 * gated to local-origin requests.
 */
export async function GET() {
  const items = await listTweets();
  return NextResponse.json({ ok: true, items });
}

export async function POST(req: Request) {
  if (!isLocalOrigin(req)) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }
  let body: { url?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }
  const url = typeof body.url === "string" ? body.url.trim() : "";
  if (!url) return NextResponse.json({ ok: false, error: "url required" }, { status: 400 });
  const result = await addTweet(url);
  if (!result.ok) return NextResponse.json(result, { status: 400 });
  return NextResponse.json(result);
}

export async function DELETE(req: Request) {
  if (!isLocalOrigin(req)) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }
  const id = new URL(req.url).searchParams.get("id")?.trim() ?? "";
  if (!id) return NextResponse.json({ ok: false, error: "id required" }, { status: 400 });
  const deleted = await removeTweet(id);
  return NextResponse.json({ ok: true, deleted });
}
