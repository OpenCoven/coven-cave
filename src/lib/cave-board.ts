import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { caveHome } from "./coven-paths.ts";
import { writeJsonAtomic } from "./server/atomic-write.ts";

import {
  DEFAULT_MAX_RETRIES,
  type Card,
  type CardAsanaLink,
  type CardBeadRef,
  type CardGitHubLink,
  type CardLifecycle,
  type CardPriority,
  type CardStatus,
  type TaskDependency,
  type TaskNextStep,
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
import { canonicalHarnessId } from "@/lib/harness-adapters";
import { assertValidOrchestration } from "@/lib/task-orchestration";

export {
  DEFAULT_MAX_RETRIES,
  DEFAULT_TIMEOUT_MS,
  LIFECYCLES,
  PRIORITIES,
  STATUSES,
  type Card,
  type CardAsanaLink,
  type CardBeadRef,
  type CardGitHubLink,
  type CardLifecycle,
  type CardPriority,
  type CardStatus,
  type TaskDependency,
  type TaskNextStep,
} from "@/lib/cave-board-types";
export { OrchestrationValidationError } from "@/lib/task-orchestration";

const BOARD_PATH = path.join(caveHome(), "board.json");

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

function statusForWrite(
  lifecycle: CardLifecycle,
  requestedStatus: CardStatus | undefined,
  currentStatus: CardStatus,
): CardStatus {
  if (lifecycle !== "queued") {
    return statusForLifecycle(lifecycle, currentStatus);
  }
  if (requestedStatus === "inbox" || requestedStatus === "backlog") {
    return requestedStatus;
  }
  return currentStatus === "inbox" ? "inbox" : "backlog";
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

/**
 * Whether two links point at the same thing, for deciding if a URL-derived link
 * is redundant. Compared on stable identity — the Asana gid, the GitHub
 * repo/kind/number — rather than on `id` or `url`, because a link stored from
 * the API and one derived from a pasted URL legitimately differ in both while
 * naming the same task.
 */
function sameAsanaTarget(a: CardAsanaLink, b: CardAsanaLink): boolean {
  if (a.gid && b.gid) return a.gid === b.gid;
  return normalizeCompareUrl(a.url) === normalizeCompareUrl(b.url);
}

function sameGitHubTarget(a: CardGitHubLink, b: CardGitHubLink): boolean {
  if (a.repo && b.repo && a.kind === b.kind && a.number !== undefined && b.number !== undefined) {
    // Repo comparison is case-insensitive, matching itemId() in task-github.ts,
    // which lowercases the repo when building an id. GitHub treats owner/name
    // case-insensitively, so a link stored from the API with canonical casing
    // and one derived from a lowercase pasted URL name the same item — comparing
    // them case-sensitively would fail to match, leave the derived link
    // unfiltered, and let its generated title overwrite the stored one again.
    return a.repo.toLowerCase() === b.repo.toLowerCase() && a.number === b.number;
  }
  return normalizeCompareUrl(a.url) === normalizeCompareUrl(b.url);
}

function normalizeCompareUrl(value: string | null | undefined): string {
  return (value ?? "").trim().replace(/\/+$/, "").toLowerCase();
}

function normalizeCwd(value: string | null | undefined): string | null {
  const cwd = value?.trim();
  return cwd ? cwd : null;
}

const MAX_MODEL_OVERRIDE_CHARS = 512;

/** Task models are user-configured runtime ids, so retain custom ids while
 * bounding malformed or hand-edited board data. */
function normalizeModelOverride(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const model = value.trim();
  return model && model.length <= MAX_MODEL_OVERRIDE_CHARS ? model : null;
}

function normalizeModelOverrideHarness(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const harness = value.trim();
  return harness && harness.length <= 128 ? canonicalHarnessId(harness) : null;
}

type LegacyCard = Omit<
  Card,
  "cwd" | "projectId" | "modelOverride" | "modelOverrideHarness" | "links" | "github" | "asana" | "lifecycle" | "lifecycleAt" | "retryCount" | "maxRetries" | "steps" | "startDate" | "endDate"
> &
  Partial<
    Pick<
      Card,
      "cwd" | "projectId" | "modelOverride" | "modelOverrideHarness" | "links" | "github" | "asana" | "lifecycle" | "lifecycleAt" | "retryCount" | "maxRetries" | "steps" | "startDate" | "endDate"
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

/**
 * A link only counts when both halves are present and non-empty. Normalizing
 * here matters in both directions: a malformed value must not fake a link (which
 * would make a card undeletable for no reason), and must not be quietly dropped
 * either — a half-written ref is treated as no link, which is the safe reading
 * because deletion protection is then simply not claimed.
 */
function normalizeBeadRef(value: unknown): CardBeadRef | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<CardBeadRef>;
  const id = typeof raw.id === "string" ? raw.id.trim() : "";
  const projectId = typeof raw.projectId === "string" ? raw.projectId.trim() : "";
  if (!id || !projectId) return null;
  return { id, projectId };
}

function backfillCard(c: Card | LegacyCard): Card {
  const lifecycle = c.lifecycle ?? inferLifecycle(c.status);
  // Derived links FILL GAPS; they never overwrite what is already stored.
  //
  // Both merges resolve a clash with `title: item.title || previous.title`, so
  // the incoming value wins whenever it is non-empty — correct when the incoming
  // link is fresh data from Asana or GitHub, wrong when it was invented from a
  // URL. The URL derivations always invent a title ("Asana task <gid>",
  // "<repo> #<number>"), so folding them back in replaced a real stored title
  // with a placeholder on EVERY load: a human title survived exactly one
  // round-trip. backfillCard was not a fixed point, which is visible even
  // without restore — write a card back verbatim and loadBoard returns a
  // different one (cave-0b8t8).
  //
  // Fixed here rather than in the shared merges because the precedence those
  // use is right for their other caller, where incoming really is authoritative.
  const storedGitHub = normalizeGitHubLinks(c.github);
  const storedAsana = normalizeAsanaLinks(c.asana);
  const github = mergeGitHubLinks(
    storedGitHub,
    ...gitHubLinksFromLinks(c.links).filter(
      (derived) => !storedGitHub.some((stored) => sameGitHubTarget(stored, derived)),
    ),
  );
  const asana = mergeAsanaLinks(
    storedAsana,
    ...asanaLinksFromLinks(c.links).filter(
      (derived) => !storedAsana.some((stored) => sameAsanaTarget(stored, derived)),
    ),
  );
  // Both link derivations feed back into `links` so a card's URL list stays the
  // union of everything attached, regardless of which source added it.
  const links = mergeLinksWithAsana(mergeLinksWithGitHub(normalizeLinks(c.links), github), asana);
  return {
    ...c,
    status: statusForLifecycle(lifecycle, c.status),
    cwd: normalizeCwd(c.cwd),
    projectId: c.projectId ?? null,
    beadRef: normalizeBeadRef((c as Card).beadRef),
    modelOverride: normalizeModelOverride(c.modelOverride),
    modelOverrideHarness: normalizeModelOverrideHarness(c.modelOverrideHarness),
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
    dependencies: c.dependencies ?? [],
    primaryBlockerId: c.primaryBlockerId ?? null,
    primaryBlockerPinned:
      typeof c.primaryBlockerPinned === "boolean" ? c.primaryBlockerPinned : false,
    nextStep: c.nextStep ?? null,
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
  /** Optional stable id for idempotent internal creation paths. */
  id?: string;
  title: string;
  notes?: string;
  status?: CardStatus;
  priority?: CardPriority;
  familiarId?: string | null;
  modelOverride?: string | null;
  modelOverrideHarness?: string | null;
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
  dependencies?: TaskDependency[];
  primaryBlockerId?: string | null;
  primaryBlockerPinned?: boolean;
  nextStep?: TaskNextStep | null;
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
  const explicitId = typeof input.id === "string" && input.id.trim() ? input.id.trim() : null;
  if (explicitId) {
    const existing = board.cards.find((card) => card.id === explicitId);
    if (existing) return existing;
  }
  const now = new Date().toISOString();
  const status: CardStatus = input.status ?? "backlog";
  const github = mergeGitHubLinks(normalizeGitHubLinks(input.github), ...gitHubLinksFromLinks(input.links));
  const asana = mergeAsanaLinks(normalizeAsanaLinks(input.asana), ...asanaLinksFromLinks(input.links));
  const card: Card = {
    id: explicitId ?? crypto.randomUUID(),
    title: input.title.trim(),
    notes: (input.notes ?? "").trim(),
    status,
    priority: input.priority ?? "medium",
    familiarId: input.familiarId ?? null,
    modelOverride: normalizeModelOverride(input.modelOverride),
    modelOverrideHarness: normalizeModelOverrideHarness(input.modelOverrideHarness),
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
    dependencies: input.dependencies ?? [],
    primaryBlockerId: input.primaryBlockerId ?? null,
    primaryBlockerPinned:
      input.primaryBlockerPinned === undefined ? false : input.primaryBlockerPinned,
    nextStep: input.nextStep ?? null,
  };
  if (card.nextStep?.requiresApproval) card.needsHuman = true;
  const attachments = boardAttachments(input.attachments);
  if (attachments) card.attachments = attachments;
  assertValidOrchestration(card, { cards: board.cards });
  board.cards.push(card);
  await saveBoard(board);
  return card;
  });
}

