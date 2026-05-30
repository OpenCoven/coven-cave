import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { homedir } from "node:os";

const BOARD_PATH = path.join(homedir(), ".coven", "cave-board.json");

export type CardStatus = "inbox" | "running" | "review" | "blocked";
export type CardPriority = "low" | "medium" | "high" | "urgent";

export type Card = {
  id: string;
  title: string;
  notes: string;
  status: CardStatus;
  priority: CardPriority;
  familiarId: string | null;
  sessionId: string | null;
  labels: string[];
  template?: string | null;
  createdAt: string;
  updatedAt: string;
};

export const STATUSES: CardStatus[] = ["inbox", "running", "review", "blocked"];
export const PRIORITIES: CardPriority[] = ["urgent", "high", "medium", "low"];

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
    return {
      version: parsed.version ?? 1,
      cards: Array.isArray(parsed.cards) ? parsed.cards : [],
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
  const card: Card = {
    id: crypto.randomUUID(),
    title: input.title.trim(),
    notes: (input.notes ?? "").trim(),
    status: input.status ?? "inbox",
    priority: input.priority ?? "medium",
    familiarId: input.familiarId ?? null,
    sessionId: input.sessionId ?? null,
    labels: (input.labels ?? []).map((l) => l.trim()).filter(Boolean),
    template: input.template ?? null,
    createdAt: now,
    updatedAt: now,
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
