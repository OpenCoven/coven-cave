// Runtime → provider → models map. Pure, dependency-free data + helpers.
//
// "Model parity" means every runtime gets the same first-class, working model
// selection, sourced from the provider tied to that runtime where one exists.
// Model ids follow Cave's existing namespaced convention (`provider/model`),
// matching the live default (`openai/gpt-5.5`).
//
// The curated lists below are a seed. They are intentionally a one-line edit as
// providers ship new models, and `allowCustom` is the safety valve so the menu
// never blocks an id that isn't listed yet. Runtimes with no clean provider
// (e.g. OpenClaw) get `provider: null` and render a free-text field only — the
// literal "else the runtime's CLI" branch.

export type RuntimeProvider = "openai" | "anthropic" | "nous" | null;

export type RuntimeModelOption = { id: string; label: string };

export type RuntimeModelCatalog = {
  /** Harness id: codex | claude | hermes | openclaw. */
  runtime: string;
  provider: RuntimeProvider;
  /** Curated seed; empty ⇒ no menu, free-text only. */
  models: RuntimeModelOption[];
  /** User may type any model id not present in `models`. */
  allowCustom: boolean;
};

export const RUNTIME_MODEL_CATALOG: Record<string, RuntimeModelCatalog> = {
  codex: {
    runtime: "codex",
    provider: "openai",
    models: [{ id: "openai/gpt-5.5", label: "GPT-5.5" }],
    allowCustom: true,
  },
  claude: {
    runtime: "claude",
    provider: "anthropic",
    models: [
      { id: "anthropic/claude-opus-4-8", label: "Claude Opus 4.8" },
      { id: "anthropic/claude-opus-4-7", label: "Claude Opus 4.7" },
      { id: "anthropic/claude-sonnet-5", label: "Claude Sonnet 5" },
      { id: "anthropic/claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
      { id: "anthropic/claude-haiku-4-5", label: "Claude Haiku 4.5" },
    ],
    allowCustom: true,
  },
  hermes: {
    runtime: "hermes",
    provider: "nous",
    models: [{ id: "nous/hermes-4", label: "Hermes 4" }],
    allowCustom: true,
  },
  // No clean provider → defer to the runtime's own CLI: free-text only, no menu.
  openclaw: {
    runtime: "openclaw",
    provider: null,
    models: [],
    allowCustom: true,
  },
};

const GLOBAL_DEFAULT_MODEL = "openai/gpt-5.5";

export function catalogForRuntime(runtime: string): RuntimeModelCatalog | null {
  return RUNTIME_MODEL_CATALOG[runtime] ?? null;
}

export function defaultModelForRuntime(runtime: string): string {
  return catalogForRuntime(runtime)?.models[0]?.id ?? GLOBAL_DEFAULT_MODEL;
}

export function isModelInCatalog(runtime: string, modelId: string): boolean {
  const catalog = catalogForRuntime(runtime);
  if (!catalog) return false;
  return catalog.models.some((model) => model.id === modelId);
}
