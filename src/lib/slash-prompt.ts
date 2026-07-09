// Helpers for the `/prompt` and `/prompts` slash commands and the Prompt
// snippets modal — the inline autocomplete options shown while typing,
// resolving a typed argument to a template, and the composer insertion. Pure +
// client-safe: the prompt list is passed in (fetched from /api/prompts) so this
// never pulls server code into the bundle. Mirrors slash-skill.ts, with one
// deliberate difference: picking a prompt INSERTS its body into the composer
// for editing — it never sends.

import { nextPlaceholder } from "./prompt-placeholders.ts";

export type PromptOption = {
  id: string;
  name: string;
  description?: string;
  /** Phosphor icon name — validated against the curated set at render. */
  icon?: string;
  tags?: string[];
  /** Template text dropped into the composer. May contain {{placeholder}} tokens. */
  body: string;
  /** Where the template came from: shipped default, ~/.coven/prompts file, or
   *  an installed marketplace prompt pack. */
  source: "builtin" | "user" | `pack:${string}`;
  /** Absolute path for file-backed templates. */
  path?: string;
};

// `/prompts` is the no-arg "show everything" picker; it also accepts a trailing
// filter. `/prompt ` (with a space) is the per-arg autocomplete. Bare `/prompt`
// (no space) matches neither so the command menu shows both commands first.
const PROMPTS_RE = /^\/prompts\s*(.*)$/i;
const PROMPT_ARG_RE = /^\/prompt\s+(.*)$/i;

function filterPrompts(prompts: PromptOption[], partial: string): PromptOption[] {
  const q = partial.trim().toLowerCase();
  if (!q) return prompts;
  return prompts.filter(
    (p) =>
      p.id.toLowerCase().includes(q) ||
      p.name.toLowerCase().includes(q) ||
      (p.description?.toLowerCase().includes(q) ?? false) ||
      (p.tags?.some((tag) => tag.toLowerCase().includes(q)) ?? false),
  );
}

/** Prompt options for the inline autocomplete when the composer is in
 *  `/prompt <partial>` or `/prompts [<partial>]` position. Returns null when
 *  the text isn't a prompt picker, so callers fall back to the command menu. */
export function promptSlashOptions(text: string, prompts: PromptOption[]): PromptOption[] | null {
  const t = text.trimStart();
  const m = t.match(PROMPTS_RE) ?? t.match(PROMPT_ARG_RE);
  if (!m) return null;
  return filterPrompts(prompts, m[1]);
}

/** Resolve a typed /prompt argument to a concrete template: exact id/name
 *  match first, then a substring match. Returns null for an empty/unknown
 *  argument. */
export function resolvePromptArg(arg: string, prompts: PromptOption[]): PromptOption | null {
  const a = arg.trim().toLowerCase();
  if (!a) return null;
  const exact = prompts.find((p) => p.id.toLowerCase() === a || p.name.toLowerCase() === a);
  if (exact) return exact;
  const partial = prompts.find(
    (p) => p.id.toLowerCase().includes(a) || p.name.toLowerCase().includes(a),
  );
  return partial ?? null;
}

export type PromptInsertion = {
  text: string;
  /** When the body carries a {{placeholder}}, the range of the first one so
   *  the caller can select it — typing then replaces the placeholder. */
  selectStart?: number;
  selectEnd?: number;
};

/** The composer insertion for a picked template. Never a send. Selects the
 *  first {{placeholder}} (shared engine grammar, incl. {{name|default}}) so
 *  typing replaces it and Tab cycles onward from there. */
export function promptInsertion(p: PromptOption): PromptInsertion {
  const first = nextPlaceholder(p.body, 0, 1);
  if (!first) return { text: p.body };
  return { text: p.body, selectStart: first.start, selectEnd: first.end };
}

/** One-line-per-prompt list for the bare `/prompt` / `/prompts` system message. */
export function formatPromptList(prompts: PromptOption[]): string {
  if (prompts.length === 0) {
    return "No prompt templates found. Add .md files under ~/.coven/prompts or install a prompt pack from the Marketplace, then try `/prompts` again.";
  }
  const lines = prompts.map(
    (p) => `  ○ ${p.name} — \`${p.id}\`${p.description ? ` — ${p.description}` : ""}`,
  );
  return `Available prompts (type \`/prompt <name>\` or pick from the menu — picking drops the template into the composer):\n${lines.join("\n")}`;
}
