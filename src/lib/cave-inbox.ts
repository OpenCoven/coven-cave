import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { homedir } from "node:os";

const INBOX_PATH = path.join(homedir(), ".coven", "cave-inbox.json");

export type ItemKind = "reminder" | "agent" | "response-needed";
export type ItemStatus = "pending" | "fired" | "snoozed" | "dismissed" | "done";

export type Recurrence =
  | { type: "none" }
  | { type: "interval"; everyMs: number }
  | { type: "daily"; hour: number; minute: number }
  | { type: "weekly"; days: number[]; hour: number; minute: number };

export type LinkRef = {
  kind: "session" | "card" | "memory" | "url";
  ref: string;
};

export type InboxItem = {
  id: string;
  kind: ItemKind;
  title: string;
  body?: string;
  status: ItemStatus;
  createdAt: string;
  updatedAt: string;
  fireAt?: string | null;
  firedAt?: string | null;
  snoozeUntil?: string | null;
  recurrence: Recurrence;
  source: "user" | "agent" | "system";
  familiarId?: string | null;
  sessionId?: string | null;
  link?: LinkRef | null;
};

type InboxFile = {
  version: number;
  items: InboxItem[];
};

const EMPTY: InboxFile = { version: 1, items: [] };

async function ensureDir() {
  await mkdir(path.dirname(INBOX_PATH), { recursive: true });
}

export async function loadInbox(): Promise<InboxFile> {
  try {
    const raw = await readFile(INBOX_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<InboxFile>;
    return {
      version: parsed.version ?? 1,
      items: Array.isArray(parsed.items) ? parsed.items : [],
    };
  } catch {
    return { version: 1, items: [] };
  }
}

export async function saveInbox(file: InboxFile): Promise<void> {
  await ensureDir();
  await writeFile(INBOX_PATH, JSON.stringify(file, null, 2), "utf8");
}

// Serialize all read-modify-write sequences against the inbox file. Without
// this, two concurrent route handlers can each load N items, each remove
// their target, and each save N-1 — the last writer wins and the other
// deletion is lost. Attached to globalThis so the chain survives Next.js
// dev hot-reloads (same pattern as the scheduler singleton).
declare global {
  // eslint-disable-next-line no-var
  var __inboxWriteChain: Promise<unknown> | undefined;
}

export function withInboxLock<T>(fn: () => Promise<T>): Promise<T> {
  const prev = globalThis.__inboxWriteChain ?? Promise.resolve();
  const next = prev.then(fn, fn);
  globalThis.__inboxWriteChain = next.catch(() => undefined);
  return next;
}

export type NewItemInput = {
  kind: ItemKind;
  title: string;
  body?: string;
  fireAt?: string | null;
  recurrence?: Recurrence;
  source?: "user" | "agent" | "system";
  familiarId?: string | null;
  sessionId?: string | null;
  link?: LinkRef | null;
};

export async function createItem(input: NewItemInput): Promise<InboxItem> {
  return withInboxLock(async () => {
    const file = await loadInbox();
    const now = new Date().toISOString();
    const status: ItemStatus =
      input.kind === "agent" && !input.fireAt ? "fired" : "pending";
    const item: InboxItem = {
      id: crypto.randomUUID(),
      kind: input.kind,
      title: input.title.trim(),
      body: input.body?.trim() || undefined,
      status,
      createdAt: now,
      updatedAt: now,
      fireAt: input.fireAt ?? null,
      firedAt: status === "fired" ? now : null,
      snoozeUntil: null,
      recurrence: input.recurrence ?? { type: "none" },
      source: input.source ?? "user",
      familiarId: input.familiarId ?? null,
      sessionId: input.sessionId ?? null,
      link: input.link ?? null,
    };
    file.items.push(item);
    await saveInbox(file);
    return item;
  });
}

export async function updateItem(
  id: string,
  patch: Partial<Omit<InboxItem, "id" | "createdAt">>,
): Promise<InboxItem | null> {
  return withInboxLock(async () => {
    const file = await loadInbox();
    const idx = file.items.findIndex((i) => i.id === id);
    if (idx < 0) return null;
    const current = file.items[idx];
    const next: InboxItem = {
      ...current,
      ...patch,
      id: current.id,
      createdAt: current.createdAt,
      updatedAt: new Date().toISOString(),
    };
    file.items[idx] = next;
    await saveInbox(file);
    return next;
  });
}

export async function deleteItem(id: string): Promise<boolean> {
  return withInboxLock(async () => {
    const file = await loadInbox();
    const before = file.items.length;
    file.items = file.items.filter((i) => i.id !== id);
    if (file.items.length === before) return false;
    await saveInbox(file);
    return true;
  });
}

export async function listPending(): Promise<InboxItem[]> {
  const file = await loadInbox();
  return file.items.filter((i) => i.status === "pending");
}

export async function listFired(): Promise<InboxItem[]> {
  const file = await loadInbox();
  return file.items.filter((i) => i.status === "fired");
}

export async function snoozeItem(
  id: string,
  untilIso: string,
): Promise<InboxItem | null> {
  return updateItem(id, { status: "pending", fireAt: untilIso, snoozeUntil: untilIso });
}

export async function markDone(id: string): Promise<InboxItem | null> {
  return updateItem(id, { status: "done" });
}

export async function dismissItem(id: string): Promise<InboxItem | null> {
  return updateItem(id, { status: "dismissed" });
}

/**
 * Phase 1 supports only one-shots; recurrence stays for forward compatibility.
 * Returns null when there is no further occurrence (one-shot, or "none").
 */
export function computeNextOccurrence(
  rec: Recurrence,
  fromMs: number,
): string | null {
  if (rec.type === "none") return null;
  if (rec.type === "interval") {
    return new Date(fromMs + rec.everyMs).toISOString();
  }
  if (rec.type === "daily") {
    const d = new Date(fromMs);
    d.setSeconds(0, 0);
    d.setHours(rec.hour, rec.minute, 0, 0);
    while (d.getTime() <= fromMs) d.setDate(d.getDate() + 1);
    return d.toISOString();
  }
  if (rec.type === "weekly") {
    if (rec.days.length === 0) return null;
    const allowed = new Set(rec.days);
    const d = new Date(fromMs);
    d.setSeconds(0, 0);
    d.setHours(rec.hour, rec.minute, 0, 0);
    for (let i = 0; i < 14; i++) {
      if (d.getTime() > fromMs && allowed.has(d.getDay())) return d.toISOString();
      d.setDate(d.getDate() + 1);
    }
    return null;
  }
  return null;
}

export { INBOX_PATH };
