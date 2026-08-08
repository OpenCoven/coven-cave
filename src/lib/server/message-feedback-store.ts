// Per-message thumbs feedback — LOCAL ONLY, for later quality analytics.
// Records which assistant message got a thumbs up/down (or had its vote toggled
// off), which familiar produced it, and when. Privacy (mirrors
// salem/pathfinder-feedback.ts §"Privacy And Logging"): nothing leaves the
// machine; only the whitelisted fields below are stored — arbitrary keys
// (message content, prompts, secrets) are dropped, so nothing sensitive can
// leak in. These local traces can later seed a sanitized analytics set after
// review.

import { access, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";
import { FAMILIAR_DASHBOARD_LIMITS } from "@/lib/familiar-dashboard";
import { caveHome } from "@/lib/coven-paths";
import {
  applyMessageFeedbackEntry,
  EMPTY_FEEDBACK_ROLLUP,
  finalizeMessageFeedbackRollup,
  type MessageFeedbackRollup,
} from "@/lib/message-feedback-rollup";

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
};

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

function isMissingFileError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}

function invalidFeedbackStore(reason: string): Error {
  return new Error(`invalid message feedback store: ${reason}`);
}

function parseFeedbackEntryBlock(lines: string[]): MessageFeedback {
  const raw = lines.join("\n").replace(/,\s*$/, "");
  return JSON.parse(raw) as MessageFeedback;
}

export async function loadMessageFeedbackRollup(args?: {
  familiarId?: string;
  bucketLimit?: number;
}): Promise<MessageFeedbackRollup> {
  try {
    await access(MESSAGE_FEEDBACK_PATH);
  } catch (error) {
    if (isMissingFileError(error)) return EMPTY_FEEDBACK_ROLLUP;
    throw error;
  }

  const finalVotes = new Map<string, MessageFeedback>();
  const reader = createInterface({
    input: createReadStream(MESSAGE_FEEDBACK_PATH, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });

  let sawEntriesArray = false;
  let collectingEntry = false;
  const entryLines: string[] = [];

  try {
    for await (const line of reader) {
      const trimmed = line.trim();
      if (!sawEntriesArray) {
        if (trimmed === '"entries": []') {
          sawEntriesArray = true;
          break;
        }
        if (trimmed === '"entries": [' || trimmed.startsWith('"entries": [')) {
          sawEntriesArray = true;
        }
        continue;
      }

      if (!collectingEntry) {
        if (!trimmed || trimmed === "]" || trimmed === "]," || trimmed === "}") continue;
        if (trimmed === "{") {
          collectingEntry = true;
          entryLines.push(trimmed);
          continue;
        }
        throw invalidFeedbackStore(`unexpected token ${trimmed}`);
      }

      entryLines.push(trimmed);
      if (trimmed === "}" || trimmed === "},") {
        applyMessageFeedbackEntry(
          finalVotes,
          parseFeedbackEntryBlock(entryLines),
          { familiarId: args?.familiarId },
        );
        entryLines.length = 0;
        collectingEntry = false;
      }
    }
  } finally {
    reader.close();
  }

  if (!sawEntriesArray) throw invalidFeedbackStore('missing "entries" array');
  if (collectingEntry) throw invalidFeedbackStore("unterminated feedback entry");

  return finalizeMessageFeedbackRollup(finalVotes.values(), {
    bucketLimit: args?.bucketLimit ?? FAMILIAR_DASHBOARD_LIMITS.feedbackBuckets,
  });
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
