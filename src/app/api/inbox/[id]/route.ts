import { NextResponse } from "next/server";
import { isLocalOrigin } from "@/lib/server/local-origin";
import {
  deleteItem,
  updateItem,
  type InboxItem,
} from "@/lib/cave-inbox";
import {
  broadcastDeleted,
  broadcastUpdated,
  startScheduler,
} from "@/lib/inbox-scheduler";

export const dynamic = "force-dynamic";

startScheduler();

// Only the fields the UI legitimately edits — a raw pass-through let any local
// page rewrite kind/source/firedAt/machine-discriminator fields and persist
// shapes the scheduler can't handle.
const PATCHABLE_FIELDS = [
  "title", "body", "status", "fireAt", "snoozeUntil", "recurrence", "whenText", "familiarId", "link",
] as const;

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isLocalOrigin(req)) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }
  const { id } = await params;
  let raw: Record<string, unknown>;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json body" }, { status: 400 });
  }
  const body: Partial<Omit<InboxItem, "id" | "createdAt">> = {};
  for (const key of PATCHABLE_FIELDS) {
    if (!(key in raw)) continue;
    // whenText is free text persisted verbatim — reject non-string shapes so
    // a malformed client can't store an object/number on the item.
    if (key === "whenText" && raw.whenText !== null && typeof raw.whenText !== "string") {
      return NextResponse.json({ ok: false, error: "whenText must be a string or null" }, { status: 400 });
    }
    (body as Record<string, unknown>)[key] = raw[key];
  }
  const item = await updateItem(id, body);
  if (!item) {
    return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  }
  broadcastUpdated(item);
  return NextResponse.json({ ok: true, item });
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isLocalOrigin(req)) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }
  const { id } = await params;
  const ok = await deleteItem(id);
  if (!ok) {
    return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  }
  broadcastDeleted(id);
  return NextResponse.json({ ok: true });
}
