import { NextResponse } from "next/server";
import { rejectNonLocalRequest } from "@/lib/server/api-security";
import { isValidSessionId } from "@/lib/server/session-id";
import {
  archiveSessionLocal,
  extendSessionAutoArchiveLocal,
  sacrificeSessionLocal,
  setSessionKeepLocal,
  setSessionTitle,
  summonSessionLocal,
} from "@/lib/cave-config";
import { clampExtendDays, extendUntilIso } from "@/lib/chat-auto-archive";
import { resolveArchiveNudges } from "@/lib/task-archive-nudge-emit";

export const dynamic = "force-dynamic";

type PatchBody = {
  /** New display title. Empty string clears the override. */
  title?: string;
  /** true → archive, false → summon (unarchive). */
  archived?: boolean;
  /** true → mark keep (never auto-archived), false → clear the mark. */
  keep?: boolean;
  /** Push the auto-archive deadline out by N days from now (1–365). */
  extendDays?: number;
};

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const forbidden = rejectNonLocalRequest(req);
  if (forbidden) return forbidden;

  const { id } = await params;
  if (!id || !isValidSessionId(id)) {
    return NextResponse.json({ ok: false, error: "invalid session id" }, { status: 400 });
  }

  let body: PatchBody;
  try {
    body = (await req.json()) as PatchBody;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json body" }, { status: 400 });
  }

  // Validate before applying any mutation so a bad extendDays doesn't land a
  // partial patch.
  const extendDays = body.extendDays !== undefined ? clampExtendDays(body.extendDays) : undefined;
  if (body.extendDays !== undefined && extendDays == null) {
    return NextResponse.json(
      { ok: false, error: "extendDays must be a number between 1 and 365" },
      { status: 400 },
    );
  }

  const result: {
    ok: true;
    title?: string | null;
    archivedAt?: string | null;
    keep?: boolean;
    extendedUntil?: string;
  } = { ok: true };

  if (typeof body.title === "string") {
    const next = await setSessionTitle(id, body.title);
    result.title = next;
  }

  if (typeof body.archived === "boolean") {
    if (body.archived) {
      result.archivedAt = await archiveSessionLocal(id);
      // Clear any "ready to archive" nudge now that the user has archived it.
      await resolveArchiveNudges(id);
    } else {
      await summonSessionLocal(id);
      result.archivedAt = null;
    }
  }

  if (typeof body.keep === "boolean") {
    result.keep = await setSessionKeepLocal(id, body.keep);
  }

  if (extendDays != null) {
    result.extendedUntil = await extendSessionAutoArchiveLocal(
      id,
      extendUntilIso(new Date(), extendDays),
    );
  }

  return NextResponse.json(result);
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const forbidden = rejectNonLocalRequest(req);
  if (forbidden) return forbidden;

  const { id } = await params;
  if (!id || !isValidSessionId(id)) {
    return NextResponse.json({ ok: false, error: "invalid session id" }, { status: 400 });
  }
  const sacrificedAt = await sacrificeSessionLocal(id);
  return NextResponse.json({ ok: true, sacrificedAt });
}
