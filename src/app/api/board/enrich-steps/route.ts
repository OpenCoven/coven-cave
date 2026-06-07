import { loadBoard, updateCard } from "@/lib/cave-board";
import type { CardStep } from "@/lib/cave-board-types";
import { bindingFor, loadConfig } from "@/lib/cave-config";
import { covenBin, covenSpawnEnv } from "@/lib/coven-bin";
import { familiarWorkspace } from "@/lib/coven-paths";
import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import { stripAnsi } from "@/lib/ansi";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ENRICH_INTENT = "board-enrich-steps";

// Prompt the familiar to return ONLY a JSON array of step strings — nothing else.
function enrichPrompt(card: {
  title: string;
  notes?: string;
  labels?: string[];
}): string {
  const labels = card.labels?.length
    ? `\nLabels: ${card.labels.join(", ")}`
    : "";
  const notes = card.notes?.trim() ? `\n\nNotes:\n${card.notes.trim()}` : "";
  return [
    `You are helping plan the following task as a concrete checklist.`,
    `Task: ${card.title.trim()}${labels}${notes}`,
    ``,
    `Output ONLY a JSON array of step strings — no explanation, no markdown, no extra text.`,
    `Each step must be a short, actionable sentence (< 80 chars).`,
    `Produce 3–7 steps that reflect your role, skills, and the ideal process for this task.`,
    `Example output: ["Step one","Step two","Step three"]`,
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

// Parse familiar response — look for a JSON array anywhere in the output.
function parseSteps(raw: string): string[] | null {
  const clean = stripAnsi(raw);

  // When using `--stream-json`, assistant text is wrapped in JSON envelopes.
  // Extract the assistant's text payload first so we don't accidentally match
  // other JSON arrays like `message.content`.
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

  const haystack = assistantText.trim() ? assistantText : clean;
  const match = haystack.match(/\[[\s\S]*?\]/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]);
    if (Array.isArray(parsed) && parsed.every((s) => typeof s === "string")) {
      return parsed
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 7);
    }
  } catch {
    /* */
  }
  return null;
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

  // Only enrich tasks that:
  // - have an assigned familiar
  // - are not completed or cancelled
  // - have no existing steps yet (or have 0 steps)
  const SKIP_LIFECYCLE = new Set(["completed", "cancelled"]);
  const candidates = board.cards.filter(
    (c) =>
      c.familiarId &&
      !SKIP_LIFECYCLE.has(c.lifecycle) &&
      (c.steps ?? []).length === 0,
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

        // Local Coven harnesses can run headlessly through `coven run
        // <harness> --stream-json`, including external adapter manifests.
        if (binding.harness === "openclaw") {
          push({
            kind: "skip",
            cardId: card.id,
            reason: `harness:${binding.harness}`,
          });
          continue;
        }

        push({ kind: "progress", cardId: card.id, title: card.title });

        const title = `Plan task steps: ${card.title.trim().slice(0, 80) || card.id}`;
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
        const steps = parseSteps(raw);

        if (!steps || steps.length === 0) {
          push({ kind: "skip", cardId: card.id, reason: "no_steps_parsed" });
          continue;
        }

        const now = new Date().toISOString();
        const cardSteps: CardStep[] = steps.map((text) => ({
          id: crypto.randomUUID(),
          text,
          done: false,
          addedAt: now,
        }));

        const updated = await updateCard(card.id, { steps: cardSteps });
        if (!updated) {
          push({ kind: "skip", cardId: card.id, reason: "card_missing" });
          continue;
        }
        push({ kind: "done", cardId: card.id, count: cardSteps.length });
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
