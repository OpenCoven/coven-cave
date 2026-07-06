import type { PromptOption } from "./slash-prompt";

/**
 * Built-in prompt templates — always available, even before the user authors
 * files under ~/.coven/prompts or installs a marketplace prompt pack. A user
 * file or pack template with the same id overrides these (see mergePrompts in
 * src/lib/server/prompt-scan.ts). Client-safe: the chat composer seeds its
 * picker with this list so prompts work offline.
 *
 * Icons must come from the curated set in src/lib/icon.tsx.
 */
export const BUILTIN_PROMPTS: PromptOption[] = [
  {
    id: "code-review",
    name: "Code review",
    description: "Audit the current change for regressions, dropped edge cases, and missing tests.",
    icon: "ph:list-checks-bold",
    body:
      "Review the current change. Look for regressions, dropped edge cases, and missing tests. Call out anything that would surprise the next reader, and end with a short must-fix list.",
    source: "builtin",
  },
  {
    id: "implementation-plan",
    name: "Implementation plan",
    description: "Outline an approach before touching code so the diff stays focused.",
    icon: "ph:note-pencil",
    body:
      "Before touching code, outline an implementation plan for {{what to build}}. Name the files involved, the order of changes, the risks, and how we verify it works.",
    source: "builtin",
  },
  {
    id: "explain-this",
    name: "Explain this",
    description: "Walk through how the selected code works and link to the key files.",
    icon: "ph:book-open",
    body:
      "Explain how {{file or function}} works. Walk through the flow step by step, link the key files, and note anything non-obvious a newcomer would miss.",
    source: "builtin",
  },
];
