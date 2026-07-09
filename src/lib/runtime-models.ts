// Runtime → provider → models map. Pure, dependency-free data + helpers.
//
// "Model parity" means every runtime gets the same first-class, working model
// selection, sourced from the provider tied to that runtime where one exists.
// Model ids follow Cave's existing namespaced convention (`provider/model`),
// matching the live default (`openai/gpt-5.5`).
//
// The curated lists below are a seed. They are intentionally a one-line edit as
// providers ship new models, and `allowCustom` is the safety valve so the menu
// never blocks an id that isn't listed yet. Runtime-managed adapters get
// `provider: null` and render a free-text field only — the literal "else the
// runtime's CLI" branch. That includes Hermes: Cave's Hermes mode means the
// installed Hermes Agent runtime, not a bundled Nous/Hermes model selection.

export type RuntimeProvider = "openai" | "anthropic" | "github" | "nous" | null;

export type RuntimeModelOption = { id: string; label: string };

export type RuntimeModelCatalog = {
  /** Harness id: codex | claude | copilot | hermes | openclaw. */
  runtime: string;
  provider: RuntimeProvider;
  /** Curated seed; empty ⇒ no menu, free-text only. */
  models: RuntimeModelOption[];
  /** Fallback when no curated model exists. Runtime markers are synthetic. */
  defaultModel?: string;
  /** User may type any model id not present in `models`. */
  allowCustom: boolean;
};

export const RUNTIME_MODEL_CATALOG: Record<string, RuntimeModelCatalog> = {
  codex: {
    runtime: "codex",
    provider: "openai",
    models: [
      { id: "openai/gpt-5.5", label: "GPT-5.5" },
      { id: "openai/gpt-5.4", label: "GPT-5.4" },
      { id: "openai/gpt-5.4-mini", label: "GPT-5.4 Mini" },
      { id: "openai/gpt-5.3-codex-spark", label: "GPT-5.3 Codex Spark" },
    ],
    allowCustom: true,
  },
  claude: {
    runtime: "claude",
    provider: "anthropic",
    models: [
      { id: "anthropic/claude-opus-4-8", label: "Claude Opus 4.8" },
      { id: "anthropic/claude-fable-5", label: "Claude Fable 5" },
      { id: "anthropic/claude-opus-4-7", label: "Claude Opus 4.7" },
      { id: "anthropic/claude-sonnet-5", label: "Claude Sonnet 5" },
      { id: "anthropic/claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
      { id: "anthropic/claude-haiku-4-5", label: "Claude Haiku 4.5" },
    ],
    allowCustom: true,
  },
  // Copilot serves multiple providers' models through one GitHub subscription;
  // ids are namespaced under `github/` and forwarded bare to `copilot --model`.
  // `github/auto` stays first: Copilot's own default is letting it pick.
  copilot: {
    runtime: "copilot",
    provider: "github",
    models: [
      { id: "github/auto", label: "Auto (Copilot picks)" },
      { id: "github/gpt-5.5", label: "GPT-5.5" },
      { id: "github/claude-opus-4-8", label: "Claude Opus 4.8" },
      { id: "github/claude-fable-5", label: "Claude Fable 5" },
      { id: "github/claude-sonnet-5", label: "Claude Sonnet 5" },
      { id: "github/claude-haiku-4-5", label: "Claude Haiku 4.5" },
      { id: "github/gemini-3.1-pro", label: "Gemini 3.1 Pro" },
    ],
    allowCustom: true,
  },
  hermes: {
    runtime: "hermes",
    provider: null,
    models: [],
    defaultModel: "hermes-local",
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
  const catalog = catalogForRuntime(runtime);
  return catalog?.models[0]?.id ?? catalog?.defaultModel ?? GLOBAL_DEFAULT_MODEL;
}

export function isModelInCatalog(runtime: string, modelId: string): boolean {
  const catalog = catalogForRuntime(runtime);
  if (!catalog) return false;
  return catalog.models.some((model) => model.id === modelId);
}
