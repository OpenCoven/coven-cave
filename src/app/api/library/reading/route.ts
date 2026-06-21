import { NextRequest, NextResponse } from "next/server";
import { createLibraryStore } from "@/lib/library-store";
import { isSafeHttpUrl } from "@/lib/url-safety";
import type { LibraryReadingItem, ReadingStatus, LinkCapture } from "@/lib/library-types";

const store = createLibraryStore();
const READING_STATUSES: ReadingStatus[] = ["want-to-read", "reading", "done", "abandoned"];

function generateId(): string {
  return `rd_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function isReadingStatus(value: unknown): value is ReadingStatus {
  return typeof value === "string" && READING_STATUSES.includes(value as ReadingStatus);
}

export async function GET() {
  const items = (await store.readReading()).slice().sort((a, b) => (a.addedAt < b.addedAt ? 1 : -1));
  return NextResponse.json({ ok: true, items });
}

export async function POST(req: NextRequest) {
  const body = await req.json() as {
    title: string;
    url?: string;
    author?: string;
    sourceType?: LibraryReadingItem["sourceType"];
    status?: ReadingStatus;
    notes?: string;
    tags?: string[];
    familiar?: string;
    capture?: LinkCapture;
  };
  if (!body.title) return NextResponse.json({ ok: false, error: "title required" }, { status: 400 });
  if (body.url && !isSafeHttpUrl(body.url)) return NextResponse.json({ ok: false, error: "http(s) url required" }, { status: 400 });

  const item: LibraryReadingItem = {
    id: generateId(),
    title: body.title,
    url: body.url,
    author: body.author,
    sourceType: body.sourceType ?? "article",
    status: body.status ?? "want-to-read",
    notes: body.notes,
    tags: body.tags ?? [],
    addedAt: new Date().toISOString(),
    familiar: body.capture?.familiar ?? body.familiar ?? "unknown",
    capture: body.capture,
  };

  try { await store.appendReading(item); }
  catch { return NextResponse.json({ ok: false, error: "write failed" }, { status: 500 }); }
  return NextResponse.json({ ok: true, item });
}

export async function PATCH(req: NextRequest) {
  const body = await req.json() as {
    id?: string;
    status?: unknown;
    progress?: number;
  };
  if (!body.id) return NextResponse.json({ ok: false, error: "id required" }, { status: 400 });
  if (!isReadingStatus(body.status)) return NextResponse.json({ ok: false, error: "status required" }, { status: 400 });
  if (body.progress != null && (!Number.isFinite(body.progress) || body.progress < 0 || body.progress > 100)) {
    return NextResponse.json({ ok: false, error: "progress must be 0-100" }, { status: 400 });
  }

  try {
    const nextStatus = body.status as ReadingStatus;
    const item = await store.updateReading(body.id, (existing) => ({
      ...existing,
      status: nextStatus,
      progress: body.progress ?? existing.progress,
      // Stamp finishedAt when an item first becomes done; clear it whenever it
      // leaves done (so an un-marked item doesn't keep a stale completion date);
      // otherwise preserve the existing stamp.
      finishedAt:
        nextStatus !== "done"
          ? undefined
          : existing.status === "done"
            ? existing.finishedAt
            : new Date().toISOString(),
    }));
    if (!item) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
    return NextResponse.json({ ok: true, item });
  } catch { return NextResponse.json({ ok: false, error: "write failed" }, { status: 500 }); }
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ ok: false, error: "id required" }, { status: 400 });
  try { await store.deleteById("reading", id); }
  catch { return NextResponse.json({ ok: false, error: "write failed" }, { status: 500 }); }
  return NextResponse.json({ ok: true });
}