export async function updateCard(
  id: string,
  patchWithOps: CardPatch,
  options: { automated?: boolean } = {},
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
  const now = new Date().toISOString();
  const requestedStatus = "status" in patch ? patch.status : undefined;
  const nextLifecycle =
    ("lifecycle" in patch ? patch.lifecycle : undefined) ??
    (requestedStatus ? inferLifecycle(requestedStatus) : current.lifecycle);
  const nextStatus =
    "status" in patch || "lifecycle" in patch
      ? statusForWrite(nextLifecycle, requestedStatus, current.status)
      : current.status;
  const lifecycleChanged = nextLifecycle !== current.lifecycle;
  const statusChanged = nextStatus !== current.status;
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
    status: nextStatus,
    lifecycle: nextLifecycle,
    lifecycleAt: lifecycleChanged ? now : current.lifecycleAt,
    lifecycleReason: lifecycleChanged
      ? ("lifecycleReason" in patch ? patch.lifecycleReason : undefined)
      : current.lifecycleReason,
    updatedAt: now,
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
    // A task model belongs to a familiar runtime. Keep its source harness with
    // the override so launch can reject an id left behind when the familiar's
    // harness changes without reassigning the card.
    modelOverride: "modelOverride" in patch
      ? normalizeModelOverride(patch.modelOverride)
      : "familiarId" in patch && patch.familiarId !== current.familiarId
        ? null
        : current.modelOverride ?? null,
    modelOverrideHarness: "modelOverride" in patch
      ? normalizeModelOverride(patch.modelOverride)
        ? normalizeModelOverrideHarness(patch.modelOverrideHarness)
        : null
      : "familiarId" in patch && patch.familiarId !== current.familiarId
        ? null
        : "modelOverrideHarness" in patch
          ? normalizeModelOverrideHarness(patch.modelOverrideHarness)
          : current.modelOverrideHarness ?? null,
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
    dependencies: "dependencies" in patch ? patch.dependencies ?? [] : current.dependencies ?? [],
    primaryBlockerId: "primaryBlockerId" in patch
      ? patch.primaryBlockerId ?? null
      : current.primaryBlockerId ?? null,
    primaryBlockerPinned: "primaryBlockerPinned" in patch
      ? patch.primaryBlockerPinned === undefined
        ? current.primaryBlockerPinned ?? false
        : patch.primaryBlockerPinned
      : current.primaryBlockerPinned ?? false,
    nextStep: "nextStep" in patch ? patch.nextStep ?? null : current.nextStep ?? null,
  };
  if (statusChanged) next.needsHuman = next.status === "blocked";
  if (next.nextStep?.requiresApproval) next.needsHuman = true;
  if (next.lifecycle === "running" && !next.runningSince) {
    next.runningSince = next.updatedAt;
  } else if (next.lifecycle !== "running") {
    delete next.runningSince;
  }
  assertValidOrchestration(next, {
    cards: board.cards,
    previous: current,
    automated: options.automated,
  });
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

