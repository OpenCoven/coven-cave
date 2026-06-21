// Client helper: ask a familiar to author a workflow by streaming /api/chat/send
// (the same daemon-agent bridge canvas + journal generation use — Cave has no
// server-side LLM). Two passes: (1) goal -> 2-3 clarifying questions, (2) goal +
// answers -> a CWF-01 manifest. Prompt builders and parsers are pure and unit-
// tested; the streaming wrappers mirror canvas-generate. Generated manifests are
// validated server-side on save (same as import), so parsing here only guards
// the structural shape.

import { parse as parseYaml } from "yaml";
import { parseSseFrame } from "@/lib/canvas-generate";

/** A single familiar-authored clarifying question. */
export type GeneratedQuestion = { id: string; question: string; hint?: string };

/** A question paired with the user's typed answer, fed into the manifest pass. */
export type GeneratedAnswer = { id: string; question: string; answer: string };

/** Thrown when the familiar's output can't be parsed into the expected shape. */
export class WorkflowGenerateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkflowGenerateError";
  }
}

const STEP_KINDS = "input, agent, skill, tool, human-gate, workflow, output";

/** Pass 1 prompt: ask the familiar for the 2-3 questions that fully scope the workflow. */
export function buildQuestionsPrompt(goal: string): string {
  return [
    "I want to create an automated workflow. Here is the goal in my words:",
    "",
    goal.trim() || "(no goal given yet — ask the broadest scoping questions)",
    "",
    "Before you design it, ask me the 2-3 most important clarifying questions you need so the",
    "workflow is fully specified. Together your questions must cover these aspects: what input or",
    "trigger starts it, what output artifact it should produce, how we'll know it succeeded, which",
    "skills/tools/agents/sub-workflows it must use, and any limits (max agents, timeout, cost).",
    "Fold related aspects into a single question — never ask more than 3.",
    "",
    "Reply with ONLY a fenced json block in exactly this shape:",
    "```json",
    '{ "questions": [ { "id": "q1", "question": "…", "hint": "optional example" } ] }',
    "```",
  ].join("\n");
}

/** Pass 2 prompt: hand the goal + answers back and ask for a CWF-01 manifest. */
export function buildManifestPrompt(opts: {
  goal: string;
  answers: GeneratedAnswer[];
  familiarId?: string;
  suggestedName?: string;
}): string {
  const qa = opts.answers
    .map((a) => `- ${a.question}\n  ${a.answer.trim() || "(no answer — use a sensible default)"}`)
    .join("\n");
  return [
    `Design a workflow that achieves this goal: ${opts.goal.trim() || "(see answers below)"}`,
    "",
    "My answers to your questions:",
    qa || "(none)",
    "",
    "Produce a single CWF-01 workflow manifest as a fenced yaml block. Requirements:",
    `- Top-level keys: id, version (use "0.1.0"), name${opts.suggestedName ? ` (use "${opts.suggestedName}")` : ""}, summary, pattern, steps.`,
    opts.familiarId ? `- Set "familiar: ${opts.familiarId}".` : "- Omit the familiar field.",
    "- Pick the closest pattern: sequential, fan-out-and-synthesize, classify-and-act,",
    "  adversarial-verification, generate-and-filter, tournament, loop-until-done, or custom.",
    `- Every step needs an "id" and a "kind" (one of: ${STEP_KINDS}).`,
    "- Start with one input step and end with one output step. Use \"requires: [ids]\" for ordering,",
    "  \"uses\" to bind an agent/skill/tool/sub-workflow, and a short \"summary\" per step.",
    "- Reply with ONLY the fenced yaml manifest — no prose before or after.",
    "```yaml",
    "id: example",
    "version: 0.1.0",
    "steps:",
    "  - id: input",
    "    kind: input",
    "  - id: output",
    "    kind: output",
    "    requires: [input]",
    "```",
  ].join("\n");
}

/** First fenced ``` block in the text, or the whole trimmed text as a fallback. */
function fencedBody(text: string): string {
  const match = text.match(/```[\w-]*\n([\s\S]*?)```/);
  return (match ? match[1] : text).trim();
}

