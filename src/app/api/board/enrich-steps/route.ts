import {
  loadBoard,
  OrchestrationValidationError,
  transitionCard,
  updateCard,
} from "@/lib/cave-board";
import {
  LIFECYCLES,
  PRIORITIES,
  STATUSES,
  type BoardAgenticProposalRecord,
  type Card,
  type CardGitHubLink,
  type CardLifecycle,
  type CardPriority,
  type CardStatus,
  type CardStep,
  type TaskDependency,
} from "@/lib/cave-board-types";
import { normalizeTaskGitHubLinks } from "@/lib/task-github";
import { bindingFor, loadConfig } from "@/lib/cave-config";
import { runCovenOneShot, resolveFamiliarWorkspace } from "@/lib/server/coven-oneshot";
import { isTrustedChatHarness } from "@/lib/harness-adapters";
import { stripAnsi } from "@/lib/ansi";
import { assistantTextFromStream } from "@/lib/server/coven-stream-text";
import { resolveGitHubToken } from "@/lib/github-token";
import {
  appendEnrichmentProposal,
  assessEnrichmentGates,
  blockedRecordFromWriteErrors,
  buildEnrichmentProposalRecord,
  cleanOrchestrationProposal,
  enrichmentPatch,
  hasOrchestrationContent,
  type EnrichmentGateResult,
} from "@/lib/enrich-steps-orchestration";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ENRICH_INTENT = "board-enrich-steps";
const STATUS_VALUES = new Set<CardStatus>(STATUSES);
const LIFECYCLE_VALUES = new Set<CardLifecycle>(LIFECYCLES);
const PRIORITY_VALUES = new Set<CardPriority>(PRIORITIES);
const REPO_RE = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?\/[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/;

type TaskEnrichment = {
  steps?: string[];
  notes?: string;
  status?: CardStatus;
  lifecycle?: CardLifecycle;
  priority?: CardPriority;
  startDate?: string | null;
  endDate?: string | null;
  links?: string[];
  github?: CardGitHubLink[];
  sessionId?: string | null;
  needsHuman?: boolean;
  lifecycleReason?: string;
  // Dependency and next-step suggestions (cave-bmcoe). Kept as raw values
  // here; cleanOrchestrationProposal validates and bounds them with card
  // context before the auto-application gates run.
  dependencies?: unknown;
  primaryBlockerId?: unknown;
  primaryBlockerPinned?: unknown;
  nextStep?: unknown;
  confidence?: unknown;
  rationale?: unknown;
};

type EnrichRequestBody = {
  intent?: unknown;
  familiarId?: unknown;
  /** `"all"` sweeps every open task on the Board, each through its own
   *  assigned familiar. Without it the run covers one familiar's tasks. */
  scope?: unknown;
  /** Optional: only these task ids, still each through its own familiar. */
  cardIds?: unknown;
};

const SAFE_FAMILIAR_ID = /^[a-z0-9_-]+$/i;
const CLOSED_LIFECYCLES = new Set<CardLifecycle>(["completed", "cancelled"]);
const MAX_PARALLEL_FAMILIARS = 3;

function statusForLifecycle(lifecycle: CardLifecycle, currentStatus: CardStatus): CardStatus {
  if (lifecycle === "dispatched" || lifecycle === "running") return "running";
  if (lifecycle === "review") return "review";
  if (lifecycle === "completed") return "done";
  if (lifecycle === "failed" || lifecycle === "cancelled") return "blocked";
  if (currentStatus === "inbox") return "inbox";
  return "backlog";
}

function lifecycleForStatus(status: CardStatus): CardLifecycle {
  if (status === "running") return "running";
  if (status === "review") return "review";
  if (status === "blocked") return "failed";
  if (status === "done") return "completed";
  return "queued";
}

function statusMatchesLifecycle(lifecycle: CardLifecycle, status: CardStatus): boolean {
  return statusForLifecycle(lifecycle, status) === status;
}

function stepKey(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

function cleanStepStrings(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return values
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter(Boolean)
    .slice(0, 8);
}

function mergeSteps(card: Card, steps: string[], now: string): CardStep[] {
  if (steps.length === 0) return card.steps ?? [];
  const existing = new Map((card.steps ?? []).map((step) => [stepKey(step.text), step]));
  return steps.map((text) => {
    const previous = existing.get(stepKey(text));
    return {
      id: previous?.id ?? crypto.randomUUID(),
      text,
      done: previous?.done ?? false,
      addedAt: previous?.addedAt ?? now,
      ...(previous?.doneAt ? { doneAt: previous.doneAt } : {}),
    };
  });
}

function cleanReason(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, 240) : undefined;
}

function cleanNotes(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, 2_000) : undefined;
}

