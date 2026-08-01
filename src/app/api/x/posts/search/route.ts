import { NextResponse } from "next/server.js";

import {
  XApiError,
  type NormalizedXPost,
  type XScope,
} from "@/lib/x-api";
import { readJsonBody, rejectNonLocalRequest, type JsonBodyResult } from "@/lib/server/api-security";
import { isValidFamiliarId } from "@/lib/server/familiar-id";
import {
  cacheNormalizedXPosts,
  sweepExpiredXCache,
} from "@/lib/server/x-sources";
import {
  toXErrorResponse,
  withXAuthenticatedRead,
} from "@/lib/server/x-access";
import { searchRecentXPosts } from "@/lib/server/x-client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BODY_BYTES = 16 * 1024;
const MAX_QUERY_CHARS = 512;
const READ_SCOPES: XScope[] = ["tweet.read", "users.read"];

type SearchBody = {
  familiarId: string;
  query: string;
};

type SearchDependencies = {
  rejectNonLocalRequest(req: Request): Response | null;
  readJsonBody(req: Request, maxBytes: number): Promise<JsonBodyResult<unknown>>;
  sweepExpiredCache(): Promise<number>;
  withAuthenticatedRead(
    familiarId: string,
    scopes: XScope[],
    operation: (accessToken: string) => Promise<NormalizedXPost[]>,
  ): Promise<NormalizedXPost[]>;
  searchPosts(accessToken: string, query: string): Promise<NormalizedXPost[]>;
  cachePosts(posts: NormalizedXPost[]): Promise<void>;
  errorResponse(error: unknown): Response;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseBody(value: unknown): SearchBody {
  if (!isRecord(value)
    || Object.keys(value).length !== 2
    || !Object.hasOwn(value, "familiarId")
    || !Object.hasOwn(value, "query")
    || typeof value.familiarId !== "string"
    || !isValidFamiliarId(value.familiarId)
    || typeof value.query !== "string") {
    throw new XApiError("invalid-request", "X post search is invalid");
  }
  const query = value.query.trim();
  if (!query || Array.from(query).length > MAX_QUERY_CHARS) {
    throw new XApiError("invalid-request", "X post search is invalid");
  }
  return { familiarId: value.familiarId, query };
}

export function createXPostSearchHandler(dependencies: SearchDependencies) {
  return async function handleSearch(req: Request): Promise<Response> {
    const forbidden = dependencies.rejectNonLocalRequest(req);
    if (forbidden) return forbidden;
    try {
      await dependencies.sweepExpiredCache();
      const parsed = await dependencies.readJsonBody(req, MAX_BODY_BYTES);
      if (!parsed.ok) return parsed.response;
      const body = parseBody(parsed.body);
      const posts = (
        await dependencies.withAuthenticatedRead(
          body.familiarId,
          READ_SCOPES,
          (accessToken) => dependencies.searchPosts(accessToken, body.query),
        )
      ).slice(0, 10);
      await dependencies.cachePosts(posts);
      return NextResponse.json({ ok: true, posts });
    } catch (error) {
      return dependencies.errorResponse(error);
    }
  };
}

const handleSearch = createXPostSearchHandler({
  rejectNonLocalRequest,
  readJsonBody: (req, maxBytes) => readJsonBody<unknown>(req, maxBytes),
  sweepExpiredCache: () => sweepExpiredXCache(),
  withAuthenticatedRead: (familiarId, scopes, operation) => (
    withXAuthenticatedRead(familiarId, scopes, operation)
  ),
  searchPosts: searchRecentXPosts,
  cachePosts: cacheNormalizedXPosts,
  errorResponse: toXErrorResponse,
});

export async function POST(req: Request) {
  return handleSearch(req);
}
