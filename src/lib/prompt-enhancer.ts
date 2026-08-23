import type {
  AgenticEvidenceRef,
  AgenticRecommendation,
} from "./agentic-recommendations.ts";
import { contextFingerprint } from "./agentic-recommendations.ts";
import { containsSecretText, redactSecretText } from "./secret-redaction.ts";

export type PromptEnhanceMode = "chat" | "code" | "image" | "research" | "task";

export type PromptEnhanceContext = {
  activeProject?: {
    name?: unknown;
    root?: unknown;
  };
  selectedFiles?: unknown;
  recentThreadTitle?: unknown;
  recentMessages?: unknown;
  recentToolOutcomes?: unknown;
  linkedTask?: unknown;
  modelScope?: unknown;
};

type PromptEnhanceRequest = {
  draft: unknown;
  mode?: unknown;
  context?: unknown;
};

export type PromptEnhanceResult =
  | {
      ok: true;
      mode: PromptEnhanceMode;
      enhanced: string;
      label: "Enhance" | "Clarify" | "Expand" | "Implement" | "Research";
    }
  | {
      ok: false;
      mode: PromptEnhanceMode;
      error: string;
    };

export type PromptEnhancementPayload = {
  enhanced: string;
  offline: boolean;
  mode: PromptEnhanceMode;
  intent: EnhanceIntent;
};

/** Matches the chat input route's 64 KiB composer ceiling without loosening shared payload limits. */
export const MAX_ENHANCED_PROMPT_CHARS = 64 * 1024;
const MAX_PROMPT_ENHANCEMENT_ENVELOPE_CHARS = MAX_ENHANCED_PROMPT_CHARS * 6 + 128 * 1024;
const SAFE_EVIDENCE_ID_RE = /^(?:[A-Za-z][A-Za-z0-9._:/-]{0,95}|[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;
const RECOMMENDATION_ID_RE = /^[A-Za-z][A-Za-z0-9._:/-]{0,95}$/;
const CONTEXT_FINGERPRINT_RE = /^ctx-v1-[0-9a-f]{32}$/;
const MAX_RECOMMENDATION_TEXT_CHARS = 2_000;

export type CreatePromptEnhancementRecommendationInput = {
  id: string;
  enhanced: string;
  offline: boolean;
  mode: PromptEnhanceMode;
  intent: EnhanceIntent;
  contextFingerprint: string;
  evidenceRefs: AgenticEvidenceRef[];
};

export function normalizeEnhanceMode(mode: unknown): PromptEnhanceMode {
  return mode === "code" || mode === "image" || mode === "research" || mode === "task" || mode === "chat"
    ? mode
    : "chat";
}

function cleanDraft(draft: unknown): string {
  return typeof draft === "string" ? draft.replace(/\s+/g, " ").trim() : "";
}

function asText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asStringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0).map((entry) => entry.trim())
    : [];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function boundedContextText(value: unknown, maxLength = 480): string | null {
  const text = asText(value);
  if (!text) return null;
  return redactSecretText(text).slice(0, maxLength).trim() || null;
}

function boundedContextRecords(value: unknown, limit = 3): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value
      .map(asRecord)
      .filter((entry): entry is Record<string, unknown> => entry !== null)
      .slice(-limit)
    : [];
}

function safeEvidenceId(value: unknown): string | null {
  return typeof value === "string"
    && SAFE_EVIDENCE_ID_RE.test(value)
    && !containsSecretText(value)
    ? value
    : null;
}

function contextEvidenceRefs(context: PromptEnhanceContext): AgenticEvidenceRef[] {
  const evidence: AgenticEvidenceRef[] = [];
  const seen = new Set<string>();
  const add = (kind: AgenticEvidenceRef["kind"], value: unknown, label: string) => {
    const id = safeEvidenceId(value);
    const key = id ? `${kind}:${id}` : null;
    if (!id || !key || seen.has(key)) return;
    seen.add(key);
    evidence.push({ id, kind, label });
  };

  for (const message of boundedContextRecords(context.recentMessages)) {
    add("message", message.id, "Recent chat message");
  }
  const task = asRecord(context.linkedTask);
  if (task) add("task", task.id, "Linked task");
  for (const outcome of boundedContextRecords(context.recentToolOutcomes)) {
    add("artifact", outcome.id, "Recent tool outcome");
  }
  return evidence.slice(0, 8);
}

function capitalizeDraft(draft: string): string {
  return draft.charAt(0).toUpperCase() + draft.slice(1);
}

