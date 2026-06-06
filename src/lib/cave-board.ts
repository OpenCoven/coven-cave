import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { homedir } from "node:os";

import {
  DEFAULT_MAX_RETRIES,
  type Card,
  type CardLifecycle,
  type CardPriority,
  type CardStatus,
} from "@/lib/cave-board-types";

export {
  DEFAULT_MAX_RETRIES,
  DEFAULT_TIMEOUT_MS,
  LIFECYCLES,
  PRIORITIES,
  STATUSES,
  type Card,
  type CardLifecycle,
  type CardPriority,
  type CardStatus,
} from "@/lib/cave-board-types";

const BOARD_PATH = path.join(homedir(), ".coven", "cave-board.json");

/**
 * Old cards predate the lifecycle machine. Map their column `status` to the
 * closest lifecycle state so visuals look sane the first time a user opens
 * the Board after upgrading.
 */
function inferLifecycle(status: CardStatus): CardLifecycle {
  if (status === "running") return "running";
  if (status === "review") return "review";
  if (status === "done") return "completed";
  if (status === "blocked") return "failed";
  return "queued";
}

function statusForLifecycle(lifecycle: CardLifecycle, currentStatus: CardStatus): CardStatus {
  if (lifecycle === "dispatched" || lifecycle === "running") return "running";
  if (lifecycle === "review") return "review";
  if (lifecycle === "completed") return "done";
  if (lifecycle === "failed" || lifecycle === "cancelled") return "blocked";
  return currentStatus;
}

function backfillCard(c: Card | (Omit<Card, "lifecycle" | "lifecycleAt" | "retryCount" | "maxRetries"> & Partial<Pick<Card, "lifecycle" | "lifecycleAt" | "retryCount" | "maxRetries">>)): Card {
  const lifecycle = c.lifecycle ?? inferLifecycle(c.status);
  return {
    ...c,
    status: statusForLifecycle(lifecycle, c.status),
    lifecycle,
    lifecycleAt: c.lifecycleAt ?? c.updatedAt,
    retryCount: c.retryCount ?? 0,
    maxRetries: c.maxRetries ?? DEFAULT_MAX_RETRIES,
  } as Card;
}

type BoardFile = {
  version: number;
  cards: Card[];
};

const EMPTY: BoardFile = { version: 1, cards: [] };

async function ensureDir() {
  await mkdir(path.dirname(BOARD_PATH), { recursive: true });
}

