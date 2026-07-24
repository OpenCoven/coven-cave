import { NextResponse } from "next/server.js";
import { speechEnginesReadiness } from "../../../../lib/voice/speech-models.ts";
import { piperRuntimeAvailability } from "../../../../lib/voice/local-tts-server.ts";
import { whisperRuntimeAvailable } from "../../../../lib/voice/sidecar-whisper.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const [engines, piper, whisperAvailable] = await Promise.all([
    speechEnginesReadiness(),
    piperRuntimeAvailability(),
    whisperRuntimeAvailable(),
  ]);
  return NextResponse.json({
    ...engines,
    runtimes: { piper, whisper: { available: whisperAvailable } },
  });
}
