import { NextResponse } from "next/server";
import { isLocalOrigin } from "@/lib/server/local-origin";
import {
  loadPrefs,
  MUTABLE_KINDS,
  patchPrefs,
  toggleMute,
  toggleMuteKind,
  type MutableKind,
  type SoundMode,
} from "@/lib/cave-inbox-prefs";

export const dynamic = "force-dynamic";

export async function GET() {
  const prefs = await loadPrefs();
  return NextResponse.json({ ok: true, prefs });
}

export async function PATCH(req: Request) {
  if (!isLocalOrigin(req)) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }
  let body: {
    mutedFamiliars?: string[];
    mutedKinds?: MutableKind[];
    sound?: { mode?: SoundMode; name?: string };
    toggleMuteFor?: string;
    toggleMuteKind?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json body" }, { status: 400 });
  }
  if (body.toggleMuteFor) {
    const prefs = await toggleMute(body.toggleMuteFor);
    return NextResponse.json({ ok: true, prefs });
  }
  if (body.toggleMuteKind) {
    if (!(MUTABLE_KINDS as readonly string[]).includes(body.toggleMuteKind)) {
      return NextResponse.json(
        { ok: false, error: `kind must be one of: ${MUTABLE_KINDS.join(", ")}` },
        { status: 400 },
      );
    }
    const prefs = await toggleMuteKind(body.toggleMuteKind as MutableKind);
    return NextResponse.json({ ok: true, prefs });
  }
  const sound =
    body.sound && body.sound.mode
      ? { mode: body.sound.mode, name: body.sound.name }
      : undefined;
  const prefs = await patchPrefs({
    mutedFamiliars: body.mutedFamiliars,
    mutedKinds: body.mutedKinds,
    sound,
  });
  return NextResponse.json({ ok: true, prefs });
}
