import { loadBoard, updateCard } from "@/lib/cave-board";
import {
  LIFECYCLES,
  PRIORITIES,
  STATUSES,
  type Card,
  type CardLifecycle,
  type CardPriority,
  type CardStatus,
  type CardStep,
} from "@/lib/cave-board-types";
import { bindingFor, loadConfig } from "@/lib/cave-config";
import { covenBin, covenSpawnEnv } from "@/lib/coven-bin";
import { familiarWorkspace } from "@/lib/coven-paths";
import { isTrustedChatHarness } from "@/lib/harness-adapters";
import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import { stripAnsi } from "@/lib/ansi";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ENRICH_INTENT = "board-enrich-steps";
const STATUS_VALUES = new Set<CardStatus>(STATUSES);
const LIFECYCLE_VALUES = new Set<CardLifecycle>(LIFECYCLES);
const PRIORITY_VALUES = new Set<CardPriority>(PRIORITIES);

type TaskEnrichment = {
  steps?: string[];
  status?: CardStatus;
  lifecycle?: CardLifecycle;
  priority?: CardPriority;
  needsHuman?: boolean;
  lifecycleReason?: string;
};

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

function enrichPrompt(card: Card): string {
  const labels = card.labels?.length
    ? `\nLabels: ${card.labels.join(", ")}`
    : "";
  const notes = card.notes?.trim() ? `\n\nNotes:\n${card.notes.trim()}` : "";
  const steps = card.steps?.length
    ? `\n\nCurrent steps:\n${card.steps
        .map((step, index) => `${index + 1}. [${step.done ? "x" : " "}] ${step.text}`)
        .join("\n")}`
    : "";
  return [
    `You are refreshing a board task so it reflects the current best plan and state.`,
    `Task: ${card.title.trim()}${labels}${notes}`,
    `Current status: ${card.status}`,
    `Current lifecycle: ${card.lifecycle}`,
    `Current priority: ${card.priority}`,
    `Needs human: ${card.needsHuman ? "yes" : "no"}${steps}`,
    ``,
    `Output ONLY one JSON object with these keys:`,
    `{"steps":["short action"],"status":"backlog|inbox|running|review|blocked|done","lifecycle":"queued|dispatched|running|review|completed|failed|cancelled","priority":"low|medium|high|urgent","needsHuman":false,"lifecycleReason":"short reason"}`,
    `Produce 3-8 steps that reflect your role, skills, and the ideal current process.`,
    `Each step must be a short, actionable sentence under 80 characters.`,
    `Use status, lifecycle, priority, needsHuman, and lifecycleReason to reflect the task's current reality.`,
    `Return no explanation, no markdown, and no extra text.`,
  ].join("\n");
}

async function hasIntent(req: Request): Promise<boolean> {
  if (req.headers.get("x-coven-cave-intent") !== "board-enrich-steps")
    return false;
  try {
    const body = (await req.json()) as { intent?: unknown };
    return body.intent === "board-enrich-steps";
  } catch {
    return false;
  }
}

async function resolveFamiliarWorkspace(
  familiarId: string,
): Promise<string | undefined> {
  if (!/^[a-z0-9_-]+$/i.test(familiarId)) return undefined;
  const candidate = await familiarWorkspace(familiarId);
  try {
    const entry = await stat(candidate);
    return entry.isDirectory() ? candidate : undefined;
  } catch {
    return undefined;
  }
}

// Run coven CLI and collect full stdout output as a string.
function runCoven(
  args: string[],
  signal: AbortSignal,
  familiarWorkspacePath?: string,
): Promise<string> {
  return new Promise((resolve) => {
    try {
      let out = "";
      let settled = false;
      const child = spawn(covenBin(), args, {
        cwd: familiarWorkspacePath ?? process.cwd(),
        stdio: ["ignore", "pipe", "pipe"],
        env: covenSpawnEnv(),
      });

      const finish = () => {
        if (settled) return;
        settled = true;
        signal.removeEventListener("abort", onAbort);
        resolve(out);
      };
      const onAbort = () => {
        try {
          child.kill("SIGTERM");
        } catch {
          /* ignore */
        }
      };

      if (signal.aborted) onAbort();
      signal.addEventListener("abort", onAbort, { once: true });

      child.stdout.on("data", (d: Buffer) => {
        out += d.toString("utf8");
      });
      child.stderr.on("data", (d: Buffer) => {
        out += d.toString("utf8");
      });
      child.on("close", finish);
      child.on("error", finish);
    } catch {
      resolve("");
    }
  });
}

