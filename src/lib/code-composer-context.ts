/**
 * The Coding Desk's follow-up dock (#5705): what the composer offers and what
 * it actually sends.
 *
 * The box used to be a bare textarea. Two things were missing that the desk
 * already knew: WHICH file you were reading (and the range the chat block
 * handed off), and what a sensible next ask looks like for a session with
 * changes, a PR, or an open file. Both are pure functions of desk state so
 * the tests can pin them without rendering.
 */

export const CODE_COMPOSER_MAX_SUGGESTIONS = 4;

export type CodeComposerSuggestion = {
  id: string;
  label: string;
  prompt: string;
};

export type CodeComposerSuggestionInput = {
  /** Display name of the file in the viewer, or null when none is open. */
  fileName: string | null;
  hasChanges: boolean;
  hasPr: boolean;
};

/**
 * Up to four pills, most specific first. Each seeds the prompt — it never
 * sends — so the ask stays the reader's own before it reaches the familiar.
 */
export function codeComposerSuggestions(input: CodeComposerSuggestionInput): CodeComposerSuggestion[] {
  const out: CodeComposerSuggestion[] = [];
  if (input.hasChanges) {
    out.push({
      id: "review-changes",
      label: "Review my changes",
      prompt: "Review the working-tree changes in this worktree and list anything risky before I commit.",
    });
  }
  if (input.fileName) {
    out.push({
      id: "explain-file",
      label: "Explain this file",
      prompt: `Explain what ${input.fileName} does and how it fits the project.`,
    });
    out.push({
      id: "test-file",
      label: "Add tests for this file",
      prompt: `Write tests for ${input.fileName} that cover its main behaviours and edge cases.`,
    });
  }
  if (input.hasPr) {
    out.push({
      id: "summarize-pr",
      label: "Summarize the PR",
      prompt: "Summarize this pull request for a reviewer: what changed, why, and what to check.",
    });
  }
  out.push({
    id: "run-checks",
    label: "Run the checks",
    prompt: "Run the project's lint, typecheck and tests, then fix what fails.",
  });
  return out.slice(0, CODE_COMPOSER_MAX_SUGGESTIONS);
}

export type CodeFollowUpInput = {
  prompt: string;
  /** Path shown in the viewer, as the desk prints it. */
  contextPath: string | null;
  /** The handed-off selection, e.g. "lines 12–30". */
  rangeLabel: string | null;
  includeContext: boolean;
};

/** The text that rides on /api/chat/send. Context leads so the model reads it first. */
export function buildCodeFollowUp(input: CodeFollowUpInput): string {
  const prompt = input.prompt.trim();
  if (!prompt) return "";
  if (!input.includeContext || !input.contextPath) return prompt;
  const range = input.rangeLabel?.trim();
  return `Regarding \`${input.contextPath}\`${range ? ` (${range})` : ""}:\n\n${prompt}`;
}

export type CodeComposerPhaseKind = "idle" | "streaming" | "done" | "error";

/** One verb through the lifecycle (design language §10). */
export const CODE_COMPOSER_STATUS: Record<CodeComposerPhaseKind, string> = {
  idle: "",
  streaming: "Replying…",
  done: "Replied",
  error: "Couldn't reply",
};

/** Last few lines of the streamed reply — a peek, not a transcript. */
export function codeComposerReplyTail(text: string, lines = 3): string {
  const all = text.trimEnd().split("\n");
  return all.slice(-lines).join("\n");
}
