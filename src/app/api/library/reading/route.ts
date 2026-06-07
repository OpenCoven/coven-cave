import { NextRequest, NextResponse } from "next/server";
import { createLibraryStore } from "@/lib/library-store";
import type { LibraryReadingItem, ReadingStatus, LinkCapture } from "@/lib/library-types";

const store = createLibraryStore();

function generateId(): string {
  return `rd_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
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
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ ok: false, error: "id required" }, { status: 400 });

  const patch = await req.json() as Partial<LibraryReadingItem>;
  const items = await store.readReading();
  const idx = items.findIndex((i) => i.id === id);
  if (idx === -1) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });

  if (patch.status === "done" && items[idx].status !== "done") {
    patch.finishedAt = new Date().toISOString();
  }

  items[idx] = { ...items[idx], ...patch, id };
  try {
    await store.deleteById("reading", id);
    await store.appendReading(items[idx]);
  } catch { return NextResponse.json({ ok: false, error: "write failed" }, { status: 500 }); }
  return NextResponse.json({ ok: true, item: items[idx] });
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ ok: false, error: "id required" }, { status: 400 });
  try { await store.deleteById("reading", id); }
  catch { return NextResponse.json({ ok: false, error: "write failed" }, { status: 500 }); }
  return NextResponse.json({ ok: true });
}
