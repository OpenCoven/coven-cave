// Runtime → provider → models map. Pure, dependency-free data + helpers.
//
// "Model parity" means every runtime gets the same first-class, working model
// selection, sourced from the provider tied to that runtime where one exists.
// Model ids follow Cave's existing namespaced convention (`provider/model`),
// matching the live default (`openai/gpt-5.6-sol`).
//
// The curated lists below are a seed. They are intentionally a one-line edit as
// providers ship new models, and `allowCustom` is the safety valve so the menu
// never blocks an id that isn't listed yet. Runtime-managed adapters get
// `provider: null` and render a free-text field only — the literal "else the
// runtime's CLI" branch. Hermes is the exception: its adapter forwards the
// authenticated Codex model ids below through its supported `--model` flag,
// preserving their provider namespace per registry metadata.

export type RuntimeProvider = "openai" | "anthropic" | "github" | "nous" | "xai" | null;

import {
  CLAUDE_OPUS_5_CAVE_ID,
  CLAUDE_OPUS_5_NATIVE_MODEL,
} from "./claude-models.ts";
import { REGISTRY_RUNTIMES } from "./runtime-registry.gen.ts";
import { canonicalHarnessId } from "./harness-adapters.ts";

export type RuntimeModelOption = { id: string; label: string };

export type RuntimeModelInventoryProvenance =
  | "live"
  | "cached"
  | "fallback"
  | "runtime-managed"
  | "unavailable";

export type RuntimeModelInventoryFreshness =
  | "fresh"
  | "cached"
  | "seed"
  | "runtime-managed"
  | "unavailable";

export type RuntimeModelInventoryRefreshState = "ready" | "degraded";
export type RuntimeModelInventoryAvailability = "available" | "degraded" | "unavailable";

/** Non-secret identity for the inventory request. Credential values and
 * provider URLs deliberately never cross this boundary. */
export type RuntimeModelInventoryScope = {
  familiarId: string | null;
  runtime: string;
  provider: RuntimeProvider;
  credentialScope: "familiar" | "global" | "runtime-managed" | "unavailable";
  providerConfiguration: "familiar" | "global" | "runtime-managed" | "unavailable";
};

export type RuntimeModelInventory = {
  runtime: string;
  models: RuntimeModelOption[];
  provenance: RuntimeModelInventoryProvenance;
  freshness: RuntimeModelInventoryFreshness;
  refreshState: RuntimeModelInventoryRefreshState;
  availability: RuntimeModelInventoryAvailability;
  defaultOwner: "cave" | "runtime";
  allowCustom: boolean;
  scope: RuntimeModelInventoryScope;
};

type RuntimeModelTransformMetadata = {
  id: string;
  modelIdTransform?: unknown;
};

const MODEL_PROVIDER_RE = /^[A-Za-z0-9][A-Za-z0-9._:@+-]*$/;
const MODEL_PATH_SEGMENT_RE = /^~?[A-Za-z0-9][A-Za-z0-9._:@+-]*$/;

export function isSafeRuntimeModelId(value: string): boolean {
  if (!value || value.includes("..")) return false;
  const [provider, ...modelPath] = value.split("/");
  if (!MODEL_PROVIDER_RE.test(provider ?? "")) return false;
  return modelPath.every((segment) => MODEL_PATH_SEGMENT_RE.test(segment));
}

/**
 * Apply the adapter registry's model-id transform using the same semantics as
 * Coven's Rust authority layer. Unknown or missing metadata defaults to
 * stripping one non-empty provider segment for compatibility with older
 * registries.
 */
export function transformModelIdForRuntime(
  runtimeId: string,
  modelId: string,
  runtimes: readonly RuntimeModelTransformMetadata[] = REGISTRY_RUNTIMES,
): string {
  const canonicalRuntime = canonicalHarnessId(runtimeId);
  const transform = runtimes.find((runtime) => runtime.id === canonicalRuntime)?.modelIdTransform;
  if (transform === "preserve") return modelId;

  const slash = modelId.indexOf("/");
  const remainder = slash > 0 ? modelId.slice(slash + 1) : "";
  return remainder && !remainder.startsWith("/") ? remainder : modelId;
}

/**
 * Return a model id safe to place in a direct runtime launch. Validation runs
 * after transformation because stripping can expose a flag-shaped value.
 */
export function runtimeModelIdForLaunch(runtimeId: string, modelId: string | null): string | null {
  if (!modelId) return null;
  const transformed = transformModelIdForRuntime(runtimeId, modelId);
  return isSafeRuntimeModelId(transformed) ? transformed : null;
}

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
  /**
   * Who chooses the model when Cave has no explicit familiar/session/turn
   * selection. A runtime-owned default is represented by omitting the model
   * launch argument; catalog entries remain choices, never implicit defaults.
   */
  defaultOwner: "cave" | "runtime";
};

