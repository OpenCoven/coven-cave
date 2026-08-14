import assert from "node:assert/strict";
import type { NormalizedXPost, XErrorCode, XScope } from "./x-api.ts";
import {
  MAX_X_JSON_BYTES,
  MAX_X_POST_TEXT_BYTES,
  XApiError,
  canonicalXPostUrl,
  parseXPostUrl,
  xErrorHttpStatus,
  xErrorLogCategory,
} from "./x-api.ts";

type Equal<Actual, Expected> =
  (<Value>() => Value extends Actual ? 1 : 2) extends
  (<Value>() => Value extends Expected ? 1 : 2)
    ? (<Value>() => Value extends Expected ? 1 : 2) extends
      (<Value>() => Value extends Actual ? 1 : 2)
      ? true
      : false
    : false;
type Assert<Condition extends true> = Condition;

export type XScopeIsExact = Assert<Equal<XScope, "tweet.read" | "users.read" | "offline.access" | "tweet.write">>;
export type NormalizedXPostIsExact = Assert<Equal<NormalizedXPost, {
  id: string;
  canonicalUrl: string;
  text: string;
  author: { id: string; username: string; name?: string };
  createdAt: string;
}>>;
export type XErrorCodeIsExact = Assert<Equal<XErrorCode,
  | "not-configured"
  | "not-connected"
  | "capability-disabled"
  | "missing-scope"
  | "unauthorized"
  | "billing-unavailable"
  | "rate-limited"
  | "not-found"
  | "invalid-request"
  | "upstream-unavailable"
  | "ambiguous-write"
  | "invalid-response"
  | "oauth-in-progress"
  | "oauth-port-in-use"
  | "oauth-expired">>;
export type ParseXPostUrlSignatureIsExact = Assert<Equal<typeof parseXPostUrl, (raw: string) => {
  postId: string;
  username?: string;
  canonicalUrl: string;
}>>;

function assertInvalidXUrl(raw: string): void {
  assert.throws(
    () => parseXPostUrl(raw),
    (error: unknown) => error instanceof XApiError && error.code === "invalid-request" && error.safeMessage === "X post URL is invalid",
    "rejects unsafe or unsupported URL shape",
  );
}

assert.deepEqual(parseXPostUrl("https://x.com/OpenCoven/status/1234567890"), {
  postId: "1234567890",
  username: "opencoven",
  canonicalUrl: "https://x.com/opencoven/status/1234567890",
});
assert.deepEqual(parseXPostUrl("HTTPS://x.com/OpenCoven/status/1234567890"), {
  postId: "1234567890",
  username: "opencoven",
  canonicalUrl: "https://x.com/opencoven/status/1234567890",
});
assert.deepEqual(parseXPostUrl("https://X.COM/OpenCoven/status/1234567890"), {
  postId: "1234567890",
  username: "opencoven",
  canonicalUrl: "https://x.com/opencoven/status/1234567890",
});
assert.deepEqual(parseXPostUrl("http://twitter.com/OpenCoven/status/1234567890?ref=share#reply"), {
  postId: "1234567890",
  username: "opencoven",
  canonicalUrl: "https://x.com/opencoven/status/1234567890",
});
assert.deepEqual(parseXPostUrl("https://www.x.com/OpenCoven/status/1234567890"), {
  postId: "1234567890",
  username: "opencoven",
  canonicalUrl: "https://x.com/opencoven/status/1234567890",
});
assert.deepEqual(parseXPostUrl("https://www.twitter.com/OpenCoven/status/1234567890"), {
  postId: "1234567890",
  username: "opencoven",
  canonicalUrl: "https://x.com/opencoven/status/1234567890",
});
assert.deepEqual(parseXPostUrl("https://x.com/i/web/status/1234567890"), {
  postId: "1234567890",
  canonicalUrl: "https://x.com/i/web/status/1234567890",
});
assert.equal(canonicalXPostUrl("1234567890", "OpenCoven"), "https://x.com/opencoven/status/1234567890");
assert.equal(canonicalXPostUrl("1234567890"), "https://x.com/i/web/status/1234567890");
assert.throws(
  () => canonicalXPostUrl("1234567890", ""),
  (error: unknown) => error instanceof XApiError && error.code === "invalid-request" && error.safeMessage === "A valid X username is required",
  "rejects an explicitly empty username",
);
assert.throws(
  () => canonicalXPostUrl("1234567890", "K"),
  (error: unknown) => error instanceof XApiError && error.code === "invalid-request" && error.safeMessage === "A valid X username is required",
  "rejects a Unicode confusable username",
);
assert.throws(
  () => canonicalXPostUrl("not-a-post-id"),
  (error: unknown) => error instanceof XApiError && error.code === "invalid-request" && error.safeMessage === "A numeric X post ID is required",
  "rejects a non-numeric post ID",
);

