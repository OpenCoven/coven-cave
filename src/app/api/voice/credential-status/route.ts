import { getSecretStatus } from "../../../../lib/vault.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const VOICE_CREDENTIAL_KEYS = [
  "ELEVENLABS_API_KEY",
  "OPENAI_API_KEY",
] as const;

/** Return status metadata for the two Voice-owned credentials, never values. */
export async function GET() {
  try {
    return Response.json({
      ok: true,
      credentials: VOICE_CREDENTIAL_KEYS.map((key) => getSecretStatus(key)),
    });
  } catch {
    return Response.json(
      { ok: false, error: "voice credential status unavailable" },
      { status: 500 },
    );
  }
}
