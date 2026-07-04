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
