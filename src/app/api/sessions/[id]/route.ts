import { NextResponse } from "next/server";
import { rejectNonLocalRequest } from "@/lib/server/api-security";
import {
  archiveSessionLocal,
  sacrificeSessionLocal,
  setSessionTitle,
  summonSessionLocal,
} from "@/lib/cave-config";

/** Validate session ID: only alphanum, hyphens, colons, dots — no path traversal. */
function isValidSessionId(id: string): boolean {
  return /^[A-Za-z0-9:._-]{1,256}$/.test(id);
}

export const dynamic = "force-dynamic";

type PatchBody = {
  /** New display title. Empty string clears the override. */
  title?: string;
  /** true → archive, false → summon (unarchive). */
  archived?: boolean;
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

  const result: {
    ok: true;
    title?: string | null;
    archivedAt?: string | null;
  } = { ok: true };

  if (typeof body.title === "string") {
    const next = await setSessionTitle(id, body.title);
    result.title = next;
  }

  if (typeof body.archived === "boolean") {
    if (body.archived) {
      result.archivedAt = await archiveSessionLocal(id);
    } else {
      await summonSessionLocal(id);
      result.archivedAt = null;
    }
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
