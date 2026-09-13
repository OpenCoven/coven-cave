import { NextResponse } from "next/server";

import { validateResearchMediaRenderConfig } from "@/lib/research-generations";
import { DEFAULT_ELEVENLABS_PODCAST_MODEL_ID, validateElevenLabsModelSettings } from "@/lib/voice/elevenlabs-shared";
import { readJsonBody, rejectNonLocalRequest } from "@/lib/server/api-security";
import {
  getResearchMediaReadiness,
  validateResearchMediaSelection,
} from "@/lib/server/research-media-readiness";
import {
  PODCAST_PREVIEW_TIMEOUT_MS,
  synthesizeResearchPodcastPreview,
  withPodcastAbort,
} from "@/lib/server/research-podcast-pipeline";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const headers = { "Cache-Control": "private, no-store" };
const allowedFields = new Set(["provider", "voice", "model", "voiceSettings", "seed"]);
let activePreviews = 0;

function failure(error: string, status: number) {
  return NextResponse.json({ ok: false, error }, { status, headers });
}

async function readPreviewBody(req: Request, signal: AbortSignal) {
  if (
    !req.headers.get("content-type")?.toLowerCase().startsWith("application/json") ||
    Number(req.headers.get("content-length")) > 4_096 || !req.body
  ) return readJsonBody<unknown>(req, 4_096);
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      signal.throwIfAborted();
      const { value, done } = await withPodcastAbort(reader.read(), signal);
      if (done) break;
      size += value.byteLength;
      if (size > 4_096) return { ok: false as const, response: failure("request body too large", 413) };
      chunks.push(value);
    }
    return await readJsonBody<unknown>(new Request(req, { body: Buffer.concat(chunks) }), 4_096);
  } finally {
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export async function POST(req: Request) {
  const forbidden = rejectNonLocalRequest(req);
  if (forbidden) return forbidden;
  const signal = AbortSignal.any([req.signal, AbortSignal.timeout(PODCAST_PREVIEW_TIMEOUT_MS)]);
  if (activePreviews >= 2) return failure("Two voice previews are already running. Wait for one to finish.", 429);
  activePreviews += 1;
  try {
    signal.throwIfAborted();
    const parsed = await readPreviewBody(req, signal);
    if (!parsed.ok) {
      parsed.response.headers.set("Cache-Control", headers["Cache-Control"]);
      return parsed.response;
    }
    if (
      !parsed.body || typeof parsed.body !== "object" || Array.isArray(parsed.body) ||
      Object.keys(parsed.body).some((key) => !allowedFields.has(key))
    ) {
      return failure("Preview accepts only provider, voice, model, voiceSettings, and seed. Preview text is fixed.", 400);
    }
    const validated = validateResearchMediaRenderConfig("podcast", { ...parsed.body, length: "brief" });
    if (!validated.ok) return failure(validated.error, 400);
    if (validated.value.provider === "elevenlabs") {
      const modelError = validateElevenLabsModelSettings(
        validated.value.model ?? DEFAULT_ELEVENLABS_PODCAST_MODEL_ID,
        validated.value.voiceSettings,
      );
      if (modelError) return failure(modelError, 400);
    }
    const readiness = await withPodcastAbort(getResearchMediaReadiness(), signal);
    signal.throwIfAborted();
    const selection = validateResearchMediaSelection("podcast", validated.value, readiness);
    if (!selection.ok) return failure(selection.error, 409);
    const bytes = await withPodcastAbort(synthesizeResearchPodcastPreview(validated.value, signal), signal);
    signal.throwIfAborted();
    return new Response(new Uint8Array(bytes), {
      headers: { ...headers, "Content-Type": "audio/wav", "Content-Length": String(bytes.byteLength) },
    });
  } catch {
    if (req.signal.aborted) return failure("Voice preview cancelled.", 499);
    if (signal.aborted) return failure("Voice preview timed out. Check the selected speech provider.", 504);
    // Provider errors can echo account data or credentials; never reflect them.
    return failure("Voice preview failed. Check the selected voice and provider settings. No alternate provider was used.", 502);
  } finally {
    activePreviews -= 1;
  }
}
