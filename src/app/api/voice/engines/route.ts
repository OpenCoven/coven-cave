import { NextResponse } from "next/server.js";
import {
  selectableLocalTtsVoices,
  speechEnginesReadiness,
} from "../../../../lib/voice/speech-models.ts";
import {
  kokoroRuntimeAvailability,
  piperRuntimeAvailability,
} from "../../../../lib/voice/local-tts-server.ts";
import { whisperRuntimeAvailable } from "../../../../lib/voice/sidecar-whisper.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const [engines, piper, kokoro, whisperAvailable] = await Promise.all([
    speechEnginesReadiness(),
    piperRuntimeAvailability(),
    kokoroRuntimeAvailability(),
    whisperRuntimeAvailable(),
  ]);
  return NextResponse.json(
    {
      ...engines,
      // Selection catalog for voice pickers: expands named Kokoro speakers
      // that share the one downloaded bundle (cave-xopgb). Management
      // surfaces keep reading `tts`, which stays one row per download.
      ttsVoices: selectableLocalTtsVoices(engines.tts),
      runtimes: { piper, kokoro, whisper: { available: whisperAvailable } },
    },
    { headers: { "cache-control": "no-store" } },
  );
}
