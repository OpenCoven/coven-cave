/**
 * Canonical model identity for analytics grouping (issue 6357).
 *
 * Harnesses report one model under several spellings:
 * `anthropic/claude-opus-5-5`, `claude-opus-5-5`, `claude-fable-5.1`,
 * `openAI-gpt-6-astra`, `github/gpt-6-astra`. Grouping by the raw string split
 * one model into several rows, and the one-attempt stragglers read as
 * "0% success". `canonicalModelId` folds the spellings into one key and keeps
 * the provider as its own field; callers keep the raw strings for tooltips and
 * traces.
 *
 * Pure and client-safe.
 */

/** Routing providers that prefix a model id with `/` or, loosely, `-`. */
const PROVIDERS = [
  "anthropic",
  "openai",
  "github",
  "google",
  "azure",
  "bedrock",
  "vertex",
  "openrouter",
  "copilot",
  "ollama",
] as const;

export type CanonicalModel = {
  /** Lowercase id with the provider and any `[…]` variant suffix removed, version separators unified to `-`. */
  id: string;
  /** Provider prefix when the raw id named one, lowercase. */
  provider: string | null;
};

export function canonicalModelId(raw: string): CanonicalModel {
  let id = raw.trim().toLowerCase();
  let provider: string | null = null;

  const slash = id.indexOf("/");
  if (slash > 0) {
    provider = id.slice(0, slash);
    id = id.slice(slash + 1);
  } else {
    const match = PROVIDERS.find((name) => id.startsWith(`${name}-`));
    if (match) {
      provider = match;
      id = id.slice(match.length + 1);
    }
  }

  id = id
    .replace(/\s*\[[^\]]*\]\s*$/, "")
    // `5.1` and `5-1` are the same version: unify the separator between digits.
    .replace(/(\d)\.(?=\d)/g, "$1-")
    .trim();

  return { id, provider };
}