function cleanBoardDate(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return undefined;
  const date = new Date(`${trimmed}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString().slice(0, 10) === trimmed ? trimmed : undefined;
}

function cleanLinks(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const links = value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter((item) => {
      try {
        const url = new URL(item);
        return url.protocol === "http:" || url.protocol === "https:";
      } catch {
        return false;
      }
    })
    .slice(0, 16);
  return [...new Set(links)];
}

function cleanGitHubLinks(value: unknown): CardGitHubLink[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return normalizeTaskGitHubLinks(
    value.map((item) => typeof item === "string" ? { url: item } : item),
  ).slice(0, 16);
}

function cleanSessionId(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return /^[a-z0-9_.:-]{1,160}$/i.test(trimmed) ? trimmed : undefined;
}

function dependencyLine(dependency: TaskDependency): string {
  return [
    `- ${dependency.id}`,
    `[${dependency.kind}:${dependency.state}]`,
    dependency.label,
    dependency.taskId ? `(task: ${dependency.taskId})` : "",
    dependency.ref ? `(${dependency.ref})` : "",
  ].filter(Boolean).join(" ");
}

function boardTaskContext(board: Card[]): string {
  if (board.length === 0) return "";
  return [
    ``,
    `Live board tasks you may reference as task dependencies:`,
    ...board
      .slice(0, 48)
      .map((entry) => `- ${entry.id}: ${entry.title.trim().slice(0, 80)}`),
  ].join("\n");
}

function reachableGitHubContext(card: Card): string {
  const items = card.github
    .filter((link) => link.repo && typeof link.number === "number")
    .slice(0, 16)
    .map((link) => `- ${link.repo}#${link.number}${link.title ? ` (${link.title.trim().slice(0, 80)})` : ""}`);
  return [
    ``,
    `GitHub items attached to this task (reachable references):`,
    items.length ? items.join("\n") : "- none",
  ].join("\n");
}

function enrichPrompt(card: Card, board: Card[], today: string, retry = false): string {
  const labels = card.labels?.length
    ? `\nLabels: ${card.labels.join(", ")}`
    : "";
  const notes = card.notes?.trim() ? `\n\nNotes:\n${card.notes.trim()}` : "";
  const steps = card.steps?.length
    ? `\n\nCurrent steps:\n${card.steps
        .map((step, index) => `${index + 1}. [${step.done ? "x" : " "}] ${step.text}`)
        .join("\n")}`
    : "";
  const dependencies = card.dependencies?.length
    ? `\n\nCurrent dependencies:\n${card.dependencies.map(dependencyLine).join("\n")}`
    : "";
  const primaryBlocker = card.primaryBlockerId
    ? `\nCurrent primary blocker: ${card.primaryBlockerId}`
    : "";
  const nextStep = card.nextStep
    ? `\nCurrent next step: ${card.nextStep.summary}${card.nextStep.requiresApproval ? " (requires approval)" : ""}`
    : "";
  return [
    `You are the assigned familiar refreshing your board task so it reflects the current best plan, ownership, links, schedule, and state.`,
    `Today: ${today}`,
    `Task id: ${card.id}`,
    `Task: ${card.title.trim()}${labels}${notes}`,
    `Current status: ${card.status}`,
    `Current lifecycle: ${card.lifecycle}`,
    `Current priority: ${card.priority}`,
    `Current startDate: ${card.startDate ?? "none"}`,
    `Current endDate: ${card.endDate ?? "none"}`,
    `Current sessionId: ${card.sessionId ?? "none"}`,
    `Current links: ${card.links.length ? card.links.join(", ") : "none"}`,
    `Current GitHub items: ${card.github.length ? card.github.map((item) => item.url).join(", ") : "none"}`,
    `Needs human: ${card.needsHuman ? "yes" : "no"}${steps}${dependencies}${primaryBlocker}${nextStep}${boardTaskContext(board)}${reachableGitHubContext(card)}`,
    ``,
    `Output ONLY one JSON object with these keys:`,
    `{"notes":"concise task description","steps":["short subtask"],"status":"backlog|inbox|running|review|blocked|done","lifecycle":"queued|dispatched|running|review|completed|failed|cancelled","priority":"low|medium|high|urgent","startDate":"YYYY-MM-DD|null","endDate":"YYYY-MM-DD|null","links":["https://..."],"github":[{"url":"https://github.com/owner/repo/issues/123","title":"issue title","repo":"owner/repo","kind":"issue|pr|repo|discussion|review_request|notification","number":123,"state":"open|closed|merged","labels":[]}],"sessionId":"linked-chat-session-id|null","needsHuman":false,"lifecycleReason":"short reason","dependencies":[{"id":"stable-id","kind":"task|github|human|credential|service|execution|external","label":"short blocker","taskId":"TASK_ID|null","ref":"repo#number or svc:name or null","state":"unresolved|resolved|waived"}],"primaryBlockerId":"DEPENDENCY_ID|null","primaryBlockerPinned":false,"nextStep":{"summary":"one imperative action","actorFamiliarId":"familiar-id|null","capability":"skill-or-tool|null","target":"repo/path/url/svc:name|null","inputs":["..."],"requiresApproval":false},"confidence":0.0,"rationale":"short reason"}`,
    `Simplify the description into concise task notes without losing constraints.`,
    `Create or update subtasks for the assigned task; include 3-8 short action steps.`,
    `Set startDate and endDate when the task has clear timing or sequence; use null only to clear a wrong date.`,
    `Decide whether this task is still open. Check the linked GitHub items, chats, and workspace when they can confirm its state; do not do the task's work in this run.`,
    `If the outcome is delivered (the linked PR merged, the issue closed, or the work otherwise finished), close it: status "done", lifecycle "completed".`,
    `If it is obsolete, a duplicate, or no longer wanted, close it: lifecycle "cancelled".`,
    `Otherwise keep it open and set status, lifecycle, priority, and needsHuman to where the work actually stands.`,
    `Always state the reason for the status you chose in lifecycleReason.`,
    `Ensure links, github, and sessionId reflect associated issues, PRs, discussions, docs, and chats that belong on this task.`,
    `Preserve useful existing links and GitHub/chat assignments unless they are clearly wrong.`,
    `Each subtask must be a short, actionable sentence under 80 characters.`,
    `Dependencies: propose only what actually blocks this task. A task dependency must name a live board task id from the list above; a github dependency must use a repo#number from the reachable items; a service dependency must use a known svc: reference. Never invent task ids, issue numbers, or services.`,
    `primaryBlockerId must be the id of one of your proposed dependencies or the task's existing dependencies, or null.`,
    `primaryBlockerPinned: true only to freeze the operator's chosen primary blocker.`,
    `nextStep: exactly one imperative action. Set requiresApproval true only when a human decision must gate the action; an approval-gated next step flags the task for a human and is never dispatched automatically.`,
    `confidence: your self-reported 0..1 confidence. It only ranks suggestions; it never authorizes a write.`,
    `Never propose replacing a human-authored dependency or next step; propose a reviewable change instead.`,
    `Return no explanation, no markdown, and no extra text.`,
    ...(retry ? [`Your previous response could not be parsed. Return only the JSON object now.`] : []),
  ].join("\n");
}

type EnrichScope = { familiarId: string | null; cardIds: Set<string> | null };

function cardIdsFrom(value: unknown): Set<string> | null | undefined {
  if (value === undefined) return null;
  if (!Array.isArray(value) || value.length === 0 || value.length > 256) return undefined;
  if (!value.every((id) => typeof id === "string" && id.length > 0 && id.length <= 160)) return undefined;
  return new Set(value as string[]);
}

/** `familiarId: null` means every open task, whoever it is assigned to. */
async function readEnrichRequestBody(req: Request): Promise<EnrichScope | null> {
  if (req.headers.get("x-coven-cave-intent") !== "board-enrich-steps")
    return null;
  try {
    const body = (await req.json()) as EnrichRequestBody;
    if (body.intent !== ENRICH_INTENT) return null;
    const cardIds = cardIdsFrom(body.cardIds);
    if (cardIds === undefined) return null;
    if (body.scope === "all") return { familiarId: null, cardIds };
    if (typeof body.familiarId !== "string") return null;
    const familiarId = body.familiarId.trim();
    return SAFE_FAMILIAR_ID.test(familiarId) ? { familiarId, cardIds } : null;
  } catch {
    return null;
  }
}



function assistantTextFromOutput(raw: string): string {
  return assistantTextFromStream(stripAnsi(raw));
}

function parseJsonObject(haystack: string): unknown {
  const start = haystack.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < haystack.length; i += 1) {
    const ch = haystack[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === "\"") {
        inString = false;
      }
      continue;
    }
    if (ch === "\"") {
      inString = true;
    } else if (ch === "{") {
      depth += 1;
    } else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        return JSON.parse(haystack.slice(start, i + 1));
      }
    }
  }
  return null;
}

