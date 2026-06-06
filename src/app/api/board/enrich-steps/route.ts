import { loadBoard, updateCard } from "@/lib/cave-board";
import type { CardStep } from "@/lib/cave-board-types";
import { bindingFor, loadConfig } from "@/lib/cave-config";
import { covenBin, covenSpawnEnv } from "@/lib/coven-bin";
import { spawn } from "node:child_process";
import { stripAnsi } from "@/lib/ansi";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Prompt the familiar to return ONLY a JSON array of step strings — nothing else.
function enrichPrompt(card: { title: string; notes?: string; labels?: string[] }): string {
  const labels = card.labels?.length ? `\nLabels: ${card.labels.join(", ")}` : "";
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

// Run coven CLI and collect full stdout output as a string.
function runCoven(args: string[], familiarId: string, familiarWorkspacePath?: string): Promise<string> {
  return new Promise((resolve) => {
    let out = "";
    const child = spawn(covenBin(), args, {
      cwd: familiarWorkspacePath ?? process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
      env: covenSpawnEnv(),
    });
    child.stdout.on("data", (d: Buffer) => { out += d.toString("utf8"); });
    child.on("close", () => resolve(out));
    child.on("error", () => resolve(""));
  });
}

// Parse familiar response — look for a JSON array anywhere in the output.
function parseSteps(raw: string): string[] | null {
  const clean = stripAnsi(raw);
  // Try to find a JSON array in the response (familiar may add prose around it)
  const match = clean.match(/\[[\s\S]*?\]/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]);
    if (Array.isArray(parsed) && parsed.every((s) => typeof s === "string")) {
      return parsed.filter((s) => s.trim().length > 0).slice(0, 10);
    }
  } catch { /* */ }
  return null;
}

export async function POST() {
  const [board, config] = await Promise.all([loadBoard(), loadConfig()]);

  // Only enrich tasks that:
  // - have an assigned familiar
  // - are not completed or cancelled
  // - have no existing steps yet (or have 0 steps)
  const SKIP_LIFECYCLE = new Set(["completed", "cancelled"]);
  const candidates = board.cards.filter(
    (c) => c.familiarId && !SKIP_LIFECYCLE.has(c.lifecycle) && (c.steps ?? []).length === 0
  );

  const stream = new ReadableStream<Uint8Array>({
    start: async (controller) => {
      const enc = new TextEncoder();
      const push = (obj: object) =>
        controller.enqueue(enc.encode(JSON.stringify(obj) + "\n"));

      push({ kind: "start", total: candidates.length });

      for (const card of candidates) {
        const familiarId = card.familiarId!;
        const binding = bindingFor(config, familiarId);

        // Only codex/claude harnesses can run headlessly
        if (!["codex", "claude"].includes(binding.harness)) {
          push({ kind: "skip", cardId: card.id, reason: `harness:${binding.harness}` });
          continue;
        }

        push({ kind: "progress", cardId: card.id, title: card.title });

        const args: string[] = ["run", binding.harness, "--stream-json"];
        if (/^[a-z0-9_-]+$/i.test(familiarId)) args.push("--familiar", familiarId);
        args.push("--", enrichPrompt(card));

        const raw = await runCoven(args, familiarId);
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

        await updateCard(card.id, { steps: cardSteps });
        push({ kind: "done", cardId: card.id, count: cardSteps.length });
      }

      push({ kind: "complete" });
      try { controller.close(); } catch { /* */ }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-cache",
    },
  });
}