function executionDependency(
  to: "failed" | "cancelled",
  reason: string | undefined,
  now: string,
): TaskDependency {
  const outcome = to === "failed" ? "Run failed" : "Run was cancelled";
  return {
    id: crypto.randomUUID(),
    kind: "execution",
    label: reason?.trim() ? `${outcome}: ${reason.trim()}` : outcome,
    state: "unresolved",
    origin: "system",
    createdAt: now,
  };
}

function failureNextStep(now: string): TaskNextStep {
  return {
    summary: "Review the failed run and choose retry or repair",
    requiresApproval: true,
    origin: "system",
    updatedAt: now,
  };
}

function applyExecutionBlocker(
  current: Card,
  next: Card,
  blocker: TaskDependency,
  now: string,
): void {
  const currentDependencies = Array.isArray(current.dependencies)
    ? current.dependencies
    : [];
  const pinnedPrimary = current.primaryBlockerPinned
    ? currentDependencies.find(
        (dependency) =>
          dependency?.id === current.primaryBlockerId &&
          dependency.state === "unresolved",
      )
    : undefined;

  next.dependencies = [...currentDependencies, blocker];
  if (pinnedPrimary) {
    next.primaryBlockerId = pinnedPrimary.id;
  } else {
    next.primaryBlockerId = blocker.id;
    if (current.primaryBlockerPinned) next.primaryBlockerPinned = false;
  }
  next.nextStep =
    current.nextStep?.origin === "human" ? current.nextStep : failureNextStep(now);
  next.status = "blocked";
  next.needsHuman = true;
}

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
    const blocker = executionDependency(to, reason, now);
    applyExecutionBlocker(current, next, blocker, now);
  } else if (to === "queued") {
    if (retry) {
      next.retryCount = current.retryCount + 1;
    }
    next.status = "backlog";
    next.needsHuman = false;
  } else if (to === "cancelled") {
    const blocker = executionDependency(to, reason, now);
    applyExecutionBlocker(current, next, blocker, now);
  }

  if (next.nextStep?.requiresApproval) next.needsHuman = true;
  assertValidOrchestration(next, {
    cards: board.cards,
    previous: current,
    automated: true,
  });
  board.cards[idx] = next;
  await saveBoard(board);
  return next;
  });
}

