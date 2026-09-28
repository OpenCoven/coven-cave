// Per-message thumbs feedback — LOCAL ONLY, for later quality analytics.
// Records which assistant message got a thumbs up/down (or had its vote toggled
// off), which familiar produced it, and when. Privacy (mirrors
// salem/pathfinder-feedback.ts §"Privacy And Logging"): nothing leaves the
// machine; only the whitelisted fields below are stored — arbitrary keys
// (message content, prompts, secrets) are dropped, so nothing sensitive can
// leak in. These local traces can later seed a sanitized analytics set after
// review.

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { caveHome } from "@/lib/coven-paths";
import { isFeedbackReason, type FeedbackReason } from "@/lib/message-feedback";

export const MESSAGE_FEEDBACK_PATH = path.join(caveHome(), "message-feedback.json");

export type MessageFeedbackVote = "up" | "down";

export type MessageFeedback = {
  messageId: string;
  vote: MessageFeedbackVote;
  cleared: boolean; // true when the user toggled the vote back off
  familiarId?: string;
  /** Effective model id at vote time — seeds per-model quality analytics. */
  model?: string;
  /** Runtime/harness id at vote time — seeds per-runtime quality analytics. */
  runtime?: string;
  /** The chat thread the voted message belongs to. An id, not content. Votes
   *  recorded before this field existed have none. */
  sessionId?: string;
  /** One-tap category chosen after a thumbs-down (fixed list, never free text). */
  reason?: FeedbackReason;
  at: string;
};

/** Client-supplied fields. The store stamps `at` itself. */
export type MessageFeedbackInput = {
  messageId?: string;
  vote?: string;
  cleared?: boolean;
  familiarId?: string;
  model?: string;
  runtime?: string;
  sessionId?: string;
  reason?: string;
};

/** Same shape the self-report store accepts for thread ids. */
const FEEDBACK_SESSION_ID_RE = /^[a-z0-9_-]+$/i;

type FeedbackFile = { entries: MessageFeedback[] };

/**
 * Keep ONLY the whitelisted fields (privacy). Returns null without a valid
 * messageId + vote. `at` is stamped here, never trusted from input.
 */
export function sanitizeMessageFeedback(input: MessageFeedbackInput, at: string): MessageFeedback | null {
  if (!input || typeof input.messageId !== "string" || !input.messageId.trim()) return null;
  if (input.vote !== "up" && input.vote !== "down") return null;
  const fb: MessageFeedback = {
    messageId: input.messageId.trim().slice(0, 200),
    vote: input.vote,
    cleared: input.cleared === true,
    at,
  };
  if (typeof input.familiarId === "string" && input.familiarId.trim()) {
    fb.familiarId = input.familiarId.trim().slice(0, 120);
  }
  if (typeof input.model === "string" && input.model.trim()) {
    fb.model = input.model.trim().slice(0, 120);
  }
  if (typeof input.runtime === "string" && input.runtime.trim()) {
    fb.runtime = input.runtime.trim().slice(0, 60);
  }
  if (typeof input.sessionId === "string") {
    const sessionId = input.sessionId.trim().slice(0, 200);
    if (FEEDBACK_SESSION_ID_RE.test(sessionId)) fb.sessionId = sessionId;
  }
  // A reason only explains a thumbs-down; anything off the fixed list is dropped.
  if (fb.vote === "down" && !fb.cleared && isFeedbackReason(input.reason)) fb.reason = input.reason;
  return fb;
}

export async function loadMessageFeedback(): Promise<MessageFeedback[]> {
  try {
    const raw = await readFile(MESSAGE_FEEDBACK_PATH, "utf8");
    const parsed = JSON.parse(raw) as FeedbackFile;
    return Array.isArray(parsed.entries) ? parsed.entries : [];
  } catch {
    return [];
  }
}

let feedbackTmpCounter = 0;

/** Append one sanitized feedback entry. Returns the stored entry, or null if invalid. */
export async function recordMessageFeedback(input: MessageFeedbackInput): Promise<MessageFeedback | null> {
  const entry = sanitizeMessageFeedback(input, new Date().toISOString());
  if (!entry) return null;
  await mkdir(path.dirname(MESSAGE_FEEDBACK_PATH), { recursive: true });
  const entries = await loadMessageFeedback();
  entries.push(entry);
  const tmp = `${MESSAGE_FEEDBACK_PATH}.${process.pid}.${feedbackTmpCounter++}.tmp`;
  await writeFile(tmp, JSON.stringify({ entries }, null, 2), "utf8");
  await rename(tmp, MESSAGE_FEEDBACK_PATH);
  return entry;
}
