import { NextResponse } from "next/server";
import { bindingFor, loadConfig, recordSessionFamiliar, setSessionTitle } from "@/lib/cave-config";
import { loadBoard, updateCard } from "@/lib/cave-board";
import { callDaemon, extractDaemonError } from "@/lib/coven-daemon";
import { buildInitialTaskChatPrompt } from "@/lib/task-chat-context";
import { readJsonBody, rejectNonLocalRequest } from "@/lib/server/api-security";
import { isAllowedHarness, MAX_SESSION_JSON_BYTES, normalizeProjectRoot } from "@/lib/server/session-security";

// Match the daemon's "harness X is not a supported harness" rejection
// from `/api/v1/sessions`. The daemon emits this when the requested
// harness isn't registered for daemon-managed sessions (e.g. `openclaw`
// and `hermes` today, which ship as their own CLI flows in chat/send
// but don't yet have a daemon session adapter). Surfacing a friendly
// 409 here saves the user from staring at "daemon http 400" with no
// idea what to do.
const UNSUPPORTED_HARNESS_RE = /not a supported harness/i;

export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const forbidden = rejectNonLocalRequest(req);
  if (forbidden) return forbidden;

  const { id } = await params;
  const parsed = await readJsonBody<{ familiarId?: string | null; projectRoot?: string | null }>(
    req,
    MAX_SESSION_JSON_BYTES,
  );
  if (!parsed.ok) return parsed.response;
  const body = parsed.body;

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

  const projectRoot = normalizeProjectRoot(body.projectRoot);
  if (!projectRoot) {
    return NextResponse.json({ ok: false, error: "invalid project root" }, { status: 400 });
  }

  const config = await loadConfig();
  const binding = bindingFor(config, familiarId);
  if (!isAllowedHarness(binding.harness)) {
    return NextResponse.json({ ok: false, error: "unsupported harness" }, { status: 400 });
  }
  const res = await callDaemon<{ id: string; status: string }>({
    method: "POST",
    path: "/api/v1/sessions",
    body: {
      projectRoot,
      harness: binding.harness,
      prompt: buildInitialTaskChatPrompt(card),
    },
    timeoutMs: 8000,
  });

  if (!res.ok || !res.data?.id) {
    const daemonMsg = extractDaemonError(res);
    // Unsupported-harness errors aren't outages — they're a
    // misconfiguration: the card is assigned to a familiar whose
    // harness this daemon doesn't run as a task session. Return a 409
    // with a message that tells the user what to do, instead of a 502
    // that reads as "the daemon is broken".
    if (daemonMsg && UNSUPPORTED_HARNESS_RE.test(daemonMsg)) {
      return NextResponse.json(
        {
          ok: false,
          error: `This familiar uses the '${binding.harness}' harness, which the daemon doesn't start as a task session. Reassign the card to a familiar with a daemon-supported harness, or use the regular Chat surface (daemon detail: ${daemonMsg}).`,
        },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { ok: false, error: daemonMsg ?? res.error ?? `daemon http ${res.status}` },
      { status: 502 },
    );
  }

  const sessionId = res.data.id;
  // Persist a start-time CWD onto the card so the next chat (and the
  // board inspector) see it.
  const updated = await updateCard(card.id, {
    sessionId,
    familiarId,
    ...(!card.cwd && body.projectRoot ? { cwd: body.projectRoot } : {}),
  });
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
