// Reviewing a save that Coven refused as a revision conflict (#5217).
//
// The person edited the definition they saw (the base). Someone else
// changed it in the meantime, and Coven now holds a newer revision (theirs). Cave
// never writes the person's whole form over that revision. It compares the
// three field by field:
//
// - a field only the person changed is re-applied;
// - a field only Coven changed keeps Coven's value;
// - a field both changed the same way needs nothing;
// - a field both changed differently is a conflict, and the person must choose.
//
// The rebased save then sends only the fields the person keeps, at the newer
// revision, so Coven can refuse it again if the definition moves once more.
//
// Client-safe: no node imports.

import type { CodexAutomation, CodexAutomationPatch } from "../codex-automations-types.ts";
import { sameRoutineRrule } from "./routine-rrule.ts";
import type { ReviewedAutomationSource } from "../server/automation-consumer-commands.ts";

/** The fields Coven's routine keeps and Cave's save can change. */
export const REBASE_FIELDS = ["name", "prompt", "rrule", "model", "cwd", "tags"] as const;
export type RebaseField = typeof REBASE_FIELDS[number];

export const REBASE_FIELD_LABEL: Record<RebaseField, string> = {
  name: "Name",
  prompt: "Instructions",
  rrule: "Schedule",
  model: "Model",
  cwd: "Working directory",
  tags: "Tags",
};

type FieldValues = Record<RebaseField, string>;

export type RebaseFieldKind =
  /** Neither side changed it. */
  | "unchanged"
  /** Only the person changed it: re-applied. */
  | "mine"
  /** Only Coven's newer revision changed it: kept. */
  | "theirs"
  /** Both changed it to the same value. */
  | "same"
  /** Both changed it differently: the person chooses. */
  | "conflict";

export type RebaseFieldReview = {
  field: RebaseField;
  kind: RebaseFieldKind;
  base: string;
  mine: string;
  theirs: string;
};

export type RebaseChoice = "mine" | "theirs";

export type RevisionRebase = {
  /** The revision Coven holds now; the rebased save is checked against it. */
  revision: number;
  /** Coven's newer definition, as the surfaces display it. */
  theirs: CodexAutomation;
  fields: RebaseFieldReview[];
  /** Coven's lifecycle state changed too. Saving never changes it. */
  statusChanged: { from: CodexAutomation["status"]; to: CodexAutomation["status"] } | null;
};

function routineValues(auto: Pick<CodexAutomation, "name" | "prompt" | "rrule" | "model" | "cwds" | "tags">): FieldValues {
  return {
    name: auto.name,
    prompt: auto.prompt,
    rrule: auto.rrule ?? "",
    model: auto.model ?? "",
    // Coven keeps one working directory; the route stores the first.
    cwd: auto.cwds[0] ?? "",
    tags: auto.tags.join("\n"),
  };
}

/** The person's form, read as the same fields. A field the patch leaves out is unchanged. */
function patchValues(patch: CodexAutomationPatch, base: FieldValues): FieldValues {
  return {
    name: patch.name ?? base.name,
    prompt: patch.prompt ?? base.prompt,
    rrule: patch.rrule ?? base.rrule,
    model: patch.model ?? base.model,
    cwd: patch.cwds ? patch.cwds[0] ?? "" : base.cwd,
    tags: patch.tags ? patch.tags.join("\n") : base.tags,
  };
}

function same(field: RebaseField, a: string, b: string): boolean {
  return field === "rrule" ? sameRoutineRrule(a, b) : a === b;
}

/**
 * Compare what the person started from, what they saved, and what Coven holds
 * now. Pure: the caller supplies all three.
 */
export function reviewRevisionRebase(
  base: CodexAutomation,
  patch: CodexAutomationPatch,
  theirs: CodexAutomation,
  revision: number,
): RevisionRebase {
  const baseValues = routineValues(base);
  const mine = patchValues(patch, baseValues);
  const current = routineValues(theirs);
  const fields = REBASE_FIELDS.map((field): RebaseFieldReview => {
    const changedByMe = !same(field, mine[field], baseValues[field]);
    const changedByThem = !same(field, current[field], baseValues[field]);
    const kind: RebaseFieldKind = !changedByMe && !changedByThem ? "unchanged"
      : changedByMe && !changedByThem ? "mine"
        : !changedByMe ? "theirs"
          : same(field, mine[field], current[field]) ? "same" : "conflict";
    return { field, kind, base: baseValues[field], mine: mine[field], theirs: current[field] };
  });
  return {
    revision,
    theirs,
    fields,
    statusChanged: base.status === theirs.status ? null : { from: base.status, to: theirs.status },
  };
}

/** Conflicting fields the person has not chosen for yet. */
export function unresolvedConflicts(rebase: RevisionRebase, choices: Partial<Record<RebaseField, RebaseChoice>>): RebaseField[] {
  return rebase.fields.filter((entry) => entry.kind === "conflict" && choices[entry.field] === undefined).map((entry) => entry.field);
}

/**
 * The save to send at `rebase.revision`: only the fields the person keeps.
 * Fields left out keep Coven's value, so Coven's changes survive. Null while a
 * conflict is unresolved, or when nothing of the person's edit remains.
 */
export function rebasedPatch(
  rebase: RevisionRebase,
  choices: Partial<Record<RebaseField, RebaseChoice>>,
): CodexAutomationPatch | null {
  if (unresolvedConflicts(rebase, choices).length > 0) return null;
  const patch: CodexAutomationPatch = {};
  for (const entry of rebase.fields) {
    const keepMine = entry.kind === "mine" || (entry.kind === "conflict" && choices[entry.field] === "mine");
    if (!keepMine) continue;
    switch (entry.field) {
      case "name": patch.name = entry.mine; break;
      case "prompt": patch.prompt = entry.mine; break;
      case "rrule": patch.rrule = entry.mine; break;
      case "model": patch.model = entry.mine; break;
      case "cwd": patch.cwds = entry.mine ? [entry.mine] : []; break;
      case "tags": patch.tags = entry.mine ? entry.mine.split("\n") : []; break;
    }
  }
  return Object.keys(patch).length > 0 ? patch : null;
}

