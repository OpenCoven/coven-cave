import { NextResponse } from "next/server";
import {
  createCard,
  loadBoard,
  type CardPriority,
  type CardStatus,
} from "@/lib/cave-board";
import type { CardGitHubLink } from "@/lib/cave-board-types";
import type { ChatAttachment } from "@/lib/chat-attachments";
import { trustedProjectCwd } from "@/lib/cave-projects";

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
    attachments?: ChatAttachment[];
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json body" }, { status: 400 });
  }
  if (!body.title || !body.title.trim()) {
    return NextResponse.json({ ok: false, error: "title required" }, { status: 400 });
  }
  // A card assigned to a project derives its cwd from that project server-side —
  // never from the client body, which could contradict the project (cave-pw83).
  let cwd = body.cwd ?? null;
  if (body.projectId) {
    const resolved = await trustedProjectCwd(body.projectId);
    if (!resolved.ok) {
      return NextResponse.json({ ok: false, error: "assigned project not found" }, { status: 409 });
    }
    cwd = resolved.root;
  }
  const card = await createCard({
    title: body.title,
    notes: body.notes,
    status: body.status,
    priority: body.priority,
    familiarId: body.familiarId,
    sessionId: body.sessionId,
    cwd,
    projectId: body.projectId,
    links: body.links,
    github: body.github,
    labels: body.labels,
    startDate: body.startDate,
    endDate: body.endDate,
    template: body.template,
    steps: body.steps,
    attachments: body.attachments,
  });
  return NextResponse.json({ ok: true, card });
}
