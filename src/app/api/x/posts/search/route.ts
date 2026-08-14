import { NextResponse } from "next/server";
import { XApiError, type XScope } from "@/lib/x-api";
import { readJsonBody, rejectNonLocalRequest } from "@/lib/server/api-security";
import { toXErrorResponse, withXAuthenticatedRead } from "@/lib/server/x-access";
import { searchRecentXPosts } from "@/lib/server/x-client";
import { cacheNormalizedXPosts } from "@/lib/server/x-sources";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BODY_BYTES = 4 * 1024;
const READ_SCOPES: XScope[] = ["tweet.read", "users.read"];

type SearchBody = { familiarId?: unknown; query?: unknown };

export async function POST(req: Request) {
  const forbidden = rejectNonLocalRequest(req);
  if (forbidden) return forbidden;
  const parsed = await readJsonBody<SearchBody>(req, MAX_BODY_BYTES);
  if (!parsed.ok) return parsed.response;

  const { familiarId, query } = parsed.body;
  if (typeof familiarId !== "string" || typeof query !== "string") {
    return toXErrorResponse(
      new XApiError("invalid-request", "familiarId and query are required"),
    );
  }

  try {
    // Length and emptiness are enforced inside searchRecentXPosts (512
    // codepoints), so they are not duplicated here — one definition of the
    // limit, next to the request that has to honour it.
    const posts = await withXAuthenticatedRead(familiarId, READ_SCOPES, (accessToken) =>
      searchRecentXPosts(accessToken, query),
    );
    // Same reason as the lookup route: a save reads the post out of this
    // cache, so results must be cached before the user can act on them.
    await cacheNormalizedXPosts(posts);
    return NextResponse.json({ ok: true, posts });
  } catch (error) {
    return toXErrorResponse(error);
  }
}
