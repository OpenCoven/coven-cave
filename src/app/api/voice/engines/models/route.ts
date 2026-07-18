import { NextResponse } from "next/server.js";
import { removeSpeechModel } from "../../../../../lib/voice/speech-models.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(req: Request) {
  let body: { modelId?: string };
  try { body = await req.json(); } catch {
    return NextResponse.json({ ok: false, error: "invalid json body" }, { status: 400 });
  }
  const modelId = typeof body.modelId === "string" ? body.modelId.trim() : "";
  if (!modelId) return NextResponse.json({ ok: false, error: "missing_modelId" }, { status: 400 });
  const result = await removeSpeechModel(modelId);
  if (result === "unknown_model") return NextResponse.json({ ok: false, error: result }, { status: 404 });
  return NextResponse.json({ ok: true, status: result });
}
