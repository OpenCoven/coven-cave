import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { homedir } from "node:os";

import {
  DEFAULT_MAX_RETRIES,
  type Card,
  type CardGitHubLink,
  type CardLifecycle,
  type CardPriority,
  type CardStatus,
} from "@/lib/cave-board-types";
import {
  mergeLinksWithGitHub,
  mergeTaskGitHubLinks as mergeGitHubLinks,
  normalizeTaskGitHubLinks,
  taskGitHubLinkFromUrl,
} from "@/lib/task-github";
import { loadProjects, projectForRoot } from "@/lib/cave-projects";

export {
  DEFAULT_MAX_RETRIES,
  DEFAULT_TIMEOUT_MS,
  LIFECYCLES,
  PRIORITIES,
  STATUSES,
  type Card,
  type CardGitHubLink,
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

function normalizeList(values: string[] | undefined): string[] {
  return [...new Set((values ?? []).map((value) => value.trim()).filter(Boolean))];
}

function normalizeLinks(values: string[] | undefined): string[] {
  return normalizeList(values);
}

function normalizeGitHubLinks(values: CardGitHubLink[] | undefined): CardGitHubLink[] {
  return normalizeTaskGitHubLinks(values);
}

function gitHubLinksFromLinks(values: string[] | undefined): CardGitHubLink[] {
  return (values ?? [])
    .map((url) => taskGitHubLinkFromUrl(url))
    .filter((item): item is CardGitHubLink => item !== null);
}

function normalizeCwd(value: string | null | undefined): string | null {
  const cwd = value?.trim();
  return cwd ? cwd : null;
}

type LegacyCard = Omit<
  Card,
  "cwd" | "projectId" | "links" | "github" | "lifecycle" | "lifecycleAt" | "retryCount" | "maxRetries" | "steps"
> &
  Partial<
    Pick<
      Card,
      "cwd" | "projectId" | "links" | "github" | "lifecycle" | "lifecycleAt" | "retryCount" | "maxRetries" | "steps"
    >
  >;

function backfillCard(c: Card | LegacyCard): Card {
  const lifecycle = c.lifecycle ?? inferLifecycle(c.status);
  const github = mergeGitHubLinks(normalizeGitHubLinks(c.github), ...gitHubLinksFromLinks(c.links));
  const links = mergeLinksWithGitHub(normalizeLinks(c.links), github);
  return {
    ...c,
    status: statusForLifecycle(lifecycle, c.status),
    cwd: normalizeCwd(c.cwd),
    projectId: c.projectId ?? null,
    links,
    github,
    labels: normalizeList(c.labels),
    lifecycle,
    lifecycleAt: c.lifecycleAt ?? c.updatedAt,
    retryCount: c.retryCount ?? 0,
    maxRetries: c.maxRetries ?? DEFAULT_MAX_RETRIES,
    steps: c.steps ?? [],
  } as Card;
}

function migrateProjectId(card: Card, projects: Awaited<ReturnType<typeof loadProjects>>): Card {
  if (card.projectId || !card.cwd) return card;
  const project = projectForRoot(card.cwd, projects);
  return project ? { ...card, projectId: project.id } : card;
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
    const projects = await loadProjects();
    return {
      version: parsed.version ?? 1,
      cards: rawCards.map((c) => migrateProjectId(backfillCard(c as Card), projects)),
    };
  } catch {
    return EMPTY;
  }
}

// Serialize board mutations. Each mutator does load → modify → save; without
// serialization two concurrent mutations both read the same snapshot and the
// second save clobbers the first (lost update). Same pattern as cave-inbox /
// workflow-source.
let boardWriteChain: Promise<unknown> = Promise.resolve();
function withBoardLock<T>(fn: () => Promise<T>): Promise<T> {
  const next = boardWriteChain.then(fn, fn);
  boardWriteChain = next.catch(() => undefined);
  return next;
}

let boardTmpCounter = 0;