function parseJsonArray(haystack: string): unknown {
  const match = haystack.match(/\[[\s\S]*?\]/);
  if (!match) return null;
  return JSON.parse(match[0]);
}

const TASK_ENRICHMENT_KEYS = [
  "notes", "description", "steps", "status", "lifecycle", "priority", "startDate", "endDate",
  "links", "github", "sessionId", "needsHuman", "lifecycleReason", "dependencies",
  "primaryBlockerId", "nextStep",
];

function parseTaskEnrichment(raw: string): TaskEnrichment | null {
  const haystack = assistantTextFromOutput(raw);
  try {
    const parsed = parseJsonObject(haystack);
    // An object with none of the task keys is not an answer; treating it as one
    // records a review that never happened.
    if (
      parsed && typeof parsed === "object" && !Array.isArray(parsed)
      && TASK_ENRICHMENT_KEYS.some((key) => Object.prototype.hasOwnProperty.call(parsed, key))
    ) {
      const candidate = parsed as Record<string, unknown>;
      const startDate = cleanBoardDate(candidate.startDate);
      const endDate = cleanBoardDate(candidate.endDate);
      const links = cleanLinks(candidate.links);
      const github = cleanGitHubLinks(candidate.github);
      const sessionId = cleanSessionId(candidate.sessionId);
      return {
        steps: cleanStepStrings(candidate.steps),
        notes: cleanNotes(candidate.notes ?? candidate.description),
        status: STATUS_VALUES.has(candidate.status as CardStatus)
          ? candidate.status as CardStatus
          : undefined,
        lifecycle: LIFECYCLE_VALUES.has(candidate.lifecycle as CardLifecycle)
          ? candidate.lifecycle as CardLifecycle
          : undefined,
        priority: PRIORITY_VALUES.has(candidate.priority as CardPriority)
          ? candidate.priority as CardPriority
          : undefined,
        ...(startDate !== undefined ? { startDate } : {}),
        ...(endDate !== undefined ? { endDate } : {}),
        ...(links !== undefined ? { links } : {}),
        ...(github !== undefined ? { github } : {}),
        ...(sessionId !== undefined ? { sessionId } : {}),
        needsHuman: typeof candidate.needsHuman === "boolean" ? candidate.needsHuman : undefined,
        lifecycleReason: cleanReason(candidate.lifecycleReason),
        ...(candidate.dependencies !== undefined ? { dependencies: candidate.dependencies } : {}),
        ...(candidate.primaryBlockerId !== undefined ? { primaryBlockerId: candidate.primaryBlockerId } : {}),
        ...(candidate.primaryBlockerPinned !== undefined ? { primaryBlockerPinned: candidate.primaryBlockerPinned } : {}),
        ...(candidate.nextStep !== undefined ? { nextStep: candidate.nextStep } : {}),
        ...(candidate.confidence !== undefined ? { confidence: candidate.confidence } : {}),
        ...(candidate.rationale !== undefined ? { rationale: candidate.rationale } : {}),
      };
    }
  } catch {
    /* */
  }
  try {
    const parsed = parseJsonArray(haystack);
    const steps = cleanStepStrings(parsed);
    return steps.length > 0 ? { steps } : null;
  } catch {
    /* */
  }
  return null;
}