/** Extract + parse the questions block; clamp to the first 3; throw if unusable. */
export function parseQuestionsResponse(text: string): GeneratedQuestion[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(fencedBody(text));
  } catch {
    throw new WorkflowGenerateError("The familiar didn't return readable questions. Try again.");
  }
  const raw = (parsed && typeof parsed === "object" && Array.isArray((parsed as { questions?: unknown }).questions))
    ? (parsed as { questions: unknown[] }).questions
    : null;
  if (!raw || raw.length === 0) {
    throw new WorkflowGenerateError("The familiar didn't return any questions. Try again.");
  }
  const questions: GeneratedQuestion[] = [];
  for (const [index, entry] of raw.slice(0, 3).entries()) {
    const obj = (entry && typeof entry === "object" ? entry : {}) as Record<string, unknown>;
    const question = typeof obj.question === "string" ? obj.question.trim() : "";
    if (!question) continue;
    questions.push({
      id: typeof obj.id === "string" && obj.id.trim() ? obj.id.trim() : `q${index + 1}`,
      question,
      hint: typeof obj.hint === "string" && obj.hint.trim() ? obj.hint.trim() : undefined,
    });
  }
  if (questions.length === 0) {
    throw new WorkflowGenerateError("The familiar didn't return any questions. Try again.");
  }
  return questions;
}

/** Extract + parse the manifest block; structural guard only (save validates fully). */
export function parseManifestResponse(text: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = parseYaml(fencedBody(text));
  } catch {
    throw new WorkflowGenerateError("The familiar's workflow couldn't be parsed. Regenerate to try again.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new WorkflowGenerateError("The familiar didn't return a workflow object. Regenerate to try again.");
  }
  const obj = parsed as Record<string, unknown>;
  if (!Array.isArray(obj.steps) || obj.steps.length === 0) {
    throw new WorkflowGenerateError("The generated workflow has no steps. Regenerate to try again.");
  }
  return obj;
}

/** Stream the assistant's full text for `prompt` from `familiarId`. */
async function streamFamiliarText(opts: {
  familiarId: string;
  prompt: string;
  signal?: AbortSignal;
}): Promise<{ text: string; error: string | null }> {
  let res: Response;
  try {
    res = await fetch("/api/chat/send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ familiarId: opts.familiarId, prompt: opts.prompt }),
      signal: opts.signal,
    });
  } catch (err) {
    return { text: "", error: (err as Error)?.message ?? "request failed" };
  }
  if (!res.ok || !res.body) return { text: "", error: `chat bridge ${res.status}` };

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let error: string | null = null;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buffer.indexOf("\n\n")) >= 0) {
      const frame = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const ev = parseSseFrame(frame);
      if (!ev) continue;
      if (ev.kind === "assistant_chunk") text += ev.text ?? "";
      else if (ev.kind === "done" && ev.isError) error = error ?? "the familiar reported an error";
      else if (ev.kind === "error") error = ev.message ?? "generation error";
    }
  }
  return { text, error };
}

export type QuestionsResult = { questions: GeneratedQuestion[] | null; error: string | null };
export type ManifestResult = { manifest: Record<string, unknown> | null; error: string | null };

/** Pass 1: get the familiar's 2-3 clarifying questions for `goal`. */
export async function generateWorkflowQuestions(opts: {
  goal: string;
  familiarId: string;
  signal?: AbortSignal;
}): Promise<QuestionsResult> {
  const { text, error } = await streamFamiliarText({
    familiarId: opts.familiarId,
    prompt: buildQuestionsPrompt(opts.goal),
    signal: opts.signal,
  });
  if (error) return { questions: null, error };
  try {
    return { questions: parseQuestionsResponse(text), error: null };
  } catch (err) {
    return { questions: null, error: err instanceof Error ? err.message : "couldn't read questions" };
  }
}

/** Pass 2: get the generated manifest from `goal` + `answers`. */
export async function generateWorkflowManifest(opts: {
  goal: string;
  answers: GeneratedAnswer[];
  familiarId: string;
  suggestedName?: string;
  signal?: AbortSignal;
}): Promise<ManifestResult> {
  const { text, error } = await streamFamiliarText({
    familiarId: opts.familiarId,
    prompt: buildManifestPrompt({
      goal: opts.goal,
      answers: opts.answers,
      familiarId: opts.familiarId,
      suggestedName: opts.suggestedName,
    }),
    signal: opts.signal,
  });
  if (error) return { manifest: null, error };
  try {
    return { manifest: parseManifestResponse(text), error: null };
  } catch (err) {
    return { manifest: null, error: err instanceof Error ? err.message : "couldn't read the workflow" };
  }
}
