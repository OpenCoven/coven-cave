import { NextResponse } from "next/server";
import { callDaemon } from "@/lib/coven-daemon";
import { bindingFor, loadConfig, recordOwnedSession, recordSessionFamiliar } from "@/lib/cave-config";
import { readJsonBody, rejectNonLocalRequest } from "@/lib/server/api-security";
import {
  boundedInt,
  boundedString,
  isAllowedHarness,
  MAX_PROMPT_CHARS,
  MAX_SESSION_JSON_BYTES,
  normalizeProjectRoot,
} from "@/lib/server/session-security";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const forbidden = rejectNonLocalRequest(req);
  if (forbidden) return forbidden;

  const parsed = await readJsonBody<{
    projectRoot?: unknown;
    harness?: unknown;
    prompt?: unknown;
    cols?: unknown;
    rows?: unknown;
    familiarId?: unknown;
  }>(req, MAX_SESSION_JSON_BYTES);
  if (!parsed.ok) return parsed.response;
  const body = parsed.body;

  const projectRoot = normalizeProjectRoot(body.projectRoot);
  if (!projectRoot) {
    return NextResponse.json({ ok: false, error: "invalid project root" }, { status: 400 });
  }

  const familiarId = boundedString(body.familiarId, 128);
  if (familiarId === null) {
    return NextResponse.json({ ok: false, error: "invalid familiar id" }, { status: 400 });
  }

  const config = await loadConfig();
  const requestedHarness = boundedString(body.harness, 64);
  if (requestedHarness === null) {
    return NextResponse.json({ ok: false, error: "invalid harness" }, { status: 400 });
  }
  const binding = familiarId
    ? bindingFor(config, familiarId)
    : { harness: requestedHarness ?? "codex", model: config.defaults.model };
  if (requestedHarness !== undefined && familiarId && requestedHarness !== binding.harness) {
    return NextResponse.json({ ok: false, error: "invalid harness" }, { status: 400 });
  }
  const harness = binding.harness;
  if (!isAllowedHarness(harness)) {
    return NextResponse.json({ ok: false, error: "unsupported harness" }, { status: 400 });
  }

  const prompt = boundedString(body.prompt, MAX_PROMPT_CHARS);
  if (prompt === null) {
    return NextResponse.json({ ok: false, error: "invalid prompt" }, { status: 400 });
  }
  const cols = boundedInt(body.cols, 20, 500);
  const rows = boundedInt(body.rows, 5, 200);
  if (cols === null || rows === null) {
    return NextResponse.json({ ok: false, error: "invalid terminal size" }, { status: 400 });
  }

  const res = await callDaemon<{ id: string; status: string }>({
    method: "POST",
    path: "/api/v1/sessions",
    body: {
      projectRoot,
      harness,
      prompt,
      cols,
      rows,
    },
    timeoutMs: 8000,
  });

  if (!res.ok || !res.data) {
    return NextResponse.json(
      { ok: false, error: res.error ?? `daemon http ${res.status}` },
      { status: 502 },
    );
  }

  if (res.data.id) {
    if (familiarId) {
      await recordSessionFamiliar(res.data.id, familiarId);
    } else {
      await recordOwnedSession(res.data.id);
    }
  }

  return NextResponse.json({
    ok: true,
    session: res.data,
    binding: { harness, model: binding.model },
  });
}