function assistantTextFromOutput(raw: string): string {
  const clean = stripAnsi(raw);
  let assistantText = "";
  for (const line of clean.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
      try {
        const ev = JSON.parse(trimmed) as {
          type?: string;
          message?: { content?: Array<{ type?: string; text?: string }> };
        };
        if (ev.type === "assistant" && ev.message?.content) {
          for (const block of ev.message.content) {
            if (block.type === "text" && typeof block.text === "string") {
              assistantText += block.text;
            }
          }
          continue;
        }
      } catch {
        /* fall through */
      }
    }

    // Fallback for harnesses that emit plain text even with --stream-json.
    assistantText += trimmed + "\n";
  }
  return assistantText.trim() ? assistantText : clean;
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

function parseTaskEnrichment(raw: string): TaskEnrichment | null {
  const haystack = assistantTextFromOutput(raw);
  try {
    const parsed = parseJsonObject(haystack);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const candidate = parsed as Record<string, unknown>;
      return {
        steps: cleanStepStrings(candidate.steps),
        status: STATUS_VALUES.has(candidate.status as CardStatus)
          ? candidate.status as CardStatus
          : undefined,
        lifecycle: LIFECYCLE_VALUES.has(candidate.lifecycle as CardLifecycle)
          ? candidate.lifecycle as CardLifecycle
          : undefined,
        priority: PRIORITY_VALUES.has(candidate.priority as CardPriority)
          ? candidate.priority as CardPriority
          : undefined,
        needsHuman: typeof candidate.needsHuman === "boolean" ? candidate.needsHuman : undefined,
        lifecycleReason: cleanReason(candidate.lifecycleReason),
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
    steps: mergeSteps(card, enrichment.steps ?? [], now),
    status,
    lifecycle,
    priority,
    needsHuman,
    lifecycleReason: enrichment.lifecycleReason ?? card.lifecycleReason,
    lifecycleAt: lifecycle !== card.lifecycle ? now : card.lifecycleAt,
  };
}

export async function POST(req: Request) {
  if (!(await hasIntent(req))) {
    return new Response(
      JSON.stringify({ ok: false, error: "missing enrich intent" }),
      {
        status: 403,
        headers: { "content-type": "application/json" },
      },
    );
  }

  const [board, config] = await Promise.all([loadBoard(), loadConfig()]);

  // Only enrich active tasks with an assigned familiar. Existing steps are
  // included so the familiar can refresh stale plans and task metadata.
  const SKIP_LIFECYCLE = new Set(["completed", "cancelled"]);
  const candidates = board.cards.filter(
    (c) =>
      c.familiarId &&
      !SKIP_LIFECYCLE.has(c.lifecycle),
  );

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

      for (const card of candidates) {
        if (req.signal.aborted) break;
        const familiarId = card.familiarId!;
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
          continue;
        }

        push({ kind: "progress", cardId: card.id, title: card.title });

        const title = `Refresh task: ${card.title.trim().slice(0, 80) || card.id}`;
        const args: string[] = [
          "run",
          binding.harness,
          "--stream-json",
          "--archive",
          "--title",
          title,
          "--labels",
          "board,enrich-steps",
        ];
        if (/^[a-z0-9_-]+$/i.test(familiarId))
          args.push("--familiar", familiarId);
        args.push("--", enrichPrompt(card));

        const workspace = await resolveFamiliarWorkspace(familiarId);
        const raw = await runCoven(args, req.signal, workspace);
        if (req.signal.aborted) break;
        const enrichment = parseTaskEnrichment(raw);

        if (!enrichment) {
          push({ kind: "skip", cardId: card.id, reason: "no_task_metadata_parsed" });
          continue;
        }

        const now = new Date().toISOString();
        const normalized = normalizeTaskEnrichment(card, enrichment, now);
        const updated = await updateCard(card.id, {
          steps: normalized.steps,
          status: normalized.status,
          lifecycle: normalized.lifecycle,
          priority: normalized.priority,
          needsHuman: normalized.needsHuman,
          lifecycleReason: normalized.lifecycleReason,
          lifecycleAt: normalized.lifecycleAt,
        });
        if (!updated) {
          push({ kind: "skip", cardId: card.id, reason: "card_missing" });
          continue;
        }
        push({ kind: "done", cardId: card.id, count: normalized.steps.length });
      }

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
