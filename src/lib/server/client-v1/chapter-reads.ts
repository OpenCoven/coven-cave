import { createHash, createHmac, randomBytes } from "node:crypto";

import type { ConversationFile } from "../../cave-conversations.ts";
import { buildChatContinuityChapters, hasValidChatContinuityLineage } from "../../chat-continuity-chapters.ts";
import { clientV1ConversationSequence } from "./reads.ts";
import { encodeClientV1Cursor, type ClientV1PageKey } from "./pagination.ts";

const cursorKey = randomBytes(32);
export const CLIENT_V1_CHAPTER_RULE = "utc-day-v1";

/** Legacy transcripts prove an exact conversation, not a shared audience/project. */
export function projectClientV1Chapters(conversation: ConversationFile) {
  const sourceRevision = createHash("sha256").update(JSON.stringify(conversation)).digest("hex");
  const base = {
    conversationId: conversation.sessionId,
    rule: CLIENT_V1_CHAPTER_RULE,
    contextStatus: "context-unverified" as const,
    sourceRevision,
  };
  const unavailable = { ...base, status: "unavailable" as const, chapters: [] };
  if (typeof conversation.sessionId !== "string" || !conversation.sessionId ||
      !Array.isArray(conversation.turns) || conversation.turns.some((turn) => !turn || typeof turn.id !== "string" || !turn.id)) {
    return unavailable;
  }
  if (!hasValidChatContinuityLineage(conversation.turns, conversation.activeLeafId)) return unavailable;
  const sequence = clientV1ConversationSequence(conversation);
  if (sequence.some((turn) => typeof turn.createdAt !== "string")) return unavailable;
  const index = buildChatContinuityChapters(
    conversation.sessionId,
    sequence,
    false,
  );
  let offset = 0;
  const chapters = index.chapters.map((chapter) => {
    offset += chapter.turnCount;
    return { ...chapter, lastTurnId: sequence[offset - 1].id };
  });
  return { ...base, ...index, chapters };
}

export function paginateClientV1Chapters(
  conversation: ConversationFile,
  principalId: string,
  options: { limit: number; after: ClientV1PageKey | null },
) {
  const index = projectClientV1Chapters(conversation);
  const bindingFor = (anchor: string) => createHmac("sha256", cursorKey)
    .update(JSON.stringify([CLIENT_V1_CHAPTER_RULE, principalId, index.conversationId, index.sourceRevision, anchor]))
    .digest("hex");
  // Source IDs have no cursor-sized bound. Hash the position while keeping
  // the original ID in the chapter header; the HMAC binds it to this snapshot.
  const cursorId = (anchor: string) => createHash("sha256").update(anchor).digest("hex");
  let start = 0;
  if (options.after) {
    if (index.status === "unavailable" || options.after.sort !== bindingFor(options.after.id)) return null;
    const position = index.chapters.findIndex((chapter) => cursorId(chapter.firstTurnId) === options.after!.id);
    if (position < 0) return null;
    start = position + 1;
  }
  const chapters = index.chapters.slice(start, start + options.limit);
  const hasMore = start + chapters.length < index.chapters.length;
  const last = chapters.at(-1);
  return {
    data: { ...index, chapters },
    cursor: {
      hasMore,
      ...(options.after ? { current: encodeClientV1Cursor(options.after) } : {}),
      ...(hasMore && last ? { next: encodeClientV1Cursor({ sort: bindingFor(cursorId(last.firstTurnId)), id: cursorId(last.firstTurnId) }) } : {}),
    },
  };
}