function contextLines(context: PromptEnhanceContext): string[] {
  const lines: string[] = [];
  const projectName = asText(context.activeProject?.name);
  const projectRoot = asText(context.activeProject?.root);
  if (projectName || projectRoot) {
    lines.push(`Current project: ${projectName ?? "selected project"}${projectRoot ? ` (${projectRoot})` : ""}`);
  }
  const files = asStringList(context.selectedFiles);
  if (files.length) lines.push(`Selected files: ${files.slice(0, 8).join(", ")}`);
  const thread = asText(context.recentThreadTitle);
  if (thread) lines.push(`Current thread: ${thread}`);
  const modelScope = boundedContextText(context.modelScope, 160);
  if (modelScope) lines.push(`Composer model scope: ${modelScope}`);
  const messages = boundedContextRecords(context.recentMessages)
    .map((message) => {
      const role = asText(message.role) === "assistant" ? "Assistant" : "User";
      const text = boundedContextText(message.text);
      return text ? `${role}: ${text}` : null;
    })
    .filter((message): message is string => message !== null);
  if (messages.length) lines.push(`Recent chat context:\n- ${messages.join("\n- ")}`);
  const outcomes = boundedContextRecords(context.recentToolOutcomes)
    .map((outcome) => {
      const name = boundedContextText(outcome.name, 96) ?? "Tool";
      const status = boundedContextText(outcome.status, 32);
      const output = boundedContextText(outcome.output, 320);
      return output ? `${name}${status ? ` (${status})` : ""}: ${output}` : null;
    })
    .filter((outcome): outcome is string => outcome !== null);
  if (outcomes.length) lines.push(`Recent tool outcomes:\n- ${outcomes.join("\n- ")}`);
  const task = asRecord(context.linkedTask);
  if (task) {
    const title = boundedContextText(task.title, 160);
    const status = boundedContextText(task.status, 48);
    const notes = boundedContextText(task.notes, 320);
    if (title || status || notes) {
      lines.push(`Linked task: ${title ?? "Current task"}${status ? ` (${status})` : ""}${notes ? ` — ${notes}` : ""}`);
    }
  }
  return lines;
}

function normalizeContext(context: unknown): PromptEnhanceContext {
  return typeof context === "object" && context !== null ? (context as PromptEnhanceContext) : {};
}

/** A bounded, secret-redacted fingerprint input; drafts deliberately stay out. */
export function promptEnhancementContextFingerprintInput(context: unknown) {
  const normalized = normalizeContext(context);
  const task = asRecord(normalized.linkedTask);
  return {
    activeProject: {
      name: boundedContextText(normalized.activeProject?.name, 160),
      root: boundedContextText(normalized.activeProject?.root, 320),
    },
    selectedFiles: asStringList(normalized.selectedFiles)
      .slice(0, 8)
      .map((file) => redactSecretText(file).slice(0, 320)),
    recentThreadTitle: boundedContextText(normalized.recentThreadTitle, 160),
    modelScope: boundedContextText(normalized.modelScope, 160),
    recentMessages: boundedContextRecords(normalized.recentMessages).map((message) => ({
      id: safeEvidenceId(message.id),
      role: boundedContextText(message.role, 24),
      text: boundedContextText(message.text),
    })),
    recentToolOutcomes: boundedContextRecords(normalized.recentToolOutcomes).map((outcome) => ({
      id: safeEvidenceId(outcome.id),
      name: boundedContextText(outcome.name, 96),
      status: boundedContextText(outcome.status, 32),
      output: boundedContextText(outcome.output, 320),
    })),
    linkedTask: {
      id: safeEvidenceId(task?.id),
      title: boundedContextText(task?.title, 160),
      status: boundedContextText(task?.status, 48),
      notes: boundedContextText(task?.notes, 320),
    },
  };
}

export function promptEnhancementLifecycleFingerprint({
  mode,
  familiarId,
  context,
}: {
  mode: PromptEnhanceMode;
  familiarId: string | null | undefined;
  context?: unknown;
}): string {
  const contextKey = contextFingerprint({
    mode,
    familiarId: familiarId ?? null,
    context: promptEnhancementContextFingerprintInput(context),
  });
  return contextFingerprint({ contextKey });
}

// ── Model-backed enhancement (cave-b6c2) ─────────────────────────────────────
// The rule engine below remains the instant offline/failure fallback; the
// premium path streams a real rewrite from the user's familiar. These helpers
// are pure so both the hook and tests can exercise the protocol directly.

