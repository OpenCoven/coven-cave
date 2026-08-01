import { NextResponse } from "next/server.js";

import {
  XApiError,
  parseXPostUrl,
  type NormalizedXPost,
  type XScope,
} from "@/lib/x-api";
import { readJsonBody, rejectNonLocalRequest, type JsonBodyResult } from "@/lib/server/api-security";
import { isValidFamiliarId } from "@/lib/server/familiar-id";
import {
  cacheNormalizedXPosts,
  markXPostAvailability,
  sweepExpiredXCache,
} from "@/lib/server/x-sources";
import {
  toXErrorResponse,
  withXAuthenticatedRead,
} from "@/lib/server/x-access";
import { lookupXPost } from "@/lib/server/x-client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BODY_BYTES = 16 * 1024;
const MAX_URL_CHARS = 2_048;
const READ_SCOPES: XScope[] = ["tweet.read", "users.read"];

type LookupBody = {
  familiarId: string;
  url: string;
};

type LookupDependencies = {
  rejectNonLocalRequest(req: Request): Response | null;
  readJsonBody(req: Request, maxBytes: number): Promise<JsonBodyResult<unknown>>;
  sweepExpiredCache(): Promise<number>;
  withAuthenticatedRead(
    familiarId: string,
    scopes: XScope[],
    operation: (accessToken: string) => Promise<NormalizedXPost>,
  ): Promise<NormalizedXPost>;
  lookupPost(accessToken: string, postId: string): Promise<NormalizedXPost>;
  cachePosts(posts: NormalizedXPost[]): Promise<void>;
  markAvailability(postId: string, availability: "deleted"): Promise<void>;
  errorResponse(error: unknown): Response;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseBody(value: unknown): LookupBody {
  if (!isRecord(value)
    || Object.keys(value).length !== 2
    || !Object.hasOwn(value, "familiarId")
    || !Object.hasOwn(value, "url")
    || typeof value.familiarId !== "string"
    || !isValidFamiliarId(value.familiarId)
    || typeof value.url !== "string"
    || value.url.length === 0
    || Array.from(value.url).length > MAX_URL_CHARS) {
    throw new XApiError("invalid-request", "X post lookup is invalid");
  }
  return { familiarId: value.familiarId, url: value.url };
}

export function createXPostLookupHandler(dependencies: LookupDependencies) {
  return async function handleLookup(req: Request): Promise<Response> {
    const forbidden = dependencies.rejectNonLocalRequest(req);
    if (forbidden) return forbidden;
    try {
      await dependencies.sweepExpiredCache();
      const parsed = await dependencies.readJsonBody(req, MAX_BODY_BYTES);
      if (!parsed.ok) return parsed.response;
      const body = parseBody(parsed.body);
      const { postId } = parseXPostUrl(body.url);
      try {
        const post = await dependencies.withAuthenticatedRead(
          body.familiarId,
          READ_SCOPES,
          (accessToken) => dependencies.lookupPost(accessToken, postId),
        );
        await dependencies.cachePosts([post]);
        return NextResponse.json({ ok: true, post });
      } catch (error) {
        if (error instanceof XApiError && error.code === "not-found") {
          await dependencies.markAvailability(postId, "deleted");
        }
        throw error;
      }
    } catch (error) {
      return dependencies.errorResponse(error);
    }
  };
}

const handleLookup = createXPostLookupHandler({
  rejectNonLocalRequest,
  readJsonBody: (req, maxBytes) => readJsonBody<unknown>(req, maxBytes),
  sweepExpiredCache: () => sweepExpiredXCache(),
  withAuthenticatedRead: (familiarId, scopes, operation) => (
    withXAuthenticatedRead(familiarId, scopes, operation)
  ),
  lookupPost: lookupXPost,
  cachePosts: cacheNormalizedXPosts,
  markAvailability: (postId, availability) => markXPostAvailability(postId, availability),
  errorResponse: toXErrorResponse,
});

export async function POST(req: Request) {
  return handleLookup(req);
}