for (const raw of [
  "https://user:pass@x.com/OpenCoven/status/1234567890",
  "ftp://x.com/OpenCoven/status/1234567890",
  "https://example.com/OpenCoven/status/1234567890",
  "https://x.com/OpenCoven/likes/1234567890",
  "https://x.com/OpenCoven/status/not-a-number",
  "https://x.com/OpenCoven/status/1234567890/analytics",
  "https://x.com//OpenCoven//status//1234567890",
  "https://x.com/OpenCoven/status/1234567890/",
  "https://x.com/OpenCoven/foo/../status/1234567890",
  "https://x.com/OpenCoven\\status\\1234567890",
  "https://x.com:444/OpenCoven/status/1234567890",
  "https://x.com/%4fpenCoven/status/1234567890",
  "https://x.com/OpenCoven/STATUS/1234567890",
  "https://x.com/I/WEB/STATUS/1234567890",
]) {
  assertInvalidXUrl(raw);
}

assert.equal(MAX_X_JSON_BYTES, 256 * 1024);
assert.equal(MAX_X_POST_TEXT_BYTES, 128 * 1024);

const normalizedPostFixture: NormalizedXPost = {
  id: "1234567890",
  canonicalUrl: "https://x.com/opencoven/status/1234567890",
  text: "A safe normalized post.",
  author: { id: "42", username: "opencoven", name: "OpenCoven" },
  createdAt: "2026-07-27T12:00:00.000Z",
};
void normalizedPostFixture;

const errorStatuses: Record<XErrorCode, number> = {
  "not-configured": 503,
  "not-connected": 401,
  "capability-disabled": 403,
  "missing-scope": 403,
  unauthorized: 401,
  "billing-unavailable": 503,
  "rate-limited": 429,
  "not-found": 404,
  "invalid-request": 400,
  "upstream-unavailable": 503,
  "ambiguous-write": 502,
  "invalid-response": 502,
  "oauth-in-progress": 409,
  "oauth-port-in-use": 409,
  "oauth-expired": 410,
};
for (const [code, status] of Object.entries(errorStatuses) as [XErrorCode, number][]) {
  assert.equal(xErrorHttpStatus(code), status, `maps ${code}`);
}

const safeError = new XApiError("unauthorized", "Connection needs authorization", { status: 401, dispatched: true });
assert.equal(safeError.message, safeError.safeMessage);
assert.deepEqual(Object.keys(safeError).sort(), ["code", "dispatched", "safeMessage", "status"]);
assert.equal(Object.hasOwn(safeError, "name"), false, "uses Error's inherited name");
assert.deepEqual(
  {
    code: safeError.code,
    safeMessage: safeError.safeMessage,
    status: safeError.status,
    retryAt: safeError.retryAt,
    dispatched: safeError.dispatched,
  },
  {
    code: "unauthorized",
    safeMessage: "Connection needs authorization",
    status: 401,
    retryAt: undefined,
    dispatched: true,
  },
);
assert.deepEqual(Object.keys(new XApiError("not-found", "X post was not found")).sort(), ["code", "dispatched", "safeMessage"]);
assert.equal(xErrorLogCategory(safeError), "unauthorized");
assert.equal(xErrorLogCategory(new Error("a raw upstream response body")), "internal");

console.log("x-api.test.ts: ok");
