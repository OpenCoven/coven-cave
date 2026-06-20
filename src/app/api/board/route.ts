import { NextResponse } from "next/server";
import {
  createCard,
  loadBoard,
  type CardPriority,
  type CardStatus,
} from "@/lib/cave-board";
import type { CardGitHubLink } from "@/lib/cave-board-types";

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
    projectId?: string | null;
    links?: string[];
    github?: CardGitHubLink[];
    labels?: string[];
    startDate?: string | null;
    endDate?: string | null;
    template?: string | null;
    steps?: { text: string }[];
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
    projectId: body.projectId,
    links: body.links,
    github: body.github,
    labels: body.labels,
    startDate: body.startDate,
    endDate: body.endDate,
    template: body.template,
    steps: body.steps,
  });
  return NextResponse.json({ ok: true, card });
}
