import { NextResponse } from "next/server";
import { parseXPostUrl, XApiError, type XScope } from "@/lib/x-api";
import { readJsonBody, rejectNonLocalRequest } from "@/lib/server/api-security";
import { toXErrorResponse, withXAuthenticatedRead } from "@/lib/server/x-access";
import { lookupXPost } from "@/lib/server/x-client";
import { cacheNormalizedXPosts } from "@/lib/server/x-sources";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BODY_BYTES = 4 * 1024;
const READ_SCOPES: XScope[] = ["tweet.read", "users.read"];

type LookupBody = { familiarId?: unknown; url?: unknown };

export async function POST(req: Request) {
  const forbidden = rejectNonLocalRequest(req);
  if (forbidden) return forbidden;
  const parsed = await readJsonBody<LookupBody>(req, MAX_BODY_BYTES);
  if (!parsed.ok) return parsed.response;

  const { familiarId, url } = parsed.body;
  if (typeof familiarId !== "string" || typeof url !== "string") {
    return toXErrorResponse(
      new XApiError("invalid-request", "familiarId and url are required"),
    );
  }

  try {
    // parseXPostUrl throws for anything that is not an X post URL, which is
    // the same validation the client ran before sending — re-run it rather
    // than trusting the caller, since the id goes straight into an upstream
    // path segment.
    const { postId } = parseXPostUrl(url);
    // withXAuthenticatedRead owns the capability check, token retrieval and
    // one refresh-and-retry on 401, so this route never touches credentials.
    const post = await withXAuthenticatedRead(familiarId, READ_SCOPES, (accessToken) =>
      lookupXPost(accessToken, postId),
    );
    // Saving a source reads from this cache rather than re-fetching, which is
    // why saveCachedXPostAsSource fails with "Look up or search for this X
    // post before saving it". Caching here is what makes the preview → save
    // flow work; without it every save from a lookup would 404.
    await cacheNormalizedXPosts([post]);
    return NextResponse.json({ ok: true, post });
  } catch (error) {
    return toXErrorResponse(error);
  }
}
