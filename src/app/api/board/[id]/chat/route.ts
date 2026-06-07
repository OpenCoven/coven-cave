import { NextResponse } from "next/server";
import { bindingFor, loadConfig, recordSessionFamiliar, setSessionTitle } from "@/lib/cave-config";
import { loadBoard, updateCard } from "@/lib/cave-board";
import { callDaemon } from "@/lib/coven-daemon";
import { buildInitialTaskChatPrompt } from "@/lib/task-chat-context";

export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  let body: { familiarId?: string | null; projectRoot?: string | null } = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const board = await loadBoard();
  const card = board.cards.find((candidate) => candidate.id === id);
  if (!card) {
    return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  }

  const familiarId = card.familiarId ?? body.familiarId ?? null;
  if (!familiarId) {
    return NextResponse.json(
      { ok: false, error: "assign a familiar before starting a task chat" },
      { status: 409 },
    );
  }

  if (card.sessionId) {
    await recordSessionFamiliar(card.sessionId, familiarId);
    return NextResponse.json({
      ok: true,
      reused: true,
      card,
      sessionId: card.sessionId,
      familiarId,
    });
  }

  const config = await loadConfig();
  const binding = bindingFor(config, familiarId);
  const res = await callDaemon<{ id: string; status: string }>({
    method: "POST",
    path: "/api/v1/sessions",
    body: {
      projectRoot: body.projectRoot ?? process.cwd(),
      harness: binding.harness,
      prompt: buildInitialTaskChatPrompt(card),
    },
    timeoutMs: 8000,
  });

  if (!res.ok || !res.data?.id) {
    return NextResponse.json(
      { ok: false, error: res.error ?? `daemon http ${res.status}` },
      { status: 502 },
    );
  }

  const sessionId = res.data.id;
  const updated = await updateCard(card.id, { sessionId, familiarId });
  if (!updated) {
    return NextResponse.json({ ok: false, error: "card disappeared" }, { status: 404 });
  }
  await Promise.all([
    recordSessionFamiliar(sessionId, familiarId),
    setSessionTitle(sessionId, `Task: ${card.title.trim()}`),
  ]);

  return NextResponse.json({
    ok: true,
    reused: false,
    card: updated,
    sessionId,
    familiarId,
  });
}
