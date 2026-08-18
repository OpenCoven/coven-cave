// Intent-based mutations for a Card's array fields (steps/labels/links/
// attachments). The board's interactive editors used to PATCH whole arrays
// computed from render state — any write landing between their read and their
// PATCH (another view, another session, a familiar's enrich-steps run) was
// silently clobbered. Ops instead describe the *edit* (toggle THIS step, add
// THIS label) and are applied against the CURRENT card inside updateCard's
// board lock, so concurrent edits to distinct elements all survive.
//
// Pure and fs-free on purpose: the server applies ops in cave-board.ts under
// the write lock, and board-view applies the same function client-side for the
// optimistic render — one implementation, no drift.

import type { Card, CardStep } from "@/lib/cave-board-types";
import type { ChatAttachment } from "@/lib/chat-attachments";
import { normalizeLinkUrl } from "./link-organizer.ts";

export type StepOp =
  /** `id` is optional so the client can pre-generate it and keep its
   *  optimistic step identical to the server's (no temp-id mismatch). */
  | { op: "add"; text: string; id?: string }
  | { op: "toggle"; id: string }
  | { op: "remove"; id: string }
  | { op: "setDate"; id: string; field: "startDate" | "endDate"; value: string | null }
  | { op: "reorder"; id: string; dir: -1 | 1 };

export type ListOp = { op: "add" | "remove"; value: string };
export type LinkOp = ListOp | { op: "addNormalizedUrl"; value: string };

export type AttachmentOp =
  | { op: "add"; attachments: ChatAttachment[] }
  /** Removes the first attachment with this name. */
  | { op: "remove"; name: string };

export type CardOps = {
  stepOps?: StepOp[];
  labelOps?: ListOp[];
  linkOps?: LinkOp[];
  attachmentOps?: AttachmentOp[];
};

/**
 * Per-operation outcome data for a `CardOps` patch, resolved under the same
 * board lock and snapshot as the write itself. Only `linkOps` currently
 * reports anything (see `resolveLinkOpOutcomes`); other op kinds have no
 * client-facing added/duplicate/invalid distinction to make.
 */
export type CardOpsOutcome = {
  linkOps?: LinkOpOutcome[];
};

/** A board PATCH: plain field replacement plus optional intent ops. */
export type CardPatch = Partial<Omit<Card, "id" | "createdAt">> & { ops?: CardOps };

const MAX_STEP_TEXT = 500;
const MAX_LIST_VALUE = 2_000;

function nonEmptyArray<T>(value: T[] | undefined): T[] | null {
  return Array.isArray(value) && value.length > 0 ? value : null;
}

export function hasCardOps(ops: CardOps | undefined): ops is CardOps {
  return Boolean(
    ops &&
      (nonEmptyArray(ops.stepOps) ||
        nonEmptyArray(ops.labelOps) ||
        nonEmptyArray(ops.linkOps) ||
        nonEmptyArray(ops.attachmentOps)),
  );
}

function cleanId(id: unknown): string | null {
  return typeof id === "string" && id.length > 0 && id.length <= 128 ? id : null;
}

function applyStepOps(steps: CardStep[], ops: StepOp[], now: string): CardStep[] {
  let next = steps;
  for (const raw of ops) {
    if (!raw || typeof raw !== "object") continue;
    switch (raw.op) {
      case "add": {
        const text = typeof raw.text === "string" ? raw.text.trim().slice(0, MAX_STEP_TEXT) : "";
        if (!text) break;
        next = [...next, { id: cleanId(raw.id) ?? crypto.randomUUID(), text, done: false, addedAt: now }];
        break;
      }
      case "toggle": {
        const id = cleanId(raw.id);
        next = next.map((s) =>
          s.id === id ? { ...s, done: !s.done, doneAt: !s.done ? now : undefined } : s,
        );
        break;
      }
      case "remove": {
        const id = cleanId(raw.id);
        next = next.filter((s) => s.id !== id);
        break;
      }
      case "setDate": {
        const id = cleanId(raw.id);
        if (raw.field !== "startDate" && raw.field !== "endDate") break;
        const value = typeof raw.value === "string" && raw.value ? raw.value : null;
        next = next.map((s) => (s.id === id ? { ...s, [raw.field]: value } : s));
        break;
      }
      case "reorder": {
        const id = cleanId(raw.id);
        const dir = raw.dir === -1 || raw.dir === 1 ? raw.dir : 0;
        if (!dir) break;
        const idx = next.findIndex((s) => s.id === id);
        const swap = idx + dir;
        if (idx < 0 || swap < 0 || swap >= next.length) break;
        next = [...next];
        [next[idx], next[swap]] = [next[swap], next[idx]];
        break;
      }
    }
  }
  return next;
}