/** One line for a value in the review: short text whole, long text clipped. */
export function rebaseValuePreview(field: RebaseField, value: string, max = 120): string {
  if (value === "") return field === "tags" ? "(no tags)" : "(empty)";
  const text = field === "tags" ? value.split("\n").join(", ") : value.replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** Whether Coven's definition differs from `base` in any field Cave's save can change. */
export function definitionMoved(base: CodexAutomation, theirs: CodexAutomation): boolean {
  const before = routineValues(base);
  const now = routineValues(theirs);
  return REBASE_FIELDS.some((field) => !same(field, before[field], now[field]));
}

export type CurrentDefinition =
  | { kind: "available"; automation: CodexAutomation; revision: number; reviewedSource: ReviewedAutomationSource }
  | { kind: "absent" }
  | { kind: "unavailable" };

/**
 * Coven's current definition and its revision, from one snapshot
 * (`GET /api/codex-automations/[id]/definition`). `path` is the automation's
 * `/api/codex-automations/<id>` path.
 */
export async function readCurrentDefinition(path: string, signal?: AbortSignal): Promise<CurrentDefinition> {
  try {
    const res = await fetch(`${path}/definition`, { cache: "no-store", signal });
    const json = await res.json().catch(() => null) as { ok?: unknown; automation?: unknown; revision?: unknown; reviewedSource?: ReviewedAutomationSource } | null;
    if (res.status === 404) return { kind: "absent" };
    const automation = json?.automation as CodexAutomation | undefined;
    if (!res.ok || json?.ok !== true || typeof json.revision !== "number" || !Number.isSafeInteger(json.revision) || json.revision < 1 ||
      typeof automation !== "object" || automation === null || typeof automation.id !== "string" || typeof automation.name !== "string" ||
      typeof automation.prompt !== "string" || !Array.isArray(automation.cwds) || !Array.isArray(automation.tags)
      || json.reviewedSource?.revision !== json.revision || json.reviewedSource?.routine?.id !== automation.id) {
      return { kind: "unavailable" };
    }
    return { kind: "available", automation, revision: json.revision, reviewedSource: json.reviewedSource };
  } catch {
    return { kind: "unavailable" };
  }
}

export type RevisionCheckedSave =
  | { kind: "saved"; automation: CodexAutomation | null }
  | { kind: "resolved"; automation: CodexAutomation | null }
  /** Coven's definition moved since `base`: nothing was written; the person reviews. */
  | { kind: "review"; rebase: RevisionRebase }
  | { kind: "failed"; message: string };

export type RevisionSaveSession = {
  pending?: { id: string; base: CodexAutomation; patch: string; body: string };
};

/**
 * Save `patch`, an edit of `base` (the definition the form was loaded from).
 * Coven's current definition and revision are read first, from one snapshot.
 * If any field Cave can save differs from `base`, nothing is sent and the
 * answer is a review. Otherwise the save goes out at that revision. If Coven
 * refuses it because the definition moved in between, the answer is the same
 * review. The form is never written over a revision the person has not seen.
 */
export async function saveWithRevisionCheck(base: CodexAutomation, patch: CodexAutomationPatch, session: RevisionSaveSession = {}): Promise<RevisionCheckedSave> {
  const path = `/api/codex-automations/${encodeURIComponent(base.id)}`;
  if (session.pending && session.pending.id !== base.id) {
    return { kind: "failed", message: `Resolve the pending save for ${session.pending.base.name} before saving another scheduled job.` };
  }
  if (!session.pending) {
    const current = await readCurrentDefinition(path);
    if (current.kind === "absent") return { kind: "failed", message: "Not saved: Coven no longer holds this scheduled job." };
    if (current.kind !== "available") {
      return { kind: "failed", message: "Not saved: couldn't confirm Coven's current revision. Check the daemon connection, then save again." };
    }
    if (definitionMoved(base, current.automation)) {
      return { kind: "review", rebase: reviewRevisionRebase(base, patch, current.automation, current.revision) };
    }
    session.pending = { id: base.id, base: structuredClone(base), patch: JSON.stringify(patch),
      body: JSON.stringify({ ...patch, expectedRevision: current.revision, reviewedSource: current.reviewedSource, adoptionKey: `cave-edit:${crypto.randomUUID()}` }) };
  }
  const pending = session.pending;
  let res: Response;
  let json: { ok?: unknown; error?: unknown; conflict?: unknown; uncertain?: unknown; automation?: CodexAutomation } | null;
  try {
    res = await fetch(path, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: pending.body,
    });
    json = await res.json().catch(() => null);
  } catch {
    return { kind: "failed", message: "The save may not have reached Coven. Save again to retry the original request before making another change." };
  }
  if (res.status === 409 && json?.conflict === true) {
    delete session.pending;
    const moved = await readCurrentDefinition(path);
    if (moved.kind === "available") return { kind: "review", rebase: reviewRevisionRebase(pending.base, patch, moved.automation, moved.revision) };
  }
  if (!res.ok || json?.ok !== true) {
    if (res.status >= 400 && res.status < 500 && json?.uncertain !== true) delete session.pending;
    return { kind: "failed", message: typeof json?.error === "string" ? json.error : "The save is unconfirmed. Save again to retry the original request." };
  }
  delete session.pending;
  return { kind: pending.patch === JSON.stringify(patch) ? "saved" : "resolved", automation: json.automation ?? null };
}
