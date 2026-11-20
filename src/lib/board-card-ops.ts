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
 * Dependency edits resolved against the CURRENT card under the board lock, so
 * a browser showing a stale card can never drop an edge another writer added
 * (#6258 import, #6286 human edits and their undo).
 */
export type DependencyOp =
  /** Add a `kind: task` edge unless the card already depends on that task. */
  | {
      op: "addTask";
      taskId: string;
      label: string;
      /** Optional so the client can pre-generate it, as step adds do. */
      id?: string;
      evidence?: string;
      /** Who authored the edge: a person linking it, or the system importing it. */
      origin?: "human" | "system";
    }
  /** Cut every `kind: task` edge to this upstream. A cut primary blocker
   *  re-points to the next unresolved dependency, unpinned. */
  | { op: "removeTask"; taskId: string }
  /** Remove one dependency by id (undo of an add: only that exact edge). */
  | { op: "remove"; id: string }
  /** Re-add exact records that are absent (undo of a cut), and point the
   *  primary blocker back at one of them when asked. */
  | {
      op: "restore";
      dependencies: TaskDependency[];
      primaryBlockerId?: string | null;
      primaryBlockerPinned?: boolean;
    };

type DependencyState = Pick<Card, "dependencies" | "primaryBlockerId" | "primaryBlockerPinned">;

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

function sameTaskEdge(dep: TaskDependency, taskId: string): boolean {
  return dep.kind === "task" && dep.taskId === taskId;
}

function applyDependencyOps(
  cardId: string,
  current: DependencyState,
  ops: DependencyOp[],
  now: string,
): DependencyState {
  let dependencies = current.dependencies ?? [];
  let primaryBlockerId = current.primaryBlockerId ?? null;
  let primaryBlockerPinned = current.primaryBlockerPinned === true;
  const dropPrimaryIfRemoved = () => {
    if (primaryBlockerId == null || dependencies.some((dep) => dep.id === primaryBlockerId)) return;
    primaryBlockerId = dependencies.find((dep) => dep.state === "unresolved")?.id ?? null;
    primaryBlockerPinned = false;
  };
  for (const raw of ops) {
    if (!raw || typeof raw !== "object") continue;
    switch (raw.op) {
      case "addTask": {
        const taskId = cleanId(raw.taskId);
        const label = typeof raw.label === "string" ? raw.label.trim().slice(0, MAX_LIST_VALUE) : "";
        if (!taskId || !label || taskId === cardId) break;
        if (dependencies.some((dep) => sameTaskEdge(dep, taskId))) break;
        const evidence = typeof raw.evidence === "string" ? raw.evidence.trim().slice(0, MAX_LIST_VALUE) : "";
        dependencies = [...dependencies, {
          id: cleanId(raw.id) ?? crypto.randomUUID(),
          kind: "task",
          label,
          taskId,
          state: "unresolved",
          origin: raw.origin === "human" ? "human" : "system",
          createdAt: now,
          ...(evidence ? { evidence } : {}),
        }];
        break;
      }
      case "removeTask": {
        const taskId = cleanId(raw.taskId);
        if (!taskId) break;
        dependencies = dependencies.filter((dep) => !sameTaskEdge(dep, taskId));
        dropPrimaryIfRemoved();
        break;
      }
      case "remove": {
        const id = cleanId(raw.id);
        if (!id) break;
        dependencies = dependencies.filter((dep) => dep.id !== id);
        dropPrimaryIfRemoved();
        break;
      }
      case "restore": {
        if (!Array.isArray(raw.dependencies)) break;
        const restored: string[] = [];
        for (const record of raw.dependencies) {
          if (!record || typeof record !== "object" || !cleanId(record.id)) continue;
          if (dependencies.some((dep) => dep.id === record.id)) continue;
          if (record.kind === "task" && typeof record.taskId === "string"
            && dependencies.some((dep) => sameTaskEdge(dep, record.taskId as string))) continue;
          dependencies = [...dependencies, record];
          restored.push(record.id);
        }
        if (typeof raw.primaryBlockerId === "string" && restored.includes(raw.primaryBlockerId)) {
          primaryBlockerId = raw.primaryBlockerId;
          primaryBlockerPinned = raw.primaryBlockerPinned === true;
        }
        break;
      }
      default:
        break;
    }
  }
  return { dependencies, primaryBlockerId, primaryBlockerPinned };
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
type OpFields = "steps" | "labels" | "links" | "attachments" | "dependencies" | "primaryBlockerId" | "primaryBlockerPinned";

export function applyCardOps(
  card: Pick<Card, "id" | OpFields>,
  ops: CardOps,
  now: string,
): Pick<CardPatch, OpFields> {
  const out: Pick<CardPatch, OpFields> = {};
  const stepOps = nonEmptyArray(ops.stepOps);
  if (stepOps) out.steps = applyStepOps(card.steps ?? [], stepOps, now);
  const labelOps = nonEmptyArray(ops.labelOps);
  if (labelOps) out.labels = applyListOps(card.labels ?? [], labelOps);
  const linkOps = nonEmptyArray(ops.linkOps);
  if (linkOps) out.links = applyListOps(card.links ?? [], linkOps);
  const attachmentOps = nonEmptyArray(ops.attachmentOps);
  if (attachmentOps) out.attachments = applyAttachmentOps(card.attachments ?? [], attachmentOps);
  const dependencyOps = nonEmptyArray(ops.dependencyOps);
  if (dependencyOps) {
    const next = applyDependencyOps(card.id, card, dependencyOps, now);
    out.dependencies = next.dependencies;
    // Only a changed pointer joins the patch, so a plain add leaves the
    // primary blocker exactly as the current card has it.
    if ((next.primaryBlockerId ?? null) !== (card.primaryBlockerId ?? null)) out.primaryBlockerId = next.primaryBlockerId;
    if ((next.primaryBlockerPinned === true) !== (card.primaryBlockerPinned === true)) {
      out.primaryBlockerPinned = next.primaryBlockerPinned;
    }
  }
  return out;
}