/** A linked mirror is a durable reference target; routine cleanup must not take
 *  it. `linked` is refused rather than silently skipped so the caller can say so. */
export type DeleteCardOutcome = "deleted" | "not-found" | "linked";

/**
 * Delete a card.
 *
 * A card carrying a `beadRef` is refused with `"linked"` unless the caller
 * passes `allowLinked` — the explicit stronger removal action. This guard is
 * server-side on purpose: client filtering improves the experience, but the
 * store is the retention boundary, and a Board mirror deleted by a stray client
 * takes a closed Bead's only durable pointer with it (cave-xddxs).
 */
export async function deleteCard(
  id: string,
  options: { allowLinked?: boolean } = {},
): Promise<DeleteCardOutcome> {
  return withBoardLock(async () => {
  const board = await loadBoard();
  const card = board.cards.find((c) => c.id === id);
  if (!card) return "not-found";
  if (card.beadRef && !options.allowLinked) return "linked";
  board.cards = board.cards.filter((c) => c.id !== id);
  await saveBoard(board);
  return "deleted";
  });
}

/**
 * Reinstate whole cards under their original ids.
 *
 * Undo used to re-create cleared cards through the normal create path, which
 * mints a fresh id and carries only the subset of fields that path accepts — so
 * every Bead or GitHub reference to the old id broke, and step state, asana
 * links, dependencies and lifecycle history were silently dropped. Restoring
 * writes the stored record back verbatim.
 *
 * An id that is currently live is skipped rather than overwritten: restore
 * exists to undo a removal, never to clobber a card that came back by another
 * route (a re-create, a sync, another session).
 */
export async function restoreCards(
  cards: readonly Card[],
): Promise<{ restored: string[]; skipped: string[] }> {
  return withBoardLock(async () => {
    const board = await loadBoard();
    const live = new Set(board.cards.map((c) => c.id));
    const restored: string[] = [];
    const skipped: string[] = [];
    for (const card of cards) {
      if (!card?.id || typeof card.id !== "string") continue;
      if (live.has(card.id)) {
        skipped.push(card.id);
        continue;
      }
      // Written back VERBATIM. Re-normalizing here would defeat the contract:
      // backfillCard is not idempotent — re-running it over a card whose Asana
      // URL has already been merged into `links` re-derives that link and
      // overwrites its stored title with a generated one. loadBoard normalizes
      // every card on read anyway, so nothing is skipped by not doing it twice.
      board.cards.push(card);
      live.add(card.id);
      restored.push(card.id);
    }
    if (restored.length > 0) await saveBoard(board);
    return { restored, skipped };
  });
}

/**
 * The live card mirroring a Bead, by Bead id.
 *
 * Pure so a caller can resolve against any snapshot. This is what lets a closed
 * Bead's notes point at a card without appending supersession prose every time
 * the Board is tidied: the reference is structured, and the id no longer churns.
 */
export function cardForBeadRef(cards: readonly Card[], beadId: string): Card | null {
  if (!beadId) return null;
  return cards.find((c) => c.beadRef?.id === beadId) ?? null;
}

export async function unlinkSessionFromCards(sessionId: string): Promise<number> {
  return withBoardLock(async () => {
    const board = await loadBoard();
    let unlinked = 0;
    board.cards = board.cards.map((card) => {
      if (card.sessionId !== sessionId) return card;
      unlinked += 1;
      return { ...card, sessionId: null, updatedAt: new Date().toISOString() };
    });
    if (unlinked > 0) await saveBoard(board);
    return unlinked;
  });
}

export { BOARD_PATH };
