import { createHash, randomBytes } from "node:crypto";

/**
 * Per-process salt. A tag also has to change when the code that presents a
 * transcript changes, and nothing in the file's digest can see that; salting
 * with the process start means a client revalidating across a server restart
 * or upgrade gets a full response rather than a 304 for a payload the new code
 * would have shaped differently.
 */
const PROCESS_SALT = randomBytes(12).toString("base64url");

/**
 * Strong ETag for `GET /api/chat/conversation/[id]` (#5607): the transcript
 * file's content digest, which response flavor was asked for (full or
 * recent-tool-outputs-only) and the linked context, which comes from the board
 * and changes independently of the transcript.
 */
export function conversationEtag(
  fileDigest: string,
  recentToolOutputsOnly: boolean,
  context: unknown,
): string {
  const hash = createHash("sha256")
    .update(PROCESS_SALT)
    .update("\0")
    .update(fileDigest)
    .update("\0")
    .update(recentToolOutputsOnly ? "recent" : "full")
    .update("\0")
    .update(JSON.stringify(context ?? null));
  return `"c-${hash.digest("base64url").slice(0, 32)}"`;
}
