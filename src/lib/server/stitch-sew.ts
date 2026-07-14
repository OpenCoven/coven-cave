/**
 * Sewing — the headless distillation of a stitch thread into a vault entry.
 *
 * The spawn dance lives in the shared assist runner (`assist-runner.ts`,
 * cave-c40b): sew builds its prompt, hands it to `runBoundedAssist`, and
 * parses the final message against the strict sew contract. The runner pins
 * the sandbox read-only because the prompt embeds attacker-influenceable
 * remote content (fetched pages, GitHub bodies) — a distillation needs no
 * tools, and the sewn write happens here, after the parse, not in the run.
 *
 * A sew can aim at a shape (a stitch pattern's scaffold + tag hints, or a
 * collection schema) and a destination collection (cave-kwx4), and the
 * "sew in chat" path finishes through `runDraftSew` with a caller-supplied
 * draft so provenance and thread completion survive the chat lane (cave-x1za).
 */

import {
  buildManualStitchBody,
  buildSewPrompt,
  parseSewOutput,
  pinRefs,
  type SewOutput,
  type SewShape,
  type StitchThread,
} from "../stitch.ts";
import { buildAssistInvocation, runBoundedAssist, type AssistInvocation } from "./assist-runner.ts";
import {
  isValidKnowledgeId,
  readKnowledgeEntry,
  slugifyKnowledgeId,
  writeKnowledgeEntry,
  type KnowledgeEntry,
} from "./knowledge-vault.ts";

export type SewInvocation = AssistInvocation;

export type SewOptions = {
  /** Body scaffold + tag hints from a stitch pattern or collection schema. */
  shape?: SewShape;
  /** Destination collection (validated by the caller against the vault). */
  collection?: string;
};

/** Pure: how the sew invokes `codex exec`, via the shared assist builder. */
export function buildSewInvocation(
  thread: Pick<StitchThread, "title" | "pins">,
  lastMessagePath: string,
  shape?: SewShape,
): SewInvocation {
  return buildAssistInvocation(buildSewPrompt(thread, shape), lastMessagePath);
}

/** Pick a free vault id for a sewn title: slug, then slug-2, slug-3… Unit-tested. */
export async function uniqueStitchId(title: string, collection?: string): Promise<string | null> {
  const base = slugifyKnowledgeId(title) || "stitch";
  if (!isValidKnowledgeId(base)) return null;
  if (!(await readKnowledgeEntry(base, collection))) return base;
  for (let n = 2; n <= 50; n++) {
    const candidate = `${base.slice(0, 60)}-${n}`;
    if (!isValidKnowledgeId(candidate)) return null;
    if (!(await readKnowledgeEntry(candidate, collection))) return candidate;
  }
  return null;
}

export type SewRunResult =
  | { ok: true; entry: KnowledgeEntry }
  | { ok: false; error: string };

/** Persist a parsed sew output as a vault entry with pin provenance. */
export async function writeSewnEntry(
  thread: StitchThread,
  output: SewOutput,
  collection?: string,
): Promise<SewRunResult> {
  const id = await uniqueStitchId(output.title, collection);
  if (!id) return { ok: false, error: "could not derive a vault id from the sewn title" };
  const entry = await writeKnowledgeEntry({
    id,
    ...(collection ? { collection } : {}),
    title: output.title,
    tags: output.tags,
    scope: "global",
    enabled: true,
    body: output.body,
    pins: pinRefs(thread.pins),
  });
  return { ok: true, entry };
}

/**
 * The manual sew: no model in the loop — pins concatenated under headings
 * (below the pattern's scaffold when one is chosen) into an entry the user
 * immediately edits. Same provenance as the agentic path; tag hints replace
 * the old empty-tags default.
 */
export async function runManualSew(thread: StitchThread, opts?: SewOptions): Promise<SewRunResult> {
  if (thread.pins.length === 0) return { ok: false, error: "thread has no pins" };
  return writeSewnEntry(
    thread,
    {
      title: thread.title.trim() || `Stitch ${new Date().toISOString().slice(0, 10)}`,
      tags: (opts?.shape?.tagHints ?? []).map((t) => t.trim().toLowerCase()).filter(Boolean).slice(0, 8),
      body: buildManualStitchBody(thread, opts?.shape?.scaffold),
    },
    opts?.collection,
  );
}

export type SewDraft = SewOutput;

const DRAFT_TITLE_MAX = 200;
const DRAFT_BODY_MAX = 200_000;

/** Normalize a caller-supplied sew draft (the chat lane's payload). Pure;
 *  returns null when the shape is off so the route can 400 instead of
 *  writing garbage. */
export function normalizeSewDraft(value: unknown): SewDraft | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const title = typeof record.title === "string" ? record.title.trim().slice(0, DRAFT_TITLE_MAX) : "";
  const body = typeof record.body === "string" ? record.body.trim() : "";
  if (!title || !body || body.length > DRAFT_BODY_MAX) return null;
  const tags = Array.isArray(record.tags)
    ? record.tags
        .filter((t): t is string => typeof t === "string")
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean)
        .slice(0, 8)
    : [];
  return { title, tags, body };
}

/** The chat-lane finish: persist a familiar-drafted entry with the thread's
 *  provenance — the round trip that "sew in chat" was missing (cave-x1za). */
export async function runDraftSew(
  thread: StitchThread,
  draft: SewDraft,
  collection?: string,
): Promise<SewRunResult> {
  if (thread.pins.length === 0) return { ok: false, error: "thread has no pins" };
  return writeSewnEntry(thread, draft, collection);
}

/**
 * Run the agentic sew end-to-end: one bounded assist run, parse the final
 * message, write the vault entry. Never throws.
 */
export async function runAgenticSew(thread: StitchThread, opts?: SewOptions): Promise<SewRunResult> {
  if (thread.pins.length === 0) return { ok: false, error: "thread has no pins" };
  const run = await runBoundedAssist({
    prompt: buildSewPrompt(thread, opts?.shape),
    missingRuntimeHint: 'use "Sew by hand"',
  });
  if (!run.ok) return { ok: false, error: run.error };
  const output = parseSewOutput(run.lastMessage);
  if (!output) return { ok: false, error: "sew output did not match the stitch format — try again" };
  return writeSewnEntry(thread, output, opts?.collection);
}
