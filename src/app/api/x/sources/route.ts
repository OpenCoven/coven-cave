import { NextResponse } from "next/server";
import { MAX_X_JSON_BYTES, XApiError, type XScope } from "@/lib/x-api";
import { readJsonBody, rejectNonLocalRequest } from "@/lib/server/api-security";
import {
  requireXCapability,
  toXErrorResponse,
  withXAuthenticatedRead,
} from "@/lib/server/x-access";
import { lookupXPost } from "@/lib/server/x-client";
import { loadResearchMission } from "@/lib/server/research-mission-store";
import {
  listSavedXSources,
  refreshSavedXSourceFromPost,
  saveCachedXPostAsSource,
  setXSourceMissionAttached,
} from "@/lib/server/x-sources";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const READ_SCOPES: XScope[] = ["tweet.read", "users.read"];

type SourcesBody = {
  action?: unknown;
  familiarId?: unknown;
  postId?: unknown;
  originalUrl?: unknown;
  note?: unknown;
  tags?: unknown;
  sourceId?: unknown;
  missionId?: unknown;
};

function invalid(message: string): XApiError {
  return new XApiError("invalid-request", message);
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value === "") throw invalid(`${field} is required`);
  return value;
}

/** Tags must be a string array; the store validates content and length. */
function requireTags(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((tag) => typeof tag !== "string")) {
    throw invalid("tags must be an array of strings");
  }
  return value as string[];
}

export async function GET(req: Request) {
  const forbidden = rejectNonLocalRequest(req);
  if (forbidden) return forbidden;
  const familiarId = new URL(req.url).searchParams.get("familiarId");
  try {
    if (!familiarId) throw invalid("familiarId is required");
    // Listing is gated on the capability but NOT on a live connection:
    // previously-saved sources stay readable after a disconnect, which is
    // what lets the surface show them alongside a reconnect prompt.
    await requireXCapability(familiarId, "research");
    const sources = await listSavedXSources(familiarId);
    return NextResponse.json({ ok: true, sources });
  } catch (error) {
    return toXErrorResponse(error);
  }
}

export async function POST(req: Request) {
  const forbidden = rejectNonLocalRequest(req);
  if (forbidden) return forbidden;
  const parsed = await readJsonBody<SourcesBody>(req, MAX_X_JSON_BYTES);
  if (!parsed.ok) return parsed.response;
  const body = parsed.body;

  try {
    const familiarId = requireString(body.familiarId, "familiarId");
    await requireXCapability(familiarId, "research");

    switch (body.action) {
      case "save": {
        // Reads the post out of the lookup/search cache rather than
        // re-fetching it, so saving costs no upstream call and cannot
        // silently save something different from the previewed post.
        const result = await saveCachedXPostAsSource({
          familiarId,
          postId: requireString(body.postId, "postId"),
          originalUrl: requireString(body.originalUrl, "originalUrl"),
          note: typeof body.note === "string" ? body.note : "",
          tags: body.tags === undefined ? [] : requireTags(body.tags),
        });
        return NextResponse.json({
          ok: true,
          source: result.source,
          created: result.created,
        });
      }

      case "attach": {
        const sourceId = requireString(body.sourceId, "sourceId");
        const missionId = requireString(body.missionId, "missionId");
        await setXSourceMissionAttached(familiarId, sourceId, missionId);
        // The caller rejects any mission whose id or familiarId does not
        // match what it asked for, so read the mission back rather than
        // echoing the request — that way the response reflects stored state.
        const mission = await loadResearchMission(missionId);
        if (!mission) throw new XApiError("not-found", "Research mission was not found");
        return NextResponse.json({ ok: true, mission });
      }

      case "refresh": {
        const sourceId = requireString(body.sourceId, "sourceId");
        const sources = await listSavedXSources(familiarId);
        const existing = sources.find((candidate) => candidate.id === sourceId);
        if (!existing) throw new XApiError("not-found", "Saved X source was not found");
        // Refresh is the one source action that must hit upstream: its whole
        // purpose is to re-read the post and re-derive availability.
        const post = await withXAuthenticatedRead(familiarId, READ_SCOPES, (accessToken) =>
          lookupXPost(accessToken, existing.postId),
        );
        const result = await refreshSavedXSourceFromPost(familiarId, sourceId, post);
        return NextResponse.json({ ok: true, source: result.source, post });
      }

      default:
        throw invalid("action must be save, attach or refresh");
    }
  } catch (error) {
    return toXErrorResponse(error);
  }
}
