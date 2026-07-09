import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { homedir } from "node:os";
import { writeJsonAtomic } from "./server/atomic-write.ts";

import {
  DEFAULT_MAX_RETRIES,
  type Card,
  type CardAsanaLink,
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
import {
  mergeLinksWithAsana,
  mergeTaskAsanaLinks as mergeAsanaLinks,
  normalizeTaskAsanaLinks,
  taskAsanaLinkFromUrl,
} from "@/lib/task-asana";
import { loadProjects, projectForRoot } from "@/lib/cave-projects";
import {
  normalizeChatAttachments,
  stripPreviewOnlyAttachmentFields,
  type ChatAttachment,
} from "@/lib/chat-attachments";
import { applyCardOps, hasCardOps, type CardPatch } from "@/lib/board-card-ops";

export {
  DEFAULT_MAX_RETRIES,
  DEFAULT_TIMEOUT_MS,
  LIFECYCLES,
  PRIORITIES,
  STATUSES,
  type Card,
  type CardAsanaLink,
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
  return [...new Set(toStringList(values).map((value) => value.trim()).filter(Boolean))];
}

// Defensive coercion for `links`. The Card type declares `links: string[]`, but
// older/hand-edited boards (and agent writes) have stored entries as
// `{ label, url }` objects — the same shape as the GitHub link list. Pull the
// `url` out of object entries so legacy data is salvaged instead of fatal.
function toStringList(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return values
    .map((value) => {
      if (typeof value === "string") return value;
      if (value && typeof value === "object" && typeof (value as { url?: unknown }).url === "string") {
        return (value as { url: string }).url;
      }
      return "";
    })
    .filter((value): value is string => value.length > 0);
}

function normalizeLinks(values: string[] | undefined): string[] {
  return normalizeList(values);
}

function normalizeGitHubLinks(values: CardGitHubLink[] | undefined): CardGitHubLink[] {
  return normalizeTaskGitHubLinks(values);
}

function gitHubLinksFromLinks(values: string[] | undefined): CardGitHubLink[] {
  return toStringList(values)
    .map((url) => taskGitHubLinkFromUrl(url))
    .filter((item): item is CardGitHubLink => item !== null);
}

function normalizeAsanaLinks(values: CardAsanaLink[] | undefined): CardAsanaLink[] {
  return normalizeTaskAsanaLinks(values);
}

// Derive structured Asana connections from bare app.asana.com URLs stashed in a
// card's `links` (or written by an agent) — the same backfill github does, so a
// pasted Asana task URL becomes a first-class connection.
function asanaLinksFromLinks(values: string[] | undefined): CardAsanaLink[] {
  return toStringList(values)
    .map((url) => taskAsanaLinkFromUrl(url))
    .filter((item): item is CardAsanaLink => item !== null);
}

function normalizeCwd(value: string | null | undefined): string | null {
  const cwd = value?.trim();
  return cwd ? cwd : null;
}

type LegacyCard = Omit<
  Card,
  "cwd" | "projectId" | "links" | "github" | "asana" | "lifecycle" | "lifecycleAt" | "retryCount" | "maxRetries" | "steps" | "startDate" | "endDate"
> &
  Partial<
    Pick<
      Card,
      "cwd" | "projectId" | "links" | "github" | "asana" | "lifecycle" | "lifecycleAt" | "retryCount" | "maxRetries" | "steps" | "startDate" | "endDate"
    >
  >;

function normalizeBoardDate(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
  const date = new Date(`${trimmed}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10) === trimmed ? trimmed : null;
}

function backfillCard(c: Card | LegacyCard): Card {
  const lifecycle = c.lifecycle ?? inferLifecycle(c.status);
  const github = mergeGitHubLinks(normalizeGitHubLinks(c.github), ...gitHubLinksFromLinks(c.links));
  const asana = mergeAsanaLinks(normalizeAsanaLinks(c.asana), ...asanaLinksFromLinks(c.links));
  // Both link derivations feed back into `links` so a card's URL list stays the
  // union of everything attached, regardless of which source added it.
  const links = mergeLinksWithAsana(mergeLinksWithGitHub(normalizeLinks(c.links), github), asana);
  return {
    ...c,
    status: statusForLifecycle(lifecycle, c.status),
    cwd: normalizeCwd(c.cwd),
    projectId: c.projectId ?? null,
    links,
    github,
    asana,
    labels: normalizeList(c.labels),
    startDate: normalizeBoardDate(c.startDate),
    endDate: normalizeBoardDate(c.endDate),
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
  let parsed: unknown;
  try {
    const raw = await readFile(BOARD_PATH, "utf8");
    parsed = JSON.parse(raw);
  } catch {
    // Missing file or torn/invalid JSON — nothing recoverable.
    return EMPTY;
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return EMPTY;
  }
  const board = parsed as Partial<BoardFile>;
  const rawCards = Array.isArray(board.cards) ? board.cards : [];
  const projects = await loadProjects();
  // Normalize each card in isolation. A single malformed card (e.g. `links`
  // stored as objects instead of strings) must never throw out of the whole
  // map and collapse the board to empty — that made every task, including all
  // familiar-scoped ones, silently vanish. Drop only the unrecoverable card.
  const cards: Card[] = [];
  for (const raw of rawCards) {
    try {
      cards.push(migrateProjectId(backfillCard(raw as Card), projects));
    } catch (err) {
      console.error(
        `cave-board: skipping unreadable card ${(raw as { id?: unknown })?.id ?? "<unknown>"}:`,
        err,
      );
    }
  }
  return { version: board.version ?? 1, cards };
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

export async function saveBoard(board: BoardFile): Promise<void> {
  await ensureDir();
  // Atomic write (temp file + rename): a plain writeFile truncates-then-writes,
  // so a concurrent reader can observe a half-written file, loadBoard() fails to
  // parse it and falls back to an empty board — cards momentarily "vanish" (e.g.
  // a task-chat POST 404ing on a card that exists). The write lock above
  // serializes mutations; writeJsonAtomic makes each write torn-read-safe.
  await writeJsonAtomic(BOARD_PATH, board);
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
  asana?: CardAsanaLink[];
  labels?: string[];
  startDate?: string | null;
  endDate?: string | null;
  template?: string | null;
  /** Optional checklist steps to seed the card with (e.g. a Salem path). */
  steps?: { text: string }[];
  /** Files staged in the composer, carried onto the card at creation time. */
  attachments?: ChatAttachment[];
};

/** Store attachments lean: normalize (bounds text + validates image payloads),
 * then strip the base64 `dataUrl`/`mimeType` so images ride as metadata only and
 * the board JSON stays small. Returns undefined when nothing usable remains. */
function boardAttachments(input: ChatAttachment[] | undefined): ChatAttachment[] | undefined {
  if (!input || input.length === 0) return undefined;
  const lean = stripPreviewOnlyAttachmentFields(normalizeChatAttachments(input));
  return lean.length ? lean : undefined;
}

export async function createCard(input: NewCardInput): Promise<Card> {
  return withBoardLock(async () => {
  const board = await loadBoard();
  const now = new Date().toISOString();
  const status: CardStatus = input.status ?? "backlog";
  const github = mergeGitHubLinks(normalizeGitHubLinks(input.github), ...gitHubLinksFromLinks(input.links));
  const asana = mergeAsanaLinks(normalizeAsanaLinks(input.asana), ...asanaLinksFromLinks(input.links));
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
    links: mergeLinksWithAsana(mergeLinksWithGitHub(normalizeLinks(input.links), github), asana),
    github,
    asana,
    labels: normalizeList(input.labels),
    startDate: normalizeBoardDate(input.startDate),
    endDate: normalizeBoardDate(input.endDate),
    template: input.template ?? null,
    createdAt: now,
    updatedAt: now,
    lifecycle: inferLifecycle(status),
    lifecycleAt: now,
    retryCount: 0,
    maxRetries: DEFAULT_MAX_RETRIES,
    steps: (input.steps ?? [])
      .map((s) => (s?.text ?? "").trim())
      .filter(Boolean)
      .map((text) => ({ id: crypto.randomUUID(), text, done: false, addedAt: now })),
  };
  const attachments = boardAttachments(input.attachments);
  if (attachments) card.attachments = attachments;
  board.cards.push(card);
  await saveBoard(board);
  return card;
  });
}

export async function updateCard(
  id: string,
  patchWithOps: CardPatch,
): Promise<Card | null> {
  return withBoardLock(async () => {
  const board = await loadBoard();
  const idx = board.cards.findIndex((c) => c.id === id);
  if (idx < 0) return null;
  const current = board.cards[idx];
  // Intent ops resolve against the CURRENT card here, inside the write lock —
  // a toggle/add/remove on one element can never clobber a concurrent edit to
  // another (the full-array clobber the board audit flagged). The resolved
  // arrays then flow through the exact same normalization as plain patches.
  const { ops, ...plain } = patchWithOps;
  const patch: Partial<Omit<Card, "id" | "createdAt">> = hasCardOps(ops)
    ? { ...plain, ...applyCardOps(current, ops, new Date().toISOString()) }
    : plain;
  // Resolve the structured connection lists once, then fold both back into
  // `links` so the URL list stays the union of everything attached (github +
  // asana + explicit links) — same invariant createCard/backfill maintain.
  const nextGithub = mergeGitHubLinks(
    normalizeGitHubLinks("github" in patch ? patch.github : current.github),
    ...gitHubLinksFromLinks("links" in patch ? patch.links : current.links),
  );
  const nextAsana = mergeAsanaLinks(
    normalizeAsanaLinks("asana" in patch ? patch.asana : current.asana),
    ...asanaLinksFromLinks("links" in patch ? patch.links : current.links),
  );
  const next: Card = {
    ...current,
    ...patch,
    id: current.id,
    createdAt: current.createdAt,
    updatedAt: new Date().toISOString(),
    labels: patch.labels
      ? normalizeList(patch.labels)
      : current.labels,
    github: nextGithub,
    asana: nextAsana,
    links: mergeLinksWithAsana(
      mergeLinksWithGitHub("links" in patch ? normalizeLinks(patch.links) : current.links, nextGithub),
      nextAsana,
    ),
    cwd: "cwd" in patch ? normalizeCwd(patch.cwd) : current.cwd,
    projectId: "projectId" in patch ? patch.projectId ?? null : current.projectId ?? null,
    sessionId: "sessionId" in patch ? patch.sessionId ?? null : current.sessionId,
    startDate: "startDate" in patch ? normalizeBoardDate(patch.startDate) : current.startDate ?? null,
    endDate: "endDate" in patch ? normalizeBoardDate(patch.endDate) : current.endDate ?? null,
    steps: patch.steps ?? current.steps,
    // Attachments patched from the inspector go through the same lean pipeline as
    // createCard — normalize + strip base64 image payloads — so an edit can never
    // fatten cave-board.json. An empty array clears them (field dropped).
    attachments: "attachments" in patch
      ? boardAttachments(patch.attachments ?? undefined)
      : current.attachments,
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
