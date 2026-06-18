import { NextResponse } from "next/server";
import {
  createItem,
  loadInbox,
  type ItemKind,
  type ItemStatus,
  type InboxMedia,
  type LinkRef,
  type Recurrence,
} from "@/lib/cave-inbox";
import { broadcastCreated, startScheduler } from "@/lib/inbox-scheduler";

export const dynamic = "force-dynamic";

// Guarantee the scheduler is alive even if instrumentation.ts was bypassed.
startScheduler();

function isLocalOrigin(req: Request): boolean {
  const host = req.headers.get("host") ?? "";
  const bare = host.split(":")[0];
  return bare === "127.0.0.1" || bare === "localhost" || bare === "[::1]";
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const filter = url.searchParams.get("status") as ItemStatus | null;
  const file = await loadInbox();
  const items = filter
    ? file.items.filter((i) => i.status === filter)
    : file.items;
  return NextResponse.json({ ok: true, items });
}

export async function POST(req: Request) {
  if (!isLocalOrigin(req)) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }
  let body: {
    kind?: ItemKind;
    title?: string;
    body?: string;
    fireAt?: string | null;
    recurrence?: Recurrence;
    source?: "user" | "agent" | "system";
    familiarId?: string | null;
    sessionId?: string | null;
    link?: LinkRef | null;
    media?: InboxMedia | null;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json body" }, { status: 400 });
  }
  if (!body.title || !body.title.trim()) {
    return NextResponse.json({ ok: false, error: "title required" }, { status: 400 });
  }
  const kind: ItemKind = body.kind ?? "reminder";
  if (kind === "reminder" && !body.fireAt) {
    return NextResponse.json(
      { ok: false, error: "reminder requires fireAt" },
      { status: 400 },
    );
  }
  const item = await createItem({
    kind,
    title: body.title,
    body: body.body,
    fireAt: body.fireAt,
    recurrence: body.recurrence,
    source: body.source ?? (kind === "agent" ? "agent" : "user"),
    familiarId: body.familiarId,
    sessionId: body.sessionId,
    link: body.link,
    media: body.media,
  });
  broadcastCreated(item);
  return NextResponse.json({ ok: true, item });
}