export type EnhanceIntent = "auto" | "clarify" | "expand" | "specific" | "shorten" | "criteria";

export const ENHANCE_INTENTS: { id: EnhanceIntent; label: string; goal: string }[] = [
  { id: "auto", label: "Smart enhance", goal: "Improve the prompt however helps most: sharpen the ask, add the missing specifics, and structure the expected output." },
  { id: "clarify", label: "Clarify", goal: "Remove ambiguity: make the ask, scope, and success criteria unmistakable without adding new work." },
  { id: "expand", label: "Expand", goal: "Broaden a thin draft into a complete brief: fill in the implied requirements, context, and output expectations." },
  { id: "specific", label: "Make specific", goal: "Replace vague language with concrete names, quantities, file paths, and observable outcomes." },
  { id: "shorten", label: "Shorten", goal: "Compress to the essential ask: keep every constraint, drop every redundancy. Aim for half the length." },
  { id: "criteria", label: "Add acceptance criteria", goal: "Keep the draft's body, then append a short 'Acceptance criteria' list of 3-5 observable checks that prove completion." },
];

const MODE_EXPECTATION: Record<PromptEnhanceMode, string> = {
  chat: "General request: favor a clear question or directive plus the expected output shape.",
  code: "Code request: favor root-cause framing, smallest-change expectations, conventions, tests, and a verification summary.",
  image: "Image request: favor composition, lighting, style, color palette, and output constraints.",
  research: "Research request: favor primary questions, method, sources/confidence, and an executive-summary-first output format.",
  task: "Task request: favor a title, outcome, acceptance criteria, ordered subtasks, and verification.",
};

/** The meta-prompt sent to the familiar. The model rewrites the draft — it
 *  must never ANSWER it — and returns only the rewrite inside <enhanced> tags
 *  so streaming extraction has an unambiguous frame. */
export function buildEnhanceInstruction({
  draft,
  mode,
  intent,
  context,
}: {
  draft: string;
  mode: PromptEnhanceMode;
  intent: EnhanceIntent;
  context?: unknown;
}): string {
  const goal = (ENHANCE_INTENTS.find((i) => i.id === intent) ?? ENHANCE_INTENTS[0]).goal;
  const ctx = contextLines(normalizeContext(context));
  return [
    "You are a prompt engineer. Rewrite the user's draft prompt into a stronger prompt.",
    `Goal: ${goal}`,
    MODE_EXPECTATION[mode],
    "Rules: preserve the user's objective, tone, and every explicit constraint. Do not answer the prompt, do not invent new work, do not address the user.",
    ctx.length ? `Context available to the final assistant:\n- ${ctx.join("\n- ")}` : "",
    "Return ONLY the rewritten prompt wrapped exactly in <enhanced></enhanced> tags — no preamble, no commentary.",
    "",
    "Draft prompt:",
    "```",
    draft,
    "```",
  ].filter(Boolean).join("\n");
}

/** Streaming-safe extraction of the rewrite. While the stream is mid-flight
 *  the text may hold an unopened/unclosed tag or a trailing partial fragment
 *  of `</enhanced` — trim those so the preview never flashes tag noise. A
 *  finished stream with no tags at all falls back to the whole trimmed text
 *  (models occasionally ignore wrapping) minus stray code fences. */
export function extractEnhancedPrompt(text: string): { partial: string; complete: boolean } {
  const OPEN = "<enhanced>";
  const CLOSE = "</enhanced>";
  const open = text.indexOf(OPEN);
  if (open >= 0) {
    const start = open + OPEN.length;
    const close = text.indexOf(CLOSE, start);
    if (close >= 0) return { partial: text.slice(start, close).trim(), complete: true };
    // Mid-stream: trim a trailing partial of the closing tag (longest suffix
    // of the body that is a prefix of "</enhanced>") so it never renders.
    let body = text.slice(start);
    for (let n = Math.min(CLOSE.length - 1, body.length); n > 0; n -= 1) {
      if (body.endsWith(CLOSE.slice(0, n))) {
        body = body.slice(0, body.length - n);
        break;
      }
    }
    return { partial: body.trimStart(), complete: false };
  }
  // No opening tag yet. If everything so far could still become the tag
  // (a prefix of it, ignoring leading whitespace), show nothing.
  const lead = text.trimStart();
  if (lead.length < OPEN.length && OPEN.startsWith(lead)) return { partial: "", complete: false };
  // A tagless stream is usable as-is once trimmed of stray code fences —
  // models occasionally ignore the wrapping instruction.
  const cleaned = lead.trim().replace(/^```[a-z]*\n?/, "").replace(/\n?```$/, "").trim();
  return { partial: cleaned, complete: false };
}

