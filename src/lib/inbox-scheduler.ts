import {
  computeNextOccurrence,
  loadInbox,
  saveInbox,
  withInboxLock,
  type InboxItem,
} from "@/lib/cave-inbox";

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

declare global {
  // eslint-disable-next-line no-var
  var __inboxSchedulerStarted: boolean | undefined;
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
  const fired = await withInboxLock(async () => {
    const now = Date.now();
    const file = await loadInbox();

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

    await saveInbox(file);
    return out;
  });

  if (fired.length) broadcast({ type: "fired", items: fired });
}

export function startScheduler(): void {
  if (globalThis.__inboxSchedulerStarted) return;
  globalThis.__inboxSchedulerStarted = true;
  // Boot tick (catch up reminders that fired while Cave was quit).
  void tick().catch(() => undefined);
  setInterval(() => {
    void tick().catch(() => undefined);
  }, TICK_MS);
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