function normalizeTaskEnrichment(card: Card, enrichment: TaskEnrichment, now: string) {
  const lifecycle = enrichment.lifecycle ?? (enrichment.status ? lifecycleForStatus(enrichment.status) : card.lifecycle);
  const status = enrichment.status && statusMatchesLifecycle(lifecycle, enrichment.status)
    ? enrichment.status
    : statusForLifecycle(lifecycle, card.status);
  const priority = enrichment.priority ?? card.priority;
  const needsHuman = enrichment.needsHuman ?? (status === "blocked" && lifecycle !== "cancelled");
  return {
    notes: enrichment.notes ?? card.notes,
    steps: mergeSteps(card, enrichment.steps ?? [], now),
    status,
    lifecycle,
    priority,
    startDate: enrichment.startDate !== undefined ? enrichment.startDate : card.startDate ?? null,
    endDate: enrichment.endDate !== undefined ? enrichment.endDate : card.endDate ?? null,
    links: enrichment.links ?? card.links,
    github: enrichment.github ?? card.github,
    sessionId: enrichment.sessionId !== undefined ? enrichment.sessionId : card.sessionId,
    needsHuman,
    lifecycleReason: enrichment.lifecycleReason ?? card.lifecycleReason,
    lifecycleAt: lifecycle !== card.lifecycle ? now : card.lifecycleAt,
  };
}