// Models exposed by the authenticated Codex account. Hermes accepts the full
// provider-qualified id through `--model`.
const HERMES_AUTHENTICATED_MODELS: RuntimeModelOption[] = [
  { id: "openai/gpt-5.6-sol", label: "GPT-5.6 Sol" },
  { id: "openai/gpt-5.6-terra", label: "GPT-5.6 Terra" },
  { id: "openai/gpt-5.6-luna", label: "GPT-5.6 Luna" },
  { id: "openai/gpt-5.5", label: "GPT-5.5" },
  { id: "openai/gpt-5.4", label: "GPT-5.4" },
  { id: "openai/gpt-5.4-mini", label: "GPT-5.4 Mini" },
  { id: "openai/gpt-5.3-codex-spark", label: "GPT-5.3 Codex Spark" },
  { id: "openai/codex-auto-review", label: "Codex Auto Review" },
];

export const RUNTIME_MODEL_CATALOG: Record<string, RuntimeModelCatalog> = {
  codex: {
    runtime: "codex",
    provider: "openai",
    models: [
      { id: "openai/gpt-5.6-sol", label: "GPT-5.6 Sol" },
      { id: "openai/gpt-5.6-terra", label: "GPT-5.6 Terra" },
      { id: "openai/gpt-5.6-luna", label: "GPT-5.6 Luna" },
      { id: "openai/gpt-5.5", label: "GPT-5.5" },
      { id: "openai/gpt-5.4", label: "GPT-5.4" },
      { id: "openai/gpt-5.4-mini", label: "GPT-5.4 Mini" },
      { id: "openai/gpt-5.3-codex-spark", label: "GPT-5.3 Codex Spark" },
    ],
    allowCustom: true,
    defaultOwner: "cave",
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
    defaultOwner: "cave",
  },
  // Copilot serves multiple providers' models through one GitHub subscription;
  // ids are namespaced under `github/`; its registry transform removes that
  // first provider segment for direct `copilot --model` launches.
  // `github/auto` stays first: Copilot's own default is letting it pick.
  copilot: {
    runtime: "copilot",
    provider: "github",
    models: [
      { id: "github/auto", label: "Auto (Copilot picks)" },
      { id: "github/gpt-5.6-sol", label: "GPT-5.6 Sol" },
      { id: "github/gpt-5.6-terra", label: "GPT-5.6 Terra" },
      { id: "github/gpt-5.6-luna", label: "GPT-5.6 Luna" },
      { id: "github/gpt-5.5", label: "GPT-5.5" },
      { id: "github/claude-opus-4-8", label: "Claude Opus 4.8" },
      { id: "github/claude-fable-5", label: "Claude Fable 5" },
      { id: "github/claude-sonnet-5", label: "Claude Sonnet 5" },
      { id: "github/claude-haiku-4-5", label: "Claude Haiku 4.5" },
      { id: "github/gemini-3.1-pro", label: "Gemini 3.1 Pro" },
    ],
    allowCustom: true,
    defaultOwner: "cave",
  },
  hermes: {
    runtime: "hermes",
    provider: "openai",
    models: HERMES_AUTHENTICATED_MODELS,
    allowCustom: true,
    defaultOwner: "runtime",
  },
  // Grok's authenticated catalog is discovered live by `/api/harnesses` for
  // Familiar Studio; this fallback keeps non-web surfaces on a valid known
  // default without pretending Cave owns a static xAI catalog.
  grok: {
    runtime: "grok",
    provider: "xai",
    models: [],
    defaultModel: "grok-4.5",
    allowCustom: true,
    defaultOwner: "runtime",
  },
  // OpenCode authenticates a user-selected set of providers. Its menu is
  // loaded from `opencode models` at runtime instead of freezing a catalog.
  opencode: {
    runtime: "opencode",
    provider: null,
    models: [],
    defaultModel: "",
    allowCustom: true,
    defaultOwner: "runtime",
  },
  // No clean provider → defer to the runtime's own CLI: free-text only, no menu.
  openclaw: {
    runtime: "openclaw",
    provider: null,
    models: [],
    allowCustom: true,
    defaultOwner: "runtime",
  },
};

const GLOBAL_DEFAULT_MODEL = "openai/gpt-5.6-sol";

const DYNAMIC_INVENTORY_RUNTIMES = new Set([
  "claude",
  "copilot",
  "grok",
  "hermes",
  "opencode",
]);

