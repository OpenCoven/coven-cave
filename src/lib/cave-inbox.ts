import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { computeNextOccurrence, type Recurrence } from "@/lib/inbox-recurrence";
import type { DailyReportPayload } from "./daily-report-facts.ts";
import { caveHome } from "./coven-paths.ts";
import { writeJsonAtomic } from "./server/atomic-write.ts";

const INBOX_PATH = path.join(caveHome(), "inbox.json");

export type ItemKind = "reminder" | "agent" | "response-needed" | "daily-summary";
export type ItemStatus = "pending" | "fired" | "snoozed" | "dismissed" | "done";

// Re-exported so existing consumers that say
// `import { Recurrence, computeNextOccurrence } from "@/lib/cave-inbox"`
// keep working. Definitions live in inbox-recurrence.ts (pure, no node:
// imports) so client components can reach them without dragging fs/promises
// into the browser bundle.
export { computeNextOccurrence };
export type { Recurrence };

export type LinkRef = {
  kind: "session" | "card" | "memory" | "url";
  ref: string;
};

export type InboxMedia = {
  kind: "summary-card";
  imageUrl: string;
  alt: string;
  stats: {
    reminders: number;
    responses: number;
    familiars: number;
    sessions: number;
    /** Optional day-in-review counts — absent on items generated before Phase B. */
    prsMerged?: number;
    cardsCompleted?: number;
  };
  generatedAt: string;
  /** Structured day-in-review facts, frozen per refresh. Absent on old items. */
  report?: DailyReportPayload | null;
  /** Familiar-written narrative layered on the facts (Phase C). */
  narrative?: {
    text: string;
    familiarId: string;
    /** Display name at generation time — survives familiar renames/deletes. */
    familiarName?: string;
    generatedAt: string;
    factsHash: string;
  } | null;
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
  media?: InboxMedia | null;
  /**
   * Discriminator for machine-generated items (e.g. archive nudges). Absent on
   * human/user-created items. Lets producers dedup and resolve their own items
   * without brittle title matching. See `task-archive-nudge.ts`.
   */
  auto?: string | null;
  /**
   * When the user acknowledged this notification (bell "Mark all read",
   * opening the item). Absent/null = unread — so every pre-upgrade fired item
   * counts as unread, matching the old badge that counted all of them. The
   * scheduler clears it on (re)fire so a snoozed reminder demands attention
   * again.
   */
  readAt?: string | null;
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
  await writeJsonAtomic(INBOX_PATH, file);
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
  media?: InboxMedia | null;
  auto?: string | null;
};

export async function createItem(input: NewItemInput): Promise<InboxItem> {
  return withInboxLock(async () => {
    const file = await loadInbox();
    const now = new Date().toISOString();
    const status: ItemStatus =
      (input.kind === "agent" || input.kind === "daily-summary") && !input.fireAt ? "fired" : "pending";
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
      media: input.media ?? null,
      auto: input.auto ?? null,
      readAt: null,
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

export type BulkAction = "read" | "unread" | "dismiss" | "done" | "delete";

export type BulkResult = {
  updated: InboxItem[];
  deletedIds: string[];
};

/**
 * Which items `all: true` targets, per action. Read/unread/dismiss operate on
 * the fired notification stack (what the bell shows); done and delete are
 * destructive enough that callers must name ids explicitly — the route
 * enforces that, this map just documents the eligible set.
 */
function eligibleForAll(action: BulkAction, item: InboxItem): boolean {
  if (action === "read") return item.status === "fired" && !item.readAt;
  if (action === "unread") return item.status === "fired" && !!item.readAt;
  if (action === "dismiss") return item.status === "fired";
  return false;
}

/**
 * Apply one action to many items in a single locked load→save cycle. The old
 * bell "Clear all" fanned out N sequential POSTs — N file rewrites and N SSE
 * broadcasts racing each other; this is one write. Unknown ids are skipped
 * (an item deleted elsewhere mid-flight is not an error).
 */
export async function applyBulkAction(
  action: BulkAction,
  ids: string[] | null,
): Promise<BulkResult> {
  return withInboxLock(async () => {
    const file = await loadInbox();
    const nowIso = new Date().toISOString();
    const idSet = ids ? new Set(ids) : null;
    const targeted = (item: InboxItem) =>
      idSet ? idSet.has(item.id) : eligibleForAll(action, item);

    const updated: InboxItem[] = [];
    const deletedIds: string[] = [];

    if (action === "delete") {
      file.items = file.items.filter((item) => {
        if (!targeted(item)) return true;
        deletedIds.push(item.id);
        return false;
      });
    } else {
      file.items = file.items.map((item) => {
        if (!targeted(item)) return item;
        let next: InboxItem;
        if (action === "read") {
          if (item.readAt) return item;
          next = { ...item, readAt: nowIso, updatedAt: nowIso };
        } else if (action === "unread") {
          if (!item.readAt) return item;
          next = { ...item, readAt: null, updatedAt: nowIso };
        } else {
          // dismiss | done — terminal states imply the item was seen.
          const status: ItemStatus = action === "dismiss" ? "dismissed" : "done";
          if (item.status === status) return item;
          next = { ...item, status, readAt: item.readAt ?? nowIso, updatedAt: nowIso };
        }
        updated.push(next);
        return next;
      });
    }

    if (updated.length > 0 || deletedIds.length > 0) await saveInbox(file);
    return { updated, deletedIds };
  });
}

export { INBOX_PATH };
