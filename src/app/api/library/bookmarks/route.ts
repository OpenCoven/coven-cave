import { NextRequest, NextResponse } from "next/server";
import { createLibraryStore } from "@/lib/library-store";
import { isSafeHttpUrl } from "@/lib/url-safety";
import type { LibraryBookmark, LinkCapture } from "@/lib/library-types";
import { enrichTitle, fallbackTitle } from "@/lib/title-enricher";

const store = createLibraryStore();

function domainFrom(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ""); }
  catch { return url; }
}

function generateId(): string {
  return `bm_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function syntheticId(item: Partial<LibraryBookmark>): string {
  let h = 0;
  const seed = `${item.url ?? ""}|${item.savedAt ?? ""}|${item.title ?? ""}`;
  for (let i = 0; i < seed.length; i++) h = ((h * 31) + seed.charCodeAt(i)) | 0;
  return `bm_legacy_${(h >>> 0).toString(36)}`;
}

export async function GET() {
  const raw = await store.readBookmarks();
  const items = raw
    .map((item) => ({
      ...item,
      id: item.id || syntheticId(item),
      savedAt: item.savedAt || new Date(0).toISOString(),
    }))
    .slice()
    .sort((a, b) => (a.savedAt < b.savedAt ? 1 : -1));
  return NextResponse.json({ ok: true, items });
}

export async function POST(req: NextRequest) {
  const body = await req.json() as {
    url: string;
    title?: string;
    notes?: string;
    tags?: string[];
    familiar?: string;
    capture?: LinkCapture;
  };
  if (!body.url) return NextResponse.json({ ok: false, error: "url required" }, { status: 400 });
  if (!isSafeHttpUrl(body.url)) return NextResponse.json({ ok: false, error: "http(s) url required" }, { status: 400 });

  const domain = domainFrom(body.url);
  let resolvedTitle = body.title;
  if (!resolvedTitle || resolvedTitle === domain) {
    const enriched = await enrichTitle(body.url);
    resolvedTitle = enriched?.title ?? fallbackTitle(body.url);
  }
  let favicon: string;
  try { favicon = `https://www.google.com/s2/favicons?domain=${new URL(body.url).hostname}&sz=32`; }
  catch { favicon = ""; }
  const item: LibraryBookmark = {
    id: generateId(),
    url: body.url,
    title: resolvedTitle,
    domain,
    favicon,
    notes: body.notes,
    tags: body.tags ?? [],
    savedAt: new Date().toISOString(),
    familiar: body.capture?.familiar ?? body.familiar ?? "unknown",
    capture: body.capture,
  };

  try { await store.appendBookmark(item); }
  catch { return NextResponse.json({ ok: false, error: "write failed" }, { status: 500 }); }
  return NextResponse.json({ ok: true, item });
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ ok: false, error: "id required" }, { status: 400 });
  try { await store.deleteById("bookmarks", id); }
  catch { return NextResponse.json({ ok: false, error: "write failed" }, { status: 500 }); }
  return NextResponse.json({ ok: true });
}
