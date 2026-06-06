import { NextResponse } from "next/server";
import {
  createCard,
  loadBoard,
  type CardPriority,
  type CardStatus,
} from "@/lib/cave-board";

export const dynamic = "force-dynamic";

export async function GET() {
  const board = await loadBoard();
  return NextResponse.json({ ok: true, cards: board.cards });
}

export async function POST(req: Request) {
  let body: {
    title?: string;
    notes?: string;
    status?: CardStatus;
    priority?: CardPriority;
    familiarId?: string | null;
    sessionId?: string | null;
    cwd?: string | null;
    links?: string[];
    labels?: string[];
    template?: string | null;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json body" }, { status: 400 });
  }
  if (!body.title || !body.title.trim()) {
    return NextResponse.json({ ok: false, error: "title required" }, { status: 400 });
  }
  const card = await createCard({
    title: body.title,
    notes: body.notes,
    status: body.status,
    priority: body.priority,
    familiarId: body.familiarId,
    sessionId: body.sessionId,
    cwd: body.cwd,
    links: body.links,
    labels: body.labels,
    template: body.template,
  });
  return NextResponse.json({ ok: true, card });
}
