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

import type { Card, CardStep, TaskDependency } from "@/lib/cave-board-types";
import type { ChatAttachment } from "@/lib/chat-attachments";

export type StepOp =
  /** `id` is optional so the client can pre-generate it and keep its
   *  optimistic step identical to the server's (no temp-id mismatch). */
  | { op: "add"; text: string; id?: string }
  | { op: "toggle"; id: string }
  | { op: "remove"; id: string }
  | { op: "setDate"; id: string; field: "startDate" | "endDate"; value: string | null }
  | { op: "reorder"; id: string; dir: -1 | 1 };

export type ListOp = { op: "add" | "remove"; value: string };

export type AttachmentOp =
  | { op: "add"; attachments: ChatAttachment[] }
  /** Removes the first attachment with this name. */
  | { op: "remove"; name: string };

/**
 * Add a system-authored `kind: task` edge unless the card already depends on
 * that task. The Chart Room's legacy overlay import (#6258) uses it: every
 * browser imports its own overlay against the shared board, so the edge must
 * merge into the current card rather than replace a stale snapshot.
 */
export type DependencyOp = {
  op: "addTask";
  taskId: string;
  label: string;
  /** Optional so the client can pre-generate it, as step adds do. */
  id?: string;
  evidence?: string;
};

export type CardOps = {
  stepOps?: StepOp[];
  labelOps?: ListOp[];
  linkOps?: ListOp[];
  attachmentOps?: AttachmentOp[];
  dependencyOps?: DependencyOp[];
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
        nonEmptyArray(ops.attachmentOps) ||
        nonEmptyArray(ops.dependencyOps)),
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

function applyDependencyOps(
  cardId: string,
  dependencies: TaskDependency[],
  ops: DependencyOp[],
  now: string,
): TaskDependency[] {
  let next = dependencies;
  for (const raw of ops) {
    if (!raw || typeof raw !== "object" || raw.op !== "addTask") continue;
    const taskId = cleanId(raw.taskId);
    const label = typeof raw.label === "string" ? raw.label.trim().slice(0, MAX_LIST_VALUE) : "";
    if (!taskId || !label || taskId === cardId) continue;
    if (next.some((dep) => dep.kind === "task" && dep.taskId === taskId)) continue;
    const evidence = typeof raw.evidence === "string" ? raw.evidence.trim().slice(0, MAX_LIST_VALUE) : "";
    next = [...next, {
      id: cleanId(raw.id) ?? crypto.randomUUID(),
      kind: "task",
      label,
      taskId,
      state: "unresolved",
      origin: "system",
      createdAt: now,
      ...(evidence ? { evidence } : {}),
    }];
  }
  return next;
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
  card: Pick<Card, "id" | "steps" | "labels" | "links" | "attachments" | "dependencies">,
  ops: CardOps,
  now: string,
): Pick<CardPatch, "steps" | "labels" | "links" | "attachments" | "dependencies"> {
  const out: Pick<CardPatch, "steps" | "labels" | "links" | "attachments" | "dependencies"> = {};
  const stepOps = nonEmptyArray(ops.stepOps);
  if (stepOps) out.steps = applyStepOps(card.steps ?? [], stepOps, now);
  const labelOps = nonEmptyArray(ops.labelOps);
  if (labelOps) out.labels = applyListOps(card.labels ?? [], labelOps);
  const linkOps = nonEmptyArray(ops.linkOps);
  if (linkOps) out.links = applyListOps(card.links ?? [], linkOps);
  const attachmentOps = nonEmptyArray(ops.attachmentOps);
  if (attachmentOps) out.attachments = applyAttachmentOps(card.attachments ?? [], attachmentOps);
  const dependencyOps = nonEmptyArray(ops.dependencyOps);
  if (dependencyOps) out.dependencies = applyDependencyOps(card.id, card.dependencies ?? [], dependencyOps, now);
  return out;
}
