import { NextResponse } from "next/server.js";
import { readJsonBody, rejectNonLocalRequest } from "../../../lib/server/api-security.ts";
import { createResearchLegacyImporter } from "../../../lib/server/research-automation-import.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Explicit, selected-source import only. Preview returns the exact metadata,
 * resolved timezone and paused target for review; apply accepts only that plan. */
export async function POST(req: Request) {
  const forbidden = rejectNonLocalRequest(req);
  if (forbidden) return forbidden;
  const parsed = await readJsonBody<unknown>(req, 4096);
  if (!parsed.ok) return parsed.response;
  const body = parsed.body;
  if (!body || typeof body !== "object" || Array.isArray(body) || !("action" in body)) {
    return NextResponse.json({ ok: false, error: "invalid-import-request" }, { status: 400 });
  }
  try {
    const importer = createResearchLegacyImporter();
    if (body.action === "preview" && Object.keys(body).every(key => ["action", "id", "missionId", "timezone"].includes(key))
      && "id" in body && typeof body.id === "string" && "missionId" in body && typeof body.missionId === "string"
      && "timezone" in body && typeof body.timezone === "string") {
      return NextResponse.json({ ok: true, plan: await importer.preview(body.id, body.missionId, body.timezone) }, { headers: { "Cache-Control": "no-store" } });
    }
    if (body.action === "apply" && Object.keys(body).every(key => ["action", "planId"].includes(key)) && "planId" in body && typeof body.planId === "string") {
      return NextResponse.json({ ok: true, automation: await importer.apply(body.planId) }, { headers: { "Cache-Control": "no-store" } });
    }
    return NextResponse.json({ ok: false, error: "invalid-import-request" }, { status: 400 });
  } catch (error) {
    // A transport failure may follow adoption. Keep the saved plan and retry
    // it unchanged; do not claim rollback or invent a replacement identity.
    const detail = error instanceof Error && error.message.startsWith("Research legacy import refused:") ? error.message : "Import not confirmed. Retry the same saved plan after checking the daemon and source.";
    return NextResponse.json({ ok: false, error: detail }, { status: 409, headers: { "Cache-Control": "no-store" } });
  }
}