/** Complete model output is stricter than streaming preview: one clean frame only. */
export function extractCompleteEnhancedPrompt(text: string): string | null {
  const match = /^\s*<enhanced>((?:(?!<\/?enhanced>)[\s\S])+)<\/enhanced>\s*$/.exec(text);
  if (!match) return null;
  const enhanced = match[1]!.trim();
  return enhanced && enhanced.length <= MAX_ENHANCED_PROMPT_CHARS ? enhanced : null;
}

/** The race rule: if the draft changed while the rewrite streamed, never
 *  overwrite — surface the result as a suggestion instead. */
export function settleEnhance(baseDraft: string, currentDraft: string): "apply" | "suggest" {
  return baseDraft === currentDraft ? "apply" : "suggest";
}

/** Builds a typed, review-only Chat proposal after the strict `<enhanced>` extraction. */
export function createPromptEnhancementRecommendation(
  input: CreatePromptEnhancementRecommendationInput,
): AgenticRecommendation<PromptEnhancementPayload> {
  const intent = ENHANCE_INTENTS.find((entry) => entry.id === input.intent) ?? ENHANCE_INTENTS[0]!;
  const evidenceRefs = input.evidenceRefs.slice(0, 8);
  return {
    id: input.id,
    surface: "chat",
    kind: "prose",
    payload: {
      enhanced: input.enhanced,
      offline: input.offline,
      mode: input.mode,
      intent: input.intent,
    },
    rationale: `${intent.label} was selected to improve the current draft without changing its objective.`,
    inferredGoal: intent.goal,
    rankReasons: [
      "Preserves the current draft as an explicit proposal.",
      ...(evidenceRefs.length ? ["Uses the bounded active chat context."] : ["Uses the selected enhancement intent."]),
    ],
    evidenceRefs,
    contextFingerprint: input.contextFingerprint,
    verification: { status: "proposal", checks: [] },
    application: { mode: "review", requiresApproval: true, reversible: false },
  };
}

/**
 * The shared parser accepts only model-shaped fields; code-owned verification
 * and application state are reconstructed by strict extraction.
 */
export function serializePromptEnhancementRecommendation(
  recommendation: AgenticRecommendation<PromptEnhancementPayload>,
): string {
  const { verification: _verification, application: _application, ...modelOutput } = recommendation;
  return JSON.stringify({ recommendations: [modelOutput] });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && actual.every((key) => keys.includes(key));
}

function isBoundedRecommendationText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= MAX_RECOMMENDATION_TEXT_CHARS;
}

function isPromptMode(value: unknown): value is PromptEnhanceMode {
  return value === "chat" || value === "code" || value === "image" || value === "research" || value === "task";
}

function isEnhanceIntent(value: unknown): value is EnhanceIntent {
  return value === "auto"
    || value === "clarify"
    || value === "expand"
    || value === "specific"
    || value === "shorten"
    || value === "criteria";
}

function parsePromptEvidenceRefs(value: unknown): AgenticEvidenceRef[] | null {
  if (!Array.isArray(value) || value.length > 8) return null;
  const seen = new Set<string>();
  const refs: AgenticEvidenceRef[] = [];
  for (const evidence of value) {
    if (
      !isRecord(evidence)
      || !hasExactKeys(evidence, ["id", "kind", "label"])
      || typeof evidence.id !== "string"
      || !SAFE_EVIDENCE_ID_RE.test(evidence.id)
      || (evidence.kind !== "task"
        && evidence.kind !== "dependency"
        && evidence.kind !== "github"
        && evidence.kind !== "mission"
        && evidence.kind !== "saved-link"
        && evidence.kind !== "vault"
        && evidence.kind !== "message"
        && evidence.kind !== "artifact")
      || !isBoundedRecommendationText(evidence.label)
      || containsSecretText(evidence.id)
      || containsSecretText(evidence.label)
    ) {
      return null;
    }
    const key = `${evidence.kind}:${evidence.id}`;
    if (seen.has(key)) return null;
    seen.add(key);
    refs.push({
      id: evidence.id,
      kind: evidence.kind,
      label: evidence.label,
    });
  }
  return refs;
}

