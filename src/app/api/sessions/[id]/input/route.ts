import { NextResponse } from "next/server";
import { callDaemon } from "@/lib/coven-daemon";
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
  if (!isValidSessionId(id) || !(await isOwnedSession(id))) {
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
