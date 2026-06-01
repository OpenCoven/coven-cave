import { NextResponse } from "next/server";
import {
  patchEscalation,
  snoozePresetToTimestamp,
  type EscalationState,
  type SnoozePresetId,
  ESCALATION_STATES,
} from "@/lib/vals-inbox";

export const dynamic = "force-dynamic";

const VALID_PRESETS: SnoozePresetId[] = ["1h", "4h", "tomorrow", "thisWeek"];

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  let body: {
    state?: string;
    snoozePreset?: string;
    snoozeUntil?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json body" }, { status: 400 });
  }
  const state = body.state as EscalationState | undefined;
  if (state && !ESCALATION_STATES.includes(state)) {
    return NextResponse.json(
      { ok: false, error: `state must be one of: ${ESCALATION_STATES.join(", ")}` },
      { status: 400 },
    );
  }
  let snoozeUntil = body.snoozeUntil;
  if (body.snoozePreset) {
    if (!VALID_PRESETS.includes(body.snoozePreset as SnoozePresetId)) {
      return NextResponse.json(
        { ok: false, error: `snoozePreset must be one of: ${VALID_PRESETS.join(", ")}` },
        { status: 400 },
      );
    }
    snoozeUntil = snoozePresetToTimestamp(body.snoozePreset as SnoozePresetId);
  }
  try {
    const item = await patchEscalation(id, {
      state,
      snoozeUntil,
    });
    if (!item) {
      return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true, item });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "patch failed" },
      { status: 400 },
    );
  }
}