/**
 * A narrow parser for Chat's composer-sized prose payload. It leaves shared
 * recommendation bounds unchanged while retaining the 64 KiB input contract.
 */
export function parsePromptEnhancementRecommendationOutput(text: string): AgenticRecommendation<PromptEnhancementPayload>[] {
  if (text.length > MAX_PROMPT_ENHANCEMENT_ENVELOPE_CHARS) {
    throw new Error("prompt enhancement output is too large");
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(text);
  } catch {
    throw new Error("prompt enhancement output is invalid");
  }
  if (!isRecord(decoded) || !hasExactKeys(decoded, ["recommendations"]) || !Array.isArray(decoded.recommendations) || decoded.recommendations.length !== 1) {
    throw new Error("prompt enhancement envelope is invalid");
  }

  const modelOutput = decoded.recommendations[0];
  if (
    !isRecord(modelOutput)
    || !hasExactKeys(modelOutput, [
      "id",
      "surface",
      "kind",
      "payload",
      "rationale",
      "inferredGoal",
      "rankReasons",
      "evidenceRefs",
      "contextFingerprint",
    ])
    || typeof modelOutput.id !== "string"
    || !RECOMMENDATION_ID_RE.test(modelOutput.id)
    || modelOutput.surface !== "chat"
    || modelOutput.kind !== "prose"
    || !isBoundedRecommendationText(modelOutput.rationale)
    || !isBoundedRecommendationText(modelOutput.inferredGoal)
    || !Array.isArray(modelOutput.rankReasons)
    || modelOutput.rankReasons.length > 8
    || !modelOutput.rankReasons.every(isBoundedRecommendationText)
    || typeof modelOutput.contextFingerprint !== "string"
    || !CONTEXT_FINGERPRINT_RE.test(modelOutput.contextFingerprint)
    || !isRecord(modelOutput.payload)
    || !hasExactKeys(modelOutput.payload, ["enhanced", "offline", "mode", "intent"])
    || typeof modelOutput.payload.enhanced !== "string"
    || modelOutput.payload.enhanced.trim().length === 0
    || modelOutput.payload.enhanced.length > MAX_ENHANCED_PROMPT_CHARS
    || containsSecretText(modelOutput.payload.enhanced)
    || typeof modelOutput.payload.offline !== "boolean"
    || !isPromptMode(modelOutput.payload.mode)
    || !isEnhanceIntent(modelOutput.payload.intent)
  ) {
    throw new Error("prompt enhancement recommendation is invalid");
  }
  const evidenceRefs = parsePromptEvidenceRefs(modelOutput.evidenceRefs);
  if (!evidenceRefs) throw new Error("prompt enhancement evidence is invalid");
  return [{
    id: modelOutput.id,
    surface: "chat",
    kind: "prose",
    payload: {
      enhanced: modelOutput.payload.enhanced,
      offline: modelOutput.payload.offline,
      mode: modelOutput.payload.mode,
      intent: modelOutput.payload.intent,
    },
    rationale: modelOutput.rationale,
    inferredGoal: modelOutput.inferredGoal,
    rankReasons: [...modelOutput.rankReasons],
    evidenceRefs,
    contextFingerprint: modelOutput.contextFingerprint,
    verification: { status: "proposal", checks: [] },
    application: { mode: "review", requiresApproval: true, reversible: false },
  }];
}

export function isPromptEnhancementRecommendationCurrent(
  recommendation: Pick<AgenticRecommendation<PromptEnhancementPayload>, "contextFingerprint">,
  currentContextFingerprint: string,
): boolean {
  return recommendation.contextFingerprint === currentContextFingerprint;
}

export function promptEnhancementEvidenceRefs(context: unknown): AgenticEvidenceRef[] {
  return contextEvidenceRefs(normalizeContext(context));
}

// ── Research idempotency (#4628) ──────────────────────────────────────────────
// Improve sends the full input back through the formatter on every click, so a
// second click re-wraps an already-formatted Research prompt and duplicates the
// generated sections. Recover the underlying question from a prior wrapper so a
// second pass rebuilds the wrapper instead of nesting another copy inside it.

const RESEARCH_PREFIX = "Research and compare: ";
const RESEARCH_SECTION_HEADERS = [
  "Primary questions:",
  "Method:",
  "Sources and confidence:",
  "Output format:",
] as const;

