import { NextResponse } from "next/server.js";
import { removeSpeechModel } from "../../../../../lib/voice/speech-models.ts";
import { JsonBodyTooLargeError, parseBoundedJsonBody } from "../../../../../lib/voice/bounded-json.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const MODEL_REQUEST_MAX_BYTES = 4_096;

export async function DELETE(req: Request) {
  let body: unknown;
  try {
    body = await parseBoundedJsonBody(req, MODEL_REQUEST_MAX_BYTES);
  } catch (error) {
    // Keep invalid JSON as an actionable client error while refusing oversized
    // chunked request bodies before Next can buffer them.
    return NextResponse.json(
      { ok: false, error: error instanceof JsonBodyTooLargeError ? "payload_too_large" : "invalid_json" },
      { status: error instanceof JsonBodyTooLargeError ? 413 : 400 },
    );
  }
  if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some((key) => key !== "modelId")) {
    return NextResponse.json({ ok: false, error: "invalid_request" }, { status: 400 });
  }
  const modelId = typeof (body as { modelId?: unknown }).modelId === "string"
    ? (body as { modelId: string }).modelId.trim()
    : "";
  if (!modelId) return NextResponse.json({ ok: false, error: "missing_modelId" }, { status: 400 });
  const result = await removeSpeechModel(modelId);
  if (result === "unknown_model") return NextResponse.json({ ok: false, error: result }, { status: 404 });
  return NextResponse.json({ ok: true, status: result });
}
