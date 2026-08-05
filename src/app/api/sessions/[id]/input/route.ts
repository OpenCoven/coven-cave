import { NextResponse } from "next/server";
import { callDaemon } from "@/lib/coven-daemon";
import { resolveConversationSessionId } from "@/lib/cave-conversations";
import { isOwnedSession } from "@/lib/cave-config";
import { readJsonBody, rejectNonLocalRequest } from "@/lib/server/api-security";
import {
  boundedString,
  isValidSessionId,
  MAX_INPUT_CHARS,
  MAX_SESSION_JSON_BYTES,
} from "@/lib/server/session-security";

export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const forbidden = rejectNonLocalRequest(req);
  if (forbidden) return forbidden;

  const { id } = await params;
  if (!isValidSessionId(id)) {
    return NextResponse.json({ ok: false, error: "invalid session id" }, { status: 400 });
  }
  const resolved = await resolveConversationSessionId(id);
  if (resolved.sessionId === null) {
    return NextResponse.json(
      {
        ok: false,
        error: resolved.error === "ambiguous-replay-history"
          ? "replay history is ambiguous for this session id"
          : "replay history contains a cycle for this session id",
      },
      { status: 409 },
    );
  }
  const ownedSessionId = resolved.sessionId ?? id;
  if (!(await isOwnedSession(ownedSessionId))) {
    return NextResponse.json({ ok: false, error: "invalid session id" }, { status: 400 });
  }

  const parsed = await readJsonBody<{ text?: unknown }>(req, MAX_SESSION_JSON_BYTES);
  if (!parsed.ok) return parsed.response;
  const text = boundedString(parsed.body.text, MAX_INPUT_CHARS);
  if (!text) {
    return NextResponse.json({ ok: false, error: "text required" }, { status: 400 });
  }

  const res = await callDaemon({
    method: "POST",
    path: `/api/v1/sessions/${encodeURIComponent(id)}/input`,
    body: { text },
    timeoutMs: 4000,
  });

  if (!res.ok) {
    return NextResponse.json(
      { ok: false, error: res.error ?? `daemon http ${res.status}`, status: res.status, data: res.data },
      { status: 502 },
    );
  }
  return NextResponse.json({ ok: true });
}