/** Returns the original question embedded in a prior research-mode enhancement,
 *  or null when `draft` is not a wrapped research prompt. The formatter appends
 *  exactly one "." to the draft, so exactly one trailing "." is dropped — that
 *  reconstructs a draft that already ended with a period verbatim. */
function recoverResearchCore(draft: string): string | null {
  if (!draft.startsWith(RESEARCH_PREFIX)) return null;
  const body = draft.slice(RESEARCH_PREFIX.length);
  // cleanDraft collapses whitespace, so sections may follow the question
  // separated by a single space; the first generated header is the boundary.
  let boundary = -1;
  for (const header of RESEARCH_SECTION_HEADERS) {
    const index = body.indexOf(header);
    if (index >= 0 && (boundary < 0 || index < boundary)) boundary = index;
  }
  if (boundary < 0) return null;
  const core = body.slice(0, boundary).trim();
  if (!core) return null;
  return core.endsWith(".") ? core.slice(0, -1).trim() : core;
}

export function buildPromptEnhancement(input: PromptEnhanceRequest): PromptEnhanceResult {
  const mode = normalizeEnhanceMode(input.mode);
  const draft = cleanDraft(input.draft);
  if (!draft) return { ok: false, mode, error: "Draft is empty." };

  const context = normalizeContext(input.context);
  const contextBlock = contextLines(context);
  const contextText = contextBlock.length ? `\n\nContext:\n- ${contextBlock.join("\n- ")}` : "";
  const preserved = "Do not change the objective, invent new work, or discard any explicit constraints.";

  if (mode === "code") {
    return {
      ok: true,
      mode,
      label: "Implement",
      enhanced: [
        `Investigate and implement this code request: ${draft}.`,
        contextText,
        "\nImplementation expectations:",
        "- Start by identifying the root cause or exact change area.",
        "- Follow the existing architecture, style, and project conventions.",
        "- Make the smallest appropriate fix or addition.",
        "- Update or add focused tests for affected behavior when appropriate.",
        "- Summarize the cause, the changes made, verification run, and any follow-up risk.",
        `- ${preserved}`,
      ].filter(Boolean).join("\n"),
    };
  }

  if (mode === "image") {
    return {
      ok: true,
      mode,
      label: "Expand",
      enhanced: [
        `Create an image of ${draft}.`,
        "Composition: define the subject, focal point, camera framing, and spatial layout clearly.",
        "Lighting: describe the light source, mood, contrast, and time of day.",
        "Style: specify medium, rendering quality, texture, and level of realism.",
        "Color: include palette guidance and any colors to avoid.",
        "Output: include aspect ratio, background treatment, and any important negative constraints.",
        preserved,
      ].join("\n"),
    };
  }

  if (mode === "research") {
    const question = recoverResearchCore(draft) ?? draft;
    return {
      ok: true,
      mode,
      label: "Research",
      enhanced: [
        `Research and compare: ${question}.`,
        "Primary questions: identify the key claims, tradeoffs, and decision criteria to answer.",
        "Method: use current primary sources where possible, compare alternatives, and separate facts from inference.",
        "Sources and confidence: cite sources, note publication dates, and label confidence or uncertainty.",
        "Output format: start with an executive summary, then detailed findings, comparison criteria, and recommended next steps.",
        preserved,
      ].join("\n"),
    };
  }

  if (mode === "task") {
    return {
      ok: true,
      mode,
      label: "Implement",
      enhanced: [
        `Turn this into a concrete task: ${draft}.`,
        contextText,
        "\nTask brief:",
        "- Task title: a short imperative title.",
        "- Outcome: the concrete result that should exist when this is done.",
        "- Acceptance criteria: 3-5 observable checks that prove completion.",
        "- Subtasks: ordered implementation steps sized for one maintainer or agent.",
        "- Context: include relevant project, file, dependency, or user constraints.",
        "- Verification: name the focused checks or manual proof expected before closing.",
        `- ${preserved}`,
      ].filter(Boolean).join("\n"),
    };
  }

  return {
    ok: true,
    mode,
    label: draft.length < 40 ? "Expand" : "Clarify",
    enhanced: [
      `${capitalizeDraft(draft)}.`,
      "Explain the topic clearly and directly, preserving the user's tone and intent.",
      "Cover the key concepts, practical examples, common pitfalls, and any important tradeoffs.",
      "Output format: start with a concise summary, then use organized sections or bullets if they make the answer easier to scan.",
      "Ask a clarifying question only if the request cannot be answered safely without one.",
      preserved,
    ].join("\n"),
  };
}
