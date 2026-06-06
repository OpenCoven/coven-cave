import { NextResponse } from "next/server";
import {
  deleteCard,
  updateCard,
  type CardLifecycle,
  type CardPriority,
  type CardStatus,
} from "@/lib/cave-board";

export const dynamic = "force-dynamic";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  let body: Partial<{
    title: string;
    notes: string;
    status: CardStatus;
    lifecycle: CardLifecycle;
    lifecycleReason: string | undefined;
    priority: CardPriority;
    familiarId: string | null;
    sessionId: string | null;
    cwd: string | null;
    links: string[];
    labels: string[];
    needsHuman: boolean;
    runningSince: string | undefined;
  }>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json body" }, { status: 400 });
  }
  const card = await updateCard(id, body);
  if (!card) {
    return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, card });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const ok = await deleteCard(id);
  if (!ok) {
    return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
