import { NextResponse } from "next/server";
import { rejectNonLocalRequest } from "@/lib/server/api-security";
import { isValidSessionId } from "@/lib/server/session-id";
import {
  archiveSessionLocal,
  extendSessionAutoArchiveLocal,
  loadState,
  sacrificeSessionLocal,
  setSessionKeepLocal,
  setSessionPinnedLocal,
  setSessionTitle,
  setSessionTitleAutoIfOwned,
  summonSessionLocal,
} from "@/lib/cave-config";
import {
  defaultChatTitleForSession,
  MAX_CHAT_TITLE_LENGTH,
} from "@/lib/cave-chat-titles";
import { clampExtendDays, extendUntilIso } from "@/lib/chat-auto-archive";
import { resolveArchiveNudges } from "@/lib/task-archive-nudge-emit";

export const dynamic = "force-dynamic";

type PatchBody = {
  /** New display title. Empty string clears the override. */
  title?: string;
  /** Automatic title writes use atomic ownership checks; omitted means manual. */
  titleOwnership?: "auto";
  /** Titles the automatic caller observed as defaults before generating. */
  autoDefaults?: string[];
  /** true → archive, false → summon (unarchive). */
  archived?: boolean;
  /** true → mark keep (never auto-archived), false → clear the mark. */
  keep?: boolean;
  /** true → pin to the top of chat lists, false → unpin. */
  pinned?: boolean;
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
  if (
    body.titleOwnership !== undefined &&
    (body.titleOwnership !== "auto" || typeof body.title !== "string")
  ) {
    return NextResponse.json(
      { ok: false, error: 'titleOwnership must be "auto" and include a title' },
      { status: 400 },
    );
  }

  const result: {
    ok: true;
    title?: string | null;
    titleUpdated?: boolean;
    archivedAt?: string | null;
    keep?: boolean;
    pinned?: boolean;
    extendedUntil?: string;
  } = { ok: true };

  if (typeof body.title === "string") {
    if (body.titleOwnership === "auto") {
      if (
        body.autoDefaults !== undefined &&
        (
          !Array.isArray(body.autoDefaults) ||
          body.autoDefaults.length > 4 ||
          body.autoDefaults.some(
            (value) => typeof value !== "string" || value.trim().length > MAX_CHAT_TITLE_LENGTH,
          )
        )
      ) {
        return NextResponse.json(
          { ok: false, error: "autoDefaults must contain at most 4 session titles" },
          { status: 400 },
        );
      }
      if (!body.title.trim()) {
        return NextResponse.json(
          { ok: false, error: "automatic title must not be empty" },
          { status: 400 },
        );
      }

      const state = await loadState();
      const current = state.sessionTitles[id];
      const observedDefaults = new Set(
        (body.autoDefaults ?? []).map((value) => value.trim()).filter(Boolean),
      );
      // Never pass arbitrary client strings into the ownership gate. The
      // canonical default is always safe; an observed title is admitted only
      // when it still equals the server's current override (compare-and-set).
      const safeDefaults = new Set([defaultChatTitleForSession(id)]);
      if (current && observedDefaults.has(current)) safeDefaults.add(current);

      const next = await setSessionTitleAutoIfOwned(id, body.title, safeDefaults);
      result.titleUpdated = next !== null;
      result.title = next ?? (await loadState()).sessionTitles[id] ?? null;
    } else {
      const next = await setSessionTitle(id, body.title);
      result.title = next;
      result.titleUpdated = true;
    }
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

  if (typeof body.pinned === "boolean") {
    result.pinned = await setSessionPinnedLocal(id, body.pinned);
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
