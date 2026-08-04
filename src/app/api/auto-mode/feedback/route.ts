import { NextResponse } from "next/server";
import {
  buildPreferenceDigest,
  getMissionFeedback,
  recordMissionFeedback,
} from "@/lib/auto-mode-preferences";
import { isLocalOrigin } from "@/lib/server/local-origin";

export const dynamic = "force-dynamic";

/**
 * `/auto` mission feedback endpoint. GET returns the learned-preference
 * digest for a familiar (folded into the next mission's directive by the
 * client — see buildAutoModeDirective). POST records one completion
 * questionnaire answer (rating + liked/disliked/freeform).
 */

export async function GET(req: Request) {
  const url = new URL(req.url);
  const familiarId = url.searchParams.get("familiarId");
  if (!familiarId) {
    return NextResponse.json({ ok: false, error: "familiarId required" }, { status: 400 });
  }
  const entries = await getMissionFeedback(familiarId);
  return NextResponse.json({ ok: true, digest: buildPreferenceDigest(entries), count: entries.length });
}

export async function POST(req: Request) {
  if (!isLocalOrigin(req)) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }
  let body: {
    familiarId?: string;
    mission?: string;
    rating?: number;
    liked?: string;
    disliked?: string;
    freeform?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json body" }, { status: 400 });
  }
  if (!body.familiarId || !body.familiarId.trim()) {
    return NextResponse.json({ ok: false, error: "familiarId required" }, { status: 400 });
  }
  if (!body.mission || !body.mission.trim()) {
    return NextResponse.json({ ok: false, error: "mission required" }, { status: 400 });
  }
  const rating = Number(body.rating);
  if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
    return NextResponse.json({ ok: false, error: "rating must be 1-5" }, { status: 400 });
  }
  const entry = await recordMissionFeedback({
    familiarId: body.familiarId,
    mission: body.mission,
    rating,
    liked: body.liked,
    disliked: body.disliked,
    freeform: body.freeform,
  });
  return NextResponse.json({ ok: true, entry });
}