export function runtimeModelInventoryScope(
  runtime: string,
  familiarId?: string | null,
): RuntimeModelInventoryScope {
  const canonicalRuntime = canonicalHarnessId(runtime);
  const normalizedFamiliarId = typeof familiarId === "string" && familiarId.trim()
    ? familiarId.trim()
    : null;
  const catalog = catalogForRuntime(canonicalRuntime);
  const knownRuntime = catalog !== null;
  const credentialScope = !knownRuntime
    ? "unavailable"
    : DYNAMIC_INVENTORY_RUNTIMES.has(canonicalRuntime)
      ? normalizedFamiliarId ? "familiar" : "global"
      : catalog?.provider
        ? "global"
        : "runtime-managed";
  const providerConfiguration = !knownRuntime
    ? "unavailable"
    : DYNAMIC_INVENTORY_RUNTIMES.has(canonicalRuntime)
      ? normalizedFamiliarId ? "familiar" : "global"
      : catalog?.provider
        ? "global"
        : "runtime-managed";
  return {
    familiarId: normalizedFamiliarId,
    runtime: canonicalRuntime,
    provider: catalog?.provider ?? null,
    credentialScope,
    providerConfiguration,
  };
}

export function runtimeModelInventoryFreshness(
  provenance: RuntimeModelInventoryProvenance,
): RuntimeModelInventoryFreshness {
  switch (provenance) {
    case "live": return "fresh";
    case "cached": return "cached";
    case "fallback": return "seed";
    case "runtime-managed": return "runtime-managed";
    case "unavailable": return "unavailable";
  }
}

export function runtimeModelInventoryAvailability(
  provenance: RuntimeModelInventoryProvenance,
): RuntimeModelInventoryAvailability {
  switch (provenance) {
    case "live":
    case "cached":
      return "available";
    case "fallback":
    case "runtime-managed":
      return "degraded";
    case "unavailable":
      return "unavailable";
  }
}

export function runtimeModelInventoryRefreshState(
  provenance: RuntimeModelInventoryProvenance,
): RuntimeModelInventoryRefreshState {
  return provenance === "live" || provenance === "cached" ? "ready" : "degraded";
}

export function catalogForRuntime(runtime: string): RuntimeModelCatalog | null {
  const canonicalRuntime = canonicalHarnessId(runtime);
  const curated = RUNTIME_MODEL_CATALOG[canonicalRuntime];
  if (curated) return curated;
  // Registry-synced runtimes without a curated list get the runtime-managed
  // treatment: no menu, free-text only (same branch as openclaw above).
  if (REGISTRY_RUNTIMES.some((entry) => entry.id === canonicalRuntime)) {
    return {
      runtime: canonicalRuntime,
      provider: null,
      models: [],
      allowCustom: true,
      defaultOwner: "runtime",
    };
  }
  return null;
}

export function defaultModelForRuntime(runtime: string): string {
  const catalog = catalogForRuntime(runtime);
  return catalog?.models[0]?.id ?? catalog?.defaultModel ?? GLOBAL_DEFAULT_MODEL;
}

/** Whether an unselected launch must defer to the runtime/provider config. */
export function runtimeOwnsModelDefault(runtime: string): boolean {
  const canonical = canonicalHarnessId(runtime);
  return catalogForRuntime(canonical)?.defaultOwner === "runtime";
}

/**
 * Resolve the model value persisted during a runtime switch. Explicit user
 * selections win; otherwise the explicit empty value records runtime-default
 * intent so config merge paths do not reconstruct a stale previous model.
 */
export function modelForRuntimeSwitch(
  _runtime: string,
  selectedModel?: string | null,
): string {
  const explicitModel = selectedModel?.trim() ?? "";
  if (explicitModel) return explicitModel;
  // A runtime switch without a user model pick is a default-intent change.
  // Catalog entries are conservative seeds, never an implicit launch override.
  return "";
}

export function isModelInCatalog(runtime: string, modelId: string): boolean {
  const catalog = catalogForRuntime(runtime);
  if (!catalog) return false;
  return catalog.models.some((model) => model.id === modelId);
}

/** Translate a stable Cave model id only at the native runtime boundary. */
export function modelForRuntimeLaunch(runtime: string, modelId: string): string {
  const canonicalRuntime = canonicalHarnessId(runtime);
  if (canonicalRuntime === "claude" && modelId === CLAUDE_OPUS_5_CAVE_ID) {
    return CLAUDE_OPUS_5_NATIVE_MODEL;
  }
  return modelId;
}

function bareModelId(modelId: string): string {
  return modelId.includes("/")
    ? modelId.slice(modelId.indexOf("/") + 1)
    : modelId;
}

/**
 * Convert a transport/native echo back to the stable id Cave selected.
 * Runtimes may echo either the namespaced transport value or the bare value
 * they received after Coven/native argv normalization. An unexpected resolved
 * model remains authoritative.
 */
export function modelForCaveFromRuntimeEcho(
  runtime: string,
  requestedModelId: string,
  echoedModelId: string,
): string {
  const transportModelId = modelForRuntimeLaunch(runtime, requestedModelId);
  const expectedEchoes = new Set([
    requestedModelId,
    bareModelId(requestedModelId),
    transportModelId,
    bareModelId(transportModelId),
  ]);
  return expectedEchoes.has(echoedModelId)
    ? requestedModelId
    : echoedModelId;
}
