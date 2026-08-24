/**
 * Version tag inside the encoded cursor.
 *
 * Present so a future change to the payload can be refused outright instead of
 * being misread: an unversioned token that gains a field decodes as a valid
 * token with a missing one, and the page it resumes is silently wrong.
 */
export const CLIENT_V1_CURSOR_VERSION = 1;

/**
 * The position a cursor resumes from.
 *
 * `sort` is whatever the resource orders by (an ISO timestamp for the recency
 * lists, an id for the alphabetical ones). `id` is the tiebreak that makes the
 * ordering total.
 */
export type ClientV1PageKey = {
  sort: string;
  id: string;
};

function assertMintableKey(key: ClientV1PageKey): void {
  const sort: unknown = key.sort;
  const id: unknown = key.id;
  if (typeof sort !== "string" || typeof id !== "string" || id.length === 0) {
    throw new Error(
      "Client v1 cursor cannot be minted: a page key must be two strings with a non-empty id.",
    );
  }
}

export function encodeClientV1Cursor(key: ClientV1PageKey): string {
  assertMintableKey(key);
  const encoded = Buffer.from(
    JSON.stringify({ v: CLIENT_V1_CURSOR_VERSION, s: key.sort, i: key.id }),
    "utf8",
  ).toString("base64url");
  if (encoded.length > CLIENT_V1_LIMITS.cursorCharacters) {
    throw new Error(
      `Client v1 cursor cannot exceed ${CLIENT_V1_LIMITS.cursorCharacters} characters.`,
    );
  }
  return encoded;
}
import { CLIENT_V1_LIMITS } from "./contract.ts";
