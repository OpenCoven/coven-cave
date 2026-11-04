import { NextResponse } from "next/server";
import { readJsonBody, rejectNonLocalRequest } from "@/lib/server/api-security";
import {
  applyLocalModelsSettingsPatch,
  clearLocalCodexProbeCache,
  readLocalModelsStatus,
} from "@/lib/server/local-codex-backends";
import { updateLocalModelSettings } from "@/lib/server/local-models-settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Settings → Local models (#6049). Any signed-in client can read which
// Ollama and LM Studio servers this machine's chats use and what they can
// run. Only a request from this computer can change them, because the
// address decides where prompts go.

const MAX_BODY_BYTES = 8_192;

export async function GET(req: Request) {
  const fresh = new URL(req.url).searchParams.get("fresh") === "1";
  const status = await readLocalModelsStatus({ editable: rejectNonLocalRequest(req) === null, fresh });
  return NextResponse.json(status, { headers: { "cache-control": "no-store" } });
}

export async function PUT(req: Request) {
  const rejected = rejectNonLocalRequest(req);
  if (rejected) return rejected;
  const body = await readJsonBody<unknown>(req, MAX_BODY_BYTES);
  if (!body.ok) return body.response;
  const outcome = await updateLocalModelSettings((current) => {
    const next = applyLocalModelsSettingsPatch(current, body.body);
    return { settings: next.ok ? next.settings : null, result: next };
  });
  if (!outcome.ok) {
    return NextResponse.json({ ok: false, error: outcome.error, ...(outcome.field ? { field: outcome.field } : {}) }, { status: 400 });
  }
  // A changed address must never answer from the previous server's cache.
  clearLocalCodexProbeCache();
  const status = await readLocalModelsStatus({ editable: true, settings: outcome.settings, fresh: true });
  return NextResponse.json(status, { headers: { "cache-control": "no-store" } });
}