type NormalizedTaskEnrichment = ReturnType<typeof normalizeTaskEnrichment>;

function labelsFromGitHub(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(
    value
      .map((item) => {
        if (typeof item === "string") return item.trim();
        if (!item || typeof item !== "object") return "";
        const name = (item as Record<string, unknown>).name;
        return typeof name === "string" ? name.trim() : "";
      })
      .filter(Boolean),
  )];
}

async function fetchGitHubIssueStates(github: CardGitHubLink[]): Promise<CardGitHubLink[]> {
  if (github.length === 0) return github;
  const token = resolveGitHubToken();
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const refreshed: CardGitHubLink[] = [];
  for (const item of github.slice(0, 16)) {
    if ((item.kind !== "issue" && item.kind !== "pr") || !item.number || !REPO_RE.test(item.repo)) {
      refreshed.push(item);
      continue;
    }
    try {
      const res = await fetch(`https://api.github.com/repos/${item.repo}/issues/${item.number}`, {
        headers,
        cache: "no-store",
      });
      const data = await res.json().catch(() => null) as Record<string, unknown> | null;
      if (!res.ok || !data) {
        refreshed.push(item);
        continue;
      }
      const pull = data.pull_request as Record<string, unknown> | undefined;
      const merged = typeof pull?.merged_at === "string" && pull.merged_at.trim().length > 0;
      const state = merged ? "merged" : String(data.state ?? item.state ?? "").trim();
      refreshed.push({
        ...item,
        kind: pull ? "pr" : item.kind,
        title: typeof data.title === "string" && data.title.trim() ? data.title.trim() : item.title,
        state: state || item.state,
        labels: labelsFromGitHub(data.labels),
        updatedAt: typeof data.updated_at === "string" ? data.updated_at : item.updatedAt,
        url: typeof data.html_url === "string" ? data.html_url : item.url,
      });
    } catch {
      refreshed.push(item);
    }
  }
  return normalizeTaskGitHubLinks(refreshed);
}

function terminalPatchFromGitHub(
  card: Card,
  github: CardGitHubLink[],
  now: string,
): Pick<NormalizedTaskEnrichment, "status" | "lifecycle" | "needsHuman" | "lifecycleReason" | "lifecycleAt"> | null {
  const terminal = github.find(
    (item) =>
      (item.kind === "issue" || item.kind === "pr") &&
      (item.state === "closed" || item.state === "merged"),
  );
  if (!terminal) return null;
  const kind = terminal.kind === "pr"
    ? (terminal.state === "merged" ? "PR merged" : "PR closed")
    : "issue closed";
  const target = `${terminal.repo}${terminal.number ? ` #${terminal.number}` : ""}`;
  return {
    status: "done",
    lifecycle: "completed",
    needsHuman: false,
    lifecycleReason: `GitHub ${kind}: ${target}`.slice(0, 240),
    lifecycleAt: card.lifecycle === "completed" ? card.lifecycleAt : now,
  };
}

function applyGitHubState(
  card: Card,
  normalized: NormalizedTaskEnrichment,
  github: CardGitHubLink[],
  now: string,
): NormalizedTaskEnrichment {
  const terminal = terminalPatchFromGitHub(card, github, now);
  return {
    ...normalized,
    github,
    ...(terminal ?? {}),
  };
}