export async function loadBoard(): Promise<BoardFile> {
  try {
    const raw = await readFile(BOARD_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<BoardFile>;
    const rawCards = Array.isArray(parsed.cards) ? parsed.cards : [];
    return {
      version: parsed.version ?? 1,
      cards: rawCards.map((c) => backfillCard(c as Card)),
    };
  } catch {
    return EMPTY;
  }
}

export async function saveBoard(board: BoardFile): Promise<void> {
  await ensureDir();
  await writeFile(BOARD_PATH, JSON.stringify(board, null, 2), "utf8");
}

export type NewCardInput = {
  title: string;
  notes?: string;
  status?: CardStatus;
  priority?: CardPriority;
  familiarId?: string | null;
  sessionId?: string | null;
  labels?: string[];
  template?: string | null;
};

export async function createCard(input: NewCardInput): Promise<Card> {
  const board = await loadBoard();
  const now = new Date().toISOString();
  const status: CardStatus = input.status ?? "backlog";
  const card: Card = {
    id: crypto.randomUUID(),
    title: input.title.trim(),
    notes: (input.notes ?? "").trim(),
    status,
    priority: input.priority ?? "medium",
    familiarId: input.familiarId ?? null,
    sessionId: input.sessionId ?? null,
    labels: (input.labels ?? []).map((l) => l.trim()).filter(Boolean),
    template: input.template ?? null,
    createdAt: now,
    updatedAt: now,
    lifecycle: inferLifecycle(status),
    lifecycleAt: now,
    retryCount: 0,
    maxRetries: DEFAULT_MAX_RETRIES,
  };
  board.cards.push(card);
  await saveBoard(board);
  return card;
}

export async function updateCard(
  id: string,
  patch: Partial<Omit<Card, "id" | "createdAt">>,
): Promise<Card | null> {
  const board = await loadBoard();
  const idx = board.cards.findIndex((c) => c.id === id);
  if (idx < 0) return null;
  const current = board.cards[idx];
  const next: Card = {
    ...current,
    ...patch,
    id: current.id,
    createdAt: current.createdAt,
    updatedAt: new Date().toISOString(),
    labels: patch.labels
      ? patch.labels.map((l) => l.trim()).filter(Boolean)
      : current.labels,
  };
  if (next.lifecycle === "running" && !next.runningSince) {
    next.runningSince = next.updatedAt;
  } else if (next.lifecycle !== "running") {
    delete next.runningSince;
  }
  board.cards[idx] = next;
  await saveBoard(board);
  return next;
}

/**
 * Move a card through the lifecycle state machine. Encapsulates the rules
 * we don't want call sites to forget — most importantly that `failed`
 * without remaining retries moves the card into the Blocked column with a
 * `needs human` flag.
 *
 * Transitions enforced:
 *   queued      → dispatched | cancelled
 *   dispatched  → running | failed | cancelled
 *   running     → review | completed | failed | cancelled
 *   review      → completed | failed
 *   completed   → (terminal)
 *   failed      → queued (retry) | cancelled  (auto-rollback handles needsHuman)
 *   cancelled   → queued
 *
 * `retry: true` on a failed→queued transition increments retryCount.
 */
const VALID_NEXT: Record<CardLifecycle, CardLifecycle[]> = {
  queued: ["dispatched", "cancelled"],
  dispatched: ["running", "failed", "cancelled"],
  running: ["review", "completed", "failed", "cancelled"],
  review: ["completed", "failed"],
  completed: [],
  failed: ["queued", "cancelled"],
  cancelled: ["queued"],
};

export type TransitionInput = {
  to: CardLifecycle;
  reason?: string;
  retry?: boolean;
};

export async function transitionCard(
  id: string,
  { to, reason, retry }: TransitionInput,
): Promise<Card | null> {
  const board = await loadBoard();
  const idx = board.cards.findIndex((c) => c.id === id);
  if (idx < 0) return null;
  const current = board.cards[idx];
  if (!VALID_NEXT[current.lifecycle]?.includes(to)) {
    throw new Error(`invalid transition: ${current.lifecycle} → ${to}`);
  }
  const now = new Date().toISOString();
  const next: Card = {
    ...current,
    lifecycle: to,
    lifecycleAt: now,
    lifecycleReason: reason ?? undefined,
    updatedAt: now,
  };
  if (to !== "running") {
    delete next.runningSince;
  }

  // Column-status fallouts of lifecycle transitions:
  if (to === "running") {
    next.status = "running";
    next.runningSince = now;
    next.needsHuman = false;
  } else if (to === "dispatched") {
    next.status = "running";
    next.needsHuman = false;
  } else if (to === "review") {
    next.status = "review";
  } else if (to === "completed") {
    next.status = "done";
    next.needsHuman = false;
  } else if (to === "failed") {
    const exhausted = current.retryCount >= current.maxRetries;
    if (exhausted) {
      // Auto-rollback: failed without remaining retries → Blocked with
      // `needs human` flag. Spec section 3 (rollback behavior).
      next.status = "blocked";
      next.needsHuman = true;
    } else {
      next.status = "blocked";
    }
  } else if (to === "queued") {
    if (retry) {
      next.retryCount = current.retryCount + 1;
    }
    next.status = "backlog";
    next.needsHuman = false;
  } else if (to === "cancelled") {
    next.status = "blocked";
    next.needsHuman = false;
  }

  board.cards[idx] = next;
  await saveBoard(board);
  return next;
}

export async function deleteCard(id: string): Promise<boolean> {
  const board = await loadBoard();
  const before = board.cards.length;
  board.cards = board.cards.filter((c) => c.id !== id);
  if (board.cards.length === before) return false;
  await saveBoard(board);
  return true;
}

export { BOARD_PATH };
