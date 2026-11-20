import {
  computeNextOccurrence,
  loadInbox,
  withInboxLock,
  type InboxItem,
} from "@/lib/cave-inbox";
import { automationsDomain } from "@/lib/server/automations-domain";
import { isStartupWorkerShutdownRequested } from "@/lib/server/startup-worker-shutdown";

const TICK_MS = 15_000;

export type InboxEvent =
  | { type: "snapshot"; items: InboxItem[] }
  | { type: "fired"; items: InboxItem[] }
  | { type: "created"; item: InboxItem }
  | { type: "updated"; item: InboxItem }
  | { type: "deleted"; id: string };

type Subscriber = {
  controller: ReadableStreamDefaultController<Uint8Array>;
  encoder: TextEncoder;
};

type InboxScheduler = {
  wanted: boolean;
  revision: number;
  timer?: ReturnType<typeof setInterval>;
  pending?: Promise<void>;
  starting?: Promise<void>;
};

declare global {
  // eslint-disable-next-line no-var
  var __caveInboxScheduler: InboxScheduler | undefined;
  // eslint-disable-next-line no-var
  var __inboxSubscribers: Set<Subscriber> | undefined;
}

function subscribers(): Set<Subscriber> {
  if (!globalThis.__inboxSubscribers) {
    globalThis.__inboxSubscribers = new Set();
  }
  return globalThis.__inboxSubscribers;
}

function serialize(event: InboxEvent): Uint8Array {
  const enc = new TextEncoder();
  return enc.encode(`data: ${JSON.stringify(event)}\n\n`);
}

export function broadcast(event: InboxEvent): void {
  const subs = subscribers();
  for (const sub of subs) {
    try {
      sub.controller.enqueue(serialize(event));
    } catch {
      subs.delete(sub);
    }
  }
}

export function subscribe(
  controller: ReadableStreamDefaultController<Uint8Array>,
): () => void {
  const sub: Subscriber = { controller, encoder: new TextEncoder() };
  subscribers().add(sub);
  return () => subscribers().delete(sub);
}

export async function snapshot(): Promise<InboxItem[]> {
  const file = await loadInbox();
  return file.items;
}

async function tick(): Promise<void> {
  const fired = await withInboxLock(async ({ load, save }) => {
    const now = Date.now();
    const file = await load();

    const dueIdx: number[] = [];
    for (let i = 0; i < file.items.length; i++) {
      const it = file.items[i];
      if (it.status !== "pending") continue;
      const target = it.fireAt ? Date.parse(it.fireAt) : NaN;
      if (Number.isFinite(target) && target <= now) {
        dueIdx.push(i);
      }
    }

    if (dueIdx.length === 0) return [] as InboxItem[];

    const out: InboxItem[] = [];
    const nowIso = new Date(now).toISOString();
    for (const i of dueIdx) {
      const it = file.items[i];
      const updated: InboxItem = {
        ...it,
        status: "fired",
        firedAt: nowIso,
        updatedAt: nowIso,
        // A (re)fire is a fresh demand for attention — a snoozed reminder the
        // user read last time must come back unread.
        readAt: null,
      };
      file.items[i] = updated;
      out.push(updated);

      if (updated.recurrence && updated.recurrence.type !== "none") {
        const nextIso = computeNextOccurrence(updated.recurrence, now);
        if (nextIso) {
          const sibling: InboxItem = {
            ...updated,
            id: crypto.randomUUID(),
            status: "pending",
            fireAt: nextIso,
            firedAt: null,
            snoozeUntil: null,
            createdAt: nowIso,
            updatedAt: nowIso,
            readAt: null,
          };
          file.items.push(sibling);
        }
      }
    }

    await save(file);
    return out;
  });

  if (fired.length) broadcast({ type: "fired", items: fired });
}

function schedulerOwner(): InboxScheduler {
  return globalThis.__caveInboxScheduler ??= { wanted: false, revision: 0 };
}

function pass(owner: InboxScheduler): void {
  // A slow store must not accumulate one queued transaction per interval:
  // one pass is in flight at a time, and each pass reads the current due
  // items, so skipped timer events need no replay. Admission belongs to this
  // pass; stopping clears future passes while the admitted transaction keeps
  // its authority over the delivery it already began.
  if (!owner.wanted || owner.pending) return;
  const pending = tick()
    .catch(() => undefined)
    .finally(() => {
      if (owner.pending === pending) owner.pending = undefined;
    });
  owner.pending = pending;
}

/**
 * Start the reminder worker (#6295): one process-local owner, one 15-second
 * timer and a boot catch-up pass for reminders that fired while Cave was quit.
 * A disabled automations domain or a coordinated shutdown owns no timer and
 * admits no pass. Routes call this at module load, so a request finishing
 * after shutdown cannot restart the worker.
 */
export function startScheduler(): Promise<void> {
  if (!automationsDomain().enabled || isStartupWorkerShutdownRequested()) return Promise.resolve();
  const owner = schedulerOwner();
  if (owner.wanted) return owner.starting ?? Promise.resolve();
  owner.wanted = true;
  const revision = ++owner.revision;
  const activate = () => {
    if (!owner.wanted || owner.revision !== revision) return;
    owner.timer = setInterval(() => { pass(owner); }, TICK_MS);
    pass(owner);
  };
  if (!owner.pending) {
    activate();
    return Promise.resolve();
  }
  // A restart cannot create another owner while an old admitted pass drains.
  const starting = owner.pending.then(activate);
  owner.starting = starting;
  const settled = () => {
    if (owner.starting === starting) owner.starting = undefined;
  };
  void starting.then(settled, settled);
  return starting;
}

/** Stop admission now; the caller may observe a deadline without cancelling work. */
export function stopScheduler(): Promise<void> {
  const owner = schedulerOwner();
  owner.wanted = false;
  owner.revision += 1;
  if (owner.timer !== undefined) clearInterval(owner.timer);
  owner.timer = undefined;
  return owner.pending ?? Promise.resolve();
}

/**
 * Helper for fire-now agent notifications — pushes the broadcast without
 * touching the scheduler queue. Caller is responsible for the actual create.
 */
export function broadcastCreated(item: InboxItem): void {
  broadcast({ type: "created", item });
}

export function broadcastUpdated(item: InboxItem): void {
  broadcast({ type: "updated", item });
}

export function broadcastDeleted(id: string): void {
  broadcast({ type: "deleted", id });
}

export async function broadcastSnapshot(
  controller: ReadableStreamDefaultController<Uint8Array>,
): Promise<void> {
  const items = await snapshot();
  const enc = new TextEncoder();
  controller.enqueue(
    enc.encode(`data: ${JSON.stringify({ type: "snapshot", items })}\n\n`),
  );
}