export async function saveBoard(board: BoardFile): Promise<void> {
  await ensureDir();
  // Atomic write: plain writeFile truncates-then-writes, so a concurrent reader
  // can observe a half-written file. loadBoard() then fails to parse it and
  // falls back to an empty board, making cards momentarily "vanish" — e.g. a
  // task-chat POST 404ing ("not found") on a card that actually exists. Write to
  // a temp file and rename() instead: rename is atomic on POSIX, so a reader
  // always sees a complete old-or-new file, never a torn one.
  const tmp = `${BOARD_PATH}.${process.pid}.${boardTmpCounter++}.tmp`;
  await writeFile(tmp, JSON.stringify(board, null, 2), "utf8");
  await rename(tmp, BOARD_PATH);
}

export type NewCardInput = {
  title: string;
  notes?: string;
  status?: CardStatus;
  priority?: CardPriority;
  familiarId?: string | null;
  sessionId?: string | null;
  cwd?: string | null;
  projectId?: string | null;
  links?: string[];
  github?: CardGitHubLink[];
  labels?: string[];
  template?: string | null;
};

export async function createCard(input: NewCardInput): Promise<Card> {
  return withBoardLock(async () => {
  const board = await loadBoard();
  const now = new Date().toISOString();
  const status: CardStatus = input.status ?? "backlog";
  const github = mergeGitHubLinks(normalizeGitHubLinks(input.github), ...gitHubLinksFromLinks(input.links));
  const card: Card = {
    id: crypto.randomUUID(),
    title: input.title.trim(),
    notes: (input.notes ?? "").trim(),
    status,
    priority: input.priority ?? "medium",
    familiarId: input.familiarId ?? null,
    sessionId: input.sessionId ?? null,
    cwd: normalizeCwd(input.cwd),
    projectId: input.projectId ?? null,
    links: mergeLinksWithGitHub(normalizeLinks(input.links), github),
    github,
    labels: normalizeList(input.labels),
    template: input.template ?? null,
    createdAt: now,
    updatedAt: now,
    lifecycle: inferLifecycle(status),
    lifecycleAt: now,
    retryCount: 0,
    maxRetries: DEFAULT_MAX_RETRIES,
    steps: [],
  };
  board.cards.push(card);
  await saveBoard(board);
  return card;
  });
}

export async function updateCard(
  id: string,
  patch: Partial<Omit<Card, "id" | "createdAt">>,
): Promise<Card | null> {
  return withBoardLock(async () => {
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
      ? normalizeList(patch.labels)
      : current.labels,
    github: mergeGitHubLinks(
      normalizeGitHubLinks("github" in patch ? patch.github : current.github),
      ...gitHubLinksFromLinks("links" in patch ? patch.links : current.links),
    ),
    links: mergeLinksWithGitHub(
      "links" in patch ? normalizeLinks(patch.links) : current.links,
      mergeGitHubLinks(
        normalizeGitHubLinks("github" in patch ? patch.github : current.github),
        ...gitHubLinksFromLinks("links" in patch ? patch.links : current.links),
      ),
    ),
    cwd: "cwd" in patch ? normalizeCwd(patch.cwd) : current.cwd,
    projectId: "projectId" in patch ? patch.projectId ?? null : current.projectId ?? null,
    sessionId: "sessionId" in patch ? patch.sessionId ?? null : current.sessionId,
    steps: patch.steps ?? current.steps,
  };
  if (next.lifecycle === "running" && !next.runningSince) {
    next.runningSince = next.updatedAt;
  } else if (next.lifecycle !== "running") {
    delete next.runningSince;
  }
  board.cards[idx] = next;
  await saveBoard(board);
  return next;
  });
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
  return withBoardLock(async () => {
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
  });
}

export async function deleteCard(id: string): Promise<boolean> {
  return withBoardLock(async () => {
  const board = await loadBoard();
  const before = board.cards.length;
  board.cards = board.cards.filter((c) => c.id !== id);
  if (board.cards.length === before) return false;
  await saveBoard(board);
  return true;
  });
}

export { BOARD_PATH };
