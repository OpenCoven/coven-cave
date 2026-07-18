export type PromptEnhanceMode = "chat" | "code" | "image" | "research" | "task";

type PromptEnhanceContext = {
  activeProject?: {
    name?: unknown;
    root?: unknown;
  };
  selectedFiles?: unknown;
  recentThreadTitle?: unknown;
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
  return lines;
}

function normalizeContext(context: unknown): PromptEnhanceContext {
  return typeof context === "object" && context !== null ? (context as PromptEnhanceContext) : {};
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

/** The race rule: if the draft changed while the rewrite streamed, never
 *  overwrite — surface the result as a suggestion instead. */
export function settleEnhance(baseDraft: string, currentDraft: string): "apply" | "suggest" {
  return baseDraft === currentDraft ? "apply" : "suggest";
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
    return {
      ok: true,
      mode,
      label: "Research",
      enhanced: [
        `Research and compare: ${draft}.`,
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
