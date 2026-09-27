import { stat } from "node:fs/promises";
import { BOARD_PATH, loadBoard } from "./cave-board.ts";
import type { Card } from "./cave-board-types.ts";
import { projectsFilePath } from "./cave-projects.ts";

/**
 * The board's cards grouped by the chat session they link to (#5595).
 *
 * Every conversation GET (hover prefetches included) asked "which cards link
 * to this session?" by loading and migrating the whole board: ~7ms of
 * event-loop time per request on a real 571 KB board. The index is rebuilt
 * only when the board file or the projects file (which card project ids are
 * derived from) changes identity. Board writes are atomic renames, so every
 * write changes the inode and a stale answer is never served.
 *
 * The identity is taken BEFORE the load: a write that lands during a rebuild
 * leaves this entry keyed to the older file, so the next read rebuilds again.
 * Cards are shared between readers and must be treated as read-only.
 */

type BoardSessionIndex = { key: string; bySession: Map<string, readonly Card[]> };

let index: BoardSessionIndex | null = null;
let building: { key: string; promise: Promise<BoardSessionIndex> } | null = null;
const NO_CARDS: readonly Card[] = [];

async function fileIdentity(file: string): Promise<string> {
  try {
    const info = await stat(file, { bigint: true });
    return `${info.ino}:${info.mtimeNs}:${info.size}`;
  } catch {
    return "-";
  }
}

async function currentIndex(): Promise<BoardSessionIndex> {
  const key = `${await fileIdentity(BOARD_PATH)}|${await fileIdentity(projectsFilePath())}`;
  if (index?.key === key) return index;
  if (building?.key === key) return building.promise;
  const promise = (async () => {
    const board = await loadBoard();
    const bySession = new Map<string, Card[]>();
    for (const card of board.cards) {
      if (!card.sessionId) continue;
      const cards = bySession.get(card.sessionId);
      if (cards) cards.push(card);
      else bySession.set(card.sessionId, [card]);
    }
    const built: BoardSessionIndex = { key, bySession };
    index = built;
    return built;
  })();
  building = { key, promise };
  try {
    return await promise;
  } finally {
    if (building?.promise === promise) building = null;
  }
}

/** Cards linked to `sessionId`, in board order. Read-only: shared by readers. */
export async function boardCardsForSession(sessionId: string): Promise<readonly Card[]> {
  if (!sessionId) return NO_CARDS;
  return (await currentIndex()).bySession.get(sessionId) ?? NO_CARDS;
}

/** Test seam. */
export function clearBoardSessionIndex(): void {
  index = null;
  building = null;
}