function githubStateChanged(previous: CardGitHubLink[], next: CardGitHubLink[]): boolean {
  return JSON.stringify(previous.map(({ url, state, title, labels, updatedAt }) => ({ url, state, title, labels, updatedAt }))) !==
    JSON.stringify(next.map(({ url, state, title, labels, updatedAt }) => ({ url, state, title, labels, updatedAt })));
}

export async function POST(req: Request) {
  const body = await readEnrichRequestBody(req);
  if (!body) {
    return new Response(
      JSON.stringify({ ok: false, error: "missing enrich intent" }),
      {
        status: 403,
        headers: { "content-type": "application/json" },
      },
    );
  }

  const [board, config] = await Promise.all([loadBoard(), loadConfig()]);
  const { familiarId, cardIds } = body;

  // Every open task is considered, and each is reviewed by its own assigned
  // familiar. Existing steps are included so the familiar can refresh stale
  // plans and task metadata. Unassigned tasks have no one to review them; they
  // are still counted and reported so the run never silently drops a task.
  const SKIP_LIFECYCLE = CLOSED_LIFECYCLES;
  const candidates = board.cards.filter(
    (c) =>
      (familiarId === null || c.familiarId === familiarId) &&
      (cardIds === null || cardIds.has(c.id)) &&
      !SKIP_LIFECYCLE.has(c.lifecycle),
  );
  const today = new Date().toISOString().slice(0, 10);

  const stream = new ReadableStream<Uint8Array>({
    start: async (controller) => {
      const enc = new TextEncoder();
      let closed = false;
      const push = (obj: object) => {
        if (closed) return;
        try {
          controller.enqueue(enc.encode(JSON.stringify(obj) + "\n"));
        } catch {
          closed = true;
        }
      };

      push({ kind: "start", total: candidates.length });

      // Every open task is accounted for. Unassigned tasks have no familiar to
      // review them and are reported up front; the rest are grouped into one
      // lane per assigned familiar.
      const lanes = new Map<string, Card[]>();
      for (const card of candidates) {
        const owner = card.familiarId;
        if (!owner || !SAFE_FAMILIAR_ID.test(owner)) {
          push({ kind: "skip", cardId: card.id, reason: "unassigned" });
          continue;
        }
        const lane = lanes.get(owner);
        if (lane) lane.push(card);
        else lanes.set(owner, [card]);
      }

      const reviewCard = async (card: Card, familiarId: string): Promise<void> => {
        const binding = bindingFor(config, familiarId);

        // Only bundled, reviewed Coven harnesses may run headlessly through
        // `coven run <harness> --stream-json`. OpenClaw and external adapter
        // manifests use their own bridges instead of this privileged runner.
        if (!isTrustedChatHarness(binding.harness)) {
          push({
            kind: "skip",
            cardId: card.id,
            reason: `harness:${binding.harness}`,
          });
          return;
        }

        push({ kind: "progress", cardId: card.id, title: card.title });
        const githubState = await fetchGitHubIssueStates(card.github);
        const cardForPrompt = githubStateChanged(card.github, githubState)
          ? { ...card, github: githubState }
          : card;

        const title = `Refresh task: ${card.title.trim().slice(0, 80) || card.id}`;
        const workspace = await resolveFamiliarWorkspace(familiarId);
        // One retry for unparsable output: a task the familiar never managed to
        // report on is a task that was not reviewed.
        let enrichment: TaskEnrichment | null = null;
        for (let attempt = 0; attempt < 2 && !enrichment; attempt += 1) {
          if (req.signal.aborted) break;
          const args: string[] = [
            "run",
            binding.harness,
            "--stream-json",
            "--archive",
            "--title",
            title,
            "--labels",
            "board,enrich-steps",
            "--familiar",
            familiarId,
            "--",
            enrichPrompt(cardForPrompt, board.cards, today, attempt === 1),
          ];
          const raw = await runCovenOneShot(args, req.signal, workspace, familiarId);
          enrichment = parseTaskEnrichment(raw);
        }
        if (req.signal.aborted) return;
        const now = new Date().toISOString();

        if (!enrichment) {
          const normalized = applyGitHubState(card, normalizeTaskEnrichment(card, {}, now), githubState, now);
          if (
            !githubStateChanged(card.github, normalized.github) &&
            normalized.status === card.status &&
            normalized.lifecycle === card.lifecycle
          ) {
            push({ kind: "skip", cardId: card.id, reason: "no_task_metadata_parsed" });
            return;
          }
          let updated;
          try {
            updated = await updateCard(card.id, {
              notes: normalized.notes,
              steps: normalized.steps,
              status: normalized.status,
              lifecycle: normalized.lifecycle,
              priority: normalized.priority,
              startDate: normalized.startDate,
              endDate: normalized.endDate,
              links: normalized.links,
              github: normalized.github,
              sessionId: normalized.sessionId,
              needsHuman: normalized.needsHuman,
              lifecycleReason: normalized.lifecycleReason,
              lifecycleAt: normalized.lifecycleAt,
            }, { automated: true });
          } catch (error) {
            if (error instanceof OrchestrationValidationError) {
              push({
                kind: "skip",
                cardId: card.id,
                reason: "orchestration_invalid",
                errors: error.errors,
              });
              return;
            }
            throw error;
          }
          if (!updated) {
            push({ kind: "skip", cardId: card.id, reason: "card_missing" });
            return;
          }
          push({
            kind: "done",
            cardId: card.id,
            count: normalized.steps.length,
            closed: CLOSED_LIFECYCLES.has(normalized.lifecycle),
          });
          return;
        }

        const normalized = applyGitHubState(card, normalizeTaskEnrichment(card, enrichment, now), githubState, now);
        // Dependency and next-step suggestions ride the same model run. They are
        // gated before any write: auto-application requires grounding, structural
        // validity, and non-conflict (cave-bmcoe); anything failing a gate lands
        // in the card's agenticEnhance review queue naming the gate it failed.
        const orchestration = cleanOrchestrationProposal(enrichment, card, now);
        const hasOrchestration = hasOrchestrationContent(orchestration);
        let gates: EnrichmentGateResult | null = null;
        let proposalRecord: BoardAgenticProposalRecord | null = null;
        if (hasOrchestration) {
          const candidate: Card = {
            ...card,
            ...normalized,
            ...enrichmentPatch(orchestration),
          };
          gates = assessEnrichmentGates(card, board.cards, orchestration, candidate);
          proposalRecord = buildEnrichmentProposalRecord(card, board.cards, orchestration, gates, now);
        }
        // Cancelling or failing a task goes through the Board's own lifecycle
        // transition, which records the execution blocker a "blocked" status
        // requires. A plain patch to "cancelled" is rejected by the
        // orchestration validator, so a familiar could never retire a task.
        const transitionTo = (normalized.lifecycle === "cancelled" || normalized.lifecycle === "failed")
          && normalized.lifecycle !== card.lifecycle
          ? normalized.lifecycle
          : null;
        const taskPatch = {
          notes: normalized.notes,
          steps: normalized.steps,
          status: transitionTo ? card.status : normalized.status,
          lifecycle: transitionTo ? card.lifecycle : normalized.lifecycle,
          priority: normalized.priority,
          startDate: normalized.startDate,
          endDate: normalized.endDate,
          links: normalized.links,
          github: normalized.github,
          sessionId: normalized.sessionId,
          needsHuman: transitionTo ? card.needsHuman : normalized.needsHuman,
          lifecycleReason: normalized.lifecycleReason,
          lifecycleAt: transitionTo ? card.lifecycleAt : normalized.lifecycleAt,
        };
        const finishTransition = async (written: Card): Promise<Card> => {
          if (!transitionTo) return written;
          try {
            return await transitionCard(card.id, { to: transitionTo, reason: normalized.lifecycleReason }) ?? written;
          } catch {
            // Not a legal move from the current lifecycle (review → cancelled,
            // say). Leave the task where it is and ask a human to decide.
            return await updateCard(card.id, { needsHuman: true }, { automated: true }) ?? written;
          }
        };
        let updated;
        try {
          updated = await updateCard(card.id, {
            ...taskPatch,
            // Only a suggestion that passed every gate is folded into the write;
            // the review queue still records what was proposed and why.
            ...(gates && gates.gatesFailed.length === 0 ? enrichmentPatch(orchestration) : {}),
            ...(hasOrchestration && proposalRecord
              ? {
                agenticEnhance: appendEnrichmentProposal(
                  card.agenticEnhance,
                  proposalRecord,
                  proposalRecord.state === "auto-applied" ? "auto-applied" : "blocked",
                  "enhance",
                  now,
                ),
              }
              : {}),
          }, { automated: true });
        } catch (error) {
          if (error instanceof OrchestrationValidationError) {
            if (hasOrchestration && proposalRecord) {
              // Defense in depth: the mutator re-ran the same validator and
              // rejected the write (acceptance test 3 parity). Persist the
              // suggestion as a gate-blocked review proposal so the operator
              // sees exactly why it could not auto-apply. The rest of the
              // familiar's review (status, notes, steps, dates) still lands:
              // a bad dependency suggestion must not discard it (#5629).
              const blocked = blockedRecordFromWriteErrors(card, board.cards, orchestration, error.errors, now);
              const agenticEnhance = appendEnrichmentProposal(card.agenticEnhance, blocked, "blocked", "enhance", now);
              try {
                let recorded;
                try {
                  recorded = await updateCard(card.id, { ...taskPatch, agenticEnhance }, { automated: true });
                } catch (retryError) {
                  if (!(retryError instanceof OrchestrationValidationError)) throw retryError;
                  // The status itself depended on the rejected suggestion (a
                  // "blocked" task must name its blocker). Keep the review but
                  // hold the task where it was, flagged for a human, with the
                  // familiar's reason.
                  recorded = await updateCard(card.id, {
                    ...taskPatch,
                    status: card.status,
                    lifecycle: card.lifecycle,
                    lifecycleAt: card.lifecycleAt,
                    needsHuman: true,
                    agenticEnhance,
                  }, { automated: true });
                }
                if (recorded) {
                  const final = await finishTransition(recorded);
                  push({
                    kind: "orchestration",
                    cardId: card.id,
                    state: "blocked",
                    gatesPassed: [],
                    gatesFailed: ["structural"],
                    proposalId: blocked.id,
                  });
                  push({
                    kind: "done",
                    cardId: card.id,
                    count: normalized.steps.length,
                    closed: CLOSED_LIFECYCLES.has(final.lifecycle),
                  });
                } else {
                  push({ kind: "skip", cardId: card.id, reason: "card_missing" });
                }
              } catch {
                push({ kind: "skip", cardId: card.id, reason: "orchestration_invalid", errors: error.errors });
              }
            } else {
              push({
                kind: "skip",
                cardId: card.id,
                reason: "orchestration_invalid",
                errors: error.errors,
              });
            }
            return;
          }
          throw error;
        }
        if (!updated) {
          push({ kind: "skip", cardId: card.id, reason: "card_missing" });
          return;
        }
        const final = await finishTransition(updated);
        if (hasOrchestration && gates && proposalRecord) {
          push({
            kind: "orchestration",
            cardId: card.id,
            state: gates.gatesFailed.length === 0 ? "auto-applied" : "blocked",
            gatesPassed: gates.gatesPassed,
            gatesFailed: gates.gatesFailed,
            proposalId: proposalRecord.id,
          });
        }
        push({
          kind: "done",
          cardId: card.id,
          count: normalized.steps.length,
          closed: CLOSED_LIFECYCLES.has(final.lifecycle),
        });
      };

      // Each familiar works through its own tasks in order, and up to
      // MAX_PARALLEL_FAMILIARS familiars run side by side, so a large Board
      // doesn't take one familiar's turn per task end to end. Board writes are
      // serialized by withBoardLock. A failure on one task is reported and the
      // lane moves on, so it never hides the tasks after it.
      const queue = [...lanes.entries()];
      const runLane = async () => {
        for (let next = queue.shift(); next; next = queue.shift()) {
          const [familiarId, lane] = next;
          for (const card of lane) {
            if (req.signal.aborted) return;
            try {
              await reviewCard(card, familiarId);
            } catch {
              push({ kind: "skip", cardId: card.id, reason: "error" });
            }
          }
        }
      };
      await Promise.all(
        Array.from({ length: Math.min(MAX_PARALLEL_FAMILIARS, queue.length) }, runLane),
      );

      push({ kind: "complete" });
      try {
        closed = true;
        controller.close();
      } catch {
        /* */
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-cache",
    },
  });
}