function applyListOps(values: string[], ops: ListOp[]): string[] {
  let next = values;
  for (const raw of ops) {
    if (!raw || typeof raw !== "object" || typeof raw.value !== "string") continue;
    const value = raw.value.trim().slice(0, MAX_LIST_VALUE);
    if (!value) continue;
    if (raw.op === "add" && !next.includes(value)) next = [...next, value];
    else if (raw.op === "remove") next = next.filter((v) => v !== value);
  }
  return next;
}

function cleanListValue(value: unknown): string {
  return typeof value === "string" ? value.trim().slice(0, MAX_LIST_VALUE) : "";
}

/**
 * Canonical validity + normalization for one `addNormalizedUrl` request:
 * `null` for anything that isn't a parseable http(s) URL, otherwise the
 * normalized key. Exported so callers validating a server's reported
 * per-request outcome (chat-follow-up-links.ts) check against the exact same
 * semantics `applyLinkOps`/`resolveLinkOpOutcomes` use, rather than a second,
 * potentially divergent notion of "valid"/"canonical".
 */
export function normalizedHttpLinkKey(value: unknown): string | null {
  const cleaned = cleanListValue(value);
  if (!cleaned) return null;
  let url: URL;
  try {
    url = new URL(cleaned);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  return normalizeLinkUrl(cleaned);
}

function currentNormalizedLinkKeys(values: string[]): Set<string> {
  const keys = new Set<string>();
  for (const value of values) {
    const key = normalizedHttpLinkKey(value);
    if (key) keys.add(key);
  }
  return keys;
}

/**
 * Per-request result for one `addNormalizedUrl` op, in request order. `added`
 * means the URL is genuinely new on the card after this op resolved; the
 * card's existing links (including every human-authored one) are never
 * removed or reordered to produce it. `duplicate` covers both a link that
 * pre-existed on the card AND a normalized-equivalent earlier in the same
 * batch. `invalid` covers anything that fails to parse as an http(s) URL,
 * including a blank/whitespace-only request — the existing silent-reject
 * behavior of `addNormalizedUrl`, now reported instead of only inferred
 * from the caller's own read. Every string-valued `addNormalizedUrl`
 * request yields exactly one entry here, in request order, so a caller that
 * maps requested URLs to outcomes by array position can rely on the two
 * arrays staying the same length.
 */
export type LinkOpOutcome = {
  requestedUrl: string;
  normalizedUrl: string | null;
  outcome: "added" | "duplicate" | "invalid";
};

/**
 * Single pure pass over `ops` shared by `applyLinkOps` and
 * `resolveLinkOpOutcomes`, so the two can never drift: every ordinary
 * `add`/`remove` and every `addNormalizedUrl` is observed in exact sequence,
 * against the same cleaning, the same exact add/remove semantics, and the
 * same canonical normalized-key set recomputed after every mutation —
 * whether or not the caller cares about the outcomes. Existing stored links
 * are never reordered or normalized; ordinary `add`/`remove` only append or
 * filter their raw values, while `addNormalizedUrl` alone stores its canonical
 * key. Ordinary blank `add`/`remove` requests are silently ignored (no
 * mutation, no outcome) exactly as before; `addNormalizedUrl` is the one op
 * kind whose blank requests still get a reported ("invalid") outcome, since
 * it's the one op kind with a client-facing per-request report at all.
 */
function runLinkOps(values: string[], ops: LinkOp[]): { values: string[]; outcomes: LinkOpOutcome[] } {
  let next = values;
  let normalizedKeys = currentNormalizedLinkKeys(next);
  const outcomes: LinkOpOutcome[] = [];
  for (const raw of ops) {
    if (!raw || typeof raw !== "object" || typeof raw.value !== "string") continue;
    const value = cleanListValue(raw.value);
    if (raw.op === "addNormalizedUrl") {
      // Every string-valued addNormalizedUrl request gets exactly one
      // positional outcome, even when it's blank/whitespace-only — a
      // caller (chat-follow-up-links.ts) maps its requested URLs to
      // outcomes by array position, so silently skipping a blank request
      // here (as ordinary add/remove below still does) would desync that
      // accounting instead of reporting the truthful "invalid" it is.
      const key = value ? normalizedHttpLinkKey(value) : null;
      if (!key) {
        outcomes.push({ requestedUrl: raw.value, normalizedUrl: null, outcome: "invalid" });
        continue;
      }
      if (normalizedKeys.has(key)) {
        outcomes.push({ requestedUrl: raw.value, normalizedUrl: key, outcome: "duplicate" });
        continue;
      }
      next = [...next, key];
      normalizedKeys = currentNormalizedLinkKeys(next);
      outcomes.push({ requestedUrl: raw.value, normalizedUrl: key, outcome: "added" });
      continue;
    }
    if (!value) continue;
    if (raw.op === "add") {
      if (!next.includes(value)) {
        next = [...next, value];
        normalizedKeys = currentNormalizedLinkKeys(next);
      }
    } else if (raw.op === "remove") {
      next = next.filter((v) => v !== value);
      normalizedKeys = currentNormalizedLinkKeys(next);
    }
  }
  return { values: next, outcomes };
}

function applyLinkOps(values: string[], ops: LinkOp[]): string[] {
  return runLinkOps(values, ops).values;
}

/**
 * Resolve only the `addNormalizedUrl` requests in `ops` into a truthful
 * per-request outcome, evaluated against `currentLinks` with the exact same
 * sequential pass `applyLinkOps` runs — every ordinary `add`/`remove` in the
 * same batch is observed too (recomputing the canonical normalized-key set
 * exactly as it does when applied), so a mixed batch reports the same
 * added/duplicate verdict that actually lands, including against earlier
 * adds and removes within this same batch. Pure and read-only: callers
 * resolve this from the same card snapshot they pass to `applyCardOps`,
 * under the same board lock, so the report can never drift from what was
 * actually written. `add`/`remove` ops themselves still emit no outcome —
 * they have no client-facing duplicate/invalid distinction to make truthful
 * — only their effect on later `addNormalizedUrl` requests is observed.
 */
export function resolveLinkOpOutcomes(currentLinks: string[], ops: LinkOp[]): LinkOpOutcome[] {
  return runLinkOps(currentLinks, ops).outcomes;
}

function applyAttachmentOps(
  attachments: ChatAttachment[],
  ops: AttachmentOp[],
): ChatAttachment[] {
  let next = attachments;
  for (const raw of ops) {
    if (!raw || typeof raw !== "object") continue;
    if (raw.op === "add" && Array.isArray(raw.attachments)) {
      // Size/shape/count normalization happens downstream (updateCard's lean
      // pipeline), exactly as it does for full-array patches.
      next = [...next, ...raw.attachments];
    } else if (raw.op === "remove" && typeof raw.name === "string") {
      const idx = next.findIndex((a) => a.name === raw.name);
      if (idx >= 0) next = [...next.slice(0, idx), ...next.slice(idx + 1)];
    }
  }
  return next;
}

/**
 * Resolve ops against the given card into plain array-field values. Only the
 * fields that had ops are returned, so the result merges into a patch without
 * touching untargeted arrays. `now` is injected for testability.
 */
export function applyCardOps(
  card: Pick<Card, "steps" | "labels" | "links" | "attachments">,
  ops: CardOps,
  now: string,
): Pick<CardPatch, "steps" | "labels" | "links" | "attachments"> {
  const out: Pick<CardPatch, "steps" | "labels" | "links" | "attachments"> = {};
  const stepOps = nonEmptyArray(ops.stepOps);
  if (stepOps) out.steps = applyStepOps(card.steps ?? [], stepOps, now);
  const labelOps = nonEmptyArray(ops.labelOps);
  if (labelOps) out.labels = applyListOps(card.labels ?? [], labelOps);
  const linkOps = nonEmptyArray(ops.linkOps);
  if (linkOps) out.links = applyLinkOps(card.links ?? [], linkOps);
  const attachmentOps = nonEmptyArray(ops.attachmentOps);
  if (attachmentOps) out.attachments = applyAttachmentOps(card.attachments ?? [], attachmentOps);
  return out;
}